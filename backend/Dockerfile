# syntax=docker/dockerfile:1

# ---------- deps: install all dependencies (incl. dev) for the build ----------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build: compile TypeScript -> dist/ ----------
FROM deps AS build
COPY tsconfig.json tsconfig.check.json ./
COPY src ./src
RUN npm run build

# ---------- prod-deps: production node_modules + tsx for maintenance scripts --
FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save tsx@4.23.15 && npm cache clean --force

# ---------- runtime ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY --from=build /app/dist ./dist
# TS sources + scripts kept so maintenance jobs run inside the container:
#   docker compose exec backend npx tsx scripts/seed-corpus.ts
#   docker compose exec backend npm run setup:es
COPY src ./src
COPY scripts ./scripts

USER app
EXPOSE 5000
CMD ["node", "dist/server.js"]
