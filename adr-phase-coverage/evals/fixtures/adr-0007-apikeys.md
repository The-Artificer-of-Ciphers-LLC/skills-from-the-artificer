# ADR-0007 — Self-service API key management

- **Status:** Accepted
- **Date:** 2026-02-10

## Context

Today API keys are provisioned manually by support. We want users to manage their own keys.

## Decisions

- **D1 — Key storage model.** Keys are stored as salted SHA-256 hashes; the plaintext is shown once
  at creation and never again.
- **D2 — Scopes.** Each key carries a scope set (read, write, admin) enforced at the auth middleware.
- **D3 — Rotation semantics.** Rotating a key issues a new secret and keeps the old one valid for a
  24h grace window, then revokes it.
- **D4 — Audit log.** Every create/rotate/revoke writes an immutable audit record.
- **D5 — Rate limiting.** Key management endpoints are rate-limited per account.

## User stories

- A user can **create, rotate, and revoke** their own API keys from the account dashboard.
- A user can see the **last-used time** and scope of each key in the dashboard.

## Consequences

The auth middleware (D2) becomes the single enforcement point. The dashboard gains a "API keys"
section. Support no longer provisions keys manually.
