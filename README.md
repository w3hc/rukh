# Rukh

[Nest.js](https://nestjs.com/)-based AI agent starter kit.

- [Rukh governance token](https://explorer.sepolia.mantle.xyz/address/0x4db173196C37bF4Df60277A843590690F52bEB6a#code)
- [Rukh DAO](https://explorer.sepolia.mantle.xyz/address/0x446200cB329592134989B615d4C02f9f3c9E970F#code)

## Features

- Nest.js `v11`
- Ethers `v6`
- OpenAPI/Swagger docs
- JSON-based persistent storage
- LangChain.js
- Mistral `ministral-3b-2410` 

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
  "sessionId": "f0ea9dc7-03e8-46a7-b3ad-6c3531211f73"
}
```

Will return: 

```json
{
  "output": "Rukh is a powerful bird.",
  "model": "ministral-3b-2410",
  "network": "mantle-sepolia",
  "txHash": "0xe12029f35c67551d2c8c58e91a90090e5e0f0998a8c0b6f6cdb72fe9075c73fa",
  "sessionId": "f0ea9dc7-03e8-46a7-b3ad-6c3531211f73"
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