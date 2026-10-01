# Security policy

## Supported versions

Only the latest commit on `main` is supported. Fixes are not backported.

## Reporting a vulnerability

Please don't open a public issue, pull request or discussion for a vulnerability.

Report it privately through GitHub: go to the [Security tab](https://github.com/w3hc/rukh/security), then **Report a vulnerability**. If you can't use GitHub, write through https://julienberanger.com/contact.

Include what you can of:

- the affected endpoint, file or module
- steps or a request to reproduce it
- the impact you expect (data exposure, auth bypass, cost abuse, etc.)

## What to expect

- An acknowledgement within 5 days.
- A first assessment within 14 days, saying whether the report is accepted.
- Once fixed, a published advisory crediting you, unless you'd rather stay anonymous.

## Scope

In scope: the code in this repository, including auth (SIWE), rate limiting, context management and file uploads, `/web-reader`, and how API keys and `data/` are handled.

Out of scope: vulnerabilities in the LLM providers themselves, prompt injection that only changes the model's answer without crossing a security boundary, and issues in deployments you run with your own configuration.
