/**
 * Shared shapes for the incremental (streaming) side of the model services.
 *
 * Every provider service exposes a `streamMessage()` async generator that
 * yields these events. Non-streaming `processMessage()` calls stay unchanged,
 * so the two paths can live side by side.
 */

export interface StreamUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface StreamCost {
  input_cost: number;
  output_cost: number;
  total_cost: number;
  web_search_cost?: number;
}

/** An incremental piece of the answer, to be appended by the client. */
export interface TextStreamEvent {
  type: 'text';
  text: string;
}

/**
 * Everything streamed so far is preamble and should be discarded.
 *
 * Only the Anthropic web search path emits this: the model narrates before it
 * searches ("let me look that up..."), and the non-streaming path drops that
 * narration. Emitting a reset keeps the streamed text consistent with the
 * `content` of the final event instead of silently diverging from it.
 */
export interface ResetStreamEvent {
  type: 'reset';
}

/** Terminal event: the complete answer plus usage and cost accounting. */
export interface FinalStreamEvent {
  type: 'final';
  content: string;
  sessionId: string;
  usage: StreamUsage;
  cost: StreamCost;
}

export type ModelStreamEvent =
  | TextStreamEvent
  | ResetStreamEvent
  | FinalStreamEvent;
