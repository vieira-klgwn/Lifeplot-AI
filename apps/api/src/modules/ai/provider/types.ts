export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  /** Deterministic scheduling context (today's date, timezone, schedule digest). */
  context: string;
}

export interface CompletionResult {
  content: string;
  toolCalls: ToolCall[];
}

/**
 * Swappable LLM boundary. Implementations must never receive more schedule
 * data than the caller puts in `context`, and must only emit calls to the
 * tools they are handed.
 */
export interface AIProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
