import { z } from 'zod';
import type { Event, User } from '@prisma/client';
import { addDays, format, parseISO } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { formatInZone, zonedToUtc } from '../../lib/time.js';
import {
  createEvent,
  createRecurringClass,
  createTask,
  deleteEvent,
  findFreeTime,
  listEvents,
  searchEvents,
  updateEvent,
  defaultReminderMinutes,
} from '../../services/schedule.js';
import { removeReminder, syncRemindersForEvent } from '../../services/reminders.js';
import { planningDate, previewPlan } from '../../services/planner.js';
import type { ToolDefinition } from './provider/types.js';

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .describe('Local calendar date');
const TIME = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use 24h HH:mm');
const CATEGORY = z.enum(['CLASS', 'EXAM', 'ASSIGNMENT', 'MEETING', 'STUDY', 'PERSONAL', 'OTHER']);
const WEEKDAY = z.number().int().min(0).max(6);

const schemas = {
  create_event: z.object({
    title: z.string().min(1).max(120),
    date: DATE,
    startTime: TIME,
    durationMinutes: z.number().int().min(5).max(24 * 60).default(60),
    location: z.string().max(120).optional(),
    description: z.string().max(500).optional(),
    category: CATEGORY.optional(),
    reminderMinutes: z.number().int().min(0).max(60 * 24 * 14).optional(),
  }),
  create_recurring_event: z.object({
    title: z.string().min(1).max(120),
    byWeekday: z.array(WEEKDAY).min(1).max(7),
    startTime: TIME,
    endTime: TIME,
    startDate: DATE,
    endDate: DATE,
    location: z.string().max(120).optional(),
    courseCode: z.string().max(40).optional(),
    professor: z.string().max(80).optional(),
    category: CATEGORY.optional(),
  }),
  update_event: z.object({
    eventId: z.string().uuid().optional(),
    query: z.string().max(120).optional(),
    date: DATE.optional(),
    newTitle: z.string().min(1).max(120).optional(),
    newDate: DATE.optional(),
    newStartTime: TIME.optional(),
    newDurationMinutes: z.number().int().min(5).max(24 * 60).optional(),
    newLocation: z.string().max(120).optional(),
    scope: z.enum(['this', 'future', 'all']).default('this'),
  }),
  delete_event: z.object({
    eventId: z.string().uuid().optional(),
    query: z.string().max(120).optional(),
    date: DATE.optional(),
    scope: z.enum(['this', 'future', 'all']).default('this'),
    confirm: z.boolean().default(false),
  }),
  get_schedule: z.object({
    date: DATE.optional(),
    fromDate: DATE.optional(),
    toDate: DATE.optional(),
  }),
  find_free_time: z.object({
    fromDate: DATE,
    toDate: DATE,
    durationMinutes: z.number().int().min(15).max(12 * 60),
    earliest: TIME.optional(),
    latest: TIME.optional(),
  }),
  search_events: z.object({ query: z.string().min(1).max(120) }),
  set_reminder: z.object({
    eventId: z.string().uuid().optional(),
    query: z.string().max(120).optional(),
    date: DATE.optional(),
    minutesBefore: z.number().int().min(0).max(60 * 24 * 14),
  }),
  remove_reminder: z.object({
    eventId: z.string().uuid().optional(),
    query: z.string().max(120).optional(),
    date: DATE.optional(),
  }),
  create_task: z.object({
    title: z.string().min(1).max(120),
    deadlineDate: DATE.optional(),
    deadlineTime: TIME.optional(),
    estimatedMinutes: z.number().int().min(5).max(24 * 60).optional(),
    description: z.string().max(500).optional(),
  }),
  generate_schedule: z.object({ date: DATE.optional() }),
} as const;

export type ToolName = keyof typeof schemas;

export interface UndoAction {
  kind: 'created_event' | 'updated_event' | 'deleted_event' | 'created_task' | 'created_series';
  eventId?: string;
  taskId?: string;
  recurrenceRuleId?: string;
  snapshot?: {
    title: string;
    description: string | null;
    startTime: string;
    endTime: string;
    location: string | null;
    category: Event['category'];
  };
}

