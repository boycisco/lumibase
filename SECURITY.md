# Security Policy

Security is especially important for infrastructure that handles payment creation and transaction verification.

We appreciate responsible reports that help keep LumiBase and its users safe.

## Supported Versions

LumiBase is currently in its early development stage.

Security fixes are primarily developed against the latest maintained version. No long-term support or backport policy is currently guaranteed.

| Version | Security updates |
|---|---|
| Latest release | Intended |
| Older releases | Not guaranteed |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues or discussions.**

Use GitHub's Private Vulnerability Reporting feature if it is enabled for this repository. Open the repository's **Security** tab and select **Report a vulnerability**.

If private vulnerability reporting is unavailable, contact the maintainers through a private channel listed in the repository's GitHub profile or organization. Do not publish exploit details while seeking a reporting channel.

Please include as much of the following information as possible:

- A clear description of the vulnerability.
- The affected package, component, or version.
- Steps to reproduce the issue.
- Potential impact and attack scenarios.
- Relevant logs, proof-of-concept code, or screenshots, with secrets and personal data removed.
- Any suggested mitigation.

The maintainers will review the report and coordinate any necessary investigation, fixes, and disclosure.

Please allow maintainers reasonable time to investigate and address a report before publicly disclosing it.

## Security-Critical Areas

The following areas are particularly important to LumiBase:

### Independent Payment Verification

The API must independently retrieve and validate blockchain transaction data. A client-submitted transaction hash is a reference for verification, not proof that a payment succeeded.

### Payment Integrity

Payment verification must validate the relevant chain, token, recipient, amount, transaction status, and transfer evidence before determining the payment outcome.

### Secret Management

Application credentials, API secrets, database credentials, and webhook secrets must remain server-side. They must not be exposed to browser code or committed to the repository.

### Webhook Security

Webhook delivery must account for server-side request forgery (SSRF), unsafe destinations, redirects, and other risks associated with making outbound HTTP requests.

### Database and Transaction Safety

Payment state transitions, idempotency, and event delivery must preserve consistency and prevent duplicate or conflicting processing.

## Scope

Please report vulnerabilities that affect LumiBase itself, its packages, its API, its reference demo, or its documented security boundaries.

Issues in third-party services or dependencies should be reported to their respective maintainers when they do not result from LumiBase's integration or configuration.

Thank you for helping protect the LumiBase project and its users.