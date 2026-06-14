# Context Management Guide

This guide explains how to create and manage contexts in Rukh, including how to add files, URLs, and configure the RAG (Retrieval-Augmented Generation) system.

## Table of Contents

- [What is a Context?](#what-is-a-context)
- [Context Structure](#context-structure)
- [Creating a New Context](#creating-a-new-context)
- [Adding Files to a Context](#adding-files-to-a-context)
- [Adding URLs to a Context](#adding-urls-to-a-context)
- [RAG Workflow with URLs](#rag-workflow-with-urls)
- [Context Index Schema](#context-index-schema)
- [Best Practices](#best-practices)
- [Examples](#examples)

## What is a Context?

A context is a collection of knowledge (markdown files and URLs) that provides specialized information to the AI model. Contexts allow you to:

- Create domain-specific AI assistants
- Provide up-to-date information from external sources
- Control what information is available to the AI
- Track usage and queries

## Context Structure

Each context is a directory under `data/contexts/` with the following structure:

```
data/contexts/your-context/
├── index.json              # Required: metadata and configuration
├── file1.md               # Content files
├── file2.md
└── ...
```

## Creating a New Context

### 1. Create the Directory

```bash
mkdir -p data/contexts/your-context
```

### 2. Create the index.json File

The `index.json` file is **required** and contains metadata about your context:

```json
{
  "name": "your-context",
  "description": "Brief description of what this context provides",
  "numberOfFiles": 2,
  "totalSize": 15,
  "files": [
    {
      "name": "file1.md",
      "description": "Description of file1 content",
      "size": 8
    },
    {
      "name": "file2.md",
      "description": "Description of file2 content",
      "size": 7
    }
  ],
  "links": [],
  "queries": []
}
```

### 3. Add Content Files

Create markdown files with your content:

```bash
echo "# Your Content" > data/contexts/your-context/file1.md
```

## Adding Files to a Context

### File Naming

- Use descriptive names: `best-practices.md`, `api-reference.md`
- Avoid spaces in filenames (use hyphens or underscores)
- Use `.md` extension for markdown files

### File Descriptions

Each file in `index.json` should have a clear description. This description is used by the RAG system to determine relevance:

```json
{
  "name": "api-reference.md",
  "description": "Complete API documentation with endpoints, parameters, and examples",
  "size": 25
}
```

**Good descriptions:**
- "API documentation with endpoints, parameters, and examples"
- "Best practices for storage namespacing in Solidity contracts"
- "Historical overview of EIP-7702 development and rationale"

**Poor descriptions:**
- "Documentation"
- "Info"
- "File about stuff"

## Adding URLs to a Context

URLs allow you to include external web content in your context. The content is fetched dynamically when relevant to a user's query.

### 1. Add URLs to index.json

```json
{
  "links": [
    {
      "url": "https://github.com/ethereum/solidity/issues/597#issuecomment-1537533170",
      "title": "Solidity storage namespacing discussion",
      "description": "Discussion about storage namespacing patterns for Solidity contracts used with EIP-7702"
    },
    {
      "url": "https://gist.github.com/lightclient/7742e84fde4962f32928c6177eda7523",
      "title": "Reference implementation of EIP-7702 proxy",
      "description": "Reference proxy implementation code for EIP-7702 contracts with examples"
    }
  ]
}
```

### 2. URL Fields

- **url** (required): The full URL to fetch
- **title** (required): A short, descriptive title
- **description** (optional but recommended): Keywords and description for relevance matching

### 3. Supported URL Types

The web reader service supports:
- GitHub issues and comments
- GitHub Gists
- Documentation pages
- Blog posts
- Any HTML page with readable content

## RAG Workflow with URLs

When RAG is enabled (`RAG_ENABLE_TWO_STEP=true`), URLs are treated the same as files:

### Step 1: Resource Selection

The RAG system evaluates **all resources** (files + URLs) and selects the most relevant ones:

```
Available resources:
1. [FILE] overview.md - "High-level overview of EIP-7702"
2. [FILE] best-practices.md - "Best practices for implementing EIP-7702"
3. [URL] Solidity storage namespacing discussion - "Discussion about storage..."
4. [URL] Reference implementation - "Reference proxy implementation code..."

User question: "What did yoavw suggest about storage namespacing?"

→ RAG selects: [3] (only the relevant URL)
```

### Step 2: Content Fetching

Only selected resources are fetched:
- Files: Read from disk
- URLs: Fetched using `WebReaderService.extractForLLM()`

### Step 3: Answer Generation

The LLM receives only relevant content in its prompt.

## Context Index Schema

Complete schema for `index.json`:

```json
{
  "name": "string (required)",
  "password": "string (optional) - for protected contexts",
  "description": "string (required)",
  "numberOfFiles": "number (required)",
  "totalSize": "number (required) - total KB",
  "files": [
    {
      "name": "string (required)",
      "description": "string (required)",
      "size": "number (required) - KB"
    }
  ],
  "links": [
    {
      "url": "string (required)",
      "title": "string (required)",
      "description": "string (optional but recommended)"
    }
  ],
  "queries": [
    {
      "timestamp": "ISO 8601 string",
      "origin": "wallet address or 'anonymous'",
      "message": "user's question",
      "contextFilesUsed": ["array of files/URLs used"]
    }
  ]
}
```

## Best Practices

### File Organization

1. **Use descriptive filenames**: `installation-guide.md` instead of `guide.md`
2. **Keep files focused**: Each file should cover one topic
3. **Optimal file size**: 5-50 KB per file (too large = expensive, too small = fragmented)
4. **Update descriptions**: Make them keyword-rich for better RAG selection

### URL Management

1. **Use stable URLs**: Prefer permalinks over dynamic URLs
2. **Add descriptions**: Help RAG understand when to fetch the URL
3. **Monitor costs**: URL fetching incurs web scraping + LLM costs
4. **Test URLs**: Verify they're accessible and content is extractable

### RAG Configuration

Enable RAG for cost optimization:

```env
RAG_ENABLE_TWO_STEP=true
RAG_MAX_FILES=5
RAG_REQUIRED_FILES=instruction-file.md
```

- `RAG_ENABLE_TWO_STEP`: Enable the two-step RAG workflow
- `RAG_MAX_FILES`: Maximum resources (files + URLs) to select
- `RAG_REQUIRED_FILES`: Comma-separated list of files to always include

### Query Tracking

The `queries` array is automatically populated. You can analyze it to:
- Understand what users are asking
- Identify which resources are most used
- Optimize your context based on actual usage

## Examples

### Example 1: Technical Documentation Context

```json
{
  "name": "etherverse",
  "description": "Information about EIP-7702 - Set EOA account code for one transaction",
  "numberOfFiles": 4,
  "totalSize": 54,
  "files": [
    {
      "name": "overview.md",
      "description": "High-level overview of EIP-7702",
      "size": 4
    },
    {
      "name": "best-practices.md",
      "description": "Best practices for implementing EIP-7702",
      "size": 8
    },
    {
      "name": "official-eip-description.md",
      "description": "Official EIP-7702 specification",
      "size": 25
    },
    {
      "name": "vitalik-s-post.md",
      "description": "Vitalik Buterin's post about EIP-7702",
      "size": 17
    }
  ],
  "links": [
    {
      "url": "https://github.com/ethereum/solidity/issues/597#issuecomment-1537533170",
      "title": "Solidity storage namespacing discussion",
      "description": "Discussion about storage namespacing patterns for Solidity contracts used with EIP-7702"
    },
    {
      "url": "https://gist.github.com/lightclient/7742e84fde4962f32928c6177eda7523",
      "title": "Reference implementation of EIP-7702 proxy",
      "description": "Reference proxy implementation code for EIP-7702 contracts with examples"
    }
  ],
  "queries": []
}
```

### Example 2: Personal Assistant Context

```json
{
  "name": "francesca",
  "description": "Information about Julien Béranger - software engineer, blockchain developer",
  "numberOfFiles": 4,
  "totalSize": 15,
  "files": [
    {
      "name": "assistant-context.md",
      "description": "Assistant behavior and response guidelines",
      "size": 3
    },
    {
      "name": "CV - Julien Béranger - March 2025.md",
      "description": "Professional CV and work history",
      "size": 4
    },
    {
      "name": "julien-beranger-full-bio.md",
      "description": "Complete biography and background",
      "size": 3
    },
    {
      "name": "julien-beranger-github-readme-page.md",
      "description": "GitHub profile README with skills and projects",
      "size": 5
    }
  ],
  "links": [],
  "queries": []
}
```

### Example 3: Context with External Resources

```json
{
  "name": "web3-sdk",
  "description": "Web3 SDK documentation and resources",
  "numberOfFiles": 2,
  "totalSize": 20,
  "files": [
    {
      "name": "getting-started.md",
      "description": "Quick start guide and installation instructions",
      "size": 5
    },
    {
      "name": "api-reference.md",
      "description": "Complete API reference with examples",
      "size": 15
    }
  ],
  "links": [
    {
      "url": "https://docs.example.com/changelog",
      "title": "Latest changelog",
      "description": "Recent updates, breaking changes, and new features in the SDK"
    },
    {
      "url": "https://github.com/example/sdk/issues",
      "title": "Known issues",
      "description": "Current bugs, limitations, and workarounds for the SDK"
    }
  ],
  "queries": []
}
```

## Testing Your Context

### 1. Test with RAG Disabled

```bash
curl -X POST http://localhost:3000/ask \
  -H 'Content-Type: multipart/form-data' \
  -F 'message=Your test question' \
  -F 'context=your-context' \
  -F 'model=anthropic'
```

### 2. Test with RAG Enabled

Set `RAG_ENABLE_TWO_STEP=true` in `.env` and test:

```bash
curl -X POST http://localhost:3000/ask \
  -H 'Content-Type: multipart/form-data' \
  -F 'message=Question that should match a URL' \
  -F 'context=your-context' \
  -F 'model=anthropic'
```

Check the response's `rag` object to see which resources were selected.

### 3. Verify URL Selection

Ask questions that should trigger URL fetching:

```bash
# This should select the GitHub discussion URL
curl -X POST http://localhost:3000/ask \
  -F 'message=What did yoavw suggest about storage namespacing?' \
  -F 'context=etherverse'
```

Check the response:
```json
{
  "rag": {
    "selectedFiles": [],
    "selectedUrls": ["https://github.com/ethereum/..."],
    "selectionMethod": "rag-two-step"
  }
}
```

## Troubleshooting

### URLs Not Being Fetched

1. Check that `RAG_ENABLE_TWO_STEP=true` in your `.env`
2. Verify URL descriptions contain relevant keywords
3. Check that the URL is accessible
4. Review the `rag.selectedUrls` in the response

### High Costs

1. Reduce `RAG_MAX_FILES` to select fewer resources
2. Improve file/URL descriptions for better selection
3. Split large files into smaller, focused files
4. Monitor the `rag.selectionCost` in responses

### Resources Not Selected

1. Improve descriptions with more relevant keywords
2. Check that file/URL names are descriptive
3. Test with different phrasings of questions
4. Review selection logs in the server output

## Advanced Topics

### Password-Protected Contexts

```json
{
  "name": "private-context",
  "password": "your-secure-password",
  "description": "Protected context requiring authentication"
}
```

### Required Files

Some files should always be included (like instruction files):

```env
RAG_REQUIRED_FILES=instruction-file.md,guidelines.md
```

### Custom Selection Logic

For advanced use cases, you can modify `rag.service.ts` to implement custom resource selection logic.

## Related Documentation

- [API Documentation](../README.md#api-endpoints)
- [Model Configuration](./MODELS.md)
- [Environment Variables](../README.md#environment-variables)
