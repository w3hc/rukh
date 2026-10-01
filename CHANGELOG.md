# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **DeepSeek model support**: `model=deepseek` (`deepseek-v4-flash`), at full parity with Mistral/Anthropic/OpenAI — non-streaming and SSE streaming, included in the automatic fallback chain, with cost tracking
  - Configurable via the `DEEPSEEK_API_KEY` environment variable
- **Ask-call notifications**: Sends an ntfy.sh push notification whenever a brand new conversation starts on `ask` (first message of a session, i.e. no `sessionId` was supplied)
  - Includes the `context` value and the message text
  - Configurable via `NTFY_ASK_TOKEN` and `NTFY_ASK_TOPIC` environment variables
  - Only fires when `NODE_ENV=prod`, and never blocks or fails the `ask` response
- **Example context**: `data/contexts/rukh` is now committed, so a fresh clone answers on the first `pnpm start`
  - The rest of `data/` stays gitignored, including runtime files (`chat-history.json`, `costs.json`)

### Changed
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

### Fixed
- Ask-call notifications now log and skip on an ntfy delivery failure instead of silently swallowing it
