import { createHash } from 'node:crypto';
import { addDays, format } from 'date-fns';
import type { Event, Goal, Task, User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { conflict } from '../lib/errors.js';
import { findFreeSlots } from './freeTime.js';
import { formatInZone, zonedToUtc } from '../lib/time.js';

export interface PlannedSession {
  taskId?: string;
  goalId?: string;
  title: string;
  startTime: string;
  endTime: string;
}

export interface Plan {
  date: string;
  revision: string;
  sessions: PlannedSession[];
  unscheduled: { taskId?: string; goalId?: string; title: string; reason: string }[];
}

const PLAN_DAYS = 7;
const MAX_WORK_MINUTES_PER_DAY = 360;

export function buildPlan(user: User, tasks: Task[], events: Event[], goals: Goal[], date: string, now: Date): Plan {
  const days = Array.from({ length: PLAN_DAYS }, (_, index) =>
    format(addDays(new Date(`${date}T12:00:00Z`), index), 'yyyy-MM-dd'));
  const busy = events.map((event) => ({ startTime: event.startTime, endTime: event.endTime }));
  const sessions: PlannedSession[] = [];
  const unscheduled: Plan['unscheduled'] = [];
  const dailyMinutes = new Map<string, number>();
  for (const event of events.filter((item) => item.category === 'STUDY' && item.createdBy === 'PLAN')) {
    const day = formatInZone(event.startTime, user.timezone, 'yyyy-MM-dd');
    dailyMinutes.set(day, (dailyMinutes.get(day) ?? 0) +
      Math.round((event.endTime.getTime() - event.startTime.getTime()) / 60_000));
  }
  const workEnd = user.protectEvenings && user.workEndTime > '19:00' ? '19:00' : user.workEndTime;
  const availableEnd = workEnd < user.bedTime ? workEnd : user.bedTime;
  const availableStart = user.workStartTime > user.wakeTime ? user.workStartTime : user.wakeTime;
  const candidates = tasks
    .filter((task) => task.status === 'PENDING' && task.estimatedMinutes && task.estimatedMinutes > 0)
    .sort((a, b) =>
      (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity) ||
      b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime());

  for (const task of candidates) {
    const duration = task.estimatedMinutes!;
    let placed = false;
    for (const day of days) {
      if ((dailyMinutes.get(day) ?? 0) + duration > MAX_WORK_MINUTES_PER_DAY) continue;
      const slots = findFreeSlots({
        days: [day], timezone: user.timezone, durationMinutes: duration,
        dayStart: availableStart, dayEnd: availableEnd,
        busy, notBefore: now, notAfter: task.deadline ?? undefined, limit: 1,
      });
      const slot = slots[0];
      if (!slot) continue;
      sessions.push({ taskId: task.id, title: task.title, startTime: slot.start.toISOString(), endTime: slot.end.toISOString() });
      dailyMinutes.set(day, (dailyMinutes.get(day) ?? 0) + duration);
      busy.push({ startTime: slot.start, endTime: new Date(slot.end.getTime() + user.breakMinutes * 60_000) });
      placed = true;
      break;
    }
    if (!placed) unscheduled.push({
      taskId: task.id, title: task.title,
      reason: task.deadline ? 'No free working time before the deadline.' : 'No free working time in the next seven days.',
    });
  }

  for (const goal of goals.filter((item) => item.status === 'ACTIVE' && item.weeklyMinutes > 0)
    .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime())) {
    const committed = events.filter((event) => event.goalId === goal.id && event.createdBy === 'PLAN')
      .reduce((minutes, event) => minutes + (event.endTime.getTime() - event.startTime.getTime()) / 60_000, 0);
    let remaining = Math.max(0, goal.weeklyMinutes - committed -
      sessions.filter((session) => session.taskId && tasks.some((task) =>
        task.id === session.taskId && task.goalId === goal.id))
        .reduce((minutes, session) => minutes +
          (new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 60_000, 0));
    for (const day of days) {
      if (remaining < 5) break;
      if (goal.targetDate && day > goal.targetDate.toISOString().slice(0, 10)) break;
      while (remaining >= 5) {
        const available = MAX_WORK_MINUTES_PER_DAY - (dailyMinutes.get(day) ?? 0);
        const duration = Math.min(60, remaining, available);
        if (duration < 5) break;
        const slot = findFreeSlots({
          days: [day], timezone: user.timezone, durationMinutes: duration,
          dayStart: availableStart, dayEnd: availableEnd, busy, notBefore: now, limit: 1,
        })[0];
        if (!slot) break;
        sessions.push({ goalId: goal.id, title: goal.title, startTime: slot.start.toISOString(), endTime: slot.end.toISOString() });
        busy.push({ startTime: slot.start, endTime: new Date(slot.end.getTime() + user.breakMinutes * 60_000) });
        dailyMinutes.set(day, (dailyMinutes.get(day) ?? 0) + duration);
        remaining -= duration;
      }
    }
    if (remaining >= 5) unscheduled.push({
      goalId: goal.id, title: goal.title,
      reason: `Could not fit ${Math.ceil(remaining)} more minutes of goal work into this week.`,
    });
  }

  const revision = createHash('sha256').update(JSON.stringify({
    date, now: Math.floor(now.getTime() / 60000), user: [user.wakeTime, user.bedTime, user.workStartTime, user.workEndTime, user.protectEvenings, user.breakMinutes],
    tasks: tasks.map((task) => [task.id, task.updatedAt.toISOString(), task.status, task.deadline?.toISOString(), task.estimatedMinutes]),
    goals: goals.map((goal) => [goal.id, goal.updatedAt.toISOString(), goal.status, goal.weeklyMinutes]),
    events: events.map((event) => [event.id, event.updatedAt.toISOString(), event.startTime.toISOString(), event.endTime.toISOString()]),
  })).digest('hex');
  return { date, revision, sessions, unscheduled };
}

export async function previewPlan(user: User, date: string, now = new Date()): Promise<Plan> {
  const from = zonedToUtc(date, '00:00', user.timezone);
  const to = zonedToUtc(format(addDays(new Date(`${date}T12:00:00Z`), PLAN_DAYS), 'yyyy-MM-dd'), '00:00', user.timezone);
  const [tasks, events, goals] = await Promise.all([
    prisma.task.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
    prisma.event.findMany({ where: { userId: user.id, cancelled: false, startTime: { lt: to }, endTime: { gt: from } }, orderBy: { id: 'asc' } }),
    prisma.goal.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
  ]);
  return buildPlan(user, tasks, events, goals, date, now);
}

export async function applyPlan(userId: string, date: string, revision: string) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const from = zonedToUtc(date, '00:00', user.timezone);
    const to = zonedToUtc(format(addDays(new Date(`${date}T12:00:00Z`), PLAN_DAYS), 'yyyy-MM-dd'), '00:00', user.timezone);
    const tasks = await tx.task.findMany({ where: { userId }, orderBy: { id: 'asc' } });
    const events = await tx.event.findMany({
      where: { userId, cancelled: false, startTime: { lt: to }, endTime: { gt: from } }, orderBy: { id: 'asc' },
    });
    const goals = await tx.goal.findMany({ where: { userId }, orderBy: { id: 'asc' } });
    const plan = buildPlan(user, tasks, events, goals, date, new Date());
    if (plan.revision !== revision) throw conflict('Your schedule changed. Preview the plan again.');
    for (const session of plan.sessions) {
      const startTime = new Date(session.startTime);
      const event = await tx.event.create({
        data: { userId, taskId: session.taskId,
          goalId: session.goalId ?? tasks.find((task) => task.id === session.taskId)?.goalId,
          title: session.title, startTime,
          endTime: new Date(session.endTime), category: 'STUDY', createdBy: 'PLAN' },
      });
      if (session.taskId) await tx.task.update({ where: { id: session.taskId }, data: { status: 'SCHEDULED' } });
      const fireAt = new Date(startTime.getTime() - user.defaultReminderMinutes * 60_000);
      if (fireAt > new Date()) await tx.reminder.create({
        data: { userId, eventId: event.id, minutesBefore: user.defaultReminderMinutes, fireAt },
      });
    }
    return { added: plan.sessions.length, unscheduled: plan.unscheduled };
  }, { isolationLevel: 'Serializable' });
}

export function planningDate(user: User): string {
  return formatInZone(new Date(), user.timezone, 'yyyy-MM-dd');
}
