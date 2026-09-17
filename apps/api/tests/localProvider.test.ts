import { describe, expect, it } from 'vitest';
import { LocalProvider } from '../src/modules/ai/provider/local.js';
import { toolDefinitions } from '../src/modules/ai/tools.js';

const provider = new LocalProvider();
const today = '2026-09-17'; // a Thursday

async function parse(message: string) {
  const result = await provider.complete({
    messages: [{ role: 'user', content: message }],
    tools: toolDefinitions,
    context: `Today is Thursday, ${today}. Current local time is 15:00 in Europe/Paris.`,
  });
  return result;
}

describe('offline parser', () => {
  it('handles the hero flow: unexpected meeting tonight with a 10 minute reminder', async () => {
    const { toolCalls } = await parse(
      'I just got an unexpected meeting with some important people tonight at 8. Add it to my schedule and remind me 10 minutes before.',
    );

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.name).toBe('create_event');
    expect(toolCalls[0]?.arguments).toMatchObject({
      title: 'Unexpected Meeting With Some Important People',
      date: today,
      startTime: '20:00',
      durationMinutes: 60,
      reminderMinutes: 10,
    });
  });

  it('asks for the missing day instead of inventing one', async () => {
    const { content, toolCalls } = await parse('Add lunch with Sara');
    expect(toolCalls).toHaveLength(0);
    expect(content).toMatch(/\?$/);
  });

  it('reads explicit durations without stealing the reminder offset', async () => {
    const { toolCalls } = await parse('Add gym tomorrow at 18:00 for 90 minutes, remind me 30 minutes before');
    expect(toolCalls[0]?.arguments).toMatchObject({
      date: '2026-09-18',
      startTime: '18:00',
      durationMinutes: 90,
      reminderMinutes: 30,
    });
  });

  it('routes schedule questions, deletions and free-time requests to the right tool', async () => {
    expect((await parse("what's on my schedule today?")).toolCalls[0]?.name).toBe('get_schedule');
    expect((await parse('cancel my dentist appointment on friday')).toolCalls[0]?.name).toBe('delete_event');
    expect((await parse('when am I free for 2 hours this week?')).toolCalls[0]?.name).toBe('find_free_time');
    expect((await parse('I have an essay due friday')).toolCalls[0]?.name).toBe('create_task');
  });
});
