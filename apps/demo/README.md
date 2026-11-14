# LumiBase v0.1 Demo Frontend & Backend-for-Frontend (BFF)

This application implements the **LumiBase v0.1 Base Sepolia USDC Demo** and its same-origin **Backend-for-Frontend (BFF)** according to the LumiBase Frontend Integration Contract.

## Architecture

- **Frontend (`app/page.tsx`, `components/*`, `lib/client/*`)**:
  - Connects to EIP-1193 / EIP-6963 browser wallets.
  - Enforces **Base Sepolia (`84532`)** and guides switching if on any other network (Base Mainnet `8453` is disabled in v0.1).
  - Submits real ERC-20 `transfer(address,uint256)` transactions for Base Sepolia USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`) via `viem`.
  - Calls **only same-origin `/demo/*` routes** — never calls the LumiBase API directly and never receives LumiBase credentials.
  - Interprets `payment.status` before `error` on confirmation responses and runs bounded polling on `GET /demo/payments/:id/status` until a terminal state is reached.

- **Same-Origin BFF (`app/demo/*`, `lib/server/*`)**:
  - `GET /demo/config` — returns public Base Sepolia metadata and server-configured recipient.
  - `POST /demo/payments` — validates decimal USDC amount (`<= 6` fractional digits via integer-safe `viem` `parseUnits`, rejecting over-precision with `400 VALIDATION_ERROR`), enforces server-controlled `recipient`, `chainId`, and `token`, and forwards to `POST /api/v1/payments`.
  - `POST /demo/payments/:id/confirm` — validates UUID and `0x` 64-hex tx hash, forwards to `POST /api/v1/payments/:id/confirm`, and preserves verification outcomes verbatim.
  - `GET /demo/payments/:id` — fetches a single payment.
  - `GET /demo/payments/:id/status` — read-only persisted status check.

## Required Environment Variables

Configure these server-side variables before starting against a live LumiBase API (no placeholder defaults are substituted):

```bash
LUMIBASE_API_URL=http://localhost:3000
API_SECRET=<lumibase-admin-secret>
DEMO_RECIPIENT=0x<checksummed-or-lowercase-base-sepolia-recipient>
DEMO_PORT=4000
```

> **Note:** When the demo runs without `LUMIBASE_API_URL`, `API_SECRET`, and `DEMO_RECIPIENT`, `/demo/*` routes fail closed with HTTP `503 DEMO_CONFIGURATION_ERROR`. Restarting the server provisions a new in-memory LumiBase application key via `POST /api/v1/applications` (`Authorization: Admin <API_SECRET>`), which orphans payments from previous runs.

## Commands

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
```
