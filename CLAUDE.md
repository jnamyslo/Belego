# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Everything runs in Docker. No direct `npm` on host.**

```bash
# Deploy new instance (interactive)
./deploy-instance.sh

# Quick deploy
./deploy-instance.sh <name> <db-port> <api-port> <web-port>

# Instance management
./manage-instances.sh list
./manage-instances.sh start <name>
./manage-instances.sh stop <name>
./manage-instances.sh restart <name>
./manage-instances.sh logs <name> [frontend|backend|database]
./manage-instances.sh backup <name>
./manage-instances.sh config <name>       # edit .env.backend.<name>
./manage-instances.sh remove <name>       # ⚠️ deletes DB volume

# Build & lint (runs during Docker build)
INSTANCE=<name>; docker compose --env-file .env.$INSTANCE -f docker-compose.yml up -d --build

# Lint only (check ESLint + TypeScript output in build log)
docker compose --env-file .env.$INSTANCE -f docker-compose.yml build frontend

# Shell in backend container
docker compose --env-file .env.$INSTANCE -f docker-compose.yml exec backend sh

# PSQL
docker exec -it belego-$INSTANCE-db psql -U <user> <db>
```

No test framework exists. No automated test suites.

## Architecture

### Overview

Monorepo: root = React frontend, `backend/` = Express API.

```
/               → React 18 + TypeScript + Vite + Tailwind (frontend)
/backend/       → Node.js Express + PostgreSQL (ES modules)
```

### Frontend

- **Routing**: hash-based (`window.location.hash`), no react-router. `App.tsx` owns all route switching.
- **State**: React Context API only. Contexts in `src/context/`: `AppContext`, `CompanyContext`, `CustomerContext`, `InvoiceContext`, `JobContext`, `QuoteContext`.
- **API client**: single class in `src/services/api.ts`. `VITE_API_URL` env var (defaults to `/api`, proxied by Nginx in production).
- **Types**: all shared types in `src/types/index.ts`.
- **Components**: flat in `src/components/`. Feature components (editors, overlays) are large single-file components.

### Backend

- ES modules (`"type": "module"` in `backend/package.json`). Use `.js` extensions in imports.
- `backend/server.js` registers all routes under `/api/<resource>`.
- 13 route files in `backend/routes/` — one per resource.
- `backend/database.js`: exports `pool` (pg Pool), `createTables`, `checkHealth`. Auto-runs migrations on startup.
- Migrations in `backend/migrations/` — numbered JS files, run in order via `backend/migrations/index.js`.
- Utilities in `backend/utils/`: `logger.js`, `routeHelpers.js`, `validation.js`.

### Multi-Instance Deployment

Three Docker services per instance: `database` (PostgreSQL 15), `backend`, `frontend` (Nginx).

- Env files: `.env.<instance>` for Docker Compose vars, `.env.backend.<instance>` for backend runtime.
- `COMPOSE_PROJECT_NAME=belego-<name>` scopes all containers, networks, and volumes per instance.
- Nginx proxies `/api` → backend; `client_max_body_size 100M` for attachments.

### PDF Generation

Three libraries in use — pick by context:
- `jspdf` — frontend invoice/quote/reminder PDF generation
- `pdf-lib` — ZUGFeRD PDF/A-3 embedding (attaches ZUGFeRD XML with `AFRelationship`)
- `pdfkit` — backend-side generation (jobs)

### eRechnung

- ZUGFeRD 2.1 (PDF/A-3 + embedded XML) and XRechnung 3.0 (XML) generated in frontend.
- XML conforms to UN/CEFACT CII / EN 16931.

## Code Conventions

- All UI text is German.
- Strict TypeScript: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.
- Backend body limit: `express.json({ limit: '100mb' })` — intentional for PDF payloads.
- `lucide-react` excluded from Vite `optimizeDeps` — do not move it back in.
- Backend `.gitignore` excludes all `.env*` files.

## Behavioral Guidelines (from AGENTS.md)

- State assumptions explicitly before implementing. Ask when uncertain.
- Minimum code that solves the problem — no speculative features or abstractions.
- Touch only what the task requires. Don't "improve" adjacent code.
- Remove imports/variables/functions that YOUR changes made unused; leave pre-existing dead code alone.
