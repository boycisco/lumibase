# LumiBase Specifications

This directory contains the **language-independent contract** for LumiBase.
Implementations in any language (TypeScript, Python, Rust, others) MUST
conform to these files. A correct implementation in any language is expected
to produce the same observable behavior against the same inputs.

The TypeScript implementation in `packages/` is the **reference** implementation,
not the **source of truth**. The specifications in this directory are the source
of truth. If the two disagree, the specifications win, and the TypeScript code
is fixed.

## Why this directory exists

LumiBase supports multiple independent SDKs. Python and Rust implementations
must not depend on the TypeScript runtime, and must not require reading
TypeScript source code to implement LumiBase correctly. Everything an
implementer needs is here, or is referenced from here.

This is an architectural invariant, not a documentation preference.
Violating it means the project cannot deliver on its core promise.

## Contents

| File                      | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `payments/lifecycle.json` | Payment statuses, transitions, expiry, atomicity, and behavioral rules |
| `payments/payment.json`   | Human-readable description of every payment field                      |
| `payments/events.json`    | The 7 webhook event types and their payloads                           |
| `payments/errors.json`    | API error codes and `payment.failed` reason codes                      |
| `network/chains.json`     | Supported networks, tokens, confirmation policies                      |
| `schemas/payment.json`    | JSON Schema (draft 2020-12) for payments                               |
| `schemas/event.json`      | JSON Schema (draft 2020-12) for event envelopes                        |

The `tests/conformance/` directory contains executable tests and fixture
data that assert implementations conform. Fixtures live in
`tests/fixtures/`:

| Fixture                 | Purpose                                    |
| ----------------------- | ------------------------------------------ |
| `payment/valid.json`    | Payment objects that MUST validate         |
| `payment/invalid.json`  | Payment objects that MUST be rejected      |
| `transition/cases.json` | Allowed lifecycle transitions (exhaustive) |
| `chain/cases.json`      | Expected chain configuration               |
| `event/valid.json`      | Event envelopes that MUST validate         |
| `event/invalid.json`    | Event envelopes that MUST be rejected      |

## The rules that matter most

These are the invariants whose violation causes real money loss or
cross-language divergence. Every implementation MUST enforce them.

### 1. Amounts are integers, never floats

Amounts travel as **canonical non-negative integer strings** (base units).
For USDC on Base Sepolia (6 decimals), `1.50 USDC` is `"1500000"`.

Never use a floating-point type to represent or compute amounts. In Python,
use `int`. In Rust, use `u128` or a big-integer crate. In TypeScript,
use `bigint`.

Reject any string that is not `^[1-9][0-9]*$` (i.e. no leading zero, no
decimal point, no sign, no whitespace). The `"0"` amount is also rejected
for payment requests (the `amount` field must be strictly positive).

### 2. Confirmation requires independent verification

A payment is confirmed only by independently verified blockchain evidence.
Client-supplied status, amounts, and addresses are never trusted. The
backend re-fetches the transaction, receipt, logs, and confirmation depth
from its own RPC.

### 3. Payment request and transaction attempt are distinct

A payment request is a persistent entity that the merchant created.
A transaction attempt is a single submitted hash the merchant is trying to
prove. **A rejected attempt does not fail the payment request.** See
`payments/lifecycle.json` `failure` and `atomicity` sections.

### 4. Expiration is an explicit transition

`pending` payments past `expiresAt` are transitioned to `expired` by either
(a) the expiry worker, or (b) a confirm call that observes past expiry. It
is **never** computed dynamically during a GET. `processing` payments are
never forced to `expired` — verification must complete.

### 5. Terminal is terminal

No terminal status (`confirmed`, `expired`, `failed`, `cancelled`,
`underpaid`, `overpaid`) transitions to anything. There is no recovery.

### 6. Transaction uniqueness is enforced at the database

A given `(chain_id, transaction_hash)` pair may be associated with at most
one payment request. Implementations MUST enforce a unique constraint on
that pair at the database level.

### 7. Concurrent confirms cannot both win

Two simultaneous confirm calls for the same payment must not both proceed
to full verification. Allowed strategies (see `payments/lifecycle.json`
atomicity section): row-level lock, reject-second-with-error, or
return-existing-status. Any of the three is acceptable; what is not
acceptable is two different transactions both confirming.

## Implementing LumiBase in your language

A conformance-checking implementer should proceed in this order:

1. Read `payments/lifecycle.json` end-to-end. Understand `statuses`,
   `transitions`, `expiry`, `failure`, `atomicity`, and `rules`.
2. Read `payments/errors.json`. Every error in `codes` is part of your
   public API contract.
3. Read `network/chains.json`. These are the networks and tokens you must
   support, with their enabled flags as written. **Do not enable networks
   whose `enabled` is `false`.**
4. Read `schemas/payment.json` and `schemas/event.json`. These are the
   exact JSON shapes your SDK must produce and consume.
5. Run `tests/fixtures/payment/valid.json` through your payment validator.
   All 16 MUST pass. Run `invalid.json`; all 37 MUST fail.
6. Run `tests/fixtures/transition/cases.json` through your transition
   checker. Every (from, to) pair in the 8x8 matrix MUST resolve to the
   same allow/deny as the fixture.
7. Run `tests/fixtures/event/*.json` through your event validator.
8. Run `tests/fixtures/chain/cases.json` through your chain config loader.

If your implementation passes all six fixture sets, it is a conforming
v0.1 implementation.

## Versioning

Every JSON file has a `"version"` field. It follows the same version as
the LumiBase release that produced it (currently `0.1.0`).

A conformance test that succeeds against v0.1.0 must continue to succeed
against v0.1.x. If a spec change would break existing conformance, it
requires a minor-version bump (v0.2.0).

## What is NOT here

- **RPC URLs.** These are per-environment configuration, not protocol
  constants. They are supplied via environment variables by the deployer.
- **Database schema.** Persistence is an implementation detail; two
  conforming implementations may use different database schemas. The
  database MUST enforce the invariants listed above (uniqueness,
  atomic transitions), but the exact table layout is not specified.
- **HTTP framework, language, library choices.** These are implementation
  details. The API contract (routes, request shapes, response shapes,
  error codes) IS specified, in `payments/errors.json` and the OpenAPI
  document that will be added in Phase 8.

## Contributing a spec change

Before changing any JSON file in this directory:

1. Confirm the change cannot be expressed through configuration or
   extension (it must be a protocol change).
2. Update the corresponding fixtures and expected outcomes in
   `tests/fixtures/`.
3. Update the conformance test in `tests/conformance/` if the schema shape
   changed.
4. Update the `version` field to reflect whether this is a breaking change.
5. If the change is behavioral, note it in the file's `notes` or top-level
   description so implementers can find it.

Do not change a spec solely to match a bug in one implementation. Fix the
implementation.
