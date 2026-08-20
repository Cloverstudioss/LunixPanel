# LunixPanel — QyroCloud by Clover Studios

Fast Pterodactyl replica. Hono TypeScript API + React Vite SPA. Postgres + Drizzle. Wings 100% compatible. Proxmox via API token (read + actions). Luxd daemon planned.

Paid-only: admins create users manually and assign game servers / VPS (custom resources). Public Request Access -> admin approve. Expiry + 3-day grace + auto-suspend.

## Dev

```bash
cp .env.example .env   # set ENCRYPTION_KEY (64 hex)
docker compose up -d postgres redis
pnpm install
pnpm --filter @lunixpanel/api db:generate
pnpm --filter @lunixpanel/api db:migrate
pnpm dev
```

API `http://localhost:3000` (`/api/health`), Web `http://localhost:5173`.

## Branding

LunixPanel / QyroCloud / Clover Studios — see health endpoint and web title/footer.
