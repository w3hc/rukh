# Streaming

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
