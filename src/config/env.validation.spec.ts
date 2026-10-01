import { validate } from './env.validation';

describe('validate', () => {
  const required = {
    MISTRAL_API_KEY: 'mistral-key',
    ANTHROPIC_API_KEY: 'anthropic-key',
  };

  it('accepts the required keys alone and applies defaults', () => {
    const env = validate(required);

    expect(env.PORT).toBe(3000);
    expect(env.SIWE_CHAIN_ID).toBe(1);
    expect(env.SIWE_MAX_AGE_SECONDS).toBe(300);
    expect(env.THROTTLE_ASK_LIMIT).toBe(1000);
    expect(env.THROTTLE_WEB_LIMIT).toBe(200);
    expect(env.NTFY_ASK_TOPIC).toBe('rukh');
    expect(env.OBSERVE_SERVICE_ID).toBe('rukh');
    expect(env.SPONSOR_MIN_MONTHLY_USD).toBe(5);
  });

  it('converts numeric strings', () => {
    const env = validate({ ...required, PORT: '8080', SIWE_CHAIN_ID: '10' });

    expect(env.PORT).toBe(8080);
    expect(env.SIWE_CHAIN_ID).toBe(10);
  });

  it('treats empty values as unset', () => {
    const env = validate({
      ...required,
      PORT: '',
      ANTHROPIC_EFFORT: '',
      OBSERVE_APP_KEY: '',
      OBSERVE_APP_SECRET: '',
    });

    expect(env.PORT).toBe(3000);
    expect(env.ANTHROPIC_EFFORT).toBeUndefined();
  });

  it('keeps variables outside the schema', () => {
    const env = validate({ ...required, HOME: '/home/rukh' });

    expect((env as unknown as Record<string, string>).HOME).toBe('/home/rukh');
  });

  it('lists every missing LLM key', () => {
    expect(() => validate({})).toThrow(
      /MISTRAL_API_KEY[\s\S]*ANTHROPIC_API_KEY/,
    );
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '-1'],
    ['SIWE_CHAIN_ID', '1.5'],
    ['SIWE_MAX_AGE_SECONDS', '0'],
    ['THROTTLE_ASK_LIMIT', 'many'],
    ['ANTHROPIC_EFFORT', 'extreme'],
    ['OBSERVE_DEBUG', 'yes'],
    ['SPONSOR_MIN_MONTHLY_USD', '-5'],
  ])('rejects %s=%s', (key, value) => {
    expect(() => validate({ ...required, [key]: value })).toThrow(
      new RegExp(`- ${key}:`),
    );
  });

  it('rejects an Observe key without its secret', () => {
    expect(() => validate({ ...required, OBSERVE_APP_KEY: 'key' })).toThrow(
      /set both to enable NestJS Observe/,
    );
  });

  it('rejects a sponsored login without a GitHub token', () => {
    expect(() =>
      validate({ ...required, SPONSOR_GITHUB_LOGIN: 'acme' }),
    ).toThrow(/GITHUB_API_TOKEN: required/);
  });
});
