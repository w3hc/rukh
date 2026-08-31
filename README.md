# Rukh

Modular AI framework with RAG system supporting multiple LLMs and personalized contexts.

Live at: **[rukh.w3hc.org](http://rukh.w3hc.org)**

## Install

```bash
pnpm i
```

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

The Swagger UI should be available at http://localhost:3000/api

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
    "input_cost": 0.005796,
    "output_cost": 0.00528,
    "total_cost": 0.011076
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

### Streaming

Add `stream=true` to get the answer back as it is produced, as server-sent
events, instead of one JSON body. It works with all four models (`mistral`,
`anthropic`, `anthropic-web-search`, `openai`).

```bash
curl -N 'https://rukh.w3hc.org/ask' \
  -H 'Content-Type: multipart/form-data' \
  -F 'message=What'\''s Rukh?' \
  -F 'model=anthropic' \
  -F 'stream=true'
```

The response is `text/event-stream` with these events:

```
event: chunk
data: {"text":"**Rukh** (also spelled roc"}

event: chunk
data: {"text":", ruḵḵ, or rokh) is an enormous"}

event: done
data: {"output":"...","model":"claude-sonnet-5","sessionId":"...","usage":{...},"cost":{...},"rag":{...}}
```

- `chunk` - a piece of the answer, to append to what you have rendered.
- `reset` - discard everything rendered so far and start again. Only
  `anthropic-web-search` emits it, when the model narrates before searching
  ("let me look that up...") and then starts the real answer.
- `done` - the complete answer, with the exact same payload the non-streaming
  call would have returned. A client can ignore `chunk` entirely and just read
  this.
- `error` - every model in the fallback sequence failed, or the connection
  broke mid-answer.

Model fallback still applies, but only up to the first byte: once text has
reached you, a failure is reported as an `error` event rather than silently
restarting on another model and splicing two answers together.

## License

[LGPL-3.0](LICENSE)

## Contact

https://julienberanger.com/contact