# SearchForge

A technical documentation search engine with grounded RAG answers. Docs are
crawled from public sources, stored canonically in MongoDB, and projected into
Elasticsearch where they are indexed both as whole documents and as
structure-aware chunks. Retrieval supports four modes — keyword (BM25),
semantic (kNN over dense vectors), hybrid (reciprocal rank fusion), and
passage-level search over the chunk index — and an `/ask` endpoint answers
questions with citations validated against the retrieved passages.

## Architecture

```
searchforge/
  backend/    Express 5 + TypeScript API
  frontend/   Next.js 16 App Router UI
  infrastructure/
    docker-compose.yml   Elasticsearch, MongoDB, Redis, Kibana
```

Data flow: crawler → MongoDB (canonical store) → Elasticsearch projections
(document index + chunk index). Embeddings come from Voyage AI via an
OpenAI-compatible adapter behind a provider seam, so the engine can also run
with embeddings disabled (lexical modes only). RAG answers go through the
same pattern: an `LlmProvider` seam with Anthropic and Gemini adapters,
fail-closed when no provider is configured.

Auth: users register/login against the backend (JWT access + rotating
refresh-token families); the frontend keeps only an opaque session cookie —
tokens live server-side in a Redis-backed session store.

## Features

- **Keyword / semantic / hybrid / passage retrieval** — app-level RRF since
  native `rrf` requires an Enterprise license
- **Structure-aware chunking** — ATX-heading splits, atomic code fences,
  heading-context-enriched embeddings; chunks are rebuildable ES data
- **Grounded answers** — bounded context, citation refs verified against the
  retrieved set server-side, `insufficient_evidence` without an LLM call
- **Controlled crawler** — SSRF-safe fetching (allowed domains, content-type
  and size limits), Turndown extraction, robots.txt aware
- **Relevance evaluation** — curated judgment sets, P/R/F1/MRR/nDCG at K
- **Per-user sessions** — Redis-backed, single-flight refresh, HttpOnly cookie

## Quickstart

```bash
docker compose -f infrastructure/docker-compose.yml up -d   # ES, Mongo, Redis
cp .env.example .env          # backend env
cp frontend/.env.example frontend/.env.local
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

Optional: `npm run setup:es` (backend) creates a scoped Elasticsearch
application API key — prefer it over the `elastic` superuser outside dev.

Corpus scripts (run from `backend/`):

```bash
npx tsx scripts/seed-corpus.ts         # ingest curated real documentation
npx tsx scripts/backfill-chunks.ts     # build/refresh the chunk index
npx tsx scripts/backfill-vectors.ts    # re-embed stale document vectors
npx tsx scripts/reindex-documents.ts   # versioned index rebuild + alias swap
```

## Development

Backend (from `backend/`):

- `npm run typecheck` — `tsc --noEmit -p tsconfig.check.json` (src + tests + scripts)
- `npm run build` — `tsc -p tsconfig.json` (src only → dist/)
- `npm run lint` — `oxlint`
- `npm test` — vitest; `mongodb-memory-server`, no Docker needed

Frontend (from `frontend/`): `npm run typecheck`, `npm run lint`,
`npm test`, `npm run build`.

## Security notes

- **Proxy trust**: rate limiting keys on `req.ip`, so proxy topology is
  declared explicitly via `TRUST_PROXY`. Unset/`false` (default): no proxy
  trusted, `X-Forwarded-For` ignored. `N`: trust only the N closest hops.
  `TRUST_PROXY=true` is rejected at env validation — it would let clients
  spoof IPs to evade rate limits. Behind a single reverse proxy, use
  `TRUST_PROXY=1`.
- **Refresh tokens** rotate within a family; reuse of a revoked token writes
  a durable tombstone and revokes the whole family.
- **Passwords**: bcrypt cost 12, input capped at 72 UTF-8 bytes (bcrypt's
  silent truncation limit).
- Highlight HTML is sanitized before rendering; document content renders as
  text only. The session cookie stores an opaque id — access/refresh tokens
  never reach the browser.

## Dependency audit note

`npm audit --omit=dev` reports zero vulnerabilities. The dev toolchain has
known findings in `vitest → vite → picomatch` (ReDoS in glob parsing during
test discovery only — not reachable at runtime). `npm audit fix --force`
would downgrade vitest to 3.x, so it is deliberately not applied.
