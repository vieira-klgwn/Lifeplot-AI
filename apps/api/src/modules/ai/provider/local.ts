import { addDays, format, parseISO } from 'date-fns';
import type { AIProvider, CompletionRequest, CompletionResult, ToolCall } from './types.js';

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const NUMBER_WORDS: Record<string, number> = {
  an: 1,
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

let counter = 0;
const nextId = () => `local_${(counter += 1)}`;

/**
 * Offline scheduling parser. It is the fallback provider when no LLM key is
 * configured, and the deterministic fixture used by the test-suite: it covers
 * the common student phrasings ("add X tomorrow at 5", "when am I free",
 * "cancel my ...") and asks for missing information instead of guessing.
 */
export class LocalProvider implements AIProvider {
  readonly name = 'local';

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const toolResult = [...request.messages].reverse().find((m) => m.role === 'tool');
    const text = (lastUser?.content ?? '').toLowerCase().trim();
    const today = extractToday(request.context);
    const priorCall = [...request.messages].reverse().find((m) => m.role === 'assistant');

    // A tool already ran for this turn: summarise instead of calling again.
    if (toolResult) {
      return { content: summariseToolResult(toolResult.content), toolCalls: [] };
    }

    if (!text) {
      return { content: 'What would you like me to add to your schedule?', toolCalls: [] };
    }

    if (isQuery(text)) {
      const date = resolveDate(text, today) ?? today;
      return { content: '', toolCalls: [call('get_schedule', { date })] };
    }

    if (isFreeTimeRequest(text)) {
      const duration = extractDurationMinutes(text) ?? 60;
      const from = resolveDate(text, today) ?? today;
      const until = extractDeadlineDate(text, today) ?? format(addDays(parseISO(from), 6), 'yyyy-MM-dd');
      return {
        content: '',
        toolCalls: [call('find_free_time', { fromDate: from, toDate: until, durationMinutes: duration })],
      };
    }

    if (isDelete(text)) {
      const title = extractTitle(text, ['cancel', 'delete', 'remove']);
      const date = resolveDate(text, today);
      return { content: '', toolCalls: [call('delete_event', { query: title, date: date ?? undefined })] };
    }

    if (isMove(text)) {
      const title = extractTitle(text, ['move', 'reschedule', 'shift', 'push']);
      const date = resolveDate(text, today);
      const time = extractTime(text);
      if (!date && !time) {
        return { content: `When should I move ${title || 'it'} to?`, toolCalls: [] };
      }
      return {
        content: '',
        toolCalls: [
          call('update_event', {
            query: title,
            newDate: date ?? undefined,
            newStartTime: time ?? undefined,
          }),
        ],
      };
    }

    if (isDeadline(text)) {
      const date = resolveDate(text, today);
      const time = extractTime(text) ?? '23:59';
      const title = extractTitle(text, ['i have', 'my', 'submit', 'finish', 'due']);
      if (!date) {
        return { content: `When is ${title || 'that'} due?`, toolCalls: [] };
      }
      return {
        content: '',
        toolCalls: [call('create_task', { title: title || 'Deadline', deadlineDate: date, deadlineTime: time })],
      };
    }

    // Default: the student is describing something to put on the calendar.
    const date = resolveDate(text, today);
    const time = extractTime(text);
    const duration = extractDurationMinutes(text) ?? 60;
    const title = extractTitle(text, ['add', 'i have', 'schedule', 'book', 'create', 'put']);
    const reminder = extractReminderMinutes(text);

    if (!date) {
      return { content: `Which day is ${title || 'that'} on?`, toolCalls: [] };
    }
    if (!time) {
      const subject = title || 'it';
      const askedBefore = priorCall?.content.includes('What time');
      return {
        content: askedBefore
          ? `I still need a start time for ${subject}. For example "3pm".`
          : `What time is ${subject} on ${friendlyDate(date, today)}?`,
        toolCalls: [],
      };
    }

    return {
      content: '',
      toolCalls: [
        call('create_event', {
          title: title || 'Event',
          date,
          startTime: time,
          durationMinutes: duration,
          location: extractLocation(text) ?? undefined,
          reminderMinutes: reminder ?? undefined,
        }),
      ],
    };
  }
}

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: nextId(), name, arguments: args };
}

function extractToday(context: string): string {
  const match = /\d{4}-\d{2}-\d{2}/.exec(context);
  return match ? match[0] : format(new Date(), 'yyyy-MM-dd');
}

