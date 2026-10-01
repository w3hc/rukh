import { Module } from '@nestjs/common';
import { NOTIFIER } from './notifier';
import { NtfyNotifier } from './ntfy.notifier';

export function isNotificationsEnabled(
  get: (key: string) => string | undefined,
): boolean {
  return !!get('NTFY_ASK_TOKEN');
}

/**
 * Registered only when {@link isNotificationsEnabled} holds. Swap the
 * implementation bound to {@link NOTIFIER} to notify somewhere else.
 */
@Module({
  providers: [NtfyNotifier, { provide: NOTIFIER, useExisting: NtfyNotifier }],
  exports: [NOTIFIER],
})
export class NotificationsModule {}
