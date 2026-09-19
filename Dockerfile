#syntax=docker/dockerfile:1

# Build stage: compiles the SvelteKit app and better-sqlite3's native
# addon for the target platform. python3/make/g++ are a fallback for
# platforms without a prebuilt better-sqlite3 binary (e.g. new arm64
# Node ABIs) — a slower source build here is fine; it must not fail.
FROM node:25-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
		python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

# Runtime stage: no build toolchain, non-root user, only what's needed to
# run the built app.
# ORIGIN is intentionally not baked in. It must match the operator's URL.
# BODY_SIZE_LIMIT is adapter-node's own request-body cap. It must stay above
# MAX_ARCHIVE_BYTES (256 MiB, src/lib/server/backup/archive.ts) so a restore
# upload is never rejected at the transport layer before our own archive-size
# check even runs; 10 MB attachment uploads are far under this, so it does
# not weaken that limit.
FROM node:25-bookworm-slim AS runtime
ENV NODE_ENV=production \
	PORT=3000 \
	LIFEADMIN_DATA_DIR=/data \
	TZ=Europe/Berlin \
	BODY_SIZE_LIMIT=280M
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./package.json
COPY playbooks ./playbooks

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build"]
