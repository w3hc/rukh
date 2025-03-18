# Rukh

A lightweight, developer-friendly toolkit for building AI agents with Web3 integration. Built with Nest.js (TypeScript), Rukh makes it easy to create, deploy, and scale AI applications with:

- 🚀 Quick setup and minimal configuration
- 🔄 Built-in session management and persistent storage
- 🔗 Seamless Web3 integration
- 🛠️ Modular architecture for easy LLM integration (Mistral, Anthropic, OpenAI, etc.)
- 📝 Auto-generated OpenAPI documentation
- 🎮 Token-gated access control built-in
- ⚡ Production-ready with rate limiting and error handling
- 🔒 Password-protected contexts for secure data management

Live at: **[http://rukh.w3hc.org/api](http://rukh.w3hc.org/api)**

Solidity contracts: 

- [Rukh governance token](https://sepolia.arbiscan.io/address/0x281d3F386A48D31DC65E366081f5E3E3fA49B663#code)
- [Rukh DAO](https://sepolia.arbiscan.io/address/0xf79c712228Bf3b8E71760291822c88A41C510244#code)

## Features

- [Nest.js](https://nestjs.com/) `v11` (TypeScript-based API framework)
- Ethers `v6`
- OpenAPI/Swagger docs
- JSON-based persistent storage
- LangChain.js
- Built-in Web Reader API for fetching webpage content
- Pre-integrated LLM models:
  - Mistral [`mistral-large-2411`](https://mistral.ai/en/news/ministraux)
  - Anthropic [`claude-3-7-sonnet-20250219`](https://www.anthropic.com/news/claude-3-7-sonnet)

Any other LLM service can be easily added (OpenAI, DeepSeek, or any).

## Install

```bash
pnpm i
```

Create and edit your `.env` file based on `.env.template`. You can also [deploy your own token contract](https://github.com/w3hc/ouf-contracts). 

## Run

```bash
# development
pnpm start

# watch mode
pnpm start:dev

# production mode
pnpm start:prod
```

The Swagger UI should be available at http://localhost:3000/api

## Test

```bash
# unit tests
pnpm test

# e2e tests
pnpm test:e2e

# test coverage
pnpm test:cov
```

## Context Management

Rukh provides a secure context management system that allows you to create and manage separate contexts for different use cases or clients. Each context is password-protected to ensure data security.

### Context Password System

Each context has its own `index.json` file that stores metadata including password, description, file list, and usage statistics.

### Data Storage Structure

The data folder has the following structure:

```
data/
├── chat-history.json        # Stores conversation history for all sessions
├── contexts/                # Contains all context folders
│   └── rukh/                # Example context folder
│       ├── index.json       # Context metadata and configuration
│       ├── file1.md         # Context content file
│       └── file2.md         # Context content file
└── costs.json               # Usage tracking and cost data
```

#### Context Index Structure

Each context has an `index.json` file with the following structure:

```json
{
  "name": "rukh",
  "password": "rukh",
  "description": "Just Rukh.",
  "numberOfFiles": 2,
  "totalSize": 16,
  "files": [
    {
      "name": "file1.md",
      "description": "File #1",
      "size": 8
    },
    {
      "name": "file2.md",
      "description": "File #2",
      "size": 8
    }
  ],
  "queries": [
    {
      "timestamp": "2025-03-16T12:34:06.046Z",
      "origin": "0x...",
      "contextFilesUsed": [
        "file1.md",
        "file2.md"
      ]
    }
  ]
}
```

#### Costs Tracking

Usage and cost data is stored in `costs.json`:

```json
{
  "requests": [
    {
      "timestamp": "2025-03-16T11:58:17.934Z",
      "inputCost": 0.0054,
      "outputCost": 0.0004,
      "totalCost": 0.0058,
      "inputTokens": 1794,
      "outputTokens": 138,
      "message": "What's Rukh",
      "sessionId": "e7ebac4f-e177-4461-a0f7-8266f78ff1f9",
      "model": "mistral-large-2411"
    }
  ],
  "global": {
    "totalInputCost": 0.29499999999999993,
    "totalOutputCost": 0.06150000000000002,
    "totalCost": 0.35649999999999993,
    "totalInputTokens": 98289,
    "totalOutputTokens": 19530,
    "totalRequests": 46,
    "lastUpdated": "2025-03-16T14:32:06.276Z",
    "modelsUsage": {
      "mistral-large-2411": {
        "requests": 46,
        "inputTokens": 98158,
        "outputTokens": 19440,
        "cost": 0.35309999999999997
      },
      "claude-3-7-sonnet-20250219": {
        "requests": 2,
        "inputTokens": 3849,
        "outputTokens": 488,
        "cost": 0.0189
      }
    }
  }
}
```

### Creating a Context

To create a new context:

```bash
curl -X 'POST' \
  'http://localhost:3000/context' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-context",
    "password": "my-secure-password",
    "description": "Optional description for this context"
  }'
```

### Managing Context Files

All context operations require the context password to be provided in the `x-context-password` header:

```bash
# Upload a file to a context
curl -X 'POST' \
  'http://localhost:3000/context/upload' \
  -H 'x-context-password: my-secure-password' \
  -F 'contextName=my-context' \
  -F 'fileDescription=Optional file description' \
  -F 'file=@myfile.md'

# List files in a context
curl -X 'GET' \
  'http://localhost:3000/context/my-context/files' \
  -H 'x-context-password: my-secure-password'

# Get a specific file's content
curl -X 'GET' \
  'http://localhost:3000/context/my-context/file/myfile.md' \
  -H 'x-context-password: my-secure-password'

# Delete a context
curl -X 'DELETE' \
  'http://localhost:3000/context/my-context' \
  -H 'x-context-password: my-secure-password'

# Delete a file from a context
curl -X 'DELETE' \
  'http://localhost:3000/context/my-context/file' \
  -H 'x-context-password: my-secure-password' \
  -H 'Content-Type: application/json' \
  -d '{
    "filename": "myfile.md"
  }'
```

### Managing Context Links

Rukh now supports adding web links to your contexts. When you query a context, the content of these links will be automatically fetched, processed, and included in the LLM's context alongside your context files.

#### Context Index Structure with Links

The context's `index.json` now includes a `links` array:

```json
{
  "name": "rukh",
  "password": "rukh",
  "description": "Just Rukh.",
  "numberOfFiles": 2,
  "totalSize": 16,
  "files": [
    {
      "name": "file1.md",
      "description": "File #1",
      "size": 8
    },
    {
      "name": "file2.md",
      "description": "File #2",
      "size": 8
    }
  ],
  "links": [
    {
      "title": "Rukh GitHub Repository",
      "url": "https://github.com/w3hc/rukh",
      "description": "Official GitHub repository for the Rukh project",
      "timestamp": "2025-03-16T12:34:06.046Z"
    }
  ],
  "queries": [
    {
      "timestamp": "2025-03-16T12:34:06.046Z",
      "origin": "0x...",
      "contextFilesUsed": [
        "file1.md",
        "file2.md",
        "link:https://github.com/w3hc/rukh"
      ]
    }
  ]
}
```

#### Managing Context Links

All link operations require the context password to be provided in the `x-context-password` header:

```bash
# Add a link to a context
curl -X 'POST' \
  'http://localhost:3000/context/my-context/link' \
  -H 'x-context-password: my-secure-password' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Rukh GitHub Repository",
    "url": "https://github.com/w3hc/rukh",
    "description": "Official GitHub repository for the Rukh project"
  }'

# List all links in a context
curl -X 'GET' \
  'http://localhost:3000/context/my-context/links' \
  -H 'x-context-password: my-secure-password'

# Delete a link from a context
curl -X 'DELETE' \
  'http://localhost:3000/context/my-context/link' \
  -H 'x-context-password: my-secure-password' \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://github.com/w3hc/rukh"
  }'
```

#### How Context Links Work

When you query an API with a specific context, Rukh will:

1. Process all the markdown files in the context folder
2. Fetch and extract content from all links in the context using the Web Reader API
3. Combine all this information into a single context for the LLM
4. Record which files and links were used in the context's query history

This allows you to include live web content in your AI responses without having to manually update your context files. The content is fetched fresh with each query, ensuring you always have the most up-to-date information.

#### Query Tracking with Links

Query tracking now includes links in the `contextFilesUsed` array with a `link:` prefix to distinguish them from files.

### Security Considerations

- Context passwords are stored in plain text in each context's `index.json` file. For production use, consider implementing encryption.
- Only `.md` files are allowed to be uploaded to contexts.
- All operations on a context require the correct password in the `x-context-password` header.
- File size is limited to 5MB by default.
- All context usage is tracked and recorded in the context's index file.

## AI Query API

### Basic Request

Simple request with default model (Mistral):

```bash
curl -X 'POST' \
  'http://localhost:3000/ask' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
  "message": "What is Rukh?"
}'
```

### Using Specific Models

#### With Mistral:

```json
{
  "message": "What is Rukh?",
  "model": "mistral",
  "sessionId": "f0ea9dc7-03e8-46a7-b3ad-6c3531211f73",
  "walletAddress": "0x265E31444C6E279870eB20c15B0547373635840b"
}
```

#### With Anthropic Claude:

```json
{
  "message": "What is Rukh?",
  "model": "anthropic",
  "sessionId": "f0ea9dc7-03e8-46a7-b3ad-6c3531211f73",
  "walletAddress": "0x265E31444C6E279870eB20c15B0547373635840b"
}
```

### Using Contexts

To use a specific context in your query:

```json
{
  "message": "Summarize all information about Rukh",
  "model": "anthropic",
  "context": "rukh",
  "sessionId": "f0ea9dc7-03e8-46a7-b3ad-6c3531211f73"
}
```

### File Upload with Query

You can upload a file along with your query using multipart/form-data:

```bash
curl -X 'POST' \
  'http://localhost:3000/ask' \
  -H 'accept: application/json' \
  -F 'message=Analyze this document for me' \
  -F 'model=anthropic' \
  -F 'file=@document.md'
```

### Response Format

The API will return a response like:

```json
{
  "output": "Rukh is a lightweight, developer-friendly toolkit for building AI agents with Web3 integration. It's built with Nest.js (TypeScript) and makes it easy to create, deploy, and scale AI applications. The name 'Rukh' comes from a legendary enormous bird from mythology, also known as the Roc. The toolkit includes features such as quick setup, session management, Web3 integration, modular architecture for LLM integration, token-gated access control, and more.",
  "model": "mistral-large-2411",
  "network": "arbitrum-sepolia",
  "txHash": "0xd96b35d1daefd6dc8368f7a075a1a627df960a541eb30268b1b85cedbae0214a",
  "explorerLink": "https://sepolia.arbiscan.io/tx/0xd96b35d1daefd6dc8368f7a075a1a627df960a541eb30268b1b85cedbae0214a",
  "sessionId": "bdce1931-b09d-49ef-954b-d20074d11ffa",
  "usage": {
    "input_tokens": 512,
    "output_tokens": 189
  }
}
```

When using Anthropic Claude, the `model` field will show `claude-3-7-sonnet-20250219`.

## Web Reader API

Rukh includes a Web Reader API for fetching and processing webpage content:

```bash
# Fetch raw HTML
curl -X 'GET' \
  'http://localhost:3000/web-reader?url=https://example.com'

# Extract text and links for LLM processing
curl -X 'GET' \
  'http://localhost:3000/web-reader/llm?url=https://example.com'
```

## SIWE Authentication

Sign-In with Ethereum authentication is supported:

```bash
# Get a challenge
curl -X 'GET' 'http://localhost:3000/siwe/challenge'

# Verify a signature
curl -X 'POST' \
  'http://localhost:3000/siwe/verify' \
  -H 'Content-Type: application/json' \
  -d '{
    "address": "0x1234567890123456789012345678901234567890",
    "signature": "0xsignature...",
    "nonce": "nonce-from-challenge"
  }'
```


## Support

Feel free to reach out to [Julien](https://github.com/julienbrg) through:

- Element: [@julienbrg:matrix.org](https://matrix.to/#/@julienbrg:matrix.org)
- Farcaster: [julien-](https://warpcast.com/julien-)
- Telegram: [@julienbrg](https://t.me/julienbrg)
- Twitter: [@julienbrg](https://twitter.com/julienbrg)
- Discord: [julienbrg](https://discordapp.com/users/julienbrg)
- LinkedIn: [julienberanger](https://www.linkedin.com/in/julienberanger/)

<img src="https://bafkreid5xwxz4bed67bxb2wjmwsec4uhlcjviwy7pkzwoyu5oesjd3sp64.ipfs.w3s.link" alt="built-with-ethereum-w3hc" width="100"/>