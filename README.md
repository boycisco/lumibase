# LumiBase

Open-source developer toolkit for building applications on Base.

> **Status: Pre-release (v0.1.0 in development).**
> This repository currently contains the project foundation only.
> Payments, API, and other modules are being implemented incrementally.

## What LumiBase will be

LumiBase is a modular, language-agnostic toolkit for developers building on Base. It is designed to support multiple independent language implementations (TypeScript first, Python and Rust later) that share the same protocols and specifications.

The first flagship capability is **Payments**: a secure, independently-verified flow for accepting and confirming onchain USDC payments on Base Sepolia.

## Principles

- **Language independence** — protocols live in `specs/`, not in any SDK.
- **Security first** — payments are confirmed by independently verified blockchain evidence, never by a client claim.
- **Modular monorepo** — every capability is an independent package.
- **Open source** — the core never depends on a proprietary LumiBase service.

## Repository status

| Phase                               | Status      |
| ----------------------------------- | ----------- |
| 1. Repository foundation            | Complete    |
| 2. Core package                     | Not started |
| 3. Payment specifications           | Not started |
| 4. Database foundation              | Not started |
| 5. Blockchain foundation            | Not started |
| 6. Payment service                  | Not started |
| 7. Payment verification             | Not started |
| 8. API implementation               | Not started |
| 9. Event and webhook infrastructure | Not started |
| 10. Payment demonstration           | Not started |
| 11. Documentation                   | Not started |
| 12. Release preparation             | Not started |

## Development

Requirements: Node.js >= 20, pnpm 9.
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck

## License

Apache-2.0. See [LICENSE](./LICENSE).
