# Deployment

Compose stacks living here:

| File | Purpose |
|---|---|
| `docker-compose.yml` | Local dev datastores only (ES, Mongo, Redis, Kibana) — apps run via `npm run dev` |
| `docker-compose.prod.yml` | Full stack for a single VM — ES, Mongo, Redis, backend, frontend, Caddy |
| `docker-compose.web.yml` | Two-VM split — web tier (Caddy + frontend) on the public VM |
| `docker-compose.api.yml` | Two-VM split — API tier (backend + Redis) on the private VM |

## Two-VM split (Oracle Always Free, `VM.Standard.E2.1.Micro`)

```
internet ──HTTPS──> VM-web: Caddy :443 ──> frontend :3000
                            │ SEARCH_API_URL / REDIS_URL over VCN private net
                            ▼
                     VM-api: backend :5000, redis :6379 (private IP only)
                            │────> Elastic Cloud (managed ES, API key)
                            └────> MongoDB Atlas M0
```

- `VM-web` (`VM.Standard.E2.1.Micro`, public IP): Caddy + frontend only.
- `VM-api` (same shape, **no public IP**): backend + Redis, reachable only
  inside the VCN — `TRUST_PROXY` is set to the web VM's private IP, and the
  frontend forwards `X-Forwarded-For` so rate limiting still keys on real
  client IPs.
- Datastores are external managed services: Elastic Cloud (`ELASTICSEARCH_URL`
  + scoped API key) and MongoDB Atlas (`MONGODB_URI`).

Deploy order (each VM needs Docker + a 2GB swap file — 1GB RAM is tight):

```bash
# both VMs
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# VM-api first
git clone <repo> && cd searchforge/infrastructure
cp .env.api.example .env.api    # fill DOMAIN, MONGODB_URI, ELASTICSEARCH_URL, secrets
docker compose -f docker-compose.api.yml --env-file .env.api up -d --build

# then VM-web
git clone <repo> && cd searchforge/infrastructure
cp .env.web.example .env.web    # fill DOMAIN, API_VM_IP, REDIS_PASSWORD
docker compose -f docker-compose.web.yml --env-file .env.web up -d --build

# seed from VM-api (datastores + scripts live there)
docker compose -f docker-compose.api.yml --env-file .env.api \
  exec backend npx tsx scripts/seed-corpus.ts
docker compose -f docker-compose.api.yml --env-file .env.api \
  exec backend npx tsx scripts/backfill-chunks.ts
```

Firewall: VM-web needs public ingress 80/443 (OCI security list +
`firewall-cmd`); VM-api needs nothing public — the default security list
already allows VCN-internal traffic to :5000/:6379, but open them on the
OS firewall: `sudo firewall-cmd --permanent --add-port=5000/tcp --add-port=6379/tcp && sudo firewall-cmd --reload`.

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
