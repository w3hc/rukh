import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { MistralService } from '../src/mistral/mistral.service';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  const TEST_SESSION_ID = 'fe35ccb1-848f-4111-98cf-09aec5a134e0';

  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MistralService)
      .useValue({
        processMessage: jest.fn().mockImplementation((message, sessionId) => {
          return Promise.resolve({
            content: 'Mocked AI response',
            sessionId: sessionId || TEST_SESSION_ID,
          });
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

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  describe('/ask (POST)', () => {
    it('should handle request with Mistral model explicitly specified', () => {
      return request(app.getHttpServer())
        .post('/ask')
        .send({
          message: 'test message',
          model: 'mistral',
          sessionId: TEST_SESSION_ID,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toEqual({
            output: 'Mocked AI response',
            model: 'ministral-3b-2410',
            network: 'arbitrum-sepolia',
            txHash: expect.any(String),
            sessionId: TEST_SESSION_ID,
          });
        });
    });

    it('should handle request with no model specified (defaults to Mistral)', () => {
      return request(app.getHttpServer())
        .post('/ask')
        .send({
          message: 'test message',
          sessionId: TEST_SESSION_ID,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toEqual({
            output: 'Mocked AI response',
            model: 'ministral-3b-2410',
            network: 'arbitrum-sepolia',
            txHash: expect.any(String),
            sessionId: TEST_SESSION_ID,
          });
        });
    });

    it('should generate sessionId if not provided', () => {
      return request(app.getHttpServer())
        .post('/ask')
        .send({
          message: 'test message',
          model: 'mistral',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toEqual({
            output: 'Mocked AI response',
            model: 'ministral-3b-2410',
            network: 'arbitrum-sepolia',
            txHash: expect.any(String),
            sessionId: expect.any(String),
          });
        });
    });

    it('should validate request body - missing required field', () => {
      return request(app.getHttpServer())
        .post('/ask')
        .send({})
        .expect(400)
        .expect((res) => {
          expect(Array.isArray(res.body.message)).toBe(true);
          expect(res.body.message).toContain('message must be a string');
          expect(res.body.error).toBe('Bad Request');
        });
    });

    it('should validate request body - invalid model value', () => {
      return request(app.getHttpServer())
        .post('/ask')
        .send({
          message: 'test',
          model: 'invalid-model',
        })
        .expect(400)
        .expect((res) => {
          expect(Array.isArray(res.body.message)).toBe(true);
          expect(res.body.message).toContain(
            'Model must be either "mistral" or empty',
          );
          expect(res.body.error).toBe('Bad Request');
        });
    });

    it('should validate request body - unexpected field', () => {
      return request(app.getHttpServer())
        .post('/ask')
        .send({
          message: 'test',
          unexpectedField: 'should fail',
        })
        .expect(400)
        .expect((res) => {
          expect(Array.isArray(res.body.message)).toBe(true);
          expect(res.body.message).toContain(
            'property unexpectedField should not exist',
          );
          expect(res.body.error).toBe('Bad Request');
        });
    });

    it('should accept any sessionId format', () => {
      return request(app.getHttpServer())
        .post('/ask')
        .send({
          message: 'test',
          model: 'mistral',
          sessionId: 'any-session-id-format',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toEqual({
            output: 'Mocked AI response',
            model: 'ministral-3b-2410',
            network: 'arbitrum-sepolia',
            txHash: expect.any(String),
            sessionId: 'any-session-id-format',
          });
        });
    });
  });
});
