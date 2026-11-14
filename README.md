# LumiBase

Open-source developer toolkit for building applications on Base.

> **Status: Pre-release (v0.1.0).**
> The capability packages, Fastify HTTP API, webhook worker, and Next.js
> demo are implemented. The demo targets Base Sepolia. Phase 11
> (documentation) is in progress; Phase 12 (release preparation) is next.
> Verify the current test and deployment status before treating this as a
> release-readiness statement.

## What LumiBase is

LumiBase is a modular, language-agnostic toolkit for developers building
on Base. It is designed to support multiple independent language
implementations (TypeScript first, Python and Rust later) that share the
same protocols and specifications.

The first flagship capability is **Payments**: a secure, independently
verified flow for accepting and confirming onchain USDC payments on
Base Sepolia.

## Principles

- **Language independence** — protocols live in `specs/`, not in any SDK.
- **Security first** — payments are confirmed using independently verified
  blockchain evidence, never a client claim.
- **Modular monorepo** — each capability is maintained as an independent
  package.
- **Open source** — the core does not depend on a proprietary LumiBase
  service.

## Repository status

| Phase                               | Status      |
| ----------------------------------- | ----------- |
| 1. Repository foundation            | Complete    |
| 2. Core package                     | Complete    |
| 3. Payment specifications           | Complete    |
| 4. Database foundation              | Complete    |
| 5. Blockchain foundation            | Complete    |
| 6. Payment service                  | Complete    |
| 7. Payment verification             | Complete    |
| 8. API implementation               | Complete    |
| 9. Event and webhook infrastructure | Complete    |
| 10. Payment demonstration           | Complete    |
| 11. Documentation                   | In progress |
| 12. Release preparation             | Not started |

## Packages

- `@lumibase/core` — shared primitives:
  - **Errors** — structured `LumiError` with safe wire serialization.
  - **Amounts** — exact `bigint` base-unit arithmetic; no floating point.
  - **Addresses** — EIP-55 checksum validation.
  - **Chains** — the `ChainConfig` shape and mainnet safety gate.
  - **Config** — Zod-validated environment loading with secret-safe errors.

- `@lumibase/database` — PostgreSQL schema and client:
  - **Drizzle ORM** schema for `applications`, `payments`, `transactions`,
    `events`, `webhooks`, and `deliveries`.
  - Money-critical constraints enforced at the database level, including
    `UNIQUE(chain_id, hash)` and `UNIQUE(webhook_id, event_id)`.

- `@lumibase/network` — chain access layer:
  - Viem-based public client factory with mainnet safety gating.
  - RPC reads, ERC-20 `Transfer` log parsing, confirmation counting, and
    the `waitForBlock` helper used by verification.

- `@lumibase/payments` — payment lifecycle:
  - **Create / read / expire / cancel** — lifecycle operations defined by
    `specs/`.
  - **Verify / confirm** — independently re-derives relevant facts from
    chain evidence, including receipt, logs, amount, recipient, token, and
    confirmation count.

- `@lumibase/api` — HTTP API and worker:
  - **Fastify 5** application with rate limiting, Helmet, and OpenAPI docs.
  - Admin and application-key authentication.
  - Webhook registration and delivery.
  - Worker entry point with graceful shutdown and
    `FOR UPDATE SKIP LOCKED` job claiming.

- `@lumibase/conformance` — language-independent conformance:
  - JSON Schema validators and fixture tests that implementations in
    other languages can run against `specs/` and `tests/fixtures/`.

- `@lumibase/demo` — reference demo application:
  - Next.js application demonstrating the Base Sepolia payment flow.
  - See [apps/demo/README.md](./apps/demo/README.md) for setup and operation.

## Development

Requirements: Node.js >= 20, pnpm 9, and Docker.

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm format:check
```

### Local database

LumiBase uses PostgreSQL. Start a local instance with:

```bash
docker compose up -d
```

This runs PostgreSQL on `localhost:5433` using the development credentials
configured through the root `.env` file (created from `.env.example`).
Apply the schema with:

```bash
pnpm --filter @lumibase/database drizzle:migrate
```

Stop the database with:

```bash
docker compose down
```

Add `-v` to also delete the data volume and start with a clean database.

Tests that touch the database (`@lumibase/database`) require the container
to be running. If it is not running, the test suite should fail with a
message explaining how to start it.

### Running the demo

The demo is a Next.js application in `apps/demo/` that exercises the
payment flow against Base Sepolia. It requires the LumiBase API and the
demo application to run separately.

1. **Configure the demo environment.** Create `apps/demo/.env.local` and
   add the variables required by the demo. Next.js loads this file from
   the application directory:

   ```dotenv
   LUMIBASE_API_URL=http://localhost:3000
   API_SECRET=<same value as the API's configured API_SECRET>
   DEMO_RECIPIENT=<Base Sepolia recipient address>
   DEMO_PORT=4000
   ```

2. **Configure the API RPC endpoint.** Set `BASE_SEPOLIA_RPC` in the root
   `.env` to a Base Sepolia RPC URL, such as `https://sepolia.base.org`.
   The API uses this endpoint to verify payments against the real
   Base Sepolia network.

3. **Start the API** in one terminal:

   ```bash
   pnpm --filter @lumibase/api dev
   ```

4. **Start the demo** in another terminal:

   ```bash
   pnpm demo
   ```

5. Open `http://localhost:4000` in a browser with an EVM wallet
   (such as MetaMask, Rabby, or OKX) connected to Base Sepolia.

See [apps/demo/README.md](./apps/demo/README.md) for the demo setup and
[docs/demo/frontend-contract.md](./docs/demo/frontend-contract.md) for the
frontend integration contract. The documentation index is at
[docs/index.md](./docs/index.md).

## License

Apache-2.0. See [LICENSE](./LICENSE).
