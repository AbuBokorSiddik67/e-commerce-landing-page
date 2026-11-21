# Prisma's native engine needs a trusted connection to binaries.prisma.sh at
# build time. No database or production secret is needed while building.
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    NEXT_TELEMETRY_DISABLED=1
# The public origin is baked into the Next.js build. Never put secrets here.
RUN test -n "$NEXT_PUBLIC_SITE_URL" && mkdir -p public && npm run build

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
# Retain the CLI and seed sources for an explicit, one-time bootstrap. They are
# never run automatically on container startup.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src/lib ./src/lib
RUN mkdir -p storage/uploads public/uploads .next/cache \
    && chown -R node:node storage/uploads public/uploads .next/cache
USER node
EXPOSE 3000
CMD ["npm", "start"]
