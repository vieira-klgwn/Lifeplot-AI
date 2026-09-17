import { env } from '../../../config/env.js';
import { serviceUnavailable } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import type { AIProvider, CompletionRequest, CompletionResult, ToolCall } from './types.js';

interface OpenAiToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

interface OpenAiResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
  }>;
  error?: { message?: string };
}

const REQUEST_TIMEOUT_MS = 20_000;

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    private readonly model: string = env.AI_MODEL,
    private readonly baseUrl: string = env.OPENAI_BASE_URL,
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: request.context },
            ...request.messages.map((message) =>
              message.role === 'tool'
                ? { role: 'tool', content: message.content, tool_call_id: message.toolCallId }
                : { role: message.role, content: message.content },
            ),
          ],
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          tool_choice: 'auto',
        }),
      });

      if (!response.ok) {
        logger.warn({ status: response.status }, 'AI provider returned an error status');
        throw serviceUnavailable('The assistant is unavailable right now. Please try again.');
      }

      const payload = (await response.json()) as OpenAiResponse;
      const message = payload.choices?.[0]?.message;

      const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
        .filter((call) => call.type === 'function')
        .map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: safeParseArguments(call.function.arguments),
        }));

      return { content: message?.content?.trim() ?? '', toolCalls };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw serviceUnavailable('The assistant took too long to respond. Please try again.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Model output is untrusted: malformed JSON degrades to an empty argument set. */
function safeParseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
