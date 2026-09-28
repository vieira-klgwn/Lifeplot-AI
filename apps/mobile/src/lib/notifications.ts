import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { apiRequest } from './api';
import type { Reminder, ScheduleEvent, Task } from '../types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForLocalNotifications(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Schedule reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4F7DF3',
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  return granted;
}

export async function clearPushToken(): Promise<void> {
  await apiRequest('/users/me/push-token', { method: 'PUT', body: { pushToken: null } }).catch(
    () => undefined,
  );
}

let reconciliation: Promise<void> = Promise.resolve();

export function reconcileLocalReminders(
  reminders: Reminder[],
  events: ScheduleEvent[],
  tasks: Task[],
  enabled: boolean,
  userId: string,
): Promise<void> {
  reconciliation = reconciliation.catch(() => undefined).then(() =>
    scheduleLocalReminders(reminders, events, tasks, enabled, userId));
  return reconciliation;
}

async function scheduleLocalReminders(
  reminders: Reminder[],
  events: ScheduleEvent[],
  tasks: Task[],
  enabled: boolean,
  userId: string,
): Promise<void> {
  if (Platform.OS === 'web') return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const owned = scheduled.filter((item) => item.content.data?.lifePilotUserId === userId);
  const eventTitles = new Map(events.map((event) => [event.id, event.title]));
  const taskTitles = new Map(tasks.map((task) => [task.id, task.title]));
  const target = new Map(
    (enabled ? reminders : [])
      .filter((item) => new Date(item.fireAt).getTime() > Date.now())
      .slice(0, 50)
      .map((item) => {
        const title = (item.eventId && eventTitles.get(item.eventId)) ||
          (item.taskId && taskTitles.get(item.taskId)) || 'Upcoming commitment';
        return [item.id, { ...item, title }] as const;
      }),
  );

  for (const item of owned) {
    const id = item.content.data?.lifePilotReminderId;
    const desired = typeof id === 'string' ? target.get(id) : undefined;
    if (!desired || item.content.data?.fireAt !== desired.fireAt ||
      item.content.title !== desired.title) {
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
    } else {
      if (typeof id === 'string') target.delete(id);
    }
  }

  for (const item of target.values()) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: item.title,
        body: 'A LifePilot reminder is due.',
        data: { lifePilotReminderId: item.id, lifePilotUserId: userId, fireAt: item.fireAt },
        ...(Platform.OS === 'android' ? { channelId: 'reminders' } : {}),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(item.fireAt) },
    });
  }
}
