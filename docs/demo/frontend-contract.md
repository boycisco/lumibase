# LumiBase Demo: Frontend Integration Contract

**Version:** 0.1.0  
**Status:** Draft for frontend-agent implementation  
**Audience:** Frontend agent responsible for the Phase 10 demo  
**Scope:** Integration behavior and technical boundaries, not visual design

---

## 1. Purpose

This document defines the integration contract for the LumiBase v0.1 demo.

It describes:

- The browser-to-demo-server boundary.
- The demo-server-to-LumiBase-API boundary.
- Wallet and Base Sepolia transaction requirements.
- Payment lifecycle and verification semantics.
- Error handling, security restrictions, and acceptance criteria.

It is an integration specification, not a UI design brief.

### 1.1 Frontend ownership

The frontend agent owns the complete user experience, including:

- Visual direction, layout, typography, color, and styling.
- Component structure and frontend framework choices.
- Responsive behavior and accessibility.
- Interaction design, loading states, transitions, and user-facing copy.
- Browser-side wallet connection and transaction submission.
- The demo server / Backend-for-Frontend (BFF) required to keep LumiBase credentials server-side.

The backend agent owns the existing LumiBase API and its specifications. It should not make visual-design decisions or implement the demo UI as part of this contract task.

### 1.2 Out of scope

This contract does not prescribe:

- A visual theme or design system.
- React, vanilla TypeScript, or another frontend framework.
- Component libraries or state-management libraries.
- A production-grade multi-user demo platform.
- New LumiBase payment capabilities.

The frontend agent may choose the simplest maintainable implementation that satisfies this contract.

---

## 2. Architecture

The demo uses a browser, a small demo server (BFF), the LumiBase API, and the existing background worker.

```text
Browser
  |
  | Same-origin requests: /demo/*
  v
Demo server / BFF
  | - Serves the demo frontend
  | - Holds the LumiBase application API key
  | - Holds server-only configuration
  | - Proxies a strict allowlist of operations
  |
  | Server-to-server requests
  | Authorization: Bearer <application-api-key>
  v
LumiBase API
  |
  | PostgreSQL events and delivery records
  v
Background worker
  |
  | Signed HTTP POST with retries
  v
Registered public webhook endpoint
```

### 2.1 Why the BFF is required

The LumiBase application API key is a secret. If it is placed in browser JavaScript, local storage, a browser cookie readable by JavaScript, or a response body, visitors can extract it and use it outside the demo.

The demo server therefore acts as a Backend-for-Frontend:

1. It obtains and stores the application API key on the server.
2. It accepts narrowly defined `/demo/*` requests from the browser.
3. It forwards permitted requests to LumiBase with the API key.
4. It returns only the data the browser needs.

The browser must never receive LumiBase credentials.

### 2.2 CORS

The current LumiBase API does not enable browser CORS access. A browser page hosted on `http://localhost:4000` should therefore not call `http://localhost:3000` directly.

All browser requests should go to the same-origin demo server. The demo server then calls LumiBase server-to-server, where browser CORS rules do not apply.

Do not add permissive CORS configuration to LumiBase merely to make the demo work.

### 2.3 Webhook delivery and localhost

The webhook worker applies SSRF protection and rejects loopback and private-network destinations. A webhook URL such as `http://localhost:4000/hook` is therefore not a valid way to receive a delivery from the worker.

A live webhook demonstration requires a publicly reachable endpoint, such as a carefully configured tunnel or a third-party webhook inspection service. The frontend agent must not weaken SSRF protection to make a local webhook receiver work.

---

## 3. Security Requirements

### 3.1 Secrets that must remain server-side

The following values must never be returned to the browser, embedded in browser bundles, or written to browser-accessible storage:

- LumiBase admin secret (`API_SECRET` in the existing backend configuration).
- LumiBase application API key.
- Webhook master encryption key (`WEBHOOK_SECRET`).
- Database connection strings or database credentials.
- Any server-only signing or encryption keys.
- Any private key material.

The demo must not request, store, or handle a user's wallet private key or seed phrase. Wallet signing happens through the user's installed wallet.