export interface ToolContext {
  user: User;
  undo: UndoAction[];
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  needsConfirmation?: boolean;
  data?: unknown;
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'create_event',
    description:
      'Create a single event at a known local date and time. Only call this when both the day and the start time are known.',
    parameters: jsonSchema(schemas.create_event),
  },
  {
    name: 'create_recurring_event',
    description: 'Create a repeating weekly commitment such as a university class.',
    parameters: jsonSchema(schemas.create_recurring_event),
  },
  {
    name: 'update_event',
    description: 'Move or edit an existing event, found by id or by a short title query.',
    parameters: jsonSchema(schemas.update_event),
  },
  {
    name: 'delete_event',
    description:
      'Delete an event. Deleting more than one event requires confirm=true, which you may only set after the student agreed.',
    parameters: jsonSchema(schemas.delete_event),
  },
  {
    name: 'get_schedule',
    description: "Read the student's events for a day or a date range.",
    parameters: jsonSchema(schemas.get_schedule),
  },
  {
    name: 'find_free_time',
    description: 'Find open slots of a given length between two dates.',
    parameters: jsonSchema(schemas.find_free_time),
  },
  {
    name: 'search_events',
    description: 'Search events by keyword.',
    parameters: jsonSchema(schemas.search_events),
  },
  {
    name: 'set_reminder',
    description: 'Add a reminder a number of minutes before an event.',
    parameters: jsonSchema(schemas.set_reminder),
  },
  {
    name: 'remove_reminder',
    description: 'Remove the reminders attached to an event.',
    parameters: jsonSchema(schemas.remove_reminder),
  },
  {
    name: 'create_task',
    description:
      'Store something that must get done, optionally with a deadline (assignments, essays, applications).',
    parameters: jsonSchema(schemas.create_task),
  },
  {
    name: 'generate_schedule',
    description: 'Preview a deterministic, conflict-free study plan for pending tasks. The student must approve it before any sessions are saved.',
    parameters: jsonSchema(schemas.generate_schedule),
  },
];

/**
 * Executes one model-proposed tool call. Every argument is re-validated, the
 * user id always comes from the authenticated session (never from the model),
 * and destructive multi-event operations demand explicit confirmation.
 */
