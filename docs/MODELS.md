# Supported Models

Rukh supports multiple LLM providers with automatic fallback capabilities. When making a request, you can specify which model to use via the `model` parameter. If a model fails, the system automatically tries the next available provider.

## Quick Reference

| Provider | Parameter Value | Model Name | Input Cost | Output Cost |
|----------|----------------|------------|------------|-------------|
| Mistral AI | `mistral` | `mistral-small-latest` | $0.15/M tokens | $0.60/M tokens |
| Anthropic | `anthropic` | `claude-sonnet-5` | $2/M tokens | $10/M tokens |
| OpenAI | `openai` | `gpt-4o` | $2.50/M tokens | $10/M tokens |

*Rates verified 2026-09-05 against each provider's official pricing page. They mirror the tables in `MistralService`, `AnthropicService`, `OpenAIService` and `CostTrackingService` — update all of them together.*

## Detailed Information

### Mistral AI

**Model**: `mistral-small-latest` (currently resolves to Mistral Small 4)

**Parameter value**: `mistral`

**Pricing**:
- Input: $0.15 per million tokens
- Output: $0.60 per million tokens

**Configuration**:
Set the `MISTRAL_API_KEY` environment variable in your `.env` file.

**Features**:
- Fast response times
- Cost-effective for most use cases
- Good quality for general-purpose tasks

**Use cases**:
- High-volume applications where cost is a concern
- General chat and Q&A
- Content generation

**Why not `mistral-large-latest`**:
Large is cheaper per token ($0.50/M in, $1.50/M out) but sits behind a paid
subscription tier - a key without that entitlement gets `403 tier_not_allowed`.
`MistralService.MODEL_RATES` still carries its rate, along with
`mistral-medium-latest` ($1.50/M in, $7.50/M out) and `ministral-3b-latest`
($0.10/M in and out), for the paths that name a model explicitly.

**Rate limits**:
Mistral's limits are set by workspace tier, not by model - every model
compatible with a given tier shares the same ceiling, so switching models does
not buy headroom. Free mode allows 1 request/second, 500,000 tokens/minute and
1 billion tokens/month; exceeding any of the three returns `429` with code
`1300`. Pay-as-you-go unlocks Tier 1, and tiers rise automatically at EUR 20 /
100 / 500 of cumulative *billed* usage (prepaid credits do not count). Your
actual limits and consumption are visible only at
<https://admin.mistral.ai/plateforme/limits>.

Because a 429 is a tier problem rather than a transient one, `MistralService`
caps retries at 1 (`maxRetries`) and logs the failure as a warning before the
fallback chain moves on. LangChain's default of 6 retries with exponential
backoff spent roughly 90 seconds per request before failing over.

---

### Anthropic (Claude)

**Model**: `claude-sonnet-5`

**Parameter value**: `anthropic`

**Pricing**:
- Input: $2 per million tokens
- Output: $10 per million tokens

The $2/$10 launch pricing is now Sonnet 5's standard price; the increase to
$3/$15 that had been scheduled for 2026-09-01 was cancelled.

**Configuration**:
Set the `ANTHROPIC_API_KEY` environment variable in your `.env` file.

**Features**:
- High-quality responses
- Excellent for complex reasoning and analysis
- Strong performance on nuanced tasks
- 1M token context window
- **Default model** if none is specified

**Output ceiling**:
`max_tokens` is 128,000 on the streaming paths and 64,000 on the non-streaming
ones. That split is deliberate, not drift: 128,000 is Sonnet 5's maximum, but a
ceiling that high needs streaming or the request times out before the answer
lands. Thinking draws on the same budget and is on by default, so the visible
answer gets whatever reasoning leaves behind - which is why the streaming paths
ask for the model's full allowance.

**Use cases**:
- Complex analytical tasks
- Code analysis and generation
- Tasks requiring deep reasoning
- Long-form content creation

---

### OpenAI

**Model**: `gpt-4o`

**Parameter value**: `openai`

**Pricing**:
- Input: $2.50 per million tokens
- Output: $10 per million tokens

**Configuration**:
Set the `OPENAI_API_KEY` environment variable in your `.env` file.

**Features**:
- Versatile performance across various tasks
- Strong general-purpose capabilities
- Good balance of quality and cost
- No output ceiling set - `OpenAIService` leaves `max_tokens` unset, so the
  limit is whatever the model allows rather than a constant that has to be
  revisited on every model change

**Use cases**:
- General-purpose applications
- Creative writing
- Code generation
- Problem-solving tasks

---

## RAG File Selection Model

When using two-step RAG (Retrieval-Augmented Generation), Rukh uses a lightweight model for intelligent file selection before generating the final response.

**Model**: `ministral-3b-latest` (hardcoded in `RagService`)

**Activation**: Two-step RAG runs automatically per request — no configuration needed. It kicks in only when the caller explicitly passes a `context` and that context has more than one selectable resource (files + URLs); a context with zero or one resource always uses the legacy full-context method, since there's nothing to select between. The selection cap is hardcoded to 5 resources (`AppService.RAG_MAX_FILES`).

