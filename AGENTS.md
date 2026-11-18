# SearchForge — agent notes

## Backend verification commands

Run from `backend/`:

- `npm run typecheck` — `tsc --noEmit -p tsconfig.check.json` (src + tests + scripts)
- `npm run build` — `tsc -p tsconfig.json` (src only → dist/)
- `npm run lint` — `oxlint`
- `npm test` — vitest; tests use `mongodb-memory-server`, no Docker needed

## Security notes

### `trust proxy` (src/app.ts, `TRUST_PROXY` env)

Rate limiting keys on `req.ip`, so the proxy topology must be declared
explicitly via `TRUST_PROXY`:

- unset/`false` (default, local dev & direct exposure): no proxy trusted,
  `X-Forwarded-For` ignored entirely — spoofing cannot bypass rate limits;
- `N`: trust only the N hops closest to the app;
- IPs/subnets/predefined names (`loopback`, `linklocal`, `uniquelocal`),
  comma-separated: trust only those proxy addresses.

`TRUST_PROXY=true` is rejected at env validation: it would trust arbitrary
`X-Forwarded-For` and let clients spoof IPs to evade rate limiting.
Production behind a single reverse proxy should set `TRUST_PROXY=1` (or the
proxy subnet). If topology gains a second hop (e.g. CDN + ingress), update
accordingly — never trust more hops than actually exist.

### Refresh-token families

Refresh tokens rotate within a `family`. Reuse of a revoked token writes a
durable `revokedtokenfamilies` tombstone and revokes all family documents.
The tombstone is authoritative on every `/auth/refresh` call, so a token
document inserted into a dead family by a concurrent rotation can never be
used. Tombstone expiry = detection time + refresh-token TTL + 5-minute grace
(rolling expiry means the last straggler claimed before detection can expire
marginally later than detection + TTL).

### Passwords

bcrypt (cost 12). Input is capped at 72 **UTF-8 bytes** (not characters) to
match bcrypt's silent truncation limit.

## Known audit findings (dev-only, deferred)

`npm audit --omit=dev` → **0 vulnerabilities** as of 2026-11-17.

`npm audit` (all deps) reports 5 high-severity findings, all in the
development toolchain only:

- `picomatch` — ReDoS via single-branch repeated extglobs
  (GHSA-fc5q-39xc-vjpf), pulled in through
  `vitest → vite → tinyglobby → fdir → picomatch`.
- Not exploitable at runtime: affects file globbing during test discovery only.
- `npm audit fix --force` would downgrade `vitest` to 3.x (breaking change) —
  deliberately not applied. Re-check when upgrading vitest; remove this note
  once the transitive chain is patched.
