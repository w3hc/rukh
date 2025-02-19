import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { MistralService } from '../src/mistral/mistral.service';
import { AppService } from '../src/app.service';
import { ConfigService } from '@nestjs/config';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  const TEST_SESSION_ID = 'test-session-id';
  const TEST_WALLET_ADDRESS = '0x446200cB329592134989B615d4C02f9f3c9E970F';
  const MOCK_TX_HASH =
    '0x1234567890123456789012345678901234567890123456789012345678901234';

  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MistralService)
      .useValue({
        processMessage: jest.fn().mockResolvedValue({
          content: 'Mocked AI response',
          sessionId: TEST_SESSION_ID,
        }),
        getConversationHistory: jest.fn().mockResolvedValue({
          history: [],
          isFirstMessage: true,
        }),
      })
      .overrideProvider(AppService)
      .useValue({
        getHello: () =>
          `<!DOCTYPE html><html><body><h1>Welcome to Rukh</h1><p>developer-friendly toolkit</p><a href="/api">Swagger UI</a></body></html>`,
        ask: jest.fn().mockResolvedValue({
          output: 'Mocked AI response',
          model: 'ministral-3b-2410',
          network: 'arbitrum-sepolia',
          txHash: MOCK_TX_HASH,
          explorerLink: `https://sepolia.arbiscan.io/tx/${MOCK_TX_HASH}`,
          sessionId: TEST_SESSION_ID,
        }),
      })
      .overrideProvider(ConfigService)
      .useValue({
        get: jest.fn().mockImplementation((key: string) => {
          const config = {
            ARBITRUM_RPC_URL: 'https://test.arbitrum.xyz',
            PRIVATE_KEY: '0x1234567890',
            RUKH_TOKEN_ADDRESS: '0x1234567890123456789012345678901234567890',
          };
          return config[key];
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  afterAll(async () => {
    await moduleFixture?.close();
  });

  describe('/ (GET)', () => {
    it('should return HTML welcome page', () => {
      return request(app.getHttpServer())
        .get('/')
        .expect(200)
        .expect('Content-Type', /html/)
        .expect((res) => {
          expect(res.text).toContain('Welcome to Rukh');
          expect(res.text).toContain('developer-friendly toolkit');
          expect(res.text).toContain('Swagger UI');
        });
    });
  });

  describe('/ask (POST)', () => {
    describe('Valid Requests', () => {
      it('should handle basic request with only message', () => {
        return request(app.getHttpServer())
          .post('/ask')
          .send({ message: 'test message' })
          .expect(201)
          .expect((res) => {
            expect(res.body).toMatchObject({
              output: 'Mocked AI response',
              model: 'ministral-3b-2410',
              network: 'arbitrum-sepolia',
              txHash: MOCK_TX_HASH,
              sessionId: TEST_SESSION_ID,
            });
          });
      });

      it('should handle request with all optional parameters', () => {
        return request(app.getHttpServer())
          .post('/ask')
          .send({
            message: 'test message',
            model: 'mistral',
            sessionId: TEST_SESSION_ID,
            walletAddress: TEST_WALLET_ADDRESS,
          })
          .expect(201)
          .expect((res) => {
            expect(res.body).toMatchObject({
              output: 'Mocked AI response',
              model: 'ministral-3b-2410',
              network: 'arbitrum-sepolia',
              txHash: MOCK_TX_HASH,
              explorerLink: `https://sepolia.arbiscan.io/tx/${MOCK_TX_HASH}`,
              sessionId: TEST_SESSION_ID,
            });
          });
      });

      it('should handle request with empty model string', () => {
        return request(app.getHttpServer())
          .post('/ask')
          .send({
            message: 'test message',
            model: '',
          })
          .expect(201)
          .expect((res) => {
            expect(res.body.model).toBe('ministral-3b-2410');
          });
      });
    });

    describe('Invalid Requests', () => {
      it('should reject missing message', () => {
        return request(app.getHttpServer())
          .post('/ask')
          .send({})
          .expect(400)
          .expect((res) => {
            expect(res.body.message).toContain('message must be a string');
          });
      });

      it('should reject invalid model value', () => {
        return request(app.getHttpServer())
          .post('/ask')
          .send({
            message: 'test',
            model: 'invalid-model',
          })
          .expect(400)
          .expect((res) => {
            expect(res.body.message).toContain(
              'Model must be either "mistral" or empty',
            );
          });
      });

      it('should reject invalid wallet address', () => {
        return request(app.getHttpServer())
          .post('/ask')
          .send({
            message: 'test',
            walletAddress: 'invalid-address',
          })
          .expect(400)
          .expect((res) => {
            expect(res.body.message).toContain(
              'walletAddress must be an Ethereum address',
            );
          });
      });

      it('should reject additional properties', () => {
        return request(app.getHttpServer())
          .post('/ask')
          .send({
            message: 'test',
            invalidProperty: 'value',
          })
          .expect(400)
          .expect((res) => {
            expect(res.body.message).toContain(
              'property invalidProperty should not exist',
            );
          });
      });
    });

    describe('Rate Limiting', () => {
      it('should enforce rate limiting after 3 requests', async () => {
        // Make 3 successful requests
        for (let i = 0; i < 3; i++) {
          await request(app.getHttpServer())
            .post('/ask')
            .send({ message: 'test message' })
            .expect(201);
        }

        // Fourth request should be rate limited
        return request(app.getHttpServer())
          .post('/ask')
          .send({ message: 'test message' })
          .expect(429)
          .expect((res) => {
            expect(res.body.message).toContain('Rate limit exceeded');
          });
      });
    });
  });
});