export async function executeTool(
  context: ToolContext,
  name: string,
  rawArgs: Record<string, unknown>,
): Promise<ToolResult> {
  if (!isToolName(name)) {
    return { ok: false, summary: `Unknown tool "${name}".` };
  }

  const parsed = schemas[name].safeParse(rawArgs);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, summary: `I could not use those details (${problems}).` };
  }

  const { user } = context;
  const tz = user.timezone;

  switch (name) {
    case 'create_event': {
      const args = parsed.data as z.infer<(typeof schemas)['create_event']>;
      const startTime = zonedToUtc(args.date, args.startTime, tz);
      const endTime = new Date(startTime.getTime() + args.durationMinutes * 60_000);
      const category = args.category ?? 'OTHER';
      const reminderMinutes = args.reminderMinutes ?? defaultReminderMinutes(user, category);

      const { event, conflicts } = await createEvent(user, {
        title: args.title,
        description: args.description ?? null,
        startTime,
        endTime,
        location: args.location ?? null,
        category,
        reminderMinutes,
        createdBy: 'AI',
      });
      context.undo.push({ kind: 'created_event', eventId: event.id });

      const when = describeEvent(event, tz);
      const summary = conflicts.length
        ? `Added ${event.title} ${when}. Heads up: it overlaps ${conflicts
            .map((c) => c.title)
            .join(', ')}.`
        : `Added ${event.title} ${when}. Reminder ${reminderMinutes} minutes before.`;
      return { ok: true, summary, data: { event: serialiseEvent(event, tz), conflicts: conflicts.map((c) => serialiseEvent(c, tz)) } };
    }

    case 'create_recurring_event': {
      const args = parsed.data as z.infer<(typeof schemas)['create_recurring_event']>;
      const { rule, events } = await createRecurringClass(user, {
        title: args.title,
        byWeekday: args.byWeekday,
        startTime: args.startTime,
        endTime: args.endTime,
        startDate: args.startDate,
        endDate: args.endDate,
        location: args.location ?? null,
        courseCode: args.courseCode ?? null,
        professor: args.professor ?? null,
        category: args.category ?? 'CLASS',
      });
      context.undo.push({ kind: 'created_series', recurrenceRuleId: rule.id });
      return {
        ok: true,
        summary: `Added ${rule.title} ${args.startTime}-${args.endTime} on ${args.byWeekday
          .map((d) => WEEKDAY_NAMES[d])
          .join(', ')} (${events.length} meetings).`,
        data: { ruleId: rule.id, occurrences: events.length },
      };
    }

    case 'update_event': {
      const args = parsed.data as z.infer<(typeof schemas)['update_event']>;
      const match = await resolveEvent(user, args.eventId, args.query, args.date);
      if ('error' in match) return match.error;
      const target = match.event;

      const currentDate = formatInZone(target.startTime, tz, 'yyyy-MM-dd');
      const currentTime = formatInZone(target.startTime, tz, 'HH:mm');
      const durationMinutes =
        args.newDurationMinutes ??
        Math.round((target.endTime.getTime() - target.startTime.getTime()) / 60_000);

      const startTime =
        args.newDate || args.newStartTime
          ? zonedToUtc(args.newDate ?? currentDate, args.newStartTime ?? currentTime, tz)
          : target.startTime;
      const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

      context.undo.push({ kind: 'updated_event', eventId: target.id, snapshot: snapshot(target) });

      const { event, conflicts } = await updateEvent(
        user,
        target.id,
        {
          title: args.newTitle,
          location: args.newLocation,
          startTime,
          endTime,
        },
        args.scope,
      );

      const summary = conflicts.length
        ? `Moved ${event.title} to ${describeEvent(event, tz)}, but it now overlaps ${conflicts
            .map((c) => c.title)
            .join(', ')}.`
        : `Moved ${event.title} to ${describeEvent(event, tz)}.`;
      return { ok: true, summary, data: { event: serialiseEvent(event, tz) } };
    }

    case 'delete_event': {
      const args = parsed.data as z.infer<(typeof schemas)['delete_event']>;
      const match = await resolveEvent(user, args.eventId, args.query, args.date, args.confirm);
      if ('error' in match) return match.error;
      const target = match.event;

      if (args.scope !== 'this' && !args.confirm) {
        const siblings = target.recurrenceRuleId
          ? await prisma.event.count({
              where: { userId: user.id, recurrenceRuleId: target.recurrenceRuleId },
            })
          : 1;
        return {
          ok: false,
          needsConfirmation: true,
          summary: `That would remove ${siblings} meetings of ${target.title}. Do you want me to delete them all?`,
          data: { eventId: target.id, scope: args.scope },
        };
      }

      context.undo.push({ kind: 'deleted_event', eventId: target.id, snapshot: snapshot(target) });
      const { deleted } = await deleteEvent(user, target.id, args.scope);
      return {
        ok: true,
        summary:
          deleted > 1
            ? `Deleted ${deleted} meetings of ${target.title}.`
            : `Cancelled ${target.title} on ${formatInZone(target.startTime, tz, 'EEE d MMM')}.`,
        data: { deleted },
      };
    }

    case 'get_schedule': {
      const args = parsed.data as z.infer<(typeof schemas)['get_schedule']>;
      const from = args.fromDate ?? args.date ?? format(new Date(), 'yyyy-MM-dd');
      const to = args.toDate ?? args.date ?? from;
      const events = await listEvents(user.id, {
        from: zonedToUtc(from, '00:00', tz),
        to: zonedToUtc(format(addDays(parseISO(to), 1), 'yyyy-MM-dd'), '00:00', tz),
      });
      return {
        ok: true,
        summary: events.length
          ? events.map((event) => `${describeEvent(event, tz)}: ${event.title}`).join('; ')
          : `Nothing scheduled ${from === to ? `on ${from}` : `between ${from} and ${to}`}.`,
        data: { events: events.map((event) => serialiseEvent(event, tz)) },
      };
    }

    case 'find_free_time': {
      const args = parsed.data as z.infer<(typeof schemas)['find_free_time']>;
      const days = enumerateDays(args.fromDate, args.toDate);
      const slots = await findFreeTime(user, {
        days,
        durationMinutes: args.durationMinutes,
        dayStart: args.earliest,
        dayEnd: args.latest,
        limit: 4,
      });
      return {
        ok: true,
        summary: slots.length
          ? `Free slots: ${slots
              .map((slot) => `${formatInZone(slot.start, tz, 'EEE d MMM HH:mm')}-${formatInZone(slot.end, tz, 'HH:mm')}`)
              .join(', ')}`
          : 'I could not find a free slot that long in that window.',
        data: {
          slots: slots.map((slot) => ({
            start: slot.start.toISOString(),
            end: slot.end.toISOString(),
            label: `${formatInZone(slot.start, tz, 'EEE d MMM HH:mm')}-${formatInZone(slot.end, tz, 'HH:mm')}`,
          })),
        },
      };
    }

    case 'search_events': {
      const args = parsed.data as z.infer<(typeof schemas)['search_events']>;
      const events = await searchEvents(user.id, args.query);
      return {
        ok: true,
        summary: events.length
          ? events.map((event) => `${event.title} ${describeEvent(event, tz)}`).join('; ')
          : `No events match "${args.query}".`,
        data: { events: events.map((event) => serialiseEvent(event, tz)) },
      };
    }

    case 'set_reminder': {
      const args = parsed.data as z.infer<(typeof schemas)['set_reminder']>;
      const match = await resolveEvent(user, args.eventId, args.query, args.date);
      if ('error' in match) return match.error;
      await syncRemindersForEvent(user, match.event, args.minutesBefore);
      return {
        ok: true,
        summary: `Reminder set ${args.minutesBefore} minutes before ${match.event.title}.`,
        data: { eventId: match.event.id },
      };
    }

    case 'remove_reminder': {
      const args = parsed.data as z.infer<(typeof schemas)['remove_reminder']>;
      const match = await resolveEvent(user, args.eventId, args.query, args.date);
      if ('error' in match) return match.error;
      const reminders = await prisma.reminder.findMany({
        where: { userId: user.id, eventId: match.event.id, status: 'PENDING' },
      });
      for (const reminder of reminders) {
        await removeReminder(user.id, reminder.id);
      }
      return {
        ok: true,
        summary: `Removed ${reminders.length} reminder(s) from ${match.event.title}.`,
        data: { removed: reminders.length },
      };
    }

    case 'create_task': {
      const args = parsed.data as z.infer<(typeof schemas)['create_task']>;
      const deadline = args.deadlineDate
        ? zonedToUtc(args.deadlineDate, args.deadlineTime ?? '23:59', tz)
        : null;
      const task = await createTask(user, {
        title: args.title,
        description: args.description ?? null,
        deadline,
        estimatedMinutes: args.estimatedMinutes ?? null,
        reminderMinutes: deadline ? user.defaultReminderMinutes : null,
      });
      context.undo.push({ kind: 'created_task', taskId: task.id });
      return {
        ok: true,
        summary: deadline
          ? `Saved "${task.title}", due ${formatInZone(deadline, tz, "EEE d MMM 'at' HH:mm")}.`
          : `Saved "${task.title}" to your list.`,
        data: { taskId: task.id },
      };
    }

    case 'generate_schedule': {
      const args = parsed.data as z.infer<(typeof schemas)['generate_schedule']>;
      const plan = await previewPlan(user, args.date ?? planningDate(user));
      return {
        ok: true,
        needsConfirmation: plan.sessions.length > 0,
        summary: plan.sessions.length
          ? `I found time for ${plan.sessions.length} study session(s). Review the proposed plan before saving it.`
          : 'I could not find any pending tasks with estimated durations that fit this week.',
        data: { plan },
      };
    }

    default:
      return { ok: false, summary: 'Unsupported tool.' };
  }
}

