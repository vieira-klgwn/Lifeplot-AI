import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export type AnalyticsName =
  | 'onboarding_completed'
  | 'schedule_created'
  | 'ai_request_sent'
  | 'event_created'
  | 'event_modified'
  | 'event_deleted'
  | 'reminder_created'
  | 'task_created';

/**
 * Local, privacy-conscious analytics sink: names plus non-identifying counters
 * only. Swap this module for a vendor SDK without touching call sites.
 */
export async function track(
  name: AnalyticsName,
  userId: string | null,
  props: Record<string, string | number | boolean> = {},
): Promise<void> {
  try {
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { analyticsEnabled: true },
      });
      if (!user?.analyticsEnabled) return;
    }
    await prisma.analyticsEvent.create({ data: { name, userId, props } });
  } catch (error) {
    logger.debug({ err: error, name }, 'Analytics write skipped');
  }
}
