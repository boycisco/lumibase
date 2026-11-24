# Changelog

All notable changes to LumiBase are documented in this file.

This changelog follows the principles of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-24

### Added

- Initial developer preview of LumiBase.
- Core TypeScript packages for shared primitives, database access, blockchain networking, and payment lifecycle management.
- Fastify-based developer API for payment operations.
- Independent verification of USDC transfers using blockchain transaction and receipt data.
- Webhook registration and asynchronous delivery worker.
- Language-agnostic JSON specifications and conformance fixtures.
- Next.js reference demo for the Base Sepolia USDC payment flow.

### Security

- Server-side verification of payment transactions.
- Server-side handling of application credentials through the reference demo's Backend-for-Frontend architecture.
- Webhook destination protections.
- Base Mainnet disabled in the developer preview.

[Unreleased]: https://github.com/boycisco/lumibase/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/boycisco/lumibase/releases/tag/v0.1.0