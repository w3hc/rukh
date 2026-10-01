# Adding a Provider

Every model Rukh can route a request to is an `LlmProvider` ([src/providers/llm-provider.ts](../src/providers/llm-provider.ts)). `AppService` never names a provider: it asks the `ProviderRegistry` for the one matching the request's `model`, and builds the fallback chain from whatever is registered. Adding a provider means writing one class and adding it to one list.

## The interface

| Member | Purpose |
|--------|---------|
| `key` | The value clients send as `model`, e.g. `gemini`. Must be unique. |
| `label` | The model name reported back in responses, e.g. `gemini-2.5-flash`. |
| `pricing` | Per-1K-token rates in USD (`inputCost`, `outputCost`, optional `cacheWriteCost` / `cacheReadCost`). |
| `fallbackEligible` | Whether the provider may be tried when another one fails. Defaults to `true` on the base classes. |
| `isAvailable()` | False when the provider lacks its configuration, typically an API key. Unavailable providers are left out of the fallback chain. |
| `ask()` | Answers in one response: `{ content, sessionId, usage, cost }`. |
| `stream()` | Yields `text` (and optionally `thinking` / `reset`) events, then one `final` event. See [STREAMING.md](STREAMING.md). |

Two base classes do most of the work:

- `BaseLlmService` ([src/providers/base-llm.service.ts](../src/providers/base-llm.service.ts)): conversation memory, cost calculation, request IDs, the API key guard, and `ask` / `stream` routed to your `processMessage` / `streamMessage`.
- `OpenAICompatibleService` ([src/providers/openai-compatible.service.ts](../src/providers/openai-compatible.service.ts)): the whole request, streaming and usage path for any API speaking the OpenAI chat completions protocol. `OpenAIService` and `DeepSeekService` are built on it.

## Example: Gemini through its OpenAI-compatible endpoint

**1. Write the provider** in `src/gemini/gemini.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAICompatibleService } from '../providers/openai-compatible.service';

@Injectable()
export class GeminiService extends OpenAICompatibleService {
  readonly key = 'gemini';
  readonly label = 'gemini-2.5-flash';
  protected readonly model = 'gemini-2.5-flash';
  protected readonly apiUrl =
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  protected readonly displayName = 'Gemini';
  protected readonly logger = new Logger(GeminiService.name);
  protected readonly apiKey?: string;

  // Check the provider's pricing page before shipping
  readonly pricing = { inputCost: 0.0003, outputCost: 0.0025 };

  constructor(private configService: ConfigService) {
    super();
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY');
  }
}
```

A local model served by [Ollama](https://ollama.com) works the same way: point `apiUrl` at `http://localhost:11434/v1/chat/completions`, set `pricing` to zero, and override `isAvailable()` to return `true`, since Ollama needs no key.

If the API reports more than prompt and completion tokens (cache hits, for instance), override `parseUsage()`, as `DeepSeekService` does. For an API that does not speak the OpenAI protocol, extend `BaseLlmService` instead and implement `processMessage()` and `streamMessage()` yourself, as `AnthropicService` and `MistralService` do.

**2. Wrap it in a module** in `src/gemini/gemini.module.ts`:

```ts
@Module({
  providers: [GeminiService],
  exports: [GeminiService],
})
export class GeminiModule {}
```

**3. Register it** in [src/providers/providers.module.ts](../src/providers/providers.module.ts): import `GeminiModule`, and add `GeminiService` to `PROVIDERS`. The order of that list is the fallback order.

**4. Declare the key** in [src/config/env.validation.ts](../src/config/env.validation.ts) as optional (`@IsOptional() @IsString() GEMINI_API_KEY?: string;`) and add `GEMINI_API_KEY=` to `.env.template`.

That's it: `model=gemini` now works for both `/ask` and streaming, the response reports `gemini-2.5-flash`, costs are tracked, and Gemini joins the fallback chain whenever its key is set.

## Checklist

- [ ] Add a spec next to the service. [openai.service.spec.ts](../src/openai/openai.service.spec.ts) shows how to mock `fetch` and an SSE body.
- [ ] Add the provider's rates to `CostTracker` in [src/memory/cost-tracking.service.ts](../src/memory/cost-tracking.service.ts), under its `label`.
- [ ] Add a section to [MODELS.md](MODELS.md).
