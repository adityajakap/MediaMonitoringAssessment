# Media Monitoring API

## Quick start (local development)

### Prerequisites
- Node.js ≥ 20
- pnpm (`npm install -g pnpm`)
- Docker + Docker Compose (for the database)

### 1 — Start the database

```bash
docker compose up -d          # pulls postgres:16, starts in background
# The healthcheck (pg_isready) confirms it's ready before your app connects.
```

### 2 — Configure environment

```bash
cp .env.example .env
# The defaults already match the docker-compose.yml credentials — no edits needed.
```

### 3 — Install dependencies

```bash
pnpm install
```

### 4 — Apply the schema

```bash
pnpm migrate                  # runs migrations/sql/*.sql in order
```

### 5 — Start the dev server

```bash
pnpm dev                      # tsx watch — hot-reloads on file changes
```

Verify the server is up:

```bash
curl http://localhost:3000/health
# {"status":"ok","database":{"connected":true},...}
```

---

### Stopping / resetting

```bash
docker compose down           # stop container (data volume persists)
docker compose down -v        # stop AND wipe all data (fresh slate)
```

> **Full README coming later** — this is the minimal run guide.
