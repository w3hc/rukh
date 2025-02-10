import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { MistralService } from '../src/mistral/mistral.service';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MistralService)
      .useValue({
        processMessage: jest.fn().mockResolvedValue('Mocked AI response'),
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

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  describe('/ask (POST)', () => {
    it('should handle request without model', () => {
      return request(app.getHttpServer())
        .post('/ask')
        .send({
          message: 'test message',
        })
        .expect(201)
        .expect({
          network: 'mainnet',
          model: 'none',
          txHash:
            '0x74a439e5a30952f4209037878f61e24949077e2285997a37798aee982651e84c',
        });
    });

    it('should handle request with Mistral model', () => {
      return request(app.getHttpServer())
        .post('/ask')
        .send({
          message: 'test message',
          model: 'mistral',
        })
        .expect(201)
        .expect({
          network: 'mainnet',
          model: 'ministral-3b-2410',
          txHash:
            '0x74a439e5a30952f4209037878f61e24949077e2285997a37798aee982651e84c',
          output: 'Mocked AI response',
        });
    });

    it('should validate request body - missing required field', () => {
      return request(app.getHttpServer())
        .post('/ask')
        .send({})
        .expect(400)
        .expect((res) => {
          expect(Array.isArray(res.body.message)).toBe(true);
          expect(res.body.message).toContain('Message is required');
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
  });
});
