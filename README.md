# Tiny-Web

Full-stack TypeScript app — React frontend + Bun backend, single service.

## Stack

- Frontend: React + rsbuild
- Backend: Bun
- Storage: JSONL file driver

## Quick start

```bash
npm install -g bun
bun install
cp .env.example .env
bun run serve
```

Server runs at http://localhost:3300.

## Scripts

- `bun run dev` — start frontend dev server (hot reload)
- `bun run build` — build frontend into `dist/`
- `bun run serve` — run backend (serves API + built static files)
- `bun run reset` — wipe `data/` and run backend

## Layout

```
server/      backend (Bun.serve + modules)
client/      React frontend
shared/      types & route contracts shared by client/server
data/        JSONL persistence (gitignored)
```
