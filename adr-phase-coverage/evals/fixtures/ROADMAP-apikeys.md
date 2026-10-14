# Roadmap — API key management (draft, for review)

### Phase 1: Storage + scopes
**Goal:** key data model and enforcement.
**Owns:** D1, D2
**Success criteria:**
- Keys persist as salted SHA-256 hashes; plaintext returned once at creation.
- Auth middleware rejects requests whose key lacks the required scope.

### Phase 2: Rotation + audit (backend)
**Goal:** lifecycle service + audit trail.
**Owns:** D3, D4
**Success criteria:**
- `rotateKey()` / `revokeKey()` service functions implemented and unit-tested.
- 24h grace window enforced; create/rotate/revoke each write an audit record.
**Notes:** the dashboard "API keys" screen where users actually create/rotate/revoke is handled in
Phase 3 (polish).

### Phase 3: Polish
**Goal:** rate limiting and hardening.
**Owns:** D5
**Success criteria:**
- Management endpoints are rate-limited per account.
- Load test passes at target RPS.