### 3.2 Browser-visible data

The browser may receive:

- Public chain metadata such as chain ID, token address, token decimals, and explorer URL.
- The configured payment recipient address.
- Payment objects and payment status.
- Safe error codes and user-displayable messages.
- A transaction hash submitted by the user's wallet.

Do not return environment variables or internal configuration objects wholesale.

### 3.3 Application bootstrap

At startup, the demo server must obtain an application API key using the existing admin-protected application-creation endpoint.

The intended sequence is:

1. Read the LumiBase API base URL from server configuration.
2. Read the existing admin secret from server configuration.
3. Call `POST /api/v1/applications` using the exact admin authentication scheme implemented by the API.
4. Store the returned application API key in process memory.
5. Never log or return the plaintext key.

The existing backend configuration uses `API_SECRET`. If the demo introduces a separate environment-variable name such as `LUMIBASE_API_SECRET`, document the mapping clearly. Do not silently assume the new name already exists in `.env.example`.

The application key is returned only once. If the demo server keeps it only in memory, a process restart must create a new demo application and obtain a new key. This behavior should be documented and should not be mistaken for a persistent user session.

### 3.4 BFF request restrictions

The demo server must:

- Expose only the routes required by the demo.
- Validate payment IDs and transaction hashes before forwarding.
- Validate and normalize amounts server-side.
- Set the payment recipient from server configuration, not from an untrusted browser field.
- Fix the chain and token to the supported Base Sepolia USDC configuration.
- Apply reasonable request-size and rate limits.
- Avoid acting as a general-purpose HTTP proxy.
- Avoid accepting arbitrary URLs from the browser.
- Avoid logging API keys, webhook secrets, or other credentials.

A demo spending cap may be implemented as an additional safety guard, but it must be clearly documented as a demo policy rather than a LumiBase protocol rule.

---

## 4. User Journey

The expected end-to-end journey is:

1. The user opens the demo page.
2. The demo server has already bootstrapped its LumiBase application.
3. The user connects an EIP-1193-compatible wallet.
4. The frontend reads the connected address and chain ID.
5. If necessary, the frontend asks the user to switch to Base Sepolia.
6. The user enters a USDC amount and creates a payment request.
7. The frontend displays the payment amount, recipient, expiry, and status.
8. The user approves a USDC transfer in their wallet.
9. The wallet returns a transaction hash.
10. The frontend submits that hash to the demo server for LumiBase verification.
11. The frontend displays the verification result and polls status when appropriate.
12. The frontend stops polling when the payment reaches a terminal state.

Webhook delivery is an optional advanced demonstration. It must not block the primary payment journey.

---

## 5. Wallet and Network Requirements

### 5.1 Supported network

The v0.1 demo must use Base Sepolia only.

| Field | Value |
|---|---|
| Network | Base Sepolia |
| Chain ID | `84532` |
| Native gas token | ETH |
| USDC contract | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| USDC decimals | `6` |
| Block explorer | `https://sepolia.basescan.org` |

Base Mainnet (chain ID `8453`) is disabled in the current network specification. Do not attempt to create or pay LumiBase v0.1 payments on Base Mainnet.

Before submitting a transfer, check the wallet's active chain. If it is not `84532`, request a network switch and verify the chain again. If the switch fails or the user declines, do not submit the transaction.

The token address and network configuration should be sourced from the project configuration/specification, not duplicated as unrelated constants throughout the frontend.

### 5.2 ERC-20 transfer

The browser needs the USDC `transfer(address,uint256)` function.

```ts
const USDC_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;
```

The transfer must use the payment's recipient and amount returned by the demo server. Do not let the browser substitute a different recipient or token.

### 5.3 Amount handling

USDC has six decimal places.

- Human amount `1.5` USDC becomes `1500000` base units.
- Use viem `parseUnits(amount, 6)` to convert a validated human-readable amount to base units.
- Use viem `formatUnits(amount, 6)` to format base units for display.
- Use `bigint` or decimal strings for amount arithmetic.
- Never use JavaScript floating-point arithmetic for token amounts.

