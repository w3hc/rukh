# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Provider registry**: every model is an `LlmProvider` (`key`, `label`, `pricing`, `fallbackEligible`, `isAvailable`, `ask`, `stream`) registered under the `LLM_PROVIDERS` token, and `AppService` looks it up through `ProviderRegistry` instead of switching on the model name
  - `ProvidersModule` lists the providers in fallback order; adding one is a class plus a line there. See `docs/ADDING_A_PROVIDER.md`
  - `BaseLlmService` holds the memory, cost, request ID and API key logic the four services duplicated
  - `OpenAICompatibleService` holds the whole chat completions path; `OpenAIService` and `DeepSeekService` are thin subclasses
  - `anthropic-web-search` is its own provider, `AnthropicWebSearchProvider`, wrapping `AnthropicService`
- **Docker setup** (optional): `docker compose up --build` runs Rukh in a container; `pnpm i && pnpm start` stays the default path
  - Multi-stage `Dockerfile` on Node 24, non-root `node` user, only `dist` and production dependencies, plus Chromium for `/web-reader`
  - `docker-compose.yml` reads `.env` and mounts `data/` from the host
  - `.dockerignore` keeps `.env*`, `node_modules` and runtime `data/` files out of the build context
- **DeepSeek model support**: `model=deepseek` (`deepseek-v4-flash`), at full parity with Mistral/Anthropic/OpenAI — non-streaming and SSE streaming, included in the automatic fallback chain, with cost tracking
  - Configurable via the `DEEPSEEK_API_KEY` environment variable
- **Ask-call notifications**: Sends an ntfy.sh push notification whenever a brand new conversation starts on `ask` (first message of a session, i.e. no `sessionId` was supplied)
  - Includes the `context` value and the message text
  - Configurable via `NTFY_ASK_TOKEN` and `NTFY_ASK_TOPIC` environment variables
  - Only fires when `NODE_ENV=prod`, and never blocks or fails the `ask` response
- **Example context**: `data/examples/rukh` is committed and copied to `data/contexts/rukh` at boot when missing, so a fresh clone answers on the first `pnpm start`
  - Everything else in `data/` stays gitignored, including `data/contexts/` and runtime files (`chat-history.json`, `costs.json`), so the app never writes to a tracked file
- **Optional notifier**: notifications go through a `Notifier` interface bound to the `NOTIFIER` token, with ntfy as the only implementation
  - `NotificationsModule` loads only when `NTFY_ASK_TOKEN` is set; `AppService` no longer talks to ntfy itself
- **Optional sponsorship module**: `SponsorshipModule` loads only when `SPONSOR_GITHUB_LOGIN` is set, and checks sponsorships of that account at `SPONSOR_MIN_MONTHLY_USD` (default 5) or more
  - Boot fails if `SPONSOR_GITHUB_LOGIN` is set without `GITHUB_API_TOKEN`
  - The username is sent as a GraphQL variable instead of being interpolated into the query
- **Config validation at boot**: the environment is checked against a schema (`src/config/env.validation.ts`) before any provider starts
  - A missing `MISTRAL_API_KEY` or `ANTHROPIC_API_KEY`, a non-numeric port, SIWE or throttle value, an unknown `ANTHROPIC_EFFORT`, or only half of the Observe credentials stops the app with one message listing every problem
  - Empty `KEY=` lines count as unset, and defaults live in the schema

### Changed
- **AppService split**: the 1,270-line `AppService` is gone, replaced by focused services in `src/ask/`, with no change in behavior
  - `ContextLoaderService` loads a context (two-step RAG or every file), reads its `model` override and records each query in `index.json`
  - `UploadService` decodes and fences uploaded `.md`/`.csv` files; `prompt-fencing.ts` holds both fences
  - `AskPreparationService` picks the models and builds the prompt; `AskResultService` tracks usage and assembles the response
  - `AskService` and `AskStreamService` run the fallback loops for `ask` and its streaming variant
  - Removed the unused boot-time context cache, `processContextData` and `checkUrlRelevance`
