import { AskResponseDto } from './ask-response.dto';

/**
 * What `AppService.askStream()` emits, one event per SSE frame.
 *
 * `done` carries exactly the `AskResponseDto` the non-streaming call would
 * have returned, so a client can ignore the incremental events entirely and
 * still end up with the same payload.
 */
export type AskStreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'reset' }
  | { type: 'done'; response: AskResponseDto }
  | { type: 'error'; message: string };
