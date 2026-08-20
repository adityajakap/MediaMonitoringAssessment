# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable pnpm

# Copy dependency manifests first (layer cache)
COPY package.json pnpm-lock.yaml ./

# Install ALL deps (including devDependencies needed for tsc)
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/
COPY migrations/ ./migrations/

# Compile TypeScript
RUN pnpm exec tsc --outDir dist --noEmit false

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable pnpm

# Copy dependency manifests
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy compiled JS from builder
COPY --from=builder /app/dist ./dist

# Copy static dashboard
COPY public/ ./public/

# Copy migration files (needed if we run migrate inside the container)
COPY migrations/ ./migrations/

EXPOSE 3000

CMD ["node", "dist/index.js"]
