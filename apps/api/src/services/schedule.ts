import type { Event, EventCategory, Prisma, Task, User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import { dayBoundsUtc, zonedDateKey } from '../lib/time.js';
import { expandOccurrences } from './recurrence.js';
import { findFreeSlots, type FreeSlot } from './freeTime.js';
import { syncRemindersForEvent, syncRemindersForTask } from './reminders.js';

export type EditScope = 'this' | 'future' | 'all';

export interface CreateEventInput {
  title: string;
  startTime: Date;
  endTime: Date;
  description?: string | null;
  location?: string | null;
  category?: EventCategory;
  reminderMinutes?: number | null;
  createdBy?: string;
  taskId?: string | null;
}

export interface EventWithConflicts {
  event: Event;
  conflicts: Event[];
}

const activeEvent = { cancelled: false } satisfies Prisma.EventWhereInput;

export function defaultReminderMinutes(user: User, category: EventCategory): number {
  const overrides = (user.categoryReminderMinutes ?? {}) as Record<string, unknown>;
  const override = overrides[category];
  return typeof override === 'number' && Number.isFinite(override)
    ? override
    : user.defaultReminderMinutes;
}

export async function listEvents(
  userId: string,
  range: { from: Date; to: Date },
): Promise<Event[]> {
  return prisma.event.findMany({
    where: {
      userId,
      ...activeEvent,
      startTime: { lt: range.to },
      endTime: { gt: range.from },
    },
    orderBy: { startTime: 'asc' },
  });
}

export async function getEvent(userId: string, eventId: string): Promise<Event> {
  const event = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!event) throw notFound('Event not found');
  return event;
}

export async function findConflicts(
  userId: string,
  startTime: Date,
  endTime: Date,
  excludeEventId?: string,
): Promise<Event[]> {
  return prisma.event.findMany({
    where: {
      userId,
      ...activeEvent,
      id: excludeEventId ? { not: excludeEventId } : undefined,
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    },
    orderBy: { startTime: 'asc' },
  });
}

export async function createEvent(
  user: User,
  input: CreateEventInput,
): Promise<EventWithConflicts> {
  assertValidRange(input.startTime, input.endTime);
  const category = input.category ?? 'OTHER';

  const event = await prisma.event.create({
    data: {
      userId: user.id,
      title: input.title,
      description: input.description ?? null,
      startTime: input.startTime,
      endTime: input.endTime,
      location: input.location ?? null,
      category,
      createdBy: input.createdBy ?? 'USER',
      taskId: input.taskId ?? null,
    },
  });

  const minutesBefore =
    input.reminderMinutes === null ? null : (input.reminderMinutes ?? defaultReminderMinutes(user, category));
  await syncRemindersForEvent(user, event, minutesBefore);

  return { event, conflicts: await findConflicts(user.id, event.startTime, event.endTime, event.id) };
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  startTime?: Date;
  endTime?: Date;
  location?: string | null;
  category?: EventCategory;
  reminderMinutes?: number | null;
}

export async function updateEvent(
  user: User,
  eventId: string,
  input: UpdateEventInput,
  scope: EditScope = 'this',
): Promise<EventWithConflicts> {
  const existing = await getEvent(user.id, eventId);
  const startTime = input.startTime ?? existing.startTime;
  const endTime = input.endTime ?? existing.endTime;
  assertValidRange(startTime, endTime);

  const data: Prisma.EventUpdateInput = {
    title: input.title ?? undefined,
    description: input.description === undefined ? undefined : input.description,
    location: input.location === undefined ? undefined : input.location,
    category: input.category ?? undefined,
    startTime: input.startTime ?? undefined,
    endTime: input.endTime ?? undefined,
  };

  if (scope !== 'this' && existing.recurrenceRuleId) {
    await updateSeries(user, existing, input, scope);
  }

  const event = await prisma.event.update({ where: { id: existing.id }, data });
  await syncRemindersForEvent(user, event, input.reminderMinutes);

  return { event, conflicts: await findConflicts(user.id, event.startTime, event.endTime, event.id) };
}

/**
 * Applies title/location/category edits and time shifts to the rest of a
 * recurring series. Times move by the same delta so each occurrence keeps its
 * own date.
 */
async function updateSeries(
  user: User,
  pivot: Event,
  input: UpdateEventInput,
  scope: EditScope,
): Promise<void> {
  const siblings = await prisma.event.findMany({
    where: {
      userId: user.id,
      recurrenceRuleId: pivot.recurrenceRuleId,
      id: { not: pivot.id },
      ...(scope === 'future' ? { startTime: { gt: pivot.startTime } } : {}),
    },
  });

  const startDelta = input.startTime ? input.startTime.getTime() - pivot.startTime.getTime() : 0;
  const endDelta = input.endTime ? input.endTime.getTime() - pivot.endTime.getTime() : 0;

  for (const sibling of siblings) {
    const updated = await prisma.event.update({
      where: { id: sibling.id },
      data: {
        title: input.title ?? undefined,
        description: input.description === undefined ? undefined : input.description,
        location: input.location === undefined ? undefined : input.location,
        category: input.category ?? undefined,
        startTime: startDelta ? new Date(sibling.startTime.getTime() + startDelta) : undefined,
        endTime: endDelta ? new Date(sibling.endTime.getTime() + endDelta) : undefined,
      },
    });
    await syncRemindersForEvent(user, updated, input.reminderMinutes);
  }
}

export async function deleteEvent(
  user: User,
  eventId: string,
  scope: EditScope = 'this',
): Promise<{ deleted: number }> {
  const existing = await getEvent(user.id, eventId);

  if (scope === 'this' || !existing.recurrenceRuleId) {
    await prisma.event.delete({ where: { id: existing.id } });
    return { deleted: 1 };
  }

  const where: Prisma.EventWhereInput = {
    userId: user.id,
    recurrenceRuleId: existing.recurrenceRuleId,
    ...(scope === 'future' ? { startTime: { gte: existing.startTime } } : {}),
  };
  const { count } = await prisma.event.deleteMany({ where });

  if (scope === 'all') {
    await prisma.recurrenceRule.deleteMany({
      where: { id: existing.recurrenceRuleId, userId: user.id },
    });
  }
  return { deleted: count };
}

export interface RecurringClassInput {
  title: string;
  courseCode?: string | null;
  professor?: string | null;
  location?: string | null;
  byWeekday: number[];
  startTime: string;
  endTime: string;
  startDate: string;
  endDate: string;
  category?: EventCategory;
  reminderMinutes?: number | null;
}

export async function createRecurringClass(user: User, input: RecurringClassInput) {
  const category = input.category ?? 'CLASS';
  const rule = await prisma.recurrenceRule.create({
    data: {
      userId: user.id,
      title: input.title,
      courseCode: input.courseCode ?? null,
      professor: input.professor ?? null,
      location: input.location ?? null,
      category,
      byWeekday: input.byWeekday,
      startTime: input.startTime,
      endTime: input.endTime,
      startDate: new Date(`${input.startDate}T00:00:00.000Z`),
      endDate: new Date(`${input.endDate}T00:00:00.000Z`),
      timezone: user.timezone,
      reminderMinutes: input.reminderMinutes ?? null,
    },
  });

  const occurrences = expandOccurrences({
    byWeekday: rule.byWeekday,
    startTime: rule.startTime,
    endTime: rule.endTime,
    startDate: rule.startDate,
    endDate: rule.endDate,
    timezone: rule.timezone,
  });

  if (occurrences.length === 0) {
    await prisma.recurrenceRule.delete({ where: { id: rule.id } });
    throw badRequest('That schedule produces no class meetings — check the days and dates.');
  }

  await prisma.event.createMany({
    data: occurrences.map((occurrence) => ({
      userId: user.id,
      title: rule.title,
      description: rule.courseCode ?? undefined,
      startTime: occurrence.startTime,
      endTime: occurrence.endTime,
      location: rule.location,
      category,
      recurrenceRuleId: rule.id,
      occurrenceDate: occurrence.occurrenceDate,
      createdBy: 'USER',
    })),
  });

  const events = await prisma.event.findMany({
    where: { userId: user.id, recurrenceRuleId: rule.id },
    orderBy: { startTime: 'asc' },
  });

  const minutesBefore = input.reminderMinutes ?? defaultReminderMinutes(user, category);
  for (const event of events) {
    await syncRemindersForEvent(user, event, minutesBefore);
  }

  return { rule, events };
}

