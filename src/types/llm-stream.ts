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
 * An incremental piece of the model's reasoning, to be shown separately from
 * the answer - or not at all.
 *
 * Adaptive thinking can run for minutes before the first word of the answer
 * appears. Without these events nothing at all reaches the socket during that
 * window, which reads as a hung request to the user and as an idle connection
 * to every proxy in between.
 */
export interface ThinkingStreamEvent {
  type: 'thinking';
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
  | ThinkingStreamEvent
  | ResetStreamEvent
  | FinalStreamEvent;

/**
 * Thrown when a stream is cancelled because the client went away.
 *
 * A cancelled `fetch` surfaces as a generic `AbortError` that looks exactly
 * like a genuine timeout, so the provider services raise this instead when
 * they know the cancellation was ours - it tells the caller to stop quietly
 * rather than log an error and fall back to the next model for a client that
 * is no longer there.
 */
export class StreamAbortedError extends Error {
  constructor(message = 'Stream aborted: client disconnected') {
    super(message);
    this.name = 'StreamAbortedError';
  }
}
