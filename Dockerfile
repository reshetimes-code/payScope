# Production image for Cloud Run (spec §32 — hosting PAY SCOPE itself, not
# a client site). node:20-slim (Debian glibc), not alpine — Prisma's query
# engine binaries are far less prone to musl-libc mismatches on glibc, and
# this stays consistent between the build and run stage since both use the
# same base image.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
# Must be installed BEFORE `prisma generate` — without it Prisma can't
# detect the real openssl version here either, so it silently generates the
# query engine for the wrong one (openssl-1.1.x) while the runner stage
# below (which does have openssl) correctly detects openssl-3.0.x at
# request time, and the two mismatch: "Prisma Client could not locate the
# Query Engine for runtime debian-openssl-3.0.x". Builder and runner must
# agree on this or every DB query fails.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma Client is generated from schema.prisma at build time — needed
# before `next build` traces/bundles it into the standalone output.
RUN npx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# node:20-slim ships libssl but not the `openssl` CLI, so Prisma's engine
# can't detect the exact version and silently guesses — seen as a
# "Prisma failed to detect the libssl/openssl version" warning in the
# migration job logs. Installing it removes the guesswork for every query
# the live app makes, not just the one-off migration run.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
# output: 'standalone' (next.config.mjs) traces only the files each page
# actually needs, so the image doesn't ship the full node_modules tree.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
EXPOSE 8080
CMD ["node", "server.js"]
