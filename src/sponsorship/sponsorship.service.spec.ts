import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { SponsorshipService } from './sponsorship.service';
import { isSponsorshipEnabled } from './sponsorship.module';

describe('SponsorshipService', () => {
  const settings: Record<string, unknown> = {
    SPONSOR_GITHUB_LOGIN: 'Acme',
    SPONSOR_MIN_MONTHLY_USD: 10,
    GITHUB_API_TOKEN: 'test-token',
  };
  const config = {
    getOrThrow: jest.fn((key: string) => settings[key]),
  } as unknown as ConfigService;

  let service: SponsorshipService;
  let fetchMock: jest.SpyInstance;

  const sponsoring = (
    nodes: Array<{ login: string; isActive: boolean; amount: number }>,
  ) =>
    new Response(
      JSON.stringify({
        data: {
          user: {
            sponsoring: {
              nodes: nodes.map(({ login, isActive, amount }) => ({
                login,
                sponsorshipForViewerAsSponsor: {
                  isActive,
                  tier: { monthlyPriceInDollars: amount },
                },
              })),
            },
          },
        },
      }),
    );

  beforeEach(() => {
    service = new SponsorshipService(config);
    fetchMock = jest.spyOn(global, 'fetch');
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts an active sponsorship at the minimum', async () => {
    fetchMock.mockResolvedValue(
      sponsoring([{ login: 'acme', isActive: true, amount: 10 }]),
    );

    await expect(service.isSponsor('alice')).resolves.toBe(true);
  });

  it('passes the username as a variable, not inside the query', async () => {
    fetchMock.mockResolvedValue(sponsoring([]));

    await service.isSponsor('alice") { evil }');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables).toEqual({ login: 'alice") { evil }' });
    expect(body.query).not.toContain('alice');
  });

  it.each([
    ['below the minimum', [{ login: 'acme', isActive: true, amount: 5 }]],
    ['inactive', [{ login: 'acme', isActive: false, amount: 10 }]],
    ['for someone else', [{ login: 'other', isActive: true, amount: 100 }]],
    ['absent', []],
  ])('rejects a sponsorship %s', async (_, nodes) => {
    fetchMock.mockResolvedValue(sponsoring(nodes));

    await expect(service.isSponsor('alice')).resolves.toBe(false);
  });

  it('rejects an empty username without calling GitHub', async () => {
    await expect(service.isSponsor('')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects on an HTTP error', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 502 }));

    await expect(service.isSponsor('alice')).resolves.toBe(false);
  });

  it('rejects on GraphQL errors', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: 'nope' }] })),
    );

    await expect(service.isSponsor('alice')).resolves.toBe(false);
  });

  it('rejects on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    await expect(service.isSponsor('alice')).resolves.toBe(false);
  });
});

describe('isSponsorshipEnabled', () => {
  it('is on only when a sponsored login is set', () => {
    expect(isSponsorshipEnabled(() => undefined)).toBe(false);
    expect(isSponsorshipEnabled(() => 'acme')).toBe(true);
  });
});
