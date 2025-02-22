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

Live at: **http://rukh.w3hc.org/api**

Solidity contracts: 

- [Rukh governance token](https://sepolia.arbiscan.io/address/0x281d3F386A48D31DC65E366081f5E3E3fA49B663#code)
- [Rukh DAO](https://sepolia.arbiscan.io/address/0xf79c712228Bf3b8E71760291822c88A41C510244#code)

## Features

- [Nest.js](https://nestjs.com/) `v11` (TypeScript-based API framework)
- Ethers `v6`
- OpenAPI/Swagger docs
- JSON-based persistent storage
- LangChain.js
- Mistral [`ministral-3b-2410`](https://mistral.ai/en/news/ministraux) 

Any other LLM service can be added (Anthropic, OpenAI, DeepSeek, or any).

## Install

```bash
pnpm i
```

Create and edit your `.env` file on the model of `.env.template`. You can also [deploy your own token contract](https://github.com/w3hc/ouf-contracts). 

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

Contexts are managed through a `data/contexts/index.json` file that stores context names and their associated passwords:

```json
{
  "contexts": [
    {
      "name": "context-1",
      "password": "password-1"
    },
    {
      "name": "context-2",
      "password": "password-2"
    }
  ]
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
    "password": "my-secure-password"
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
  -F 'file=@myfile.md'

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

### Security Considerations

- Context passwords are stored in plain text in `index.json`. For production use, consider implementing encryption.
- Only `.md` files are allowed to be uploaded to contexts.
- All operations on a context require the correct password in the `x-context-password` header.
- File size is limited to 1MB.

## Example requests

```json
{
  "message": "What is Rukh?"
}
```

or 

```json
{
  "message": "What is Rukh?",
  "model": "mistral",
  "sessionId": "f0ea9dc7-03e8-46a7-b3ad-6c3531211f73",
  "walletAddress": "0x265E31444C6E279870eB20c15B0547373635840b"
}
```

Will return: 

```json
{
  "output": "Rukh is a powerful bird.",
  "model": "ministral-3b-2410",
  "network": "arbitrum-sepolia",
  "txHash": "0xd96b35d1daefd6dc8368f7a075a1a627df960a541eb30268b1b85cedbae0214a",
  "explorerLink": "https://sepolia.arbiscan.io/tx/0x7946e7d46a2115779902a73ceb01d6817479c60200350c46876677566858e899",
  "sessionId": "bdce1931-b09d-49ef-954b-d20074d11ffa"
}
```

### Curl

```bash 
curl -X 'POST' \
  'http://localhost:3000/ask' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
  "message": "What is Rukh?"
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