function isQuery(text: string): boolean {
  return /(what('s| is| do i)|show me|do i have|my schedule|agenda)/.test(text) && !/add|create/.test(text);
}

function isFreeTimeRequest(text: string): boolean {
  return /(free|available|fit|find time|spare time|need .* (hour|minute))/.test(text);
}

function isDelete(text: string): boolean {
  return /^(cancel|delete|remove)\b/.test(text) || /\b(cancel|delete|remove) (my|the)\b/.test(text);
}

function isMove(text: string): boolean {
  return /\b(move|reschedule|shift|push)\b/.test(text);
}

function isDeadline(text: string): boolean {
  return /\b(due|deadline|submit|hand in)\b/.test(text);
}

function resolveDate(text: string, today: string): string | null {
  const base = parseISO(today);

  if (/\btoday\b|\btonight\b|\bthis (evening|afternoon|morning)\b/.test(text)) return today;
  if (/\btomorrow\b/.test(text)) return format(addDays(base, 1), 'yyyy-MM-dd');
  if (/\bday after tomorrow\b/.test(text)) return format(addDays(base, 2), 'yyyy-MM-dd');

  const explicit = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (explicit?.[1]) return explicit[1];

  const weekday = WEEKDAYS.findIndex((day) => new RegExp(`\\b${day}\\b`).test(text));
  if (weekday >= 0) {
    const wantsNextWeek = /\bnext\b/.test(text);
    let delta = (weekday - base.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    if (wantsNextWeek && delta < 7) delta += 7;
    return format(addDays(base, delta), 'yyyy-MM-dd');
  }

  if (/\bnext week\b/.test(text)) return format(addDays(base, 7), 'yyyy-MM-dd');
  if (/\bthis weekend\b/.test(text)) {
    const delta = (6 - base.getDay() + 7) % 7;
    return format(addDays(base, delta === 0 ? 7 : delta), 'yyyy-MM-dd');
  }
  return null;
}

function extractDeadlineDate(text: string, today: string): string | null {
  const match = /\b(?:before|by|until)\s+([a-z]+day|tomorrow|today|next week)\b/.exec(text);
  return match?.[1] ? resolveDate(match[1], today) : null;
}

function extractTime(text: string): string | null {
  const explicit = /\b([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm)?\b/.exec(text);
  if (explicit?.[1] && explicit[2]) {
    let hours = Number(explicit[1]);
    const meridiem = explicit[3];
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${explicit[2]}`;
  }

  const hourOnly = /\b(?:at|from|around)\s+(\d{1,2})\s*(am|pm)?\b/.exec(text) ?? /\b(\d{1,2})\s*(am|pm)\b/.exec(text);
  if (hourOnly?.[1]) {
    let hours = Number(hourOnly[1]);
    if (hours > 23) return null;
    const meridiem = hourOnly[2];
    if (meridiem === 'pm' && hours < 12) hours += 12;
    else if (meridiem === 'am' && hours === 12) hours = 0;
    else if (!meridiem && hours <= 7) hours += 12; // "at 5" on a student calendar means 17:00
    else if (!meridiem && /\b(tonight|evening)\b/.test(text) && hours < 12) hours += 12;
    return `${String(hours).padStart(2, '0')}:00`;
  }
  return null;
}

const REMINDER_CLAUSE = /\b(?:and\s+)?(?:remind me|set a reminder|with a reminder)\b.*$/;

/** Durations must not swallow the "remind me 10 minutes before" clause. */
function extractDurationMinutes(input: string): number | null {
  const text = input.replace(REMINDER_CLAUSE, ' ');
  const hours = /\b(\d+(?:\.\d+)?|an|a|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:hours?|hrs?|h)\b/.exec(text);
  if (hours?.[1]) {
    const value = NUMBER_WORDS[hours[1]] ?? Number(hours[1]);
    if (Number.isFinite(value)) return Math.round(value * 60);
  }
  const minutes = /\b(\d{1,3})\s*(?:minutes?|mins?|m)\b/.exec(text);
  if (minutes?.[1]) return Number(minutes[1]);
  return null;
}

function extractReminderMinutes(text: string): number | null {
  const match = /remind me\s+(\d+|an|a|one|two|three|ten|fifteen|thirty)\s*(minutes?|mins?|hours?|days?)\s*(before|early)?/.exec(text);
  if (!match?.[1] || !match[2]) return null;
  const amount = NUMBER_WORDS[match[1]] ?? Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  if (match[2].startsWith('hour')) return amount * 60;
  if (match[2].startsWith('day')) return amount * 1440;
  return amount;
}

function extractLocation(text: string): string | null {
  const match = /\b(?:in|at) the ([a-z0-9' ]{3,40}?)(?:\s+(?:at|on|tomorrow|today|tonight)\b|[.,]|$)/.exec(text);
  return match?.[1] ? titleCase(match[1].trim()) : null;
}

/**
 * Titles are the words the student used, minus the instruction wrapper: the
 * phrase is cut at the first time or date marker rather than word-filtered,
 * so "meeting with important people" survives intact.
 */
function extractTitle(text: string, leadingVerbs: string[]): string {
  let cleaned = text
    .replace(REMINDER_CLAUSE, ' ')
    .split(/[.!?;]/)[0]!
    .replace(/\band (?:add|put|schedule|create) .*$/, ' ');

  const cutMarkers = [
    /\b(?:today|tonight|tomorrow)\b/,
    /\bthis (?:morning|afternoon|evening|weekend)\b/,
    /\bnext week\b/,
    new RegExp(`\\b(?:on |next )?(?:${WEEKDAYS.join('|')})\\b`),
    /\b(?:at|from|around)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/,
    /\b\d{1,2}:\d{2}\b/,
    /\bfor \d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?)\b/,
    /\b(?:in|at) the\b/,
  ];
  for (const marker of cutMarkers) {
    const match = marker.exec(cleaned);
    if (match) cleaned = cleaned.slice(0, match.index);
  }

  for (const verb of leadingVerbs) {
    cleaned = cleaned.replace(new RegExp(`^\\s*${verb}\\b`, 'i'), ' ');
  }

  let previous = '';
  while (previous !== cleaned) {
    previous = cleaned;
    cleaned = cleaned
      .replace(/^\s*(?:i|i've|just|got|have|has|need|want|to|please|gotta|an|a|the|my|some)\b/i, ' ')
      .trim();
  }

  cleaned = cleaned
    .replace(/[,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return titleCase(cleaned.slice(0, 60));
}

function titleCase(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function friendlyDate(date: string, today: string): string {
  if (date === today) return 'today';
  if (date === format(addDays(parseISO(today), 1), 'yyyy-MM-dd')) return 'tomorrow';
  return format(parseISO(date), 'EEEE d MMM');
}

function summariseToolResult(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { summary?: string; message?: string };
    return parsed.summary ?? parsed.message ?? 'Done.';
  } catch {
    return 'Done.';
  }
}
