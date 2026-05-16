# Belego

German invoicing software (eRechnung, ZUGFeRD, XRechnung) with multi-instance deployment.

## Stack

- **Frontend**: React 18 + TypeScript + Vite 5 + Tailwind CSS 3 + Context API
- **Backend**: Node.js (Express, ES modules) + PostgreSQL
- **PDF**: jspdf / pdf-lib / pdfkit
- **Email**: nodemailer

## Commands (Docker)

**Alles läuft in Docker-Containern.** Es wird kein `npm` direkt auf dem Host ausgeführt.

### Instanz-Verwaltung

| Script | Beschreibung |
|--------|-------------|
| `./deploy-instance.sh` | Interaktives Deploy einer neuen Instanz |
| `./manage-instances.sh list` | Alle Instanzen anzeigen |
| `./manage-instances.sh start <name>` | Instanz starten |
| `./manage-instances.sh stop <name>` | Instanz stoppen |
| `./manage-instances.sh restart <name>` | Instanz neustarten |
| `./manage-instances.sh logs <name> [service]` | Logs anzeigen (service: `frontend`, `backend`, `database`) |
| `./manage-instances.sh backup <name>` | DB-Backup erstellen |
| `./manage-instances.sh remove <name>` | Instanz löschen inkl. Datenbank-Volume |
| `./manage-instances.sh config <name>` | Backend-Konfiguration (.env) editieren |

### Manuelle Docker-Kommandos

| Kommando | Beschreibung |
|----------|-------------|
| `INSTANCE=<name>; docker compose --env-file .env.$INSTANCE -f docker-compose.yml up -d --build` | Instanz bauen & starten |
| `docker compose --env-file .env.$INSTANCE -f docker-compose.yml down` | Instanz stoppen |
| `docker compose --env-file .env.$INSTANCE -f docker-compose.yml logs -f [service]` | Logs folgen |
| `docker compose --env-file .env.$INSTANCE -f docker-compose.yml exec backend sh` | Shell im Backend-Container |
| `docker compose --env-file .env.$INSTANCE -f docker-compose.yml exec backend node server.js` | Backend-Prozess manuell starten |
| `docker exec -it belego-$INSTANCE-db psql -U <user> <db>` | PSQL im Datenbank-Container |
| `docker exec belego-$INSTANCE-db pg_dump -U <user> <db> > backup.sql` | DB-Dump |

### Lint (im Frontend-Container)

Da der Frontend-Container nur die gebaute Produktionsversion via Nginx ausliefert, wird der Lint während des Build-Stages ausgeführt. Nach `up --build` kann Lint nicht mehr im laufenden Container ausgeführt werden. Zum Linten muss lokal der Build-Schritt getriggert werden:

```bash
docker compose --env-file .env.<instance> -f docker-compose.yml build frontend
```

Das ESLint-Ergebnis erscheint im Build-Output. TypeScript-Prüfung erfolgt analog während `vite build`.

## Architecture

- Monorepo with two `package.json`: root (frontend) and `backend/` (Express)
- Frontend is a single‑page app; URL routing via `window.location.hash` (no react‑router)
- API base: `VITE_API_URL` env var, defaults to `/api` (proxied through Nginx in production)
- Backend auto‑runs DB migrations on startup (see `backend/database.js` + `backend/migrations/`)
- 13 route files in `backend/routes/`; types in `src/types/index.ts`
- Context providers in `src/context/`; API client class in `src/services/api.ts`
- Customer‑specific hourly rates and material templates are supported

## Multi‑Instance

Docker‑Compose across 3 Services: `database` (PostgreSQL 15), `backend`, `frontend` (Nginx).

Env files: `.env.<instance>` für Docker-Compose-Variablen, `.env.backend.<instance>` fürs Backend.  
Instance-Namenskonvention: `COMPOSE_PROJECT_NAME=belego-<name>` scoped alle Container/Netzwerke/Volumes.

## Testing

No test framework is configured. No automated test suites exist.

## Notable quirks

- All UI text is German
- Backend is ES modules (`"type": "module"` in `package.json`)
- Strict TypeScript: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- `react-refresh/only-export-components` is a **warn** (not error) in ESLint
- Nginx `client_max_body_size 100M` for email attachments
- Backend `express.json({ limit: '100mb' })` for PDF attachments
- Backend `.gitignore` excludes all `.env*` files
- `lucide-react` is excluded from Vite optimisation

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
