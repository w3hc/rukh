# Rukh

[![Test](https://github.com/w3hc/rukh/actions/workflows/test.yml/badge.svg)](https://github.com/w3hc/rukh/actions/workflows/test.yml)
[![License: LGPL-3.0](https://img.shields.io/badge/license-LGPL--3.0-blue.svg)](LICENSE)

A [NestJS](https://nestjs.com) starter kit for shipping your own AI agent as an API. Drop markdown files in a folder, and Rukh answers questions about them through whichever LLM is up, telling you what each answer cost.

Where a plain provider SDK gives you one model and a raw completion, and LangChain gives you building blocks to assemble, Rukh is a running service you fork and make your own: one `/ask` endpoint, already wired to four providers, contexts, RAG, auth and rate limits.

- API: **[rukh.w3hc.org](http://rukh.w3hc.org)**
- UI: **[rukh.it](https://www.rukh.it/)** (source: [rukh-ui](https://github.com/w3hc/rukh-ui))

## Features

- **Multi-provider with fallback**: Mistral, Anthropic, OpenAI and DeepSeek behind one `model` parameter. If the chosen provider fails, the next one takes over. Providers register in one place, so adding one (Gemini, a local Ollama model) is one class: see [docs/ADDING_A_PROVIDER.md](docs/ADDING_A_PROVIDER.md). Models are listed in [docs/MODELS.md](docs/MODELS.md).
- **Streaming**: `stream=true` returns server-sent events, with fallback up to the first byte. See [docs/STREAMING.md](docs/STREAMING.md).
- **File-based contexts + RAG**: a context is a folder of markdown files and URLs under `data/contexts/`. A cheap first pass picks the files relevant to the question, and only those reach the model. See [docs/CONTEXT_MANAGEMENT.md](docs/CONTEXT_MANAGEMENT.md).
- **Per-call cost tracking**: every response carries its token usage and its cost in USD, RAG selection included.
- **SIWE auth**: managing contexts (create, upload, delete) requires a [Sign-In with Ethereum](https://login.xyz) signature from the context's creator.
- **Rate limiting**: per-IP limits on `/ask` (50/hour) and `/web-reader` (20/minute), set in [src/config/rate-limit.config.ts](src/config/rate-limit.config.ts).
- **Sessions**: pass back the `sessionId` to keep the conversation going.

## Architecture

```mermaid
flowchart LR
    client([Client]) -->|POST /ask| guard[Rate limiter]
    guard --> prepare[Resolve model<br/>and fallback order]
    prepare --> ctx[Load context<br/>data/contexts/name]
    ctx --> rag{Two-step RAG<br/>ministral-3b picks<br/>relevant files + URLs}
    rag --> prompt[Build system prompt]
    prompt --> provider[Provider<br/>Mistral · Anthropic · OpenAI · DeepSeek]
    provider -->|fails| provider
    provider --> cost[Cost tracking<br/>generation + RAG selection]
    cost -->|JSON or SSE| client
```

1. `/ask` goes through the per-IP rate limiter.
2. Rukh picks the model: the context's `model` override if its `index.json` sets one, then the request's `model`, then `anthropic`. The other providers line up behind it as fallbacks.
3. It loads the context (`rukh` by default). When the context has files or URLs to choose from, a cheap `ministral-3b` call selects the relevant ones, and only those go into the system prompt.
4. The first provider in line answers. If it fails, the next one takes over, as JSON or as server-sent events.
5. The response carries token usage and cost, with the RAG selection cost added on.

The code follows the same path: [src/app.controller.ts](src/app.controller.ts) → [src/ask/](src/ask/) (`AskPreparationService`, then `AskService` or `AskStreamService`) → [src/rag/rag.service.ts](src/rag/rag.service.ts) → the provider picked from the registry ([src/providers/](src/providers/): [src/anthropic/](src/anthropic/), [src/mistral/](src/mistral/), [src/openai/](src/openai/), [src/deepseek/](src/deepseek/)) → [src/memory/cost-tracking.service.ts](src/memory/cost-tracking.service.ts).

## Install

Requires Node 24 or later.

```bash
pnpm i
cp .env.template .env
```

## Configure

Only `MISTRAL_API_KEY` and `ANTHROPIC_API_KEY` are required; every variable is documented in [.env.template](.env.template).

## Test

```bash
# unit tests
pnpm test

# e2e tests
pnpm test:e2e

# test coverage
pnpm test:cov

# what CI checks before the tests
pnpm format:check
pnpm lint:check
pnpm audit
```

## Run

```bash
pnpm start
```

The Swagger UI should be available at http://localhost:3000/api, and http://localhost:3000 redirects to it.

### With Docker (optional)

Docker is never required: the steps above are the default path. If you'd rather run Rukh in a container, create `.env` as in [Install](#install), then:

```bash
docker compose up --build
```

The image builds with Node 24, runs as the non-root `node` user, and ships Chromium so `/web-reader` works. `data/` is mounted from the host, so your contexts, chat history and costs survive rebuilds. `PORT` in `.env` sets the host port; the container always listens on 3000.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and conventions. To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[LGPL-3.0](LICENSE)

## Contact

https://julienberanger.com/contact