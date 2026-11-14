'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Lock,
  ShieldAlert,
  Webhook,
} from 'lucide-react';
import {
  PAYMENT_LIFECYCLE_SPECS,
  VERIFICATION_OUTCOME_SPECS,
} from '@/lib/lumibase/constants';

const SAMPLE_WEBHOOK_BODY = JSON.stringify(
  {
    id: '9e2e2d24-6d44-4a34-9c4b-111122223333',
    type: 'payment.confirmed',
    createdAt: '2026-11-14T12:35:12.345Z',
    data: {
      payment: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        amount: '1500000',
        chainId: 84532,
        token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        status: 'confirmed',
      },
      transaction: {
        hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        blockNumber: '12345678',
      },
    },
  },
  null,
  2,
);

function hexFromBuffer(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function computeHmacSha256Hex(
  secret: string,
  payload: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return hexFromBuffer(sig);
}

function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function DeveloperReference() {
  const [signingSecret, setSigningSecret] = useState(
    'whsec_demo_local_verifier_example',
  );
  const [rawBody, setRawBody] = useState(SAMPLE_WEBHOOK_BODY);
  const [timestampInput, setTimestampInput] = useState(() =>
    String(Math.floor(Date.now() / 1000)),
  );
  const [signatureHex, setSignatureHex] = useState('');
  const [verifyResult, setVerifyResult] = useState<{
    validSignature: boolean;
    withinReplayWindow: boolean;
    expectedHex: string;
    ageSeconds: number;
  } | null>(null);

  const handleSignSample = async () => {
    const nowUnix = String(Math.floor(Date.now() / 1000));
    setTimestampInput(nowUnix);
    const hex = await computeHmacSha256Hex(
      signingSecret,
      `${nowUnix}.${rawBody}`,
    );
    setSignatureHex(hex);
    setVerifyResult({
      validSignature: true,
      withinReplayWindow: true,
      expectedHex: hex,
      ageSeconds: 0,
    });
  };

  const handleVerifySample = async () => {
    const expectedHex = await computeHmacSha256Hex(
      signingSecret,
      `${timestampInput}.${rawBody}`,
    );
    const normalizedInput = signatureHex.trim().toLowerCase();
    const validSignature = constantTimeHexEqual(normalizedInput, expectedHex);
    const parsedTs = Number(timestampInput);
    const nowUnix = Math.floor(Date.now() / 1000);
    const ageSeconds = Number.isFinite(parsedTs)
      ? Math.abs(nowUnix - parsedTs)
      : Number.POSITIVE_INFINITY;
    const withinReplayWindow = ageSeconds <= 300;
    setVerifyResult({
      validSignature,
      withinReplayWindow,
      expectedHex,
      ageSeconds,
    });
  };

  const verificationRows = Object.values(VERIFICATION_OUTCOME_SPECS);

  return (
    <div className="mt-16 space-y-16 border-t border-slate-200 pt-14">
      <section id="lifecycle" className="scroll-mt-24 space-y-8">
        <div className="max-w-3xl space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            01. Authoritative Payment Lifecycle and Verification Matrix
          </h2>
          <p className="text-sm leading-relaxed text-slate-600">
            LumiBase exposes a strict finite state machine. Confirmation
            requests may return HTTP 200 with a non-null verification outcome in
            the body, so clients always inspect{' '}
            <code className="font-mono text-xs text-slate-800">
              payment.status
            </code>{' '}
            before{' '}
            <code className="font-mono text-xs text-slate-800">error</code>.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Terminal</th>
                <th className="px-4 py-3">Authoritative Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {PAYMENT_LIFECYCLE_SPECS.map((item) => (
                <tr key={item.status} className="hover:bg-slate-50/70">
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                    {item.status}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-medium text-slate-700 whitespace-nowrap">
                    {item.terminal ? 'Yes (Stop polling)' : 'No (Poll status)'}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {item.meaning}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="px-4 py-3">Verification Outcome Code</th>
                <th className="px-4 py-3">Retry Same Hash</th>
                <th className="px-4 py-3">Meaning &amp; Client Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {verificationRows.map((row) => (
                <tr key={row.code} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                    {row.code}
                  </td>
                  <td className="px-4 py-3 text-xs font-medium whitespace-nowrap">
                    {row.action === 'retry_same_hash' ? (
                      <span className="text-emerald-700">
                        Yes — safe to retry
                      </span>
                    ) : row.action === 'poll_status' ? (
                      <span className="text-blue-700">
                        Poll status endpoint
                      </span>
                    ) : (
                      <span className="text-red-700">No — do not retry</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <span className="font-medium text-slate-900">
                      {row.meaning}.
                    </span>{' '}
                    {row.guidance}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="webhooks" className="scroll-mt-24 space-y-6">
        <div className="max-w-3xl space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Webhook className="h-4 w-4 text-slate-700" aria-hidden="true" />
            <span>Conceptual &amp; Local Signature Verification Utility</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            02. Outbound Webhook Signature Verifier &amp; SSRF Policy
          </h2>
          <p className="text-sm leading-relaxed text-slate-600">
            LumiBase&apos;s background worker enforces SSRF protection and
            rejects loopback or private-network destinations, so a receiver at{' '}
            <code className="font-mono text-xs text-slate-800">localhost</code>{' '}
            cannot receive live worker deliveries. A live webhook delivery test
            requires a public HTTPS endpoint or tunnel. Use this local Web
            Crypto utility to inspect how receivers verify{' '}
            <code className="font-mono text-xs text-slate-800">
              X-LumiBase-Signature
            </code>{' '}
            without altering SSRF rules.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 rounded-xl border border-slate-200 bg-white p-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-7">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  Sample Signing Secret (Local Test Only)
                </span>
                <input
                  type="text"
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  Header Timestamp t (Unix Seconds)
                </span>
                <input
                  type="text"
                  value={timestampInput}
                  onChange={(e) => setTimestampInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </label>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">
                Raw Request Body (Exact Bytes Signed)
              </span>
              <textarea
                rows={7}
                value={rawBody}
                onChange={(e) => setRawBody(e.target.value)}
                className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </label>
          </div>

          <div className="flex flex-col justify-between space-y-4 border-t border-slate-200 pt-4 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  v1 HMAC-SHA256 Hex Digest
                </span>
                <input
                  type="text"
                  value={signatureHex}
                  onChange={(e) => setSignatureHex(e.target.value)}
                  placeholder="Click Generate Sample Signature or paste 64-char hex"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </label>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700 break-all">
                X-LumiBase-Signature: t={timestampInput || '<unix>'},v1=
                {signatureHex || '<64-char-hmac-sha256>'}
              </div>

              {verifyResult && (
                <div
                  className={`rounded-lg border p-3 text-xs space-y-1 ${
                    verifyResult.validSignature &&
                    verifyResult.withinReplayWindow
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-red-200 bg-red-50 text-red-900'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      {verifyResult.validSignature
                        ? 'HMAC-SHA256 Signature Matched'
                        : 'Signature Mismatch'}
                    </span>
                  </div>
                  <div className="font-mono tabular-nums">
                    Replay window (|now - t| &le; 300s):{' '}
                    {verifyResult.withinReplayWindow
                      ? `Pass (${verifyResult.ageSeconds}s delta)`
                      : `Expired (${verifyResult.ageSeconds}s delta)`}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleSignSample()}
                className="min-h-[40px] rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                Generate Sample Signature
              </button>
              <button
                type="button"
                onClick={() => void handleVerifySample()}
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                Verify Header &amp; Replay Window
              </button>
            </div>
          </div>
        </div>
      </section>

      <section id="security" className="scroll-mt-24 space-y-6 pb-8">
        <div className="max-w-3xl space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            03. Architecture Boundary and v0.1 Limitations
          </h2>
          <p className="text-sm leading-relaxed text-slate-600">
            All browser traffic goes exclusively through same-origin{' '}
            <code className="font-mono text-xs text-slate-800">/demo/*</code>{' '}
            endpoints. LumiBase credentials never enter the client bundle.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Lock className="h-4 w-4 text-blue-600" aria-hidden="true" />
              <span>Server-Side BFF Isolation</span>
            </div>
            <ul className="space-y-2.5 text-sm text-slate-600">
              <li className="flex items-start gap-2">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                <span>
                  <code className="font-mono text-xs text-slate-800">
                    API_SECRET
                  </code>{' '}
                  is read only on server bootstrap to call{' '}
                  <code className="font-mono text-xs text-slate-800">
                    POST /api/v1/applications
                  </code>{' '}
                  with <code className="font-mono text-xs text-slate-800">Authorization: Admin</code>.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                <span>
                  The one-time application API key lives strictly in server
                  process memory and is never logged, written to disk, or
                  returned to the browser.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                <span>
                  Recipient address, chain ID (<span className="font-mono">84532</span>), and
                  USDC token contract are enforced server-side from{' '}
                  <code className="font-mono text-xs text-slate-800">
                    DEMO_RECIPIENT
                  </code>.
                </span>
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="text-sm font-semibold text-slate-900">
              Documented v0.1 Scope Constraints
            </div>
            <ul className="space-y-2 text-sm text-slate-600 list-disc pl-5">
              <li>Base Sepolia only (Base Mainnet 8453 is disabled).</li>
              <li>
                No direct browser-to-LumiBase CORS access; all requests proxy
                through the same-origin BFF.
              </li>
              <li>
                Underpaid and overpaid are terminal states in v0.1 with no
                automatic top-up or refund flow.
              </li>
              <li>
                Restarting the demo server provisions a new in-memory
                application key, orphaning prior in-flight demo payments.
              </li>
              <li>
                <code className="font-mono text-xs text-slate-800">failed</code>{' '}
                status is reserved for future use and not emitted in v0.1.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
