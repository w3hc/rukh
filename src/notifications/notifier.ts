export const NOTIFIER = Symbol('NOTIFIER');

/**
 * Pushes a short message to whoever runs this instance. Implementations must
 * never throw: a notification is a side effect, not part of the request.
 */
export interface Notifier {
  notify(title: string, message: string): Promise<void>;
}
