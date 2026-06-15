export const RATE_LIMITS = {
  ASK_ENDPOINT: {
    limit: 50,
    ttl: 3600000, // 1 hour in milliseconds
  },
  WEB_READER: {
    limit: 20,
    ttl: 60000, // 1 minute in milliseconds
  },
} as const;