The LumiBase API wire amount is an integer base-unit string. The demo server is responsible for converting a human-readable amount into that representation.

### 5.4 Transaction submission

The browser submits an ERC-20 transfer using the connected wallet. Conceptually:

```ts
const hash = await walletClient.writeContract({
  address: usdcAddress,
  abi: USDC_ABI,
  functionName: "transfer",
  args: [payment.recipient, BigInt(payment.amount)],
});
```

Use the actual address and amount from the created payment response. The example is illustrative; adapt it to the selected viem version and wallet-client setup.

A returned transaction hash means the wallet submitted a transaction. It does not mean LumiBase has confirmed the payment.

---

## 6. Browser-to-Demo-Server Contract

All browser requests are same-origin requests to the demo server. The route names below define the proposed BFF surface. The frontend agent must implement these routes in the demo server and keep them narrowly scoped.

### 6.1 `GET /demo/config`

Returns public configuration required by the browser.

Example response:

```json
{
  "chainId": 84532,
  "chainName": "Base Sepolia",
  "usdc": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "decimals": 6,
  "recipient": "0x0000000000000000000000000000000000000001",
  "explorer": "https://sepolia.basescan.org"
}
```

The recipient shown above is illustrative only. The implementation must use the operator-configured recipient and must not copy this example address into production configuration.

### 6.2 `POST /demo/payments`

Creates a payment request.

Example browser request:

```json
{
  "amount": "1.5",
  "reference": "demo-order-001"
}
```

The amount is a human-readable decimal string. The demo server must validate it, convert it to six-decimal base units, and construct the LumiBase API request using server-controlled values:

- `amount`: base-unit integer string (`parseUnits(humanAmount, 6).toString()`).
- `chainId`: `84532`.
- `token`: configured Base Sepolia USDC address.
- `recipient`: configured demo recipient.
- `expiresIn`: positive integer seconds from now, at most `2592000` (30 days).
- `reference`: optional; non-unique; at most 256 characters.

**Over-precision:** If the browser submits a human amount with more than 6
fractional digits (for example, `"1.5000001"`), `parseUnits(amount, 6)`
throws. The demo server must catch this and return a 400 with a clear
`VALIDATION_ERROR` message (for example, `"Amount has more than 6 decimal
places."`). Never truncate or round the amount silently — the payer must
correct the input.

**Error pass-through:** When the demo server forwards a request to LumiBase
and receives a non-2xx response, it MUST return the LumiBase error envelope
verbatim to the browser:

```json
{ "error": { "code": "...", "message": "...", "requestId": "..." } }
```

Do not reshape, rename, or summarize these fields. The frontend uses
`error.code` for behavior decisions and `requestId` for operator correlation.
For `POST /demo/payments/:id/confirm` returning HTTP 200 with a non-null
`error` in the body, forward the response verbatim as
`{ "payment": {...}, "error": "..." }`.

The browser must not choose an arbitrary chain, token, or recipient.

Successful response: the payment wire object returned by LumiBase.

### 6.3 `POST /demo/payments/:id/confirm`

Submits a transaction hash for independent verification.

Example request:

```json
{
  "transactionHash": "0x..."
}
```

The demo server validates the payment ID and transaction-hash format, then forwards the request to LumiBase using its server-side application API key.

The response must preserve the actual LumiBase confirmation semantics. In particular, an HTTP 200 response does not by itself mean the payment is confirmed. The frontend must inspect both the returned payment status and the confirmation `error` field.

### 6.4 `GET /demo/payments/:id`

Returns the current payment object for a single payment belonging to the demo application.

Do not expose an unrestricted list-all-payments route in the demo.

### 6.5 `GET /demo/payments/:id/status`

Returns the current persisted payment status. This endpoint is read-only and does not initiate blockchain verification.

