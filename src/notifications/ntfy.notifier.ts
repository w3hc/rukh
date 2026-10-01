import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notifier } from './notifier';

/** {@link Notifier} backed by https://ntfy.sh. */
@Injectable()
export class NtfyNotifier implements Notifier {
  private readonly logger = new Logger(NtfyNotifier.name);

  constructor(private readonly configService: ConfigService) {}

  async notify(title: string, message: string): Promise<void> {
    const token = this.configService.get<string>('NTFY_ASK_TOKEN');
    const topic = this.configService.get<string>('NTFY_ASK_TOPIC');

    try {
      const response = await fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Title: title,
          Tags: 'speech_balloon',
        },
        body: message,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(
          `Notification rejected by ntfy: ${response.status} ${response.statusText} ${body}`,
        );
        return;
      }

      this.logger.debug(`Notification sent to topic '${topic}'`);
    } catch (error) {
      this.logger.error(
        `Failed to send notification: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
