// AppModule validates the environment as soon as it is imported. The e2e
// suites override every provider that would use these keys, so placeholders
// are enough when the real ones are missing (as in CI).
process.env.MISTRAL_API_KEY ||= 'test-mistral-key';
process.env.ANTHROPIC_API_KEY ||= 'test-anthropic-key';
