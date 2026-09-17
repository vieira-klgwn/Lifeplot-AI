import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { formatInZone } from '../lib/time.js';
import { isExpoPushToken, sendPush, type PushMessage } from './push.js';

const BATCH_SIZE = 100;

/**
 * Delivers every reminder whose fire time has passed. Runs on a timer inside
 * the API process so notifications do not depend on the app (or the AI) being
 * open; the mobile client additionally schedules a local notification as an
 * offline fallback.
 */
export async function dispatchDueReminders(now = new Date()): Promise<{ sent: number; failed: number }> {
  const due = await prisma.reminder.findMany({
    where: { status: 'PENDING', fireAt: { lte: now } },
    include: { user: true, event: true, task: true },
    orderBy: { fireAt: 'asc' },
    take: BATCH_SIZE,
  });

  if (due.length === 0) return { sent: 0, failed: 0 };

  const deliverable = due.filter(
    (reminder) =>
      reminder.user.notificationsEnabled &&
      reminder.user.pushToken !== null &&
      isExpoPushToken(reminder.user.pushToken) &&
      (reminder.event !== null || reminder.task !== null) &&
      !(reminder.event?.cancelled ?? false),
  );

  const skipped = due.filter((reminder) => !deliverable.includes(reminder));
  if (skipped.length > 0) {
    await prisma.reminder.updateMany({
      where: { id: { in: skipped.map((r) => r.id) } },
      data: { status: 'CANCELLED', failureReason: 'No deliverable target' },
    });
  }

  const messages: PushMessage[] = deliverable.map((reminder) => {
    const timezone = reminder.user.timezone;
    if (reminder.event) {
      return {
        to: reminder.user.pushToken as string,
        title: reminder.event.title,
        body: buildEventBody(reminder.minutesBefore, formatInZone(reminder.event.startTime, timezone, 'h:mm a'), reminder.event.location),
        data: { type: 'event', id: reminder.event.id },
      };
    }
    const task = reminder.task as NonNullable<typeof reminder.task>;
    return {
      to: reminder.user.pushToken as string,
      title: task.title,
      body: task.deadline
        ? `Due ${formatInZone(task.deadline, timezone, "EEE d MMM 'at' h:mm a")}`
        : 'Deadline coming up',
      data: { type: 'task', id: task.id },
    };
  });

  const results = await sendPush(messages);
  let sent = 0;
  let failed = 0;

  for (const [index, reminder] of deliverable.entries()) {
    const result = results[index];
    if (result?.ok) {
      sent += 1;
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    } else {
      failed += 1;
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: 'FAILED', failureReason: result?.error ?? 'Unknown error' },
      });
    }
  }

  logger.debug({ sent, failed }, 'Reminder batch dispatched');
  return { sent, failed };
}

function buildEventBody(minutesBefore: number, startsAt: string, location: string | null): string {
  const lead =
    minutesBefore === 0
      ? 'Starting now'
      : minutesBefore % 1440 === 0
        ? `In ${minutesBefore / 1440} day(s)`
        : minutesBefore % 60 === 0
          ? `In ${minutesBefore / 60} hour(s)`
          : `In ${minutesBefore} minutes`;
  return location ? `${lead} at ${startsAt} - ${location}` : `${lead} at ${startsAt}`;
}

export function startReminderWorker(intervalMs = 60_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    dispatchDueReminders().catch((error) => logger.error({ err: error }, 'Reminder worker failed'));
  }, intervalMs);
  timer.unref();
  return timer;
}
