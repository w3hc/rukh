# Supported Models

Rukh supports multiple LLM providers with automatic fallback capabilities. When making a request, you can specify which model to use via the `model` parameter. If a model fails, the system automatically tries the next available provider.

## Quick Reference

| Provider | Parameter Value | Model Name | Input Cost | Output Cost |
|----------|----------------|------------|------------|-------------|
| Mistral AI | `mistral` | `mistral-large-2411` | $0.04/M tokens | $0.04/M tokens |
| Anthropic | `anthropic` | `claude-sonnet-4-20250514` | $3/M tokens | $15/M tokens |
| OpenAI | `openai` | `gpt-4o` | $2.50/M tokens | $10/M tokens |

## Detailed Information

### Mistral AI

**Model**: `mistral-large-2411`

**Parameter value**: `mistral`

**Pricing**:
- Input: $0.04 per million tokens
- Output: $0.04 per million tokens

**Configuration**:
Set the `MISTRAL_API_KEY` environment variable in your `.env` file.

**Features**:
- Fast response times
- Cost-effective for most use cases
- Good quality for general-purpose tasks
- Excellent price-to-performance ratio

**Use cases**:
- High-volume applications where cost is a concern
- General chat and Q&A
- Content generation

---

### Anthropic (Claude)

**Model**: `claude-sonnet-4-20250514`

**Parameter value**: `anthropic`

**Pricing**:
- Input: $3 per million tokens
- Output: $15 per million tokens

**Configuration**:
Set the `ANTHROPIC_API_KEY` environment variable in your `.env` file.

**Features**:
- High-quality responses
- Excellent for complex reasoning and analysis
- Strong performance on nuanced tasks
- Large context window (up to 64,000 tokens output)
- **Default model** if none is specified

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
- Up to 4,096 tokens output

**Use cases**:
- General-purpose applications
- Creative writing
- Code generation
- Problem-solving tasks

---

## RAG File Selection Model

When using two-step RAG (Retrieval-Augmented Generation), Rukh uses a lightweight model for intelligent file selection before generating the final response.

**Model**: `mistral-small-latest`

**Configuration**:
- Set `RAG_ENABLE_TWO_STEP=true` to enable two-step RAG
- Set `RAG_SELECTION_MODEL` to specify a different model (defaults to `mistral-small-latest`)
- Set `RAG_MAX_FILES` to control how many files to select (defaults to 5)

**Purpose**:
Cost-effective file relevance scoring before full context generation. This reduces costs by only including relevant context files in the main prompt.

**How it works**:
1. **Step 1 (Selection)**: Uses a small, fast model to analyze which files are relevant to the query
2. **Step 2 (Generation)**: Uses the selected model to generate the response with only relevant files included

---

## RAG Workflow

Rukh implements an intelligent two-step Retrieval-Augmented Generation (RAG) workflow to optimize context usage and reduce costs. Here's how it works:

### Standard Mode (RAG Disabled)

When `RAG_ENABLE_TWO_STEP=false` (or not set), Rukh uses the legacy method:

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

When `RAG_ENABLE_TWO_STEP=true`, Rukh uses an intelligent two-step process:

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
              │  Model: mistral-small-latest                 │
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

3. **Call Mistral Small**
   - Sends selection prompt to `mistral-small-latest`
   - Receives JSON response like `[1, 3, 5]`
   - Tracks selection cost separately

4. **Parse Response & Add Required Files**
   - Extracts JSON array from model output
   - Maps indices to filenames
   - Automatically adds any required files (from `RAG_REQUIRED_FILES`)
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
Model: claude-sonnet-4-20250514
Cost: $0.60 + $0.0075 = $0.6075
```

**Two-Step RAG Mode:**
```
Step 1 (Selection):
  Input tokens:  ~1,000 (file list)
  Output tokens: ~20 (JSON array)
  Model: mistral-small-latest
  Cost: ~$0.0001

Step 2 (Generation):
  Input tokens:  ~20,000 (5 files only)
  Output tokens: ~500
  Model: claude-sonnet-4-20250514
  Cost: $0.06 + $0.0075 = $0.0676

Total: $0.0677 (89% cost reduction!)
```

### Configuration

Add these to your `.env` file:

```bash
# Enable two-step RAG
RAG_ENABLE_TWO_STEP=true

# Maximum files to select (default: 5)
RAG_MAX_FILES=5

# Model for file selection (default: mistral-small-latest)
RAG_SELECTION_MODEL=mistral-small-latest

# Required files that are always included (comma-separated)
RAG_REQUIRED_FILES=instruction-file.md
```

### Required Files

The RAG system supports **required files** - specific files that are **always included** in the context, regardless of what the AI selects. This is useful for system instructions, glossaries, or critical reference documents that should always be available.

**How it works:**

1. **Configure** required files in `.env`:
   ```bash
   RAG_REQUIRED_FILES='instruction-file.md,system-prompt.md'
   ```

2. **Selection Phase**:
   - AI selects relevant files (e.g., 3 files)
   - System automatically adds required files if not already selected
   - Result: `instruction-file.md, system-prompt.md, file1.md, file2.md, file3.md`

3. **Context Building**:
   - Required files are placed **first** in the context (in config order)
   - This gives them priority in the LLM's attention
   - Other selected files follow

**Benefits:**
- **Consistent Behavior**: Important instructions are never missed
- **Flexible**: Change required files via config, no code changes needed
- **Priority Placement**: Required files appear first for maximum LLM attention
- **Safe**: Only adds files that actually exist in the context
- **Cost Efficient**: Required files don't count against RAG selection quota

**Example:**
```bash
# Always include these files in every request
RAG_REQUIRED_FILES='instruction-file.md'

# Or multiple files
RAG_REQUIRED_FILES='instruction-file.md,glossary.md,api-reference.md'
```

The system will check if these files exist in the context and automatically include them before any RAG-selected files.

### Response with RAG Metadata

When RAG is enabled, responses include additional metadata:

```json
{
  "output": "Response text...",
  "model": "claude-sonnet-4-20250514",
  "usage": {
    "input_tokens": 20500,
    "output_tokens": 500
  },
  "cost": {
    "input_cost": 0.0615,
    "output_cost": 0.0075,
    "total_cost": 0.069
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

- ✅ **Required Files**: Always include specific files (configured via `RAG_REQUIRED_FILES`)
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

*Note: Omitting the `model` parameter defaults to `anthropic` (Claude 3.7 Sonnet).*

---

## Response Format

All models return responses in the same format, including cost tracking:

```json
{
  "output": "Response text...",
  "model": "mistral-large-2411",
  "network": "arbitrum-sepolia",
  "txHash": "0x...",
  "explorerLink": "https://sepolia.arbiscan.io/tx/0x...",
  "sessionId": "uuid",
  "usage": {
    "input_tokens": 16,
    "output_tokens": 231
  },
  "cost": {
    "input_cost": 0.000001,
    "output_cost": 0.000009,
    "total_cost": 0.00001
  }
}
```

The `cost` field shows the actual API costs for the request, helping you track expenses across different providers.