export async function revertActions(user: User, actions: UndoAction[]): Promise<number> {
  let reverted = 0;
  for (const action of [...actions].reverse()) {
    switch (action.kind) {
      case 'created_event':
        if (action.eventId) {
          const { count } = await prisma.event.deleteMany({
            where: { id: action.eventId, userId: user.id },
          });
          reverted += count;
        }
        break;
      case 'created_task':
        if (action.taskId) {
          const { count } = await prisma.task.deleteMany({
            where: { id: action.taskId, userId: user.id },
          });
          reverted += count;
        }
        break;
      case 'created_series':
        if (action.recurrenceRuleId) {
          const { count } = await prisma.recurrenceRule.deleteMany({
            where: { id: action.recurrenceRuleId, userId: user.id },
          });
          reverted += count;
        }
        break;
      case 'updated_event':
        if (action.eventId && action.snapshot) {
          const restored = await prisma.event.updateMany({
            where: { id: action.eventId, userId: user.id },
            data: {
              title: action.snapshot.title,
              description: action.snapshot.description,
              startTime: new Date(action.snapshot.startTime),
              endTime: new Date(action.snapshot.endTime),
              location: action.snapshot.location,
              category: action.snapshot.category,
            },
          });
          if (restored.count > 0) {
            const event = await prisma.event.findFirst({
              where: { id: action.eventId, userId: user.id },
            });
            if (event) await syncRemindersForEvent(user, event);
            reverted += restored.count;
          }
        }
        break;
      case 'deleted_event':
        if (action.snapshot) {
          const event = await prisma.event.create({
            data: {
              userId: user.id,
              title: action.snapshot.title,
              description: action.snapshot.description,
              startTime: new Date(action.snapshot.startTime),
              endTime: new Date(action.snapshot.endTime),
              location: action.snapshot.location,
              category: action.snapshot.category,
              createdBy: 'AI',
            },
          });
          await syncRemindersForEvent(user, event, user.defaultReminderMinutes);
          reverted += 1;
        }
        break;
    }
  }
  return reverted;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(schemas, name);
}

