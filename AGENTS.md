# SearchForge — agent notes

## Backend verification commands

Run from `backend/`:

- `npm run typecheck` — `tsc --noEmit -p tsconfig.check.json` (src + tests + scripts)
- `npm run build` — `tsc -p tsconfig.json` (src only → dist/)
- `npm run lint` — `oxlint`
- `npm test` — vitest; tests use `mongodb-memory-server`, no Docker needed

## Frontend verification commands

Run from `frontend/`:

- `npx tsc --noEmit` — typecheck (no `typecheck` script defined)
- `npm run lint` — eslint
- `npm run build` — `next build` (Turbopack, production)
- `npm test` — vitest (pure TS unit tests, `src/**/*.test.ts`)

## Frontend stack notes

- Next.js 16 App Router + Tailwind CSS 4; shadcn CLI v4 with **Base UI**
  primitives (`@base-ui/react`), style `base-nova`, base color Neutral
  (see `frontend/components.json`).
- `cn` is re-exported from `src/lib/utils.ts`; it wraps the `cn` package,
  not `clsx`/`tailwind-merge`.
- In `globals.css` (`@theme inline`), `--font-sans`/`--font-heading` must
  reference `var(--font-geist-sans)` — `layout.tsx` exposes only
  `--font-geist-sans`/`--font-geist-mono` via next/font. A literal
  `var(--font-sans)` is self-referential and silently breaks `font-sans`.
- `shadcn` is a **runtime dependency**: `globals.css` imports
  `shadcn/tailwind.css`. Its transitive `ts-morph → minimatch` chain is the
  source of the 4 moderate `npm audit --omit=dev` findings (dev-tooling
  only, no JS is bundled; the only fix — downgrading `shadcn` — is
  breaking, so it is deliberately deferred).
- Design tokens live in `frontend/src/app/globals.css` (`:root` + `.dark`);
  shared components in `src/components/shared/`, motion tokens in
  `src/lib/motion.ts`.
- `frontend/AGENTS.md` is auto-managed by `next dev` — do not edit/remove it.

### Frontend authentication (M6.9)

The browser holds only an **opaque session id** in the `sf_session`
cookie (HttpOnly, SameSite=Lax, Secure in prod, 7d). JWTs never reach
client JavaScript: tokens live in a server-side store (`globalThis` map
in `src/lib/session.ts`) keyed by that id. Per-user refresh is
single-flighted in the data layer — this avoids both the
can't-Set-Cookie-in-RSC problem and the backend's concurrent-rotation
tombstone. Store is in-memory: restart = everyone logs in again (fail
closed).

- `src/lib/session.ts` — store, `getSession`, `getSessionAccessToken`
  (lazy refresh), `requireSession` (guard → `/login?next=`), cookie
  create/destroy, `sanitizeNextPath` (open-redirect guard)
- `src/lib/api/authorized.ts` — `authorizedJson` attaches the **user's**
  Bearer token (401 → one forced refresh + retry)
- `src/lib/api/auth.ts` — backend `/auth/*` endpoint calls
- `src/lib/actions/auth.ts` — server actions `login/register/logout`
- `src/app/(auth)/` — login + register pages (useActionState forms)
- `src/lib/api/client.ts` — primitives + `serviceJson` (**internal
  server-to-server only** — never for user-facing routes)

Identity reaches Express as the user's own access token — the backend
`authenticate` middleware resolves the real user, so authorization is
enforced server-side. Authorization model: shared index — any
authenticated user may search/read all documents (documented
limitation; `authorize(roles)` exists for future RBAC). Protected
pages call `requireSession`; `/login` & `/register` redirect to `next`
when already authed.

Required server-only env vars (see `frontend/.env.example`):
`SEARCH_API_URL` (backend base URL), `SEARCH_API_EMAIL` /
`SEARCH_API_PASSWORD` (service account — internal ops only).

Backend search contract: `q?` (empty → match_all newest-first), `page`,
`limit` ≤ 50, plus `category`/`source`/`technology`/`contentType` filters
(strict schema — unknown params are rejected). Response envelope:
`{ success, data: { results[], pagination } }`; errors:
`{ success:false, error:{ code, message, details? } }`. Highlights contain
raw `<mark>` tags — render only via `src/lib/highlight.ts`
(`highlightToHtml`), never raw `dangerouslySetInnerHTML`.

Document pages: `GET /api/v1/documents/:id` (same auth) returns
`{ success, data: { document } }`. The search hit `id` is the MongoDB
`_id` (ES doc id strategy in `indexing.service.ts`), so result cards link
straight to `/documents/[id]?from=<current /search href>`. The page is a
server component fetching via `getDocumentById` in
`src/lib/api/documents.ts` (React `cache`-deduped with
`generateMetadata`). ID is validated as 24-hex before fetching;
`from` is whitelisted to `/search*` by `sanitizeReturnPath` and external
URLs pass `safeHttpUrl` (http/https only) — all in `src/lib/documents.ts`.
Document `content` is plain text — rendered as text only, never HTML.

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
