# Deployment

Two compose stacks live here:

| File | Purpose |
|---|---|
| `docker-compose.yml` | Local dev datastores only (ES, Mongo, Redis, Kibana) — apps run via `npm run dev` |
| `docker-compose.prod.yml` | Full stack for a single VM — ES, Mongo, Redis, backend, frontend, Caddy |

## Production topology

```
internet ──HTTPS──> Caddy :443 ──> frontend :3000 ──> backend :5000 ──> ES/Mongo/Redis
                     (TLS, auto certs)     (internal network only — no public ports)
```

Only ports 80/443 are published. The backend is unreachable from the public
internet: browsers talk only to the Next.js server, which calls the API over
the internal docker network.

## VM requirements

- ~4GB+ RAM (ES heap is set to 2GB), ~20GB disk, Docker + Compose plugin
- Tested target: Oracle Cloud Always Free `VM.Standard.A1.Flex` (ARM64)
- A DNS name pointing at the VM (a free DuckDNS subdomain works — Caddy
  gets a real Let's Encrypt cert for it)
- Oracle security list + Ubuntu firewall: allow inbound 80/tcp and 443/tcp

## First deploy

```bash
# on the VM
git clone <repo> && cd searchforge/infrastructure
cp .env.production.example .env.production   # fill DOMAIN + secrets
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# once Elasticsearch is healthy, scope down app access (replaces superuser):
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec backend npx tsx scripts/setup-es-app-user.ts
# -> paste the printed key into .env.production as ELASTICSEARCH_API_KEY,
#    then `up -d` again so the backend picks it up

# seed + build the corpus
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec backend npx tsx scripts/seed-corpus.ts
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec backend npx tsx scripts/backfill-chunks.ts
```

## Updates

```bash
git pull && docker compose -f docker-compose.prod.yml \
  --env-file .env.production up -d --build
```

## Operational notes

- **Healthchecks**: every service has one; `docker compose ps` shows status.
  Backend health: `/api/v1/health`.
- **Rate limiting**: `TRUST_PROXY=1` is set because Caddy is the single proxy
  hop — do not change this unless the proxy topology changes.
- **Logs**: `docker compose -f docker-compose.prod.yml logs -f backend`
- **Backups**: `elasticsearch_data`, `mongodb_data`, `redis_data` are named
  volumes under `/var/lib/docker/volumes/` — snapshot them with the VM's
  block-volume backup if you care about the corpus; it can always be
  re-seeded otherwise.
- **Maintenance scripts** (`seed-corpus`, `backfill-chunks`, `backfill-vectors`,
  `reindex-documents`) all run inside the backend container via
  `docker compose exec backend npx tsx scripts/<name>.ts`.