async function resolveEvent(
  user: User,
  eventId: string | undefined,
  query: string | undefined,
  date: string | undefined,
  confirmed = false,
): Promise<{ event: Event } | { error: ToolResult }> {
  if (eventId) {
    const event = await prisma.event.findFirst({ where: { id: eventId, userId: user.id } });
    if (!event) return { error: { ok: false, summary: 'I could not find that event.' } };
    return { event };
  }

  if (!query) {
    return { error: { ok: false, summary: 'Which event did you mean?' } };
  }

  const where = {
    userId: user.id,
    cancelled: false,
    title: { contains: query, mode: 'insensitive' as const },
    ...(date
      ? {
          startTime: {
            gte: zonedToUtc(date, '00:00', user.timezone),
            lt: zonedToUtc(format(addDays(parseISO(date), 1), 'yyyy-MM-dd'), '00:00', user.timezone),
          },
        }
      : { endTime: { gte: new Date() } }),
  };

  const matches = await prisma.event.findMany({ where, orderBy: { startTime: 'asc' }, take: 5 });

  if (matches.length === 0) {
    return { error: { ok: false, summary: `I could not find anything called "${query}".` } };
  }
  const first = matches[0] as Event;
  if (matches.length > 1 && !confirmed) {
    return {
      error: {
        ok: false,
        needsConfirmation: true,
        summary: `I found ${matches.length} matches: ${matches
          .map((event) => `${event.title} ${describeEvent(event, user.timezone)}`)
          .join('; ')}. Which one did you mean?`,
        data: { candidates: matches.map((event) => serialiseEvent(event, user.timezone)) },
      },
    };
  }
  return { event: first };
}

function snapshot(event: Event): NonNullable<UndoAction['snapshot']> {
  return {
    title: event.title,
    description: event.description,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    location: event.location,
    category: event.category,
  };
}

function describeEvent(event: Event, timezone: string): string {
  return `${formatInZone(event.startTime, timezone, "EEE d MMM 'at' HH:mm")}`;
}

function serialiseEvent(event: Event, timezone: string) {
  return {
    id: event.id,
    title: event.title,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    localStart: formatInZone(event.startTime, timezone, "yyyy-MM-dd'T'HH:mm"),
    location: event.location,
    category: event.category,
  };
}

function enumerateDays(fromDate: string, toDate: string): string[] {
  const days: string[] = [];
  let cursor = parseISO(fromDate);
  const last = parseISO(toDate);
  for (let guard = 0; guard < 60 && cursor <= last; guard += 1) {
    days.push(format(cursor, 'yyyy-MM-dd'));
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Minimal JSON Schema generation for the tool contract sent to the model. */
function jsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(schema.shape)) {
    properties[key] = describeZod(value as z.ZodTypeAny);
    if (!(value as z.ZodTypeAny).isOptional()) required.push(key);
  }

  return { type: 'object', properties, required, additionalProperties: false };
}

function describeZod(schema: z.ZodTypeAny): Record<string, unknown> {
  const description = schema.description ? { description: schema.description } : {};

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return { ...describeZod(schema._def.innerType as z.ZodTypeAny), ...description };
  }
  if (schema instanceof z.ZodString) return { type: 'string', ...description };
  if (schema instanceof z.ZodNumber) return { type: 'number', ...description };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean', ...description };
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options, ...description };
  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: describeZod(schema.element as z.ZodTypeAny), ...description };
  }
  return { type: 'string', ...description };
}