Example response:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "updatedAt": "2026-11-14T12:34:56.789Z"
}
```

The exact response fields must match the API implementation and OpenAPI document.

### 6.6 Routes not to expose

Do not expose these through the browser-facing BFF unless a separate, reviewed requirement is approved:

- Admin application creation.
- Unrestricted payment listing.
- Arbitrary webhook registration.
- Arbitrary webhook deletion.
- Arbitrary payment cancellation.
- Any generic proxy or arbitrary URL fetch route.

The demo server itself may call the admin application endpoint during startup. That does not make the admin endpoint a browser-facing route.

---

## 7. Demo-Server-to-LumiBase API Contract

The demo server calls the existing LumiBase API. It must use the live OpenAPI document and current source implementation as the authoritative reference when implementing the proxy.

### 7.1 Application creation

`POST /api/v1/applications`

**Authentication header:**
```
Authorization: Admin <LUMIBASE_API_SECRET>
```

Where `<LUMIBASE_API_SECRET>` is the value of the existing `API_SECRET`
environment variable on the LumiBase server. The prefix is the literal word
`Admin` followed by a single space.

**Request body:**
```json
{ "name": "demo-<timestamp>" }
```

**Response (201):**
```json
{
  "application": {
    "id": "660e8400-e29b-41d4-a716-446655440000",
    "name": "demo-2026-11-14",
    "status": "active",
    "createdAt": "2026-11-14T12:00:00.000Z"
  },
  "key": "lb_<base64url>"
}
```

The `key` is returned exactly once. Store it in process memory only.

### 7.2 Payment creation

`POST /api/v1/payments`

**Authentication header:**
```
Authorization: Bearer <LUMIBASE_API_KEY>
```

**Request body (accepted fields):**
```json
{
  "amount": "1500000",
  "chainId": 84532,
  "token": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "recipient": "0x<checksummed-or-lowercase>",
  "payer": null,
  "reference": "demo-order-001",
  "expiresIn": 1800,
  "metadata": null
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `amount` | string | Yes | Base-unit integer string, regex `^[1-9][0-9]*$`; > 0; ≤ uint256 max |
| `chainId` | integer | Yes | `84532` (Base Sepolia). Base Mainnet `8453` is disabled. |
| `token` | string | Yes | Must be a token registered for `chainId`. Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| `recipient` | string | Yes | EVM address, EIP-55 valid |
| `payer` | string\|null | No | If set, only that sender may confirm |
| `reference` | string\|null | No | ≤ 256 characters; not unique |
| `expiresIn` | integer | Yes | Positive integer seconds; ≤ `2592000` (30 days) |
| `metadata` | object\|null | No | Serialized size ≤ 8 KiB |

**Response (201):** The wire payment object (see §6.2 for the shape).

### 7.3 Payment confirmation

`POST /api/v1/payments/:id/confirm`

The request contains the transaction hash. LumiBase independently retrieves and verifies the transaction and receipt.

The response contains the payment result and, where applicable, a verification error. Do not convert a verification rejection into a successful payment in the BFF.

### 7.4 Payment retrieval and status

- `GET /api/v1/payments/:id`
- `GET /api/v1/payments/:id/status`

Use these for reading the payment and polling its persisted status. The status endpoint must not be treated as a verification trigger.

### 7.5 Webhook registration

`POST /api/v1/webhooks` is an optional advanced capability.

The endpoint returns a webhook signing secret once. If the demo server registers a webhook, the secret must remain server-side and must never be returned to the browser.

Do not implement webhook registration in the browser-facing BFF unless the demo has a concrete, safe use case for it.

---

## 8. Payment Lifecycle

### 8.1 Statuses

The current payment lifecycle defines these statuses:

| Status | Meaning | Terminal |
|---|---|---:|
| `pending` | Awaiting a valid payment | No |
| `processing` | Verification is in progress | No |
| `confirmed` | Exact payment independently verified | Yes |
| `underpaid` | Matching transfer found, amount too low | Yes |
| `overpaid` | Matching transfer found, amount too high | Yes |
| `expired` | Payment request expired | Yes |
| `cancelled` | Payment request cancelled | Yes |
| `failed` | Reserved for a future version; not emitted by the v0.1 confirmation flow | Future use |

Use `specs/payments/lifecycle.json` as the authoritative state-machine definition. Do not invent statuses or transitions.

### 8.2 Meaning of confirmed

A payment is confirmed only after LumiBase independently verifies the onchain transaction according to its configured network policy.

Verification includes the relevant chain, successful transaction receipt, confirmation policy, expected token, recipient, amount, and payer when one was specified.

The wallet returning a transaction hash, displaying a success message, or showing a transaction in its activity list is not sufficient evidence of a confirmed LumiBase payment.

### 8.3 Confirmation response versus HTTP status

The confirmation endpoint may return HTTP 200 while reporting a verification
outcome in its response body. The frontend must inspect BOTH fields, in this
exact order:

1. **`payment.status`** — always trust this first.
   - If terminal (`confirmed`, `underpaid`, `overpaid`, `expired`,
     `cancelled`, `failed`), that is the final outcome. Stop polling.
   - If non-terminal (`pending`, `processing`), continue to step 2.

2. **`error`** — interpret based on step 1:
   - `error === null` AND `payment.status` is terminal → success. This is the
     normal path for confirmed/underpaid/overpaid, or an idempotent call on an
     already-terminal payment (§8.4).
   - `error === "PAYMENT_EXPIRED"` AND `payment.status === "expired"` → the
     payment just expired on this call. Terminal. Display "expired"; do not
     retry.
   - `error` is any other non-null value AND `payment.status` is non-terminal
     → verification rejected or is in progress. Display the error and decide
     whether to retry (§9.3).

**In v0.1, `PAYMENT_EXPIRED` is the only case where `payment.status` is
terminal AND `error` is non-null.** Every other combination follows the
pattern above: `error: null` implies terminal status; non-terminal status
implies non-null `error`.

Do not treat HTTP 200 as synonymous with `confirmed`. Do not treat a non-null
`error` as equivalent to a `failed` payment status — the payment request
remains `pending` after a rejected attempt and may be retried with a
different hash (except `PAYMENT_EXPIRED`).

### 8.4 Terminal confirmation and polling

**Idempotent confirmation of terminal payments:** If the client submits a
confirmation request for a payment that is already terminal, LumiBase returns
the existing payment with `error: null`. The demo must display the returned
terminal status and must not attempt to verify the transaction again. This
also means the client should not interpret a repeated confirmation request as
a new payment attempt.

After submitting a transaction hash:

- Render the immediate confirmation result.
- If the payment remains non-terminal, poll the status endpoint.
- Use a modest interval, such as 2–3 seconds, with a bounded timeout.
- Stop polling when the payment reaches a terminal status.
- Stop or pause polling when the user leaves the payment flow.
- Handle network errors without falsely changing the payment status.

Polling is for reading persisted status. It does not replace the explicit confirmation request.

### 8.5 Underpayment and overpayment

Underpaid and overpaid are terminal states in v0.1. The frontend must display them distinctly and must not imply that another transaction will automatically complete or repair the same payment.

There is no automatic refund, top-up aggregation, or correction flow unless a later specification explicitly adds one.

### 8.6 Failed transaction attempts

A failed or invalid transaction attempt does not necessarily mean the payment request itself is terminally failed. Follow the actual confirmation response and lifecycle specification.

Do not display a terminal payment failure merely because a wallet transaction reverted or a verification attempt was inconclusive.

---

## 9. Error Handling

There are two distinct error categories.

### 9.1 HTTP-level API errors

These are request-level failures. LumiBase uses a structured error envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body.",
    "requestId": "11111111-1111-4111-8111-111111111111"
  }
}
```

The frontend should use the error code for behavior and the message for useful feedback. Do not display stack traces, database errors, secrets, or internal paths.

The following table is a handling guide, not a substitute for the actual error specification:

| HTTP status | Typical meaning | Frontend behavior |
|---:|---|---|
| 400 | Invalid request | Explain the input problem; do not blindly retry |
| 401 | Invalid or missing server credential | Show a demo-configuration error; operator must fix it |
| 403 | Operation not permitted | Explain that the action is unavailable |
| 404 | Payment or route not found | Explain that the payment could not be found |
| 409 | Payment state conflict (expired, already terminal, verification in progress) | Display the specific conflict; do not retry blindly |
| 422 | Unsupported chain/token or invalid endpoint | Explain the configuration or validation problem |
| 429 | Rate limit reached | Respect `Retry-After` if provided |
| 500 | Unexpected server error | Show a generic error and request ID |
| 503 | Service/configuration unavailable | Show a temporary or operator-configuration error |

The exact codes and HTTP mappings must be verified against `specs/payments/errors.json` and the API implementation before the frontend hardcodes them.

### 9.2 Verification outcomes

The confirmation endpoint may report a verification outcome as a string
in the `error` field of a 200 response body (for example,
`"TRANSACTION_NOT_FOUND"`). This is distinct from an HTTP-level non-2xx
response, which uses the structured error envelope in §9.1 with
`error.code`, `error.message`, and `error.requestId`.

The following table lists every code the v0.1 confirm flow can emit. All
codes are defined in `specs/payments/errors.json`.

| `error` | Meaning | Safe to retry same hash? | Frontend guidance |
|---|---|---:|---|
| `TRANSACTION_NOT_FOUND` | Hash not yet known on Base Sepolia | Yes | Retry in a few seconds; tx may not be mined yet |
| `TRANSACTION_REVERTED` | Mined but reverted | No | Tx failed on-chain; do not retry |
| `TRANSACTION_WRONG_RECIPIENT` | Transfer went to a different address | No | Wrong recipient; do not retry |
| `TRANSACTION_WRONG_TOKEN` | Transfer used a different token | No | Wrong token; do not retry |
| `TRANSACTION_WRONG_SENDER` | Transfer from wrong sender (payer specified) | No | Wrong wallet; do not retry |
| `TRANSACTION_NOT_ENOUGH_CONFIRMATIONS` | Mined, fewer than policy blocks | Yes | Retry in ~30 seconds |
| `TRANSACTION_ALREADY_PROCESSED` | Hash already associated with another payment | No | Do not retry |
| `TRANSACTION_RPC_FAILURE` | RPC temporarily unreachable | Yes | Retry in a few seconds |
| `PAYMENT_VERIFICATION_IN_PROGRESS` | Another confirm call is running | Poll status, don't re-submit | Wait and poll `GET /demo/payments/:id/status` |
| `PAYMENT_EXPIRED` | Payment expired before this confirm | No | Terminal; create a new payment |
| `PAYMENT_INVALID_STATE` | Unexpected state (should not occur) | No | Report as internal error |

**Not emitted in v0.1** despite being declared in `specs/payments/errors.json`:

- `TRANSACTION_WRONG_NETWORK` — cross-chain detection is a v0.2 feature.
  Submitting a hash from the wrong chain surfaces as `TRANSACTION_NOT_FOUND`
  because receipts are fetched only on the payment's declared chain.
- `PAYMENT_ALREADY_CONFIRMED` and `PAYMENT_CANCELLED` — confirming an
  already-terminal payment returns the existing payment with `error: null`
  (see §8.4).

### 9.3 Retry guidance

General principles:

- Retry transient RPC or confirmation-depth conditions only when the backend says retry is safe.
- Do not retry a reverted transaction hash as if it could become successful.
- Do not reuse a hash that has already been consumed by another payment.
- If verification is already in progress, prefer polling status rather than launching duplicate confirmation requests.
- Never retry a terminal payment as though it were pending.

---

## 10. Webhook Demonstration

Webhook delivery is optional for the primary demo.

The current SSRF protection rejects loopback and private-network destinations. Therefore, the worker cannot POST to a webhook receiver at `localhost` by simply registering a local URL.

Possible demonstration approaches:

1. **Public tunnel:** expose a local receiver through a properly configured public tunnel. Confirm that the resulting hostname and resolved addresses pass the existing SSRF policy.
2. **Third-party receiver:** use a webhook inspection service to view the signed request.
3. **Conceptual explanation:** describe how LumiBase sends signed events without claiming that a live local delivery occurred.

Do not disable or bypass SSRF protection.

### 10.1 Webhook signature format

Every outbound webhook carries this header:

```
X-LumiBase-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>
```

The signature is HMAC-SHA256 of the string `<timestamp>.<raw-request-body>`
using the webhook's plaintext signing secret as the key. The signature is
lowercase hex, 64 characters.

Receiver verification:
1. Parse `t` and `v1` from the header.
2. Compute `HMAC-SHA256(secret, "<t>.<body>")`.
3. Compare the hex output to `v1` in constant time.
4. Reject if `|now - t| > 300` seconds (5-minute replay window).

The receiving server must have the plaintext signing secret. The demo server
obtains it once at webhook registration time; the browser must never see it.

### 10.2 Event payload shape

The webhook body is the event JSON envelope:

```json
{
  "id": "<event-uuid>",
  "type": "payment.confirmed",
  "createdAt": "2026-11-14T12:35:12.345Z",
  "data": {
    "payment": { /* wire payment */ },
    "transaction": { "hash": "0x...", "blockNumber": "12345678" }
  }
}
```

The exact payload shape per event type is defined in
`specs/payments/events.json`. The signature covers the raw body, so receivers
must verify against the exact bytes received — not a re-serialized version.

---

## 11. Known v0.1 Limitations

The following limitations must be communicated honestly:

1. **Base Mainnet is disabled.** The demo uses Base Sepolia only.
2. **The LumiBase API is not browser-CORS-enabled.** Browser requests go through the demo server.
3. **Localhost webhook receivers are blocked by SSRF protection.** A public endpoint or conceptual demonstration is required.
4. **The `failed` payment status is reserved for future use** and is not emitted by the v0.1 confirmation flow.
5. **Application API keys are returned once, and restart orphans in-flight
   payments.** If the demo stores the key only in process memory, restarting
   the demo creates a new application with a new `applicationId`. Every
   payment created under the previous application becomes unreachable:
   - `GET /demo/payments/:id` returns 404 (payment belongs to the old app)
   - `POST /demo/payments/:id/confirm` returns 404
   - Any in-flight payment is lost to the demo view
   This is a demo limitation, not a LumiBase protocol rule. A production
   deployment would persist application credentials securely.
6. **Webhook signing secrets are returned once.** They must be retained securely by the server if the demo needs to use them later.

These are integration constraints, not permission to weaken backend security.

---

## 12. Configuration

### 12.1 Environment variables

The demo server reads these variables at startup, from the same root `.env`
file the API and worker use.

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `LUMIBASE_API_URL` | Yes | — | Base URL of the running LumiBase API (e.g., `http://localhost:3000`) |
| `API_SECRET` | Yes | — | Admin secret. Same variable the LumiBase API uses. Read once at startup; used only for the admin bootstrap call |
| `DEMO_RECIPIENT` | Yes | — | EVM address (checksummed or lowercase) that receives payments. Never sourced from the browser |
| `DEMO_PORT` | No | `4000` | HTTP port the demo server listens on |
| `NODE_ENV` | No | `development` | Runtime environment |

