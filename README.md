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

Any other LLM service can be added (Anthropic, OpenAI, DeepSeek).

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

## Support

Feel free to reach out to [Julien](https://github.com/julienbrg) through:

- Element: [@julienbrg:matrix.org](https://matrix.to/#/@julienbrg:matrix.org)
- Farcaster: [julien-](https://warpcast.com/julien-)
- Telegram: [@julienbrg](https://t.me/julienbrg)
- Twitter: [@julienbrg](https://twitter.com/julienbrg)
- Discord: [julienbrg](https://discordapp.com/users/julienbrg)
- LinkedIn: [julienberanger](https://www.linkedin.com/in/julienberanger/)