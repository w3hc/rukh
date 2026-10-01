# Contributing

Thanks for helping out. Bug reports, fixes and new providers are all welcome.

## Setup

Requires Node 24 or later and [pnpm](https://pnpm.io).

```bash
pnpm i
cp .env.template .env
pnpm start:dev
```

Only `MISTRAL_API_KEY` and `ANTHROPIC_API_KEY` are required to run. The Swagger UI is at http://localhost:3000/api.

## Checks

CI runs these on every pull request, so run them before pushing:

```bash
pnpm format:check   # or `pnpm format` to fix
pnpm lint:check     # or `pnpm lint` to fix
pnpm audit
pnpm build
pnpm test
pnpm test:e2e       # needs MISTRAL_API_KEY
```

CI tests on Node 24 and 26. See [docs/CI_CD.md](docs/CI_CD.md).

## Workflow

1. Open an issue first, or comment on an existing one, so the change can be discussed before you write it.
2. Branch off `main`.
3. Open a pull request against `main`, with `Closes #<issue>` in the body.
4. Pull requests are squash-merged once the checks pass.

Issue and pull request titles start with a capitalized verb: `Add`, `Fix`, `Improve` or `Remove`, e.g. `Add Gemini provider`.

## Commits

- One logical change per commit.
- Short, lowercase, imperative title, no trailing period: `add gemini pricing`, `fix stream fallback`.
- No body unless the change needs explaining.

## Where to start

- New LLM provider: [docs/ADDING_A_PROVIDER.md](docs/ADDING_A_PROVIDER.md).
- Contexts and RAG: [docs/CONTEXT_MANAGEMENT.md](docs/CONTEXT_MANAGEMENT.md).
- Streaming: [docs/STREAMING.md](docs/STREAMING.md).

Add an entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) for user-facing changes.

## Security

Don't open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [LGPL-3.0](LICENSE).