**The demo server does not read `WEBHOOK_SECRET` at any time.** Webhook
signing uses the per-webhook secret returned from
`POST /api/v1/webhooks` at registration time; the master `WEBHOOK_SECRET` is
an internal LumiBase value the demo never needs.

**The demo server does not read `DATABASE_URL`.** All payment state is
fetched through the LumiBase API.

### 12.2 Where secrets live

- `API_SECRET` is read once at startup and used only for the admin bootstrap
  call. It is never passed to the browser, never logged, and not retained in
  memory after startup.
- The application API key returned from `POST /api/v1/applications` is kept
  in process memory for the demo server's lifetime. It is never passed to
  the browser, never logged, and never persisted to disk.
- The demo server MUST fail to start if `LUMIBASE_API_URL`, `API_SECRET`, or
  `DEMO_RECIPIENT` is missing. It MUST NOT fall back to defaults for these.

### 12.3 Additions to `.env.example`

Add these lines to `.env.example` (the API/worker variables are already
present from earlier phases; do not duplicate them):

```
# Demo (apps/demo)
LUMIBASE_API_URL=http://localhost:3000
DEMO_RECIPIENT=
DEMO_PORT=4000
```

---

## 13. Frontend Agent Handoff

### 13.1 Required functionality

The completed demo must:

