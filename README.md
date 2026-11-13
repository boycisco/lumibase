# LumiBase

Open-source developer toolkit for building applications on Base.

> **Status: Pre-release (v0.1.0 in development).**
> This repository currently contains the project foundation, the core
> package, and the database layer. Payments, API, and other modules are
> being implemented incrementally.

## What LumiBase will be

LumiBase is a modular, language-agnostic toolkit for developers building
on Base. It is designed to support multiple independent language
implementations (TypeScript first, Python and Rust later) that share the
same protocols and specifications.

The first flagship capability is **Payments**: a secure, independently-
verified flow for accepting and confirming onchain USDC payments on
Base Sepolia.

## Principles

- **Language independence** — protocols live in `specs/`, not in any SDK.
- **Security first** — payments are confirmed by independently verified
  blockchain evidence, never by a client claim.
- **Modular monorepo** — every capability is an independent package.
- **Open source** — the core never depends on a proprietary LumiBase
  service.

## Repository status

| Phase                               | Status      |
| ----------------------------------- | ----------- |
| 1. Repository foundation            | Complete    |
| 2. Core package                     | Complete    |
| 3. Payment specifications           | Complete    |
| 4. Database foundation              | In progress |
| 5. Blockchain foundation            | Not started |
| 6. Payment service                  | Not started |
| 7. Payment verification             | Not started |
| 8. API implementation               | Not started |
| 9. Event and webhook infrastructure | Not started |
| 10. Payment demonstration           | Not started |
| 11. Documentation                   | Not started |
| 12. Release preparation             | Not started |

## Packages

- `@lumibase/core` — shared primitives:
  - **Errors** — structured `LumiError` with safe wire serialization.
  - **Amounts** — exact `bigint` base-unit arithmetic. No floating point.
  - **Addresses** — EIP-55 checksum validation.
  - **Chains** — the `ChainConfig` shape and the mainnet safety gate.
  - **Config** — Zod-validated environment loading with secret-safe errors.

- `@lumibase/database` — PostgreSQL schema and client:
  - **Drizzle ORM** schema for `applications`, `payments`, `transactions`,
    `events`, `webhooks`, `deliveries`.
  - Money-critical constraints enforced at the database level:
    `UNIQUE(chain_id, hash)` and `UNIQUE(webhook_id, event_id)`.

## Development

Requirements: Node.js >= 20, pnpm 9, Docker.
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm format:check

### Local database

LumiBase uses PostgreSQL. Start a local instance with:
docker compose up -d

This runs Postgres on `localhost:5433` with the dev credentials already
declared in `.env` (created from `.env.example`). Apply the schema with:
pnpm --filter @lumibase/database drizzle:migrate

Stop the database with `docker compose down` (add `-v` to also delete
the data volume and start from a clean database).

Tests that touch the database (`@lumibase/database`) require the
container to be running. If it isn't, the test suite fails fast with a
message that says exactly what to run.

## License

Apache-2.0. See [LICENSE](./LICENSE).
