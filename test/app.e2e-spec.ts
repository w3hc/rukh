import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, Logger } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { MistralService } from '../src/mistral/mistral.service';
import { AppService } from '../src/app.service';
import { ConfigService } from '@nestjs/config';
import { ContextService } from '../src/context/context.service';
import { existsSync } from 'fs';
import { mkdir, rm, readFile, writeFile } from 'fs/promises';

jest.mock('fs');
jest.mock('fs/promises');

describe('App (e2e)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let loggerErrorSpy: jest.SpyInstance;

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

    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    await app.init();
  });

  afterEach(async () => {
    loggerErrorSpy.mockRestore();
    await app?.close();
  });

  afterAll(async () => {
    await moduleFixture?.close();
  });

  describe('Root Endpoint', () => {
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
  });

  describe('Ask Endpoint', () => {
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
          for (let i = 0; i < 50; i++) {
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

  describe('Context Endpoint with Password Authentication', () => {
    const mockConfigPath = 'data/contexts/index.json';
    const mockConfig = {
      contexts: [{ name: 'test-context', password: 'test-password' }],
    };

    beforeEach(() => {
      // Reset mocks for each test
      (existsSync as jest.Mock).mockReset();
      (readFile as jest.Mock).mockReset();
      (writeFile as jest.Mock).mockReset();
      (mkdir as jest.Mock).mockReset();
      (rm as jest.Mock).mockReset();

      // Setup default mock behaviors
      (readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
      (writeFile as jest.Mock).mockResolvedValue(undefined);
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      (rm as jest.Mock).mockResolvedValue(undefined);
    });

    describe('POST /context', () => {
      it('should create context with password', () => {
        const contextName = 'new-context';
        const password = 'new-password';

        (existsSync as jest.Mock).mockReturnValue(false);

        return request(app.getHttpServer())
          .post('/context')
          .send({ name: contextName, password })
          .expect(201)
          .expect((res) => {
            expect(res.body).toHaveProperty(
              'message',
              'Context created successfully',
            );
            expect(res.body).toHaveProperty('path');
          });
      });

      it('should reject context creation without password', () => {
        return request(app.getHttpServer())
          .post('/context')
          .send({ name: 'test-context' })
          .expect(400)
          .expect((res) => {
            expect(res.body.message).toContain('password should not be empty');
          });
      });
    });

    describe('DELETE /context/:name', () => {
      it('should delete context with correct password', () => {
        const contextName = 'test-context';
        const password = 'test-password';

        (existsSync as jest.Mock).mockReturnValue(true);

        return request(app.getHttpServer())
          .delete(`/context/${contextName}`)
          .set('x-context-password', password)
          .expect(200)
          .expect((res) => {
            expect(res.body).toHaveProperty(
              'message',
              'Context deleted successfully',
            );
          });
      });

      it('should reject context deletion with incorrect password', () => {
        const contextName = 'test-context';

        (existsSync as jest.Mock).mockReturnValue(true);

        return request(app.getHttpServer())
          .delete(`/context/${contextName}`)
          .set('x-context-password', 'wrong-password')
          .expect(401)
          .expect((res) => {
            expect(res.body.message).toBe('Invalid password for context');
          });
      });

      it('should reject context deletion without password header', () => {
        (existsSync as jest.Mock).mockReturnValue(true);

        return request(app.getHttpServer())
          .delete('/context/test-context')
          .expect(400)
          .expect((res) => {
            expect(res.body.message).toBe(
              'x-context-password header is required',
            );
          });
      });
    });

    describe('POST /context/upload', () => {
      it('should upload file with correct password', () => {
        const contextName = 'test-context';
        const password = 'test-password';
        const testFile = Buffer.from('test content');

        (existsSync as jest.Mock).mockImplementation((path) => true);

        return request(app.getHttpServer())
          .post('/context/upload')
          .set('x-context-password', password)
          .field('contextName', contextName)
          .attach('file', testFile, 'test.md')
          .expect(201)
          .expect((res) => {
            expect(res.body).toHaveProperty('message');
            expect([
              'File uploaded successfully',
              'File updated successfully',
            ]).toContain(res.body.message);
            expect(res.body).toHaveProperty('path');
            expect(res.body).toHaveProperty('wasOverwritten');
          });
      });

      it('should reject file upload with incorrect password', () => {
        const contextName = 'test-context';
        const testFile = Buffer.from('test content');

        (existsSync as jest.Mock).mockReturnValue(true);

        return request(app.getHttpServer())
          .post('/context/upload')
          .set('x-context-password', 'wrong-password')
          .field('contextName', contextName)
          .attach('file', testFile, 'test.md')
          .expect(401)
          .expect((res) => {
            expect(res.body.message).toBe('Invalid password for context');
          });
      });
    });

    describe('DELETE /context/:name/file', () => {
      it('should delete file with correct password', () => {
        const contextName = 'test-context';
        const password = 'test-password';
        const fileName = 'test.md';

        (existsSync as jest.Mock).mockImplementation((path) => true);

        return request(app.getHttpServer())
          .delete(`/context/${contextName}/file`)
          .set('x-context-password', password)
          .send({ filename: fileName })
          .expect(200)
          .expect((res) => {
            expect(res.body).toHaveProperty(
              'message',
              'File deleted successfully',
            );
          });
      });

      it('should reject file deletion with incorrect password', () => {
        const contextName = 'test-context';
        const fileName = 'test.md';

        (existsSync as jest.Mock).mockImplementation((path) => true);

        return request(app.getHttpServer())
          .delete(`/context/${contextName}/file`)
          .set('x-context-password', 'wrong-password')
          .send({ filename: fileName })
          .expect(401)
          .expect((res) => {
            expect(res.body.message).toBe('Invalid password for context');
          });
      });
    });

    describe('File Upload with Ask', () => {
      it('should handle a request with file upload', () => {
        const testFile = Buffer.from('This is test file content');

        return request(app.getHttpServer())
          .post('/ask')
          .attach('file', testFile, 'test.txt')
          .field('message', 'Please analyze this file')
          .field('model', 'mistral')
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

      it('should handle a request with all parameters and file', () => {
        const testFile = Buffer.from('This is test file content');

        return request(app.getHttpServer())
          .post('/ask')
          .attach('file', testFile, 'test.txt')
          .field('message', 'Please analyze this file')
          .field('model', 'mistral')
          .field('sessionId', TEST_SESSION_ID)
          .field('walletAddress', TEST_WALLET_ADDRESS)
          .field('context', 'rukh')
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
    });
  });
});