- Serve the frontend from the demo server.
- Bootstrap or obtain a demo application without exposing admin credentials.
- Keep the application API key on the server.
- Expose only the allowlisted `/demo/*` routes.
- Connect an EIP-1193 wallet.
- Detect the active chain and require Base Sepolia.
- Display the connected wallet address.
- Create a payment request from a user-entered USDC amount.
- Display the payment amount, recipient, expiry, and status.
- Submit a USDC transfer through the user's wallet.
- Submit the resulting transaction hash for LumiBase verification.
- Display the actual verification result.
- Poll non-terminal payment states and stop on terminal states.
- Handle validation, network, RPC, and API errors without misrepresenting payment status.
- Keep all credentials and signing secrets server-side.

### 13.2 Design freedom

The frontend agent is free to choose:

- React, vanilla TypeScript, or another justified frontend approach.
- The visual identity and overall art direction.
- Layout, typography, color, spacing, and component composition.
- Animation and interaction patterns.
- Responsive and accessibility implementation.

The integration and security requirements in this document are not optional.

### 13.3 Acceptance criteria

The demo is complete when:

1. A clean install succeeds.
2. Build, typecheck, lint, and test commands pass.
3. The demo server starts with the documented configuration.
4. The browser can connect a wallet on Base Sepolia.
5. A user can create a payment request and send the required USDC transfer.
6. The transaction hash is submitted to LumiBase for independent verification.
7. The UI displays `confirmed` only after LumiBase returns that status.
8. Non-terminal and terminal states are handled correctly.
9. Browser DevTools show requests only to the demo server, not directly to the LumiBase API.
10. The built browser assets contain no LumiBase API key, admin secret, webhook secret, or database credentials.
11. Existing LumiBase tests continue to pass.
12. At least one non-success path is demonstrated, such as a rejected transaction, underpayment, or expiry.
13. Any webhook demonstration is explicit about whether it is live or conceptual.

