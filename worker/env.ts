export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  /** live = real AI, fixture = seed/expected/*.json, no AI calls. */
  AI_MODE: string;
  LLM_PROVIDER: string;
  ANTHROPIC_MODEL: string;
  MISTRAL_MODEL: string;
  ANTHROPIC_API_KEY?: string;
  MISTRAL_API_KEY?: string;

  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET?: string;

  CAP_SANDBOX_LIVE_PER_DAY: string;
  CAP_GLOBAL_AI_CALLS_PER_DAY: string;
  RETENTION_DAYS: string;
  INBOUND_ADDRESS: string;

  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** Local development only: opens /admin without Cloudflare Access. */
  DEV_ADMIN?: string;
}
