# Contributing to LumiBase

Thank you for your interest in contributing to LumiBase.

LumiBase is an open-source, language-agnostic developer toolkit for building on Base. Payments are the first capability, and contributions that improve the existing implementation, developer experience, documentation, or language compatibility are welcome.

## Before You Start

- Check existing issues and pull requests before starting significant work.
- For substantial changes, open an issue first to discuss the proposed approach.
- Keep changes focused and avoid unrelated refactoring.
- Do not introduce breaking changes to public specifications or API behavior without discussing them first.

## Development Environment

LumiBase is a TypeScript monorepo managed with pnpm and Turborepo.

### Prerequisites

- Node.js 20 or later.
- pnpm 9.
- Docker, for local infrastructure required by the project.

Use the package manager version specified by the repository's `package.json` or workspace configuration.

### Setup

```bash
# Clone the repository
git clone https://github.com/boycisco/lumibase.git
cd lumibase

# Install dependencies
pnpm install

# Start local infrastructure
docker compose up -d --wait

# Build the project
pnpm build
```

Some applications and integration tests may require additional environment variables. Check the relevant application README and environment example files before running them.

## Testing and Quality Checks

Run the repository's test suite:

```bash
pnpm test
```

Before submitting a pull request, run the applicable checks:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
```

These commands assume the corresponding scripts are available in the current repository. If a script is not defined, use the relevant package-level command instead.

When changing payment logic, transaction verification, API behavior, or protocol specifications, include tests covering both successful and unsuccessful cases.

Never use real private keys or production funds in tests. Use the project's supported local or test-network configuration.

## Making Changes

- Follow the existing code style and package conventions.
- Keep payment amounts in integer base units. Do not use floating-point arithmetic for money.
- Preserve the separation between client-submitted transaction data and server-side verification.
- Keep secrets and private credentials out of browser code, logs, commits, and test fixtures.
- Update relevant documentation when changing public behavior.
- Add or update conformance fixtures when changing language-independent specifications.

## Language Implementations

LumiBase is designed to support implementations beyond TypeScript.

If you are proposing a Python, Rust, or another language implementation, start a discussion before beginning substantial work. Implementations should follow the authoritative specifications in `specs/` and use the available conformance fixtures and validators.

Do not assume that reproducing the TypeScript implementation's internal architecture is required. Compatibility with the published protocol and behavior is what matters.

## Pull Requests

1. Create a focused branch for your changes.
2. Make your changes and add appropriate tests.
3. Run the relevant quality checks.
4. Update documentation where necessary.
5. Submit a pull request using the repository's pull request template.

A useful pull request description should explain:

- What changed.
- Why the change is needed.
- How it was tested.
- Whether it introduces breaking changes.
- Any relevant issue or discussion.

## Commit Messages

Use clear, descriptive commit messages. Conventional Commit-style messages are encouraged:

```text
feat(payments): add payment expiration handling
fix(api): validate application credentials
docs: improve installation instructions
test(network): cover transfer log parsing
```

## Questions and Discussions

For usage questions, feature proposals, or architectural discussions, use the repository's available GitHub discussion or issue channels.

For security vulnerabilities, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

Thank you for helping make LumiBase better.