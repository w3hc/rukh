export const SIWE_CONFIG = {
  // How long a signed message stays acceptable after being issued.
  MAX_AGE_SECONDS: Number(process.env.SIWE_MAX_AGE_SECONDS) || 300,
  // Clock skew tolerated between the signer's clock and this server's.
  CLOCK_SKEW_SECONDS: 60,
  CHAIN_ID: Number(process.env.SIWE_CHAIN_ID) || 1,
  // Comma-separated allow-list of frontend domains. Unset = no domain check
  // (the API itself has no single fixed frontend, so this is opt-in).
  ALLOWED_DOMAINS: process.env.SIWE_ALLOWED_DOMAINS
    ? process.env.SIWE_ALLOWED_DOMAINS.split(',').map((d) => d.trim())
    : undefined,
};
