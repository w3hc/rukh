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

The code follows the same path: [src/app.controller.ts](src/app.controller.ts) → [src/app.service.ts](src/app.service.ts) (`prepareAsk`) → [src/rag/rag.service.ts](src/rag/rag.service.ts) → the provider picked from the registry ([src/providers/](src/providers/): [src/anthropic/](src/anthropic/), [src/mistral/](src/mistral/), [src/openai/](src/openai/), [src/deepseek/](src/deepseek/)) → [src/memory/cost-tracking.service.ts](src/memory/cost-tracking.service.ts).

## Install

Requires Node 24.

```bash
pnpm i
cp .env.template .env
```

## Configure

Only `MISTRAL_API_KEY` and `ANTHROPIC_API_KEY` are required; every variable is documented in [.env.template](.env.template).

Optional modules load only when their variable is set:

- **Notifications** (`NTFY_ASK_TOKEN`): a push to [ntfy.sh](https://ntfy.sh) when a new conversation starts. To notify somewhere else, bind your own `Notifier` to the `NOTIFIER` token in [src/notifications/notifications.module.ts](src/notifications/notifications.module.ts).
- **Sponsorship check** (`SPONSOR_GITHUB_LOGIN`): `SponsorshipService.isSponsor()` tells whether a GitHub user sponsors that account with at least `SPONSOR_MIN_MONTHLY_USD` a month. It needs `GITHUB_API_TOKEN` and isn't wired to any route.

## Test

```bash
# format, lint, build, test, and test:e2e
pnpm dance
```

Or separately: 

```bash
# unit tests
pnpm test

# e2e tests
pnpm test:e2e

# test coverage
pnpm test:cov
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

## Create your first context

The repo ships one example context, [data/examples/rukh](data/examples/rukh). At boot, Rukh copies it to `data/contexts/rukh` if that folder doesn't exist yet, so a fresh clone can answer on the first `pnpm start`. The rest of `data/`, including `data/contexts/`, is gitignored, so your contexts and query logs never show up in `git status`. A context is just a folder: Rukh picks up changes on the next request, no restart needed.

1. Ask it something:

   ```bash
   curl 'http://localhost:3000/ask' \
     -F 'message=What is a Rukh?' \
     -F 'context=rukh'
   ```

   The `rag` block of the response lists `rukh-definition.md` in `selectedFiles`: the files that went to the model.

2. Look at `data/contexts/rukh/index.json` (copied from [data/examples/rukh/index.json](data/examples/rukh/index.json)). It describes each markdown file of the folder. The RAG step only sees these descriptions when it picks which files to send to the model, so make them specific:

   ```json
   {
     "name": "rukh",
     "description": "The rukh (roc), legendary bird of prey of Middle Eastern mythology",
     "numberOfFiles": 1,
     "totalSize": 7,
     "files": [
       {
         "name": "rukh-definition.md",
         "description": "Definition, etymology, origins and accounts of the rukh",
         "size": 7
       }
     ],
     "links": [],
     "queries": [],
     "creatorAddress": "0xe8c7A82B3AeA7239F8857b5Aa280b52e6E2B60Cd"
   }
   ```

   `size` is in KB. `creatorAddress` is the Ethereum address allowed to manage the context through the API: set your own. Add `"model": "mistral"` to pin the context to one provider. Each `/ask` appends to `queries`.

3. Make your own: copy the folder, replace the markdown files, and update `index.json` to match.

   ```bash
   cp -r data/contexts/rukh data/contexts/my-product
   ```

To manage contexts over HTTP instead (`POST /context`, `POST /context/upload`, links, deletion), sign each request with SIWE as `creatorAddress`. The full reference, including URLs as context sources and the `index.json` schema, is in [docs/CONTEXT_MANAGEMENT.md](docs/CONTEXT_MANAGEMENT.md).

## Example

Simple request: 

```bash
curl 'https://rukh.w3hc.org/ask' \
  -H 'Content-Type: multipart/form-data' \
  -F 'message=What'\''s Rukh?' \
  -F 'context=rukh'
```

Response body:

```json
{
  "output": "**Rukh** (also spelled roc, ruḵḵ, or rokh) is an enormous legendary bird of prey from Middle Eastern mythology and folklore.",
  "model": "claude-sonnet-5",
  "sessionId": "15a7e248-17f2-4b9e-a42b-000f97a075e7",
  "usage": {
    "input_tokens": 1930,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": {
      "ephemeral_5m_input_tokens": 0,
      "ephemeral_1h_input_tokens": 0
    },
    "output_tokens": 352,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "cost": {
    "input_cost": 0.003866,
    "output_cost": 0.00352,
    "total_cost": 0.007386
  },
  "rag": {
    "selectedFiles": ["rukh-definition.md"],
    "selectedUrls": [],
    "totalFilesAvailable": 1,
    "totalUrlsAvailable": 0,
    "selectionMethod": "rag-two-step",
    "selectionCost": {
      "input_cost": 0.000006,
      "output_cost": 0,
      "total_cost": 0.000006
    }
  }
}
```

## License

[LGPL-3.0](LICENSE)

## Contact

https://julienberanger.com/contact