export async function searchEvents(userId: string, query: string, limit = 20): Promise<Event[]> {
  return prisma.event.findMany({
    where: {
      userId,
      ...activeEvent,
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { location: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { startTime: 'asc' },
    take: limit,
  });
}

export interface FreeTimeQuery {
  days: string[];
  durationMinutes: number;
  dayStart?: string;
  dayEnd?: string;
  notBefore?: Date;
  notAfter?: Date;
  limit?: number;
}

export async function findFreeTime(user: User, query: FreeTimeQuery): Promise<FreeSlot[]> {
  if (query.days.length === 0) return [];
  const sorted = [...query.days].sort();
  const first = sorted[0] as string;
  const last = sorted[sorted.length - 1] as string;
  const searchStart = dayBoundsUtc(first, user.timezone).start;
  const searchEnd = dayBoundsUtc(last, user.timezone).end;
  const busy = await prisma.event.findMany({
    where: {
      userId: user.id,
      ...activeEvent,
      startTime: { lt: searchEnd },
      endTime: { gt: searchStart },
    },
    select: { startTime: true, endTime: true },
  });

  return findFreeSlots({
    days: sorted,
    timezone: user.timezone,
    durationMinutes: query.durationMinutes,
    dayStart: query.dayStart,
    dayEnd: query.dayEnd,
    busy,
    notBefore: query.notBefore,
    notAfter: query.notAfter,
    limit: query.limit,
  });
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  deadline?: Date | null;
  estimatedMinutes?: number | null;
  category?: EventCategory;
  reminderMinutes?: number | null;
  goalId?: string | null;
}

export async function createTask(user: User, input: CreateTaskInput): Promise<Task> {
  if (input.goalId && !await prisma.goal.findFirst({ where: { id: input.goalId, userId: user.id } })) {
    throw notFound('Goal not found');
  }
  const task = await prisma.task.create({
    data: {
      userId: user.id,
      title: input.title,
      description: input.description ?? null,
      deadline: input.deadline ?? null,
      estimatedMinutes: input.estimatedMinutes ?? null,
      category: input.category ?? 'ASSIGNMENT',
      goalId: input.goalId ?? null,
    },
  });
  await syncRemindersForTask(user, task, input.reminderMinutes);
  return task;
}

export async function listTasks(userId: string, includeDone = false): Promise<Task[]> {
  return prisma.task.findMany({
    where: { userId, ...(includeDone ? {} : { status: { not: 'DONE' } }) },
    orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function getTask(userId: string, taskId: string): Promise<Task> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw notFound('Task not found');
  return task;
}

export async function updateTask(
  user: User,
  taskId: string,
  input: Partial<CreateTaskInput> & { status?: Task['status'] },
): Promise<Task> {
  await getTask(user.id, taskId);
  if (input.goalId && !await prisma.goal.findFirst({ where: { id: input.goalId, userId: user.id } })) {
    throw notFound('Goal not found');
  }
  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      title: input.title ?? undefined,
      description: input.description === undefined ? undefined : input.description,
      deadline: input.deadline === undefined ? undefined : input.deadline,
      estimatedMinutes: input.estimatedMinutes === undefined ? undefined : input.estimatedMinutes,
      category: input.category ?? undefined,
      status: input.status ?? undefined,
      goalId: input.goalId === undefined ? undefined : input.goalId,
    },
  });
  await syncRemindersForTask(user, task, input.reminderMinutes);
  return task;
}

export async function deleteTask(userId: string, taskId: string): Promise<void> {
  await getTask(userId, taskId);
  await prisma.task.delete({ where: { id: taskId } });
}

/** Groups events by local calendar day for the mobile agenda views. */
export function groupByLocalDay(events: Event[], timezone: string): Record<string, Event[]> {
  return events.reduce<Record<string, Event[]>>((acc, event) => {
    const key = zonedDateKey(event.startTime, timezone);
    const bucket = acc[key] ?? [];
    bucket.push(event);
    acc[key] = bucket;
    return acc;
  }, {});
}

function assertValidRange(startTime: Date, endTime: Date): void {
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    throw badRequest('Invalid start or end time');
  }
  if (endTime <= startTime) {
    throw badRequest('Event must end after it starts');
  }
  if (endTime.getTime() - startTime.getTime() > 1000 * 60 * 60 * 24 * 7) {
    throw badRequest('Events longer than a week are not supported');
  }
}
