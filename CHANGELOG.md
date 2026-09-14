# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Ask-call notifications**: Sends an ntfy.sh push notification whenever a brand new conversation starts on `ask` (first message of a session, i.e. no `sessionId` was supplied)
  - Includes the `context` value and the message text
  - Configurable via `NTFY_ASK_TOKEN` and `NTFY_ASK_TOPIC` environment variables
  - Only fires when `NODE_ENV=prod`, and never blocks or fails the `ask` response
