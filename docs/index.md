# LumiBase Documentation

The authoritative specifications and demo documentation for LumiBase v0.1.

## Specifications

Language-independent JSON specifications. Any implementation (TypeScript,
Python, Rust, ...) can be built against these without reading the reference
TypeScript source.

- [Specifications guide](../specs/README.md) — how to use `specs/` and
  `tests/fixtures/` for independent implementations.
- [Payment lifecycle](../specs/payments/lifecycle.json) — the state
  machine (`pending` → `confirming` → `confirmed`, etc.).
- [Payment object](../specs/payments/payment.json) — canonical payment
  shape.
- [Payment events](../specs/payments/events.json) — lifecycle events.
- [Wire error codes](../specs/payments/errors.json) — the code set
  returned in `{ error: { code, message, requestId } }`.
- [Supported chains](../specs/network/chains.json) — Base Sepolia
  (enabled) and Base Mainnet (disabled in v0.1).
- [Payment JSON Schema](../specs/schemas/payment.json) — draft 2020-12
  schema for conformance testing.
- [Event JSON Schema](../specs/schemas/event.json) — draft 2020-12 schema
  for event payloads.

## Demo

- [Frontend integration contract](demo/frontend-contract.md) — the
  integration contract between the browser, the demo BFF, and the
  LumiBase API.
- [Demo application README](../apps/demo/README.md) — setup, environment
  variables, commands, and verification steps.

## Repository

- [Root README](../README.md) — project overview, packages, and development setup.
