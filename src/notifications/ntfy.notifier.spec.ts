import { ConfigService } from '@nestjs/config';
import { NtfyNotifier } from './ntfy.notifier';
import { isNotificationsEnabled } from './notifications.module';

describe('NtfyNotifier', () => {
  const config = {
    get: jest.fn((key: string) =>
      key === 'NTFY_ASK_TOKEN' ? 'tk_test' : 'my-topic',
    ),
  } as unknown as ConfigService;

  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('posts to the configured topic with the token', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));

    await new NtfyNotifier(config).notify('Rukh Ask', 'hello');

    expect(fetchMock).toHaveBeenCalledWith('https://ntfy.sh/my-topic', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tk_test',
        Title: 'Rukh Ask',
        Tags: 'speech_balloon',
      },
      body: 'hello',
    });
  });

  it('swallows a rejected response', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 403 }));

    await expect(
      new NtfyNotifier(config).notify('t', 'm'),
    ).resolves.toBeUndefined();
  });

  it('swallows a network error', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    await expect(
      new NtfyNotifier(config).notify('t', 'm'),
    ).resolves.toBeUndefined();
  });
});

describe('isNotificationsEnabled', () => {
  it('is on only when a token is set', () => {
    expect(isNotificationsEnabled(() => undefined)).toBe(false);
    expect(isNotificationsEnabled(() => 'tk_test')).toBe(true);
  });
});
