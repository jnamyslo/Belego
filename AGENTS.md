# Belego

German invoicing software (eRechnung, ZUGFeRD, XRechnung) with multi-instance deployment.

## Stack

- **Frontend**: React 18 + TypeScript + Vite 5 + Tailwind CSS 3 + Context API
- **Backend**: Node.js (Express, ES modules) + PostgreSQL
- **PDF**: jspdf / pdf-lib / pdfkit
- **Email**: nodemailer

## Commands (root)

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (frontend only) |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | ESLint on all `*.ts,*.tsx` |
| `npm run preview` | Preview production build |

Backend commands (in `backend/`): `npm start` (prod), `npm run dev` (nodemon).

## Architecture

- Monorepo with two `package.json`: root (frontend) and `backend/` (Express)
- Frontend is a single‑page app; URL routing via `window.location.hash` (no react‑router)
- API base: `VITE_API_URL` env var, defaults to `/api` (proxied through Nginx in production)
- Backend auto‑runs DB migrations on startup (see `backend/database.js` + `backend/migrations/`)
- 13 route files in `backend/routes/`; types in `src/types/index.ts`
- Context providers in `src/context/`; API client class in `src/services/api.ts`
- Customer‑specific hourly rates and material templates are supported

## Multi‑Instance

Docker‑Compose across 3 services: `database` (PostgreSQL 15), `backend`, `frontend` (Nginx).

| Script | Use |
|--------|-----|
| `./deploy-instance.sh` | Interactive / quick‑args deploy |
| `./manage-instances.sh` | `list`, `start`, `stop`, `restart`, `logs`, `backup`, `config`, `remove` |

Env files: `.env.<instance>` for Docker Compose vars, `.env.backend.<instance>` for backend.  
Instance naming convention `COMPOSE_PROJECT_NAME=belego-<name>` scopes all containers/networks/volumes.

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
