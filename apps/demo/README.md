# LumiBase v0.1 Demo Frontend and Backend-for-Frontend (BFF)

This application implements the **LumiBase v0.1 Base Sepolia USDC demo**
and its same-origin **Backend-for-Frontend (BFF)** according to the
[LumiBase Frontend Integration Contract](../../docs/demo/frontend-contract.md).

## Architecture

### Frontend

The frontend:

- Connects to EIP-1193 / EIP-6963 browser wallets.
- Enforces **Base Sepolia (`84532`)** and guides users through switching
  networks when necessary. Base Mainnet (`8453`) is disabled in v0.1.
- Submits ERC-20 `transfer(address,uint256)` transactions for Base Sepolia
  USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`) through the connected
  wallet and `viem`.
- Calls only same-origin `/demo/*` routes. It never calls the LumiBase API
  directly and never receives LumiBase credentials.
- Interprets the payment status and verification result separately.
- Polls payment status until a terminal state is reached, then stops.

### Same-origin BFF

The BFF:

- `GET /demo/config` — returns public Base Sepolia metadata and the
  server-configured recipient address.
- `POST /demo/payments` — validates the decimal USDC amount, enforces
  server-controlled recipient, chain, and token configuration, and
  forwards the payment creation request to `POST /api/v1/payments`.
- `POST /demo/payments/:id/confirm` — validates the payment ID and
  transaction hash, forwards the request to the LumiBase confirmation
  endpoint, and preserves the verification outcome.
- `GET /demo/payments/:id` — retrieves a payment.
- `GET /demo/payments/:id/status` — retrieves the persisted payment status.

The BFF must not duplicate payment creation, blockchain verification,
payment state transitions, or webhook delivery logic. The LumiBase API
remains authoritative.

## Required environment variables

The demo is a Next.js application. Create `apps/demo/.env.local` in the
demo application's directory:

```dotenv
LUMIBASE_API_URL=http://localhost:3000
API_SECRET=<same value as the API's configured API_SECRET>
DEMO_RECIPIENT=<Base Sepolia recipient address>
DEMO_PORT=4000
```

Next.js loads application environment files from the application directory.
Do not assume that variables in the monorepo root `.env` are automatically
available to the demo application.

The root `.env` is used by the API and worker. Set the Base Sepolia RPC
configuration there as required by the API:

```dotenv
BASE_SEPOLIA_RPC=https://sepolia.base.org
```

Use the RPC provider and variable name required by the actual API
configuration. Do not commit `.env` or `.env.local` files.

If required demo configuration is missing, the BFF must fail closed with
a clear configuration error. It must not substitute placeholder secrets
or recipient addresses.

### Application bootstrap and process restarts

On first request, the demo provisions a LumiBase application via
`POST /api/v1/applications` and caches the API key in process memory
via `globalThis`, so all Next.js route handlers share the same key. See
`lib/server/bootstrap.ts`.

This is essential: without `globalThis`, Next.js's per-route webpack
bundling would give each route handler its own copy of the bootstrap
state, and payments created under one route would return
`PAYMENT_NOT_FOUND` when confirmed under another.

Behavior of the current implementation:

- Application creation occurs once per Node process, not once per request.
- The application key is stored only in process memory — never on disk,
  never in logs, never sent to the browser.
- Restarting the demo process creates a new LumiBase application.
- Payments created before a restart remain in the database but are not
  accessible to the restarted demo process (the previous application key
  is lost with the process).
- Multiple route handlers within the same process share the same
  application key.

These behaviors were verified end-to-end against Base Sepolia: one
`POST /api/v1/applications` per session, and `/confirm` polls returned
HTTP 200 (not 404) across the full confirmation window. If the
implementation changes, update this section rather than assuming the
description here is authoritative.

## Commands

Run commands from the monorepo root.

```bash
# Install workspace dependencies
pnpm install

# Run demo checks
pnpm --filter @lumibase/demo typecheck
pnpm --filter @lumibase/demo lint
pnpm --filter @lumibase/demo test

# Build the demo
pnpm --filter @lumibase/demo build

# Start the demo in development mode
pnpm demo
```

The demo requires the LumiBase API to be running. In a separate terminal,
start it with:

```bash
pnpm --filter @lumibase/api dev
```

Use the actual package scripts defined in the repository. If a command
above is not present, update this README to match the verified scripts
rather than adding a misleading command.

## Verifying the payment flow

After the API and demo are running:

1. Open `http://localhost:4000` in a browser with an EVM wallet connected
   to Base Sepolia.
2. Connect the wallet and enter a USDC amount, such as `0.5`.
3. Review the payment amount, recipient, token, and network.
4. Approve the USDC transfer in the wallet.
5. Submit the resulting transaction hash to the demo.
6. Observe LumiBase independently verify the transaction.
7. Confirm that the UI displays the authoritative payment status and
   stops polling after a terminal state.

Use [BaseScan for Base Sepolia](https://sepolia.basescan.org/) to inspect
the transaction.

A successful wallet submission is not proof that LumiBase has confirmed
the payment. The UI must wait for the backend verification result.

## Security notes

- Keep `API_SECRET` and application API keys on the server.
- Never expose server credentials through `NEXT_PUBLIC_*` variables.
- Do not accept arbitrary token addresses, chain IDs, or recipient
  addresses from the browser.
- Use integer-safe USDC amount handling with six decimal places.
- Do not trust a client-submitted transaction hash as proof of payment.
- Do not weaken the API's authentication, verification, or SSRF controls
  to make local testing easier.