**Purpose**:
Cost-effective file relevance scoring before full context generation. This reduces costs by only including relevant context files in the main prompt.

**How it works**:
1. **Step 1 (Selection)**: Uses a small, fast model to analyze which files are relevant to the query
2. **Step 2 (Generation)**: Uses the selected model to generate the response with only relevant files included

---

## RAG Workflow

Rukh implements an intelligent two-step Retrieval-Augmented Generation (RAG) workflow to optimize context usage and reduce costs. Here's how it works:

### Standard Mode (Legacy)

When no `context` is passed, or the context has zero or one resource, Rukh uses the legacy method:

```
User Query → Load ALL Context Files → Send to Main Model → Response
```

**Characteristics**:
- All markdown files in the context are loaded
- All web links in the context are fetched
- Full context is sent to the main model
- Higher cost for contexts with many files
- Simpler, more straightforward approach

### Two-Step RAG Mode (Recommended)

When an explicit `context` has more than one resource, Rukh uses an intelligent two-step process:

```
                          ┌─────────────────────┐
                          │   User Query        │
                          └──────────┬──────────┘
                                     │
                          ┌──────────▼──────────────┐
                          │  Load Context Index     │
                          │  (file metadata only)   │
                          └──────────┬──────────────┘
                                     │
              ┌──────────────────────▼──────────────────────┐
              │        STEP 1: FILE SELECTION                │
              │                                              │
              │  Model: ministral-3b-latest                  │
              │  Input: User query + File descriptions       │
              │  Output: Array of relevant file numbers      │
              │  Cost: ~$0.0001 per request                  │
              └──────────────────────┬───────────────────────┘
                                     │
                          ┌──────────▼──────────────┐
                          │  Load ONLY Selected     │
                          │  Files (typically 3-5)  │
                          └──────────┬──────────────┘
                                     │
              ┌──────────────────────▼──────────────────────┐
              │        STEP 2: RESPONSE GENERATION           │
              │                                              │
              │  Model: User's choice (mistral/anthropic/    │
              │         openai)                              │
              │  Input: User query + Selected files only     │
              │  Output: Final response                      │
              │  Cost: Reduced due to smaller context        │
              └──────────────────────┬───────────────────────┘
                                     │
                          ┌──────────▼──────────────┐
                          │   Return Response       │
                          │   (with cost breakdown) │
                          └─────────────────────────┘
```

### Detailed Workflow Steps

#### Step 1: Intelligent File Selection

1. **Load Context Metadata**
   - Reads `data/contexts/{context}/index.json`
   - Extracts file list with descriptions
   - No file content is loaded yet

2. **Build Selection Prompt**
   - Formats user's question
   - Lists all available files with their descriptions
   - Asks model to return JSON array of relevant file indices

3. **Call Ministral 3B**
   - Sends selection prompt to `ministral-3b-latest`
   - Receives JSON response like `[1, 3, 5]`
   - Tracks selection cost separately

4. **Parse Response & Add Required Files**
   - Extracts JSON array from model output
   - Maps indices to filenames
   - Automatically adds any required files (hardcoded in `RagService.REQUIRED_FILES`)
   - Falls back to all files if parsing fails

#### Step 2: Context Building & Response Generation

5. **Load Selected Files**
   - Reads only the selected markdown files from disk
   - Places required files first (in config order)
   - Places RAG-selected files after required files
   - Builds a focused context prompt
   - Includes web links (not yet filtered by RAG)

6. **Generate Response**
   - Sends user query + focused context to main model
   - Uses the model specified by user (`mistral`, `anthropic`, or `openai`)
   - Returns response with usage metrics

7. **Return Combined Costs**
   - Calculates total cost (selection + generation)
   - Returns both costs separately in response
   - Provides RAG metadata (selected files, total available)

### Cost Comparison Example

Consider a context with 50 files, where only 5 are relevant:

**Standard Mode:**
```
Input tokens:  ~200,000 (all 50 files)
Output tokens: ~500
Model: claude-sonnet-5
Cost: $0.40 + $0.005 = $0.405
```

**Two-Step RAG Mode:**
```
Step 1 (Selection):
  Input tokens:  ~1,000 (file list)
  Output tokens: ~20 (JSON array)
  Model: ministral-3b-latest
  Cost: ~$0.0001

Step 2 (Generation):
  Input tokens:  ~20,000 (5 files only)
  Output tokens: ~500
  Model: claude-sonnet-5
  Cost: $0.04 + $0.005 = $0.045

Total: $0.0451 (89% cost reduction!)
```

### Configuration

Two-step RAG has no `.env` configuration — it's fully automatic and its parameters are hardcoded in the source:

- **Activation** (`AppService.ask`): runs only when the caller passes an explicit `context` with more than one selectable resource.
- **Selection cap** (`AppService.RAG_MAX_FILES`): 5 resources.
- **Selection model** (`RagService.selectRelevantFiles`): `ministral-3b-latest`.
- **Required files** (`RagService.REQUIRED_FILES`): `['instruction-file.md']`.