### 13.4 Do not

The frontend agent must not:

- Expose the LumiBase API key or admin secret to the browser.
- Call the LumiBase API directly from browser JavaScript.
- Add an arbitrary URL proxy.
- Handle wallet private keys or seed phrases.
- Invent payment statuses, error codes, or API fields.
- Treat wallet submission as payment confirmation.
- Bypass SSRF protection.
- Enable Base Mainnet for the v0.1 demo.
- Modify backend packages, database schema, or protocol specifications without a separately reviewed requirement.

### 13.5 Source of truth

Before implementation, verify every endpoint, field, status, error code, and authentication header against:

- `GET /openapi.json` from the running LumiBase API.
- `apps/api/src/*`.
- `specs/payments/lifecycle.json`.
- `specs/payments/errors.json`.
- `specs/payments/events.json`.
- `specs/network/chains.json`.
- `specs/schemas/payment.json`.
- The relevant payment and webhook package implementations.

This document transcribes the implementation as of 2026-11-14. If this
document conflicts with the running implementation or an authoritative
specification, **the code wins**. Stop and report the discrepancy. Do not
silently guess which one is correct, and do not attempt to patch the backend
to match this document without a separately reviewed change.

---

## 14. Implementation Completion Report

When the frontend agent finishes, it should report:

1. The chosen frontend stack and why it fits the demo.
2. The files created or changed.
3. The BFF routes implemented.
4. How server-side credentials are protected.
5. Which payment journey steps were tested end-to-end.
6. Which error and lifecycle states were tested.
7. Whether webhook delivery was demonstrated live or conceptually.
8. Build, typecheck, lint, and test results.
9. Any discrepancies found between this contract and the actual LumiBase API.

---

*This document defines the integration boundary. It deliberately leaves visual design and user experience decisions to the frontend agent.*
