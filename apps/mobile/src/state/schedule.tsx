import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { addDays, format } from 'date-fns';
import { apiRequest, OfflineError } from '../lib/api';
import { cache } from '../lib/storage';
import { DATE_FORMAT } from '../lib/dates';
import { reconcileLocalReminders } from '../lib/notifications';
import { useAuth } from './auth';
import type { Reminder, ScheduleEvent, Task } from '../types';

interface ScheduleValue {
  events: ScheduleEvent[];
  tasks: Task[];
  loading: boolean;
  offline: boolean;
  refresh: () => Promise<void>;
  eventsOn: (date: Date) => ScheduleEvent[];
}

const ScheduleContext = createContext<ScheduleValue | null>(null);

/** Two months of schedule are kept locally so the app opens without a network. */
const WINDOW_DAYS_BACK = 21;
const WINDOW_DAYS_FORWARD = 45;

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const activeUserId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setEvents([]);
      setTasks([]);
      if (activeUserId.current) {
        void reconcileLocalReminders([], [], [], false, activeUserId.current);
        activeUserId.current = null;
      }
      return;
    }
    if (activeUserId.current && activeUserId.current !== user.id) {
      await reconcileLocalReminders([], [], [], false, activeUserId.current);
      setEvents([]);
      setTasks([]);
    }
    activeUserId.current = user.id;
    setLoading(true);
    const today = new Date();
    const from = format(addDays(today, -WINDOW_DAYS_BACK), DATE_FORMAT);
    const to = format(addDays(today, WINDOW_DAYS_FORWARD), DATE_FORMAT);
    try {
      const [eventPayload, taskPayload, reminderPayload] = await Promise.all([
        apiRequest<{ events: ScheduleEvent[] }>('/events', { query: { from, to } }),
        apiRequest<{ tasks: Task[] }>('/tasks', { query: { includeDone: true } }),
        apiRequest<{ reminders: Reminder[] }>('/reminders'),
      ]);
      if (activeUserId.current !== user.id) return;
      setEvents(eventPayload.events);
      setTasks(taskPayload.tasks);
      setOffline(false);
      await cache.write(`${user.id}.events`, eventPayload.events);
      await cache.write(`${user.id}.tasks`, taskPayload.tasks);
      await reconcileLocalReminders(
        reminderPayload.reminders, eventPayload.events, taskPayload.tasks,
        user.notificationsEnabled, user.id,
      ).catch(() => undefined);
    } catch (error) {
      if (activeUserId.current !== user.id) return;
      const [cachedEvents, cachedTasks] = await Promise.all([
        cache.read<ScheduleEvent[]>(`${user.id}.events`),
        cache.read<Task[]>(`${user.id}.tasks`),
      ]);
      if (cachedEvents) setEvents(cachedEvents);
      if (cachedTasks) setTasks(cachedTasks);
      setOffline(error instanceof OfflineError);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    Promise.resolve().then(() => refresh());
  }, [refresh]);

  const value = useMemo<ScheduleValue>(
    () => ({
      events,
      tasks,
      loading,
      offline,
      refresh,
      eventsOn: (date) => {
        const key = format(date, DATE_FORMAT);
        return events
          .filter((event) => format(new Date(event.startTime), DATE_FORMAT) === key)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
      },
    }),
    [events, loading, offline, refresh, tasks],
  );

  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}

export function useSchedule(): ScheduleValue {
  const value = useContext(ScheduleContext);
  if (!value) throw new Error('useSchedule must be used inside ScheduleProvider');
  return value;
}
