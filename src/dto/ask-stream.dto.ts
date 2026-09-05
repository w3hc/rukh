import { AskResponseDto } from './ask-response.dto';

/**
 * What `AppService.askStream()` emits, one event per SSE frame.
 *
 * `done` carries exactly the `AskResponseDto` the non-streaming call would
 * have returned, so a client can ignore the incremental events entirely and
 * still end up with the same payload.
 *
 * `thinking` is reasoning, not answer: it never appears in `done.output` and a
 * client is free to render it separately or drop it. It is emitted anyway
 * because it is the only traffic on the wire while the model reasons.
 */
export type AskStreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'reset' }
  | { type: 'done'; response: AskResponseDto }
  | { type: 'error'; message: string };
