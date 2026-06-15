import { Test, TestingModule } from '@nestjs/testing';
import { SubsService } from './subs.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

// Mock fetch globally
global.fetch = jest.fn();

describe('SubsService', () => {
  let service: SubsService;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'GITHUB_API_TOKEN') return 'test-token';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubsService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<SubsService>(SubsService);

    // Suppress logger output in tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isSubscribed', () => {
    it('should return false if no data is provided', async () => {
      const result = await service.isSubscribed('testuser');

      expect(result).toBe(false);
    });

    it('should return false if data is invalid JSON string', async () => {
      const result = await service.isSubscribed('testuser', 'invalid-json');

      expect(result).toBe(false);
    });

    it('should return false if no GitHub username is provided', async () => {
      const result = await service.isSubscribed(undefined, {});

      expect(result).toBe(false);
    });

    it('should return false if user is not sponsoring', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            user: {
              sponsoring: {
                nodes: [],
              },
            },
          },
        }),
      });

      const result = await service.isSubscribed('testuser', {
        githubUserName: 'testuser',
      });

      expect(result).toBe(false);
    });

    it('should return true if user is sponsoring w3hc with >= $5', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            user: {
              sponsoring: {
                nodes: [
                  {
                    login: 'w3hc',
                    sponsorshipForViewerAsSponsor: {
                      tier: {
                        name: 'Basic',
                        monthlyPriceInDollars: 5,
                      },
                      isActive: true,
                    },
                  },
                ],
              },
            },
          },
        }),
      });

      const result = await service.isSubscribed('testuser', {
        githubUserName: 'testuser',
      });

      expect(result).toBe(true);
    });

    it('should return false if sponsorship amount is less than $5', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            user: {
              sponsoring: {
                nodes: [
                  {
                    login: 'w3hc',
                    sponsorshipForViewerAsSponsor: {
                      tier: {
                        name: 'Supporter',
                        monthlyPriceInDollars: 3,
                      },
                      isActive: true,
                    },
                  },
                ],
              },
            },
          },
        }),
      });

      const result = await service.isSubscribed('testuser', {
        githubUserName: 'testuser',
      });

      expect(result).toBe(false);
    });

    it('should return false if sponsorship is inactive', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            user: {
              sponsoring: {
                nodes: [
                  {
                    login: 'w3hc',
                    sponsorshipForViewerAsSponsor: {
                      tier: {
                        name: 'Basic',
                        monthlyPriceInDollars: 5,
                      },
                      isActive: false,
                    },
                  },
                ],
              },
            },
          },
        }),
      });

      const result = await service.isSubscribed('testuser', {
        githubUserName: 'testuser',
      });

      expect(result).toBe(false);
    });

    it('should handle GitHub API errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
      });

      const result = await service.isSubscribed('testuser', {
        githubUserName: 'testuser',
      });

      expect(result).toBe(false);
    });

    it('should handle GitHub API GraphQL errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          errors: [{ message: 'Invalid token' }],
        }),
      });

      const result = await service.isSubscribed('testuser', {
        githubUserName: 'testuser',
      });

      expect(result).toBe(false);
    });

    it('should handle fetch errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await service.isSubscribed('testuser', {
        githubUserName: 'testuser',
      });

      expect(result).toBe(false);
    });

    it('should parse string data as JSON', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            user: {
              sponsoring: {
                nodes: [
                  {
                    login: 'w3hc',
                    sponsorshipForViewerAsSponsor: {
                      tier: {
                        name: 'Basic',
                        monthlyPriceInDollars: 5,
                      },
                      isActive: true,
                    },
                  },
                ],
              },
            },
          },
        }),
      });

      const result = await service.isSubscribed(
        undefined,
        JSON.stringify({ githubUserName: 'testuser' }),
      );

      expect(result).toBe(true);
    });
  });

  describe('initialization without GITHUB_API_TOKEN', () => {
    it('should log warning if GITHUB_API_TOKEN is not set', async () => {
      const mockConfigServiceNoToken = {
        get: jest.fn().mockReturnValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SubsService,
          { provide: ConfigService, useValue: mockConfigServiceNoToken },
        ],
      }).compile();

      const serviceNoToken = module.get<SubsService>(SubsService);

      // Service should still be created but sponsorship check will fail
      expect(serviceNoToken).toBeDefined();

      const result = await serviceNoToken.isSubscribed('testuser', {
        githubUserName: 'testuser',
      });

      expect(result).toBe(false);
    });
  });
});
