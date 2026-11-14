# LumiBase v0.1.0 Release Notes

**Release Date:** 2026-11-15
**Status:** Pre-release / Developer Preview

## Overview

LumiBase v0.1.0 is the first functional release of the LumiBase toolkit. It provides a language-agnostic payments specification, a TypeScript reference implementation, and a fully working Next.js demo that proves the "independently verified" payment flow on Base Sepolia.

## What's Included

- **`@lumibase/core`**: Strict error handling, exact `bigint` base-unit math, EIP-55 validation, and chain safety gates.
- **`specs/`**: Language-independent JSON specifications for payments, chains, and error codes. Conformance fixtures included.
- **`@lumibase/database`**: PostgreSQL schema with Drizzle ORM. Enforces money-critical constraints (e.g., `UNIQUE(chain_id, hash)`).
- **`@lumibase/network`**: Viem-based chain access, confirmation counting, and ERC-20 log parsing.
- **`@lumibase/payments`**: The core payment lifecycle (create, read, cancel, expire, verify, confirm).
- **`@lumibase/api`**: Fastify HTTP API with rate limiting, application bootstrap, and OpenAPI docs. Includes the webhook delivery worker.
- **`apps/demo`**: A Next.js 15 BFF and UI that demonstrates the full payment lifecycle against Base Sepolia.

## Verification & Security

- **556 Automated Tests**: 100% passing across all 7 packages.
- **Cold-Start E2E Verified**: The system was tested end-to-end from a completely fresh Docker volume (`docker compose down -v`), migrating the DB from scratch, and successfully confirming a real 0.5 USDC transfer on Base Sepolia.
- **Bugs Found & Fixed During Audit**:
  - *Next.js Module Isolation*: Found and fixed a critical bug where route handlers bootstrapped separate LumiBase applications, orphaning payments across routes. Fixed via `globalThis` state sharing.
  - *Rate-Limit Bypass*: The same isolation bug weakened the BFF rate limiter. Fixed via `globalThis`.
- **Security Controls Verified**:
  - The BFF never exposes the API Key or `API_SECRET` to the browser.
  - Webhook SSRF protection is active.
  - The API independently verifies all payments against the blockchain; it does not trust client claims.

## Known Limitations (v0.1)

- **Base Mainnet is Disabled**: `chains.json` explicitly blocks Base Mainnet (8453). Only Base Sepolia (84532) is supported.
- **No Webhook CORS**: The API has no CORS headers. The demo relies on a same-origin BFF proxy.
- **UI is Developer-Focused**: The `apps/demo` UI exposes low-level details (lifecycle matrices, HMAC verifiers) intended for developers. A consumer-friendly UI polish is planned for v0.2.
- **File Naming**: Some demo files use hyphens (e.g., `rate-limit.ts`), deviating from the strict single-word rule. This will be normalized in v0.2.

## Getting Started

See the [README.md](./README.md) for setup instructions, or [apps/demo/README.md](./apps/demo/README.md) to run the demo. Ensure `docker compose up -d` is running and `BASE_SEPOLIA_RPC` is configured in your `.env`.