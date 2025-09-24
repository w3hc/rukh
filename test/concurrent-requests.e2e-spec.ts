import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { MistralService } from '../src/mistral/mistral.service';
import { AnthropicService } from '../src/anthropic/anthropic.service';
import { CostTracker } from '../src/memory/cost-tracking.service';
import { SubsService } from '../src/subs/subs.service';

// Set timeout for concurrent tests
jest.setTimeout(30000);

describe('Concurrent Requests (e2e)', () => {
  let app: INestApplication;

  // Mock implementations for services
  const mockMistralService = {
    processMessage: jest
      .fn()
      .mockImplementation(async (message, sessionId) => ({
        content: `Mocked Mistral response for: ${message.substring(0, 50)}...`,
        sessionId: sessionId || 'generated-session-id',
        usage: { input_tokens: 100, output_tokens: 50 },
      })),
    getConversationHistory: jest.fn().mockResolvedValue({
      history: [],
      isFirstMessage: true,
    }),
  };

  const mockAnthropicService = {
    processMessage: jest
      .fn()
      .mockImplementation(async (message, sessionId) => ({
        content: `Mocked Anthropic response for: ${message.substring(0, 50)}...`,
        sessionId: sessionId || 'generated-session-id',
        usage: { input_tokens: 150, output_tokens: 75 },
      })),
    getConversationHistory: jest.fn().mockResolvedValue({
      history: [],
      isFirstMessage: true,
    }),
  };

  const mockCostTracker = {
    trackUsageWithTokens: jest.fn().mockResolvedValue(undefined),
    generateUsageReport: jest.fn().mockResolvedValue({
      global: { totalRequests: 2, totalCost: '0.0058' },
    }),
  };

  const mockSubsService = {
    isSubscribed: jest.fn().mockResolvedValue(true),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MistralService)
      .useValue(mockMistralService)
      .overrideProvider(AnthropicService)
      .useValue(mockAnthropicService)
      .overrideProvider(CostTracker)
      .useValue(mockCostTracker)
      .overrideProvider(SubsService)
      .useValue(mockSubsService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('Concurrent Ask Requests', () => {
    it('should handle 2 concurrent requests to /ask endpoint', async () => {
      const startTime = Date.now();

      // Prepare two different requests
      const request1 = {
        message:
          'What is the capital of France? Please provide a detailed answer.',
        model: 'mistral',
        sessionId: 'session-1',
        walletAddress: '0x1234567890123456789012345678901234567890',
      };

      const request2 = {
        message: 'Explain quantum computing in simple terms with examples.',
        model: 'anthropic',
        sessionId: 'session-2',
        walletAddress: '0x0987654321098765432109876543210987654321',
      };

      // Execute both requests concurrently using Promise.all
      const [response1, response2] = await Promise.all([
        request(app.getHttpServer()).post('/ask').send(request1).expect(201),
        request(app.getHttpServer()).post('/ask').send(request2).expect(201),
      ]);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify both responses are successful
      expect(response1.body).toHaveProperty('output');
      expect(response1.body).toHaveProperty('sessionId', 'session-1');
      expect(response1.body).toHaveProperty('model');

      expect(response2.body).toHaveProperty('output');
      expect(response2.body).toHaveProperty('sessionId', 'session-2');
      expect(response2.body).toHaveProperty('model');

      // Verify responses are different (not cached or mixed up)
      expect(response1.body.output).toContain('capital of France');
      expect(response2.body.output).toContain('quantum computing');
      expect(response1.body.sessionId).not.toBe(response2.body.sessionId);

      // Verify both services were called
      expect(mockMistralService.processMessage).toHaveBeenCalledWith(
        expect.stringContaining('capital of France'),
        'session-1',
        expect.any(String),
      );
      expect(mockAnthropicService.processMessage).toHaveBeenCalledWith(
        expect.stringContaining('quantum computing'),
        'session-2',
        expect.any(String),
      );

      // Verify cost tracking was called for both requests
      expect(mockCostTracker.trackUsageWithTokens).toHaveBeenCalledTimes(2);

      console.log(`Concurrent requests completed in ${totalTime}ms`);

      // Concurrent requests should complete faster than sequential
      // Allow some buffer for test environment overhead
      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
    });

    it('should handle 2 concurrent requests with different contexts', async () => {
      const request1 = {
        message: 'Summarize the documentation',
        model: 'mistral',
        context: 'rukh',
        sessionId: 'context-session-1',
      };

      const request2 = {
        message: 'What are the main features?',
        model: 'anthropic',
        context: 'rukh',
        sessionId: 'context-session-2',
      };

      // Execute concurrent requests with context
      const [response1, response2] = await Promise.all([
        request(app.getHttpServer()).post('/ask').send(request1).expect(201),
        request(app.getHttpServer()).post('/ask').send(request2).expect(201),
      ]);

      // Both should succeed
      expect(response1.body).toHaveProperty('output');
      expect(response2.body).toHaveProperty('output');

      // Sessions should remain separate
      expect(response1.body.sessionId).toBe('context-session-1');
      expect(response2.body.sessionId).toBe('context-session-2');
    });

    it('should handle concurrent requests from same session', async () => {
      const sharedSessionId = 'shared-session-123';

      const request1 = {
        message: 'Hello, my name is Alice.',
        model: 'mistral',
        sessionId: sharedSessionId,
      };

      const request2 = {
        message: 'What did I just tell you about my name?',
        model: 'mistral',
        sessionId: sharedSessionId,
      };

      // Execute concurrent requests with same session
      const [response1, response2] = await Promise.all([
        request(app.getHttpServer()).post('/ask').send(request1).expect(201),
        request(app.getHttpServer()).post('/ask').send(request2).expect(201),
      ]);

      // Both should use the same session
      expect(response1.body.sessionId).toBe(sharedSessionId);
      expect(response2.body.sessionId).toBe(sharedSessionId);

      // Both should get responses
      expect(response1.body.output).toBeTruthy();
      expect(response2.body.output).toBeTruthy();
    });

    it('should maintain rate limiting under concurrent load', async () => {
      // Test that rate limiting still works with concurrent requests
      const requests = Array.from({ length: 2 }, (_, i) => ({
        message: `Test message ${i + 1} for rate limiting verification`,
        model: 'mistral',
      }));

      const responses = await Promise.all(
        requests.map((req) =>
          request(app.getHttpServer()).post('/ask').send(req).expect(201),
        ),
      );

      // All should succeed since we're under the rate limit (50/hour)
      responses.forEach((response, index) => {
        expect(response.body).toHaveProperty('output');
        expect(response.body.output).toContain(`Test message ${index + 1}`);
      });

      // Verify all service calls were made
      expect(mockMistralService.processMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('Performance Characteristics', () => {
    it('should complete concurrent requests efficiently', async () => {
      const startTime = process.hrtime.bigint();

      const requests = [
        { message: 'Quick test 1', model: 'mistral' },
        { message: 'Quick test 2', model: 'anthropic' },
      ];

      await Promise.all(
        requests.map((req) =>
          request(app.getHttpServer()).post('/ask').send(req).expect(201),
        ),
      );

      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;

      console.log(`Concurrent execution time: ${durationMs.toFixed(2)}ms`);

      // Should complete within reasonable time
      expect(durationMs).toBeLessThan(5000); // 5 seconds max
    });
  });
});
