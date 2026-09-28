export type EventCategory =
  | 'CLASS'
  | 'EXAM'
  | 'ASSIGNMENT'
  | 'MEETING'
  | 'STUDY'
  | 'PERSONAL'
  | 'OTHER';

export interface ScheduleEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  category: EventCategory;
  startTime: string;
  endTime: string;
  recurrenceRuleId: string | null;
  cancelled: boolean;
  createdBy: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  estimatedMinutes: number | null;
  status: 'PENDING' | 'SCHEDULED' | 'DONE' | 'CANCELLED';
  priority: number;
  goalId: string | null;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: number;
  targetDate: string | null;
  weeklyMinutes: number;
  progress: number;
  notes: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
}

export interface Reminder {
  id: string;
  eventId: string | null;
  taskId: string | null;
  minutesBefore: number;
  fireAt: string;
  status: string;
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  university: string | null;
  timezone: string;
  weekStartsOn: number;
  defaultReminderMinutes: number;
  wakeTime: string;
  bedTime: string;
  workStartTime: string;
  workEndTime: string;
  breakMinutes: number;
  protectEvenings: boolean;
  categoryReminderMinutes: Record<string, number>;
  notificationsEnabled: boolean;
  analyticsEnabled: boolean;
  onboardedAt: string | null;
}

export interface ChatAction {
  tool: string;
  ok: boolean;
  summary: string;
  data?: unknown;
}

export interface ChatResponse {
  conversationId: string;
  messageId: string;
  reply: string;
  actions: ChatAction[];
  needsConfirmation: boolean;
  canUndo: boolean;
}

export interface Plan {
  date: string;
  revision: string;
  sessions: { taskId?: string; goalId?: string; title: string; startTime: string; endTime: string }[];
  unscheduled: { taskId?: string; goalId?: string; title: string; reason: string }[];
}

export interface FreeSlot {
  start: string;
  end: string;
}
