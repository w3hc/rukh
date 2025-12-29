# Rukh

A lightweight, developer-friendly toolkit for building AI agents with Web3 integration. Built with Nest.js (TypeScript), Rukh makes it easy to create, deploy, and scale AI applications with:

- Quick setup and minimal configuration
- Built-in session management and persistent storage
- Seamless Web3 integration
- Modular architecture for easy LLM integration (Mistral, Anthropic, OpenAI, etc.)
- Auto-generated OpenAPI documentation
- Production-ready with rate limiting and error handling
- Password-protected contexts for secure data management

Live at: **[rukh.w3hc.org](http://rukh.w3hc.org)**

Solidity contracts: 

- [Rukh governance token](https://sepolia.arbiscan.io/address/0x281d3F386A48D31DC65E366081f5E3E3fA49B663#code)
- [Rukh DAO](https://sepolia.arbiscan.io/address/0xf79c712228Bf3b8E71760291822c88A41C510244#code)

## Install

```bash
pnpm i
```

## Run

```bash
pnpm start
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

## Example

Simple request: 

```bash
curl -X 'POST' \
  'https://rukh.w3hc.org/ask' \
  -H 'accept: application/json' \
  -H 'Content-Type: multipart/form-data' \
  -F 'message=What'\''s Rukh?' \
  -F 'model=mistral' \
  -F 'context=rukh'
```

Response body: 

```json
{
  "output": "Rukh is a term that can have different meanings depending on the context. Here are a few possible interpretations:\n\n1. **Literary Character**: In the novel \"The Jungle Book\" by Rudyard Kipling, Rukh is a reference to the forest or jungle where the story takes place. It is a wild and untamed place where the characters, including Mowgli, live and have their adventures.\n\n2. **Mythological Creature**: In Persian mythology, the Rukh (or Roc) is a legendary bird of enormous size, often depicted as carrying off elephants. It is a popular figure in folklore and fantasy literature.\n\n3. **Place Name**: Rukh could also refer to a geographical location, although this is less common.\n\n4. **Other Contexts**: Depending on the context, Rukh could have other meanings, such as a name, a term in a specific field, or a concept in a particular culture or language.\n\nIf you provide more context, I can give a more precise explanation.",
  "model": "mistral-large-2411",
  "network": "arbitrum-sepolia",
  "txHash": "0x812ecae72643da884555d2614c4c6f45c8e4d77239131bb8f4eb801d37d221bf",
  "explorerLink": "https://sepolia.arbiscan.io/tx/0x812ecae72643da884555d2614c4c6f45c8e4d77239131bb8f4eb801d37d221bf",
  "sessionId": "b31d326a-ed6d-464a-9900-b084f124e549",
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

## Contact

**Julien Béranger** ([GitHub](https://github.com/julienbrg))

- Element: [@julienbrg:matrix.org](https://matrix.to/#/@julienbrg:matrix.org)
- Farcaster: [julien-](https://warpcast.com/julien-)
- Telegram: [@julienbrg](https://t.me/julienbrg)

---

<img src="https://bafkreid5xwxz4bed67bxb2wjmwsec4uhlcjviwy7pkzwoyu5oesjd3sp64.ipfs.w3s.link" alt="built-with-ethereum-w3hc" width="100"/>