To change any of these, edit the source directly rather than an env var.

### Required Files

The RAG system supports **required files** - specific files that are **always included** in the context, regardless of what the AI selects. This is useful for system instructions, glossaries, or critical reference documents that should always be available.

**How it works:**

1. **Defined** in code as `RagService.REQUIRED_FILES` (currently `['instruction-file.md']`).

2. **Selection Phase**:
   - AI selects relevant files (e.g., 3 files)
   - System automatically adds required files if not already selected
   - Result: `instruction-file.md, file1.md, file2.md, file3.md`

3. **Context Building**:
   - Required files are placed **first** in the context (in list order)
   - This gives them priority in the LLM's attention
   - Other selected files follow

**Benefits:**
- **Consistent Behavior**: Important instructions are never missed
- **Priority Placement**: Required files appear first for maximum LLM attention
- **Safe**: Only adds files that actually exist in the context
- **Cost Efficient**: Required files don't count against RAG selection quota

The system checks if these files exist in the context and automatically includes them before any RAG-selected files.

### Response with RAG Metadata

When RAG is enabled, responses include additional metadata:

```json
{
  "output": "Response text...",
  "model": "claude-sonnet-5",
  "usage": {
    "input_tokens": 20500,
    "output_tokens": 500
  },
  "cost": {
    "input_cost": 0.041,
    "output_cost": 0.005,
    "total_cost": 0.046
  },
  "rag": {
    "selectedFiles": ["intro.md", "api.md", "examples.md"],
    "totalFilesAvailable": 50,
    "selectionMethod": "rag-two-step",
    "selectionCost": {
      "input_cost": 0.00008,
      "output_cost": 0.00002,
      "total_cost": 0.0001
    }
  }
}
```

### Fallback Behavior

If file selection fails for any reason:
- System logs the error
- Falls back to loading all context files
- Continues with response generation
- No RAG metadata in response

### Implemented Features

- ✅ **Required Files**: Always include specific files (hardcoded in `RagService.REQUIRED_FILES`)
- ✅ **Two-Step RAG**: Intelligent file selection before generation
- ✅ **Cost Tracking**: Separate tracking for selection and generation costs
- ✅ **Priority Placement**: Required files appear first in context
- ✅ **Automatic Fallback**: Graceful degradation if RAG fails

### Future Enhancements

The RAG system is designed for future improvements:
- [ ] Web link filtering (currently all links are included)
- [ ] Semantic search with embeddings
- [ ] Configurable selection models per context
- [ ] Caching of file selections for similar queries
- [ ] Per-context required files configuration

---

## Automatic Fallback

Rukh implements an automatic fallback mechanism. When you specify a model and it fails for any reason, the system will automatically try the other available models in sequence:

1. Your specified model (e.g., `mistral`)
2. Next available model (e.g., `anthropic`)
3. Final fallback model (e.g., `openai`)

This ensures high availability even if one provider experiences issues.

---

## Usage Examples

### Using Mistral

```bash
curl -X 'POST' \
  'https://rukh.w3hc.org/ask' \
  -H 'accept: application/json' \
  -H 'Content-Type: multipart/form-data' \
  -F 'message=What is Rukh?' \
  -F 'model=mistral' \
  -F 'context=rukh'
```

### Using Anthropic (Claude)

```bash
curl -X 'POST' \
  'https://rukh.w3hc.org/ask' \
  -H 'accept: application/json' \
  -H 'Content-Type: multipart/form-data' \
  -F 'message=Analyze this code structure' \
  -F 'model=anthropic' \
  -F 'context=rukh'
```

### Using OpenAI

```bash
curl -X 'POST' \
  'https://rukh.w3hc.org/ask' \
  -H 'accept: application/json' \
  -H 'Content-Type: multipart/form-data' \
  -F 'message=Help me write a story' \
  -F 'model=openai' \
  -F 'context=rukh'
```

### Using Default Model

```bash
curl -X 'POST' \
  'https://rukh.w3hc.org/ask' \
  -H 'accept: application/json' \
  -H 'Content-Type: multipart/form-data' \
  -F 'message=What is Rukh?' \
  -F 'context=rukh'
```

*Note: Omitting the `model` parameter defaults to `anthropic` (Claude Sonnet 5).*

---

## Response Format

All models return responses in the same format, including cost tracking:

```json
{
  "output": "Response text...",
  "model": "mistral-small-latest",
  "network": "arbitrum-sepolia",
  "txHash": "0x...",
  "explorerLink": "https://sepolia.arbiscan.io/tx/0x...",
  "sessionId": "uuid",
  "usage": {
    "input_tokens": 16,
    "output_tokens": 231
  },
  "cost": {
    "input_cost": 0.000002,
    "output_cost": 0.000139,
    "total_cost": 0.000141
  }
}
```

The `cost` field shows the actual API costs for the request, helping you track expenses across different providers.