- **Fallback chain**: built from the registered providers, and skips those without an API key, so an unconfigured OpenAI or DeepSeek no longer fails on every fallback
- **Mistral wiring**: `MistralService` has its own `MistralModule`, so the app and `RagModule` share one instance instead of each creating its own
- **Root route**: `GET /` redirects to the Swagger UI at `/api` instead of serving a w3hc-branded page
- **Version**: read from `package.json` for Swagger, NestJS Observe and the boot log, instead of a hardcoded `0.2.0`
- **Config access**: every variable is read through `ConfigService`; `process.env` is no longer read directly
  - `src/config/siwe.config.ts` is removed, `SiweAuthGuard` reads the SIWE settings itself
  - NestJS Observe is registered through `ConditionalModule`, after validation
  - An invalid `ANTHROPIC_EFFORT` now fails at boot instead of being ignored with a warning
  - Each optional feature logs once at boot when its key is missing, including ntfy
- **Dependencies**: NestJS 12 (`@nestjs/*`, `@nestjs/config` 12, `@nestjs/observe` 0.3), plus minor/patch bumps (langchain, puppeteer-core, throttler, multer, eslint, jest, prettier, `@types/node` 26)
  - NestJS 12 is ESM-only: Jest scripts run with `--experimental-vm-modules`, and node_modules are no longer transformed
  - TypeScript stays on 6: `ts-jest` and `@nestjs/cli` don't support TypeScript 7 yet
- **Node 24**: CI runs on Node 24 with a frozen lockfile
- **README**: rewritten for developers forking Rukh
  - Pitch, feature list, CI and license badges
  - Architecture diagram of the `/ask` flow (rate limit → model resolution → context/RAG → provider fallback → cost tracking)
  - "Create your first context" walkthrough, built on the committed `rukh` context
- **`.env.template`**: grouped into commented sections, each variable marked required or optional with its default
  - Adds the missing `NTFY_ASK_TOPIC`
  - Flags `THROTTLE_ASK_LIMIT` and `THROTTLE_WEB_LIMIT` as currently overridden by `rate-limit.config.ts`
  - Empty values instead of `'88888'` placeholders; settings with a default are commented out
- **Stricter types**: `@typescript-eslint/no-explicit-any` is now `warn`, and `src/` has no `any` left
  - Cost, usage and RAG metadata use `StreamCost` and `RagMetadataDto`, which now documents `selectedUrls` and `totalUrlsAvailable`
  - Provider responses and stream events (Anthropic, OpenAI-compatible, DeepSeek, Mistral) have their own types
  - Specs and mocks use typed provider mocks (`ProviderMock`, `AnthropicMock`) instead of `any`

### Fixed
- Ask-call notifications now log and skip on an ntfy delivery failure instead of silently swallowing it
- **Dirty working tree after `/ask`**: logging a query no longer modifies a tracked file, so the deploy script stops refusing to deploy
- **Corrupted JSON files under concurrent writes**: context indexes, chat history, the JSON stores and cost data are written to a temp file and renamed over the original, so a shorter write can no longer leave the tail of a longer one behind
- **Damaged context index**: `/ask` logs a warning and answers instead of failing when a context's `index.json` doesn't parse
- **Flaky e2e tests**: `pnpm test:e2e` runs the test files one at a time, since they share `data/`

### Removed
- **Legacy ESLint config**: `.eslintrc.js`, superseded by `eslint.config.mjs`
- **Unused `@mistralai/mistralai` mock** under `src/__mocks__/`, which no Jest config mapped
- **`SubsService`**: replaced by the optional `SponsorshipModule`; it was injected into `AppService` but never called
- **w3hc landing page**: the inline HTML returned by `GET /`, with its w3hc links and badge
