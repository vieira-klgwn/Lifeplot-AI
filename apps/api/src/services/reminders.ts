import type { Event, Reminder, Task, User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import { addMinutes } from '../lib/time.js';

export const REMINDER_PRESETS = [5, 10, 15, 30, 60, 120, 1440] as const;

function assertMinutes(minutesBefore: number): void {
  if (!Number.isInteger(minutesBefore) || minutesBefore < 0 || minutesBefore > 60 * 24 * 14) {
    throw badRequest('Reminder must be between 0 minutes and 14 days before the event');
  }
}

/**
 * Rewrites the pending reminders of an event so they always match its current
 * start time. Passing `undefined` keeps the existing offsets (used when only
 * the time changed), `null` removes them.
 */
export async function syncRemindersForEvent(
  user: User,
  event: Event,
  minutesBefore?: number | null,
): Promise<Reminder[]> {
  const existing = await prisma.reminder.findMany({
    where: { userId: user.id, eventId: event.id, status: 'PENDING' },
  });

  let offsets: number[];
  if (minutesBefore === null) {
    offsets = [];
  } else if (minutesBefore === undefined) {
    offsets = existing.map((r) => r.minutesBefore);
  } else {
    assertMinutes(minutesBefore);
    offsets = [minutesBefore];
  }

  await prisma.reminder.deleteMany({
    where: { userId: user.id, eventId: event.id, status: 'PENDING' },
  });

  if (event.cancelled || offsets.length === 0) return [];

  await prisma.reminder.createMany({
    data: offsets.map((offset) => ({
      userId: user.id,
      eventId: event.id,
      minutesBefore: offset,
      fireAt: addMinutes(event.startTime, -offset),
    })),
  });

  return prisma.reminder.findMany({
    where: { userId: user.id, eventId: event.id, status: 'PENDING' },
    orderBy: { fireAt: 'asc' },
  });
}

export async function syncRemindersForTask(
  user: User,
  task: Task,
  minutesBefore?: number | null,
): Promise<Reminder[]> {
  const existing = await prisma.reminder.findMany({
    where: { userId: user.id, taskId: task.id, status: 'PENDING' },
  });

  let offsets: number[];
  if (minutesBefore === null) {
    offsets = [];
  } else if (minutesBefore === undefined) {
    offsets = existing.map((r) => r.minutesBefore);
  } else {
    assertMinutes(minutesBefore);
    offsets = [minutesBefore];
  }

  await prisma.reminder.deleteMany({
    where: { userId: user.id, taskId: task.id, status: 'PENDING' },
  });

  if (!task.deadline || task.status === 'DONE' || task.status === 'CANCELLED' || offsets.length === 0) {
    return [];
  }

  const deadline = task.deadline;
  await prisma.reminder.createMany({
    data: offsets.map((offset) => ({
      userId: user.id,
      taskId: task.id,
      minutesBefore: offset,
      fireAt: addMinutes(deadline, -offset),
    })),
  });

  return prisma.reminder.findMany({
    where: { userId: user.id, taskId: task.id, status: 'PENDING' },
    orderBy: { fireAt: 'asc' },
  });
}

export async function listReminders(userId: string, upcomingOnly = true): Promise<Reminder[]> {
  return prisma.reminder.findMany({
    where: {
      userId,
      ...(upcomingOnly ? { status: 'PENDING', fireAt: { gte: new Date() } } : {}),
    },
    orderBy: { fireAt: 'asc' },
    take: 200,
  });
}

export async function removeReminder(userId: string, reminderId: string): Promise<void> {
  const reminder = await prisma.reminder.findFirst({ where: { id: reminderId, userId } });
  if (!reminder) throw notFound('Reminder not found');
  await prisma.reminder.delete({ where: { id: reminder.id } });
}

/** Recomputes every future reminder after a timezone change or bulk edit. */
export async function reconcileUserReminders(userId: string): Promise<number> {
  const reminders = await prisma.reminder.findMany({
    where: { userId, status: 'PENDING' },
    include: { event: true, task: true },
  });

  let updated = 0;
  for (const reminder of reminders) {
    const anchor = reminder.event?.startTime ?? reminder.task?.deadline;
    if (!anchor) continue;
    const fireAt = addMinutes(anchor, -reminder.minutesBefore);
    if (fireAt.getTime() !== reminder.fireAt.getTime()) {
      await prisma.reminder.update({ where: { id: reminder.id }, data: { fireAt } });
      updated += 1;
    }
  }
  return updated;
}
