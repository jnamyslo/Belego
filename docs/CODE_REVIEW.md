# Code Review — Findings & Tracking

Review date: **2026-07-17**. Scope: full repo (frontend `src/`, backend `backend/`, infra).
Method: four parallel reviewers (backend, frontend state/API, PDF/eRechnung math, editor components) plus infra scan. Every finding below was verified by reading the code.

This document tracks two things:
1. **Fixed** — bugs already patched in this pass (verify with a Docker build before merge).
2. **Open** — findings left for follow-up agents, ordered by severity, each with a concrete fix. Grab any `Open` item, fix it, move it to the Fixed table with the commit hash.

> **No automated tests exist.** After any change, smoke-test the affected flow manually. Backend has no typecheck — read carefully.

> **The build does NOT typecheck.** `npm run build` = `vite build` (esbuild), which strips types without checking them. Running `tsc -p tsconfig.app.json --noEmit` against the frontend reports **~269 pre-existing errors** (verified 2026-07-17). This is exactly why runtime bugs like F4 (missing `logger` import) shipped. Most errors are one systemic pattern — `logger.error('msg', err)` where `err` is `unknown` and the 2nd param is typed `LogMeta` — plus `noUnusedLocals` dead imports. **These are pre-existing tech debt, not from this review.** See O35.
>
> To typecheck without polluting the host (project convention is Docker-only, no host `npm`):
> ```bash
> docker run --rm -v "$PWD":/app -v /app/node_modules -w /app node:20-alpine \
>   sh -c "npm install --loglevel=error && npx tsc -p tsconfig.app.json --noEmit"
> ```
> The `-v /app/node_modules` anonymous volume keeps `node_modules` out of the host tree.

> **Auth is intentionally absent** in this service — it is handled by an upstream service in front of Belego. Do **not** add auth middleware here. (Original review flagged open CORS/endpoints; dismissed per project owner.)

---

## Fixed in this pass

| # | Severity | File | What was wrong | Fix |
|---|----------|------|----------------|-----|
| F1 | Critical | `backend/routes/backup.js` (JSON + ZIP restore) | Column identifiers built from client-supplied JSON keys were interpolated raw into `INSERT INTO ${table} (${columnNames})` → SQL injection via a crafted backup file. | Escape every column and the table name with `client.escapeIdentifier()`. Values were already parameterized. |
| F2 | High | `backend/routes/jobs.js` (`POST /`, `POST /:id/signature`) | Validation branches `return`ed after `BEGIN` without `ROLLBACK`; `finally` released the connection to the pool "idle in transaction", poisoning the next borrower. | Added `await client.query('ROLLBACK')` before each early return. |
| F3 | High | `backend/routes/emailManagement.js` (`/debug-config`, `/test-network`) | `require('os'/'net'/'dns')` in an ES module (`"type":"module"`) → `ReferenceError`, endpoints always 500. | Converted to static `import os/net/dns`; `dns.lookup` → `dnsPromises.lookup`. |
| F4 | High | `src/utils/faviconUtils.ts`, `src/utils/fileUtils.ts` | `logger.*` called with no `logger` import → `ReferenceError` at runtime on the error path (esbuild build doesn't type-check, so it shipped). | Added `import logger from './logger'`. |
| F5 | High | `src/components/InvoiceManagement.tsx` (bulk + single download) | "Mark as sent" condition included `paid`/`overdue`/`sent`, so downloading a paid invoice downgraded it to `sent`, destroying its state. | Restricted to `invoice.status === 'draft'`. |
| F6 | High | `src/components/QuoteEditor.tsx` (template item add) | `template.taxRate \|\| (isSmallBusiness ? 0 : 19)`: a Kleinunternehmer adding a template with `taxRate 19` kept 19, so the quote total silently included VAT. | Changed to `isSmallBusiness ? 0 : (template.taxRate ?? 19)`, matching `InvoiceEditor`. |
| F7 | High | `src/components/QuoteEditor.tsx` (init effect) | Init `useEffect` keyed on `[quote, customers]`; a changing `customers` reference (background refresh) re-ran it and **reset the whole form**, discarding in-progress edits. | Split: full init keyed on `[quote]`; a separate effect keyed on `[quote, customers]` only sets the customer search-term display. |
| F8 | High | `src/components/Calendar.tsx` (`handleJobDrop`) | Dropping a job from another day onto an occupied cell hit `handleJobDrop`, which `stopPropagation()`'d and did nothing when dates differed → cross-day reschedule silently failed. | When `!isSameDate`, delegate to `handleDrop(e, targetDate)`. |
| F9 | High | `src/components/JobManagement.tsx` (bulk status change) | `handleBulkStatusChange` lacked the invoiced-job guard that single-status change has → bulk change bypassed GoBD lock on invoiced jobs. | Filter out `invoiced` jobs; report skipped count. |
| F10 | High | `src/components/JobManagement.tsx` (bulk status dropdown) | `<option value="pending">` — `JobStatus` has no `pending`; selecting it wrote an invalid status no filter/color handled. | Changed to `<option value="draft">Entwurf</option>`. |
| F11 | High | `src/components/QuoteManagement.tsx` (`handleEmailSend` bulk) | Bulk branch's `finally` reset only `isBulkOperation`; `isEmailSending` stayed `true` forever, freezing the modal loading state on next open. | Added `setIsEmailSending(false)` to the bulk `finally`. |
| F12 | Medium | `src/components/QuoteEditor.tsx` (`moveItemUp/Down`, `handleDragEnd`) | `newItems.forEach(item => item.order = idx+1)` mutated item objects still referenced by state. | Replaced with `.map(item => ({ ...item, order: idx+1 }))`. |
| F13 | Medium | `src/components/QuoteEditor.tsx` (savings %) | Savings % divided by `subtotal + totalDiscountAmount`; `subtotal` is already the pre-discount gross, so the denominator was inflated and % understated. Also no zero guard. | Divide by `subtotal` with a `> 0` guard. |
| F14 | Low | `backend/routes/reminders.js` (`GET /eligible`) | `company.reminders_enabled` dereferenced `rows[0]` without a null check → 500 if no company row. | Guard `if (!company || !company.reminders_enabled)`. |
| F15 | High | `backend/services/quoteService.js` (`createQuote`) | **Quote stored `subtotal` as the post-item-discount value (`subtotalAfterItemDiscounts`), but the PDF/editor treat `subtotal` as gross and subtract item discounts again → "Nettobetrag" double-subtracted the discount** (5.00 −10% shown as 4.00 instead of 4.50). Invoices were unaffected — `invoiceService` correctly stores the gross subtotal. | Store the gross `subtotal` in the INSERT, matching `invoiceService` and the PDF's Zwischensumme→discount→Nettobetrag layout. **Note:** existing quotes in the DB keep the wrong (net) subtotal until re-saved (any edit resends the gross value and fixes it); a one-time migration can recompute `subtotal` for old rows if desired. |

---

## Implementation status — follow-up pass (2026-07-17)

All open findings below were implemented by a fleet of model-tiered sub-agents (backend, eRechnung, App/hooks, contexts, calendar/jobs, editors, mechanical). Verified: frontend `tsc` introduced **zero** new type errors vs the pre-pass baseline (269 → 264 total; normalized error-set diff empty); backend passed `node --check`; eRechnung/pdf files typecheck clean.

| Item | Status | Note |
|---|---|---|
| O1, O2, O3, O10, O33 | ✅ DONE | eRechnung: 0%-rate breakdown + category codes (S/E/AE/Z) + BT-121 exemption reason; header line-total = Σ line nets with line-level `AllowanceCharge` for item discounts + per-rate document `AllowanceCharge` for global discount; round-then-sum header tax; real ISO country codes. **Standard invoices (no discount / uniform non-zero VAT) are byte-identical to before** (all discount/0% branches are guarded). **Must re-run the validator for: Kleinunternehmer 0%, reverse-charge, per-item-discount, and multi-rate+global-discount invoices** — these paths were previously untested. |
| O11 | ⏸️ DEFERRED | PDF display-only 1-cent rounding on fractional quantities, entangled with the gross/net "Zwischensumme" layout. Deferred to avoid visibly altering currently-correct PDFs for low value. XML rounding (O10) is done. |
| O4, O5, O6, O23, O24 | ✅ DONE | App remount fixed (AppContent hoisted); redirect moved to effect; `useAsyncValue` uses effect; `useLocalStorage`/`usePagination` no longer setState-in-render. |
| O13, O14 | ✅ DONE | All 6 provider `value`s memoized with full dep arrays; `addJobEntry` no longer leaves a phantom entry. |
| O7, O17, O28, O30, O31, O32 | ✅ DONE | JobEntryForm init keyed on `job?.id`; Calendar local-date parsing + cross-day position; UUID material ids; duplicate DocumentPreview removed; month-filter overflow + empty-state. |
| O19, O27 | ✅ DONE | Bulk ops report actual successes / pass only completed jobs; refresh after update in both Job and Invoice paths. |
| O29 | ✅ DONE (caveat) | Overnight wrap-around for time auto-calc — but the two code paths are currently **dead** (no UI wired to `updateTimeEntry` start/end); no runtime effect until start/end-time inputs exist. Confirm intended behavior before wiring UI. |
| O15, O16 | ✅ DONE | Submit buttons disabled during async save (both editors); InvoiceEditor small-business `taxRate` normalized on load + in totals + before persist. |
| O18 | ✅ DONE (note) | QuoteManagement bulk email now honors per-quote attachment/manual-email selections and wires `isSendingEmail`. `EmailSendModal` hides per-customer selection UI in bulk mode, so selections arrive empty today — fix is forward-compatible. |
| O8, O9, O12, O20, O21, O25, O26, O34 | ✅ DONE | Backend: atomic restore (rollback on any table failure); retry-on-`23505` for invoice/quote/job/customer number generation; HTML-escape outbound email `customText`; transactional company update; clamped `/history` limit; customer POST schema validation + numeric-only `customer_number` ordering; validated `statement_timeout`. **O21 note:** `email.js` has no `/history` route — that doc ref was inaccurate; nothing to fix there. |
| O22, O36 | ✅ DONE | api.ts error fallback `error \|\| message`; faviconUtils `setAttribute('sizes', …)`. |
| O35 | ⏸️ DEFERRED | Add a `tsc --noEmit` CI/build gate + burn down the 264 pre-existing type errors. Infra/backlog — needs a pipeline decision. |

> Backend files carry cosmetic indentation drift inside the O9 retry-loop restructuring (behavior verified correct via `node --check`); a formatter pass would tidy it.

The detailed original findings for each item are retained below for reference.

---

## Original findings (reference)

### HIGH — eRechnung / EN 16931 compliance (edge-case invalid XML)

> **Re-verified 2026-07-17 against the project owner's online ZUGFeRD/XRechnung validator: standard invoices pass.** The three findings below are **real but conditional** — they only produce invalid XML for specific (legitimate) scenarios, not for every invoice. A standard-rated invoice (uniform 19%/7%, no per-line discounts) is correct today: category `S` + `Percent 19` is valid, and `LineExtensionAmount` sums match. Downgraded from CRITICAL to HIGH accordingly. Any fix **must be re-run through the validator** and must not regress the passing standard case. Confirmed by reading the code: `discountUtils.ts:86` sets `subtotal += qty*price` (gross, item discounts NOT subtracted).

- **O1 — 0%-rate invoices emit no VAT breakdown.** *(Triggers only for a 0%-only invoice: Kleinunternehmer §19 or reverse-charge §13b — common for this app's target users.)*
  `src/utils/pdf/xrechnungGenerator.ts:118`, `src/utils/pdf/zugferdGenerator.ts:~150`.
  The breakdown is `.filter(([rate]) => Number(rate) > 0)`, so a 0%-only invoice emits **no** `TaxSubtotal`/`ApplicableTradeTax` while still writing `TaxAmount 0.00`. Violates BR-CO-18 (≥1 breakdown group required). Standard invoices are unaffected (their rates are > 0).
  **Fix:** do not filter out 0% rates; emit a breakdown group with the correct category code and, for exempt/reverse-charge, an exemption reason (BT-121).

- **O2 — tax category hardcoded to `S`.** *(Only wrong when the rate is 0% / reverse-charge / exempt; `S` is correct for standard rates, which is why the validator passes.)*
  `src/utils/pdf/zugferdGenerator.ts:~79`, `src/utils/pdf/xrechnungGenerator.ts:125,157`.
  Line + header use `CategoryCode`/`ClassifiedTaxCategory = 'S'` regardless of rate. `S` with `Percent 0` violates BR-S-05/BR-S-08.
  **Fix:** derive the category from rate + small-business/reverse-charge flag — `S` (standard, rate>0), `Z` (zero-rated), `E` (exempt/Kleinunternehmer, needs BT-121 reason), `AE` (reverse charge). Pair with O1.

- **O3 — header line-sum (BT-106) ≠ Σ line nets when per-item discounts exist (BR-CO-10).** *(Triggers only when a line has a per-item discount; global-only discount and no-discount invoices are consistent and pass.)*
  `src/utils/pdf/xrechnungGenerator.ts:135,138,149`, `src/utils/pdf/zugferdGenerator.ts:~83,166,171`.
  Header `LineExtensionAmount` = `invoice.subtotal` (gross Σ qty·price), but each line's amount = `qty·price − discountAmount`. When any item discount exists, `Σ line ≠ header` by exactly the item-discount total. Item discounts are also folded into `AllowanceTotalAmount`, so BR-CO-10 and BR-CO-13 can't both hold once item discounts appear.
  **Fix:** model item discounts as line-level `AllowanceCharge`; set the header `LineExtensionAmount` = `subtotal − itemDiscounts` (= Σ line net); let `AllowanceTotalAmount` carry only the global/document discount. Re-validate with an item-discounted invoice.

### HIGH

- **O4 — App re-mounts entire tree on every navigation.**
  `src/App.tsx:~68`. `AppContent` is declared *inside* `App`'s render body, so its component identity changes every render; React unmounts/remounts `Layout` + the whole page subtree on each nav, discarding local UI state (form inputs, scroll, modals).
  **Fix:** hoist `AppContent` to module scope and pass `currentPageState`/`handlePageChange` as props, or inline its body into `App`'s return.

- **O5 — `renderPage()` calls `setState`/mutates `location.hash` during render.**
  `src/App.tsx` (redirect-to-settings branches when a module is disabled). Calling `handlePageChange('settings')` during render triggers React's "cannot update a component while rendering" and an extra pass.
  **Fix:** move the redirect into a `useEffect` keyed on `currentPageState.page` + the relevant `company.*Enabled` flag.

- **O6 — `useAsyncValue` never re-runs on dep change.**
  `src/hooks/useAsync.ts:~92`. The async logic runs inside `useState(() => {...})` (runs once at mount), so the documented "re-execute when deps change" is broken and the cleanup fn is swallowed as unused initial state.
  **Fix:** replace with `useEffect(() => {...}, [memoizedFn])`.

- **O7 — `JobEntryForm` init effect resets form on rate/date changes.**
  `src/components/JobEntryForm.tsx:~155`. Deps `[job, company.hourlyRates, defaultDate]`: when `company.hourlyRates` changes elsewhere, or a fresh `defaultDate` identity is passed, the effect re-runs and wipes in-progress edits (same class as F7).
  **Fix:** key init on `job?.id` change only; read rates/defaultDate without them being reset triggers.

### MEDIUM

- **O8 — Restore swallows per-table errors then COMMITs.** `backend/routes/backup.js:~346,~888`. Failed `INSERT`s inside the restore loop are caught, logged, and skipped; the transaction still commits → silent partial/inconsistent restore reported as success. **Fix:** track failures and `ROLLBACK`/rethrow if any table failed, or use per-table savepoints.
- **O9 — Number-generation races.** `backend/services/invoiceService.js:~12`, `quoteService.js:~43`, `jobs.js:~145`, `customers.js:~296`. `SELECT last … LIMIT 1` then increment/insert with no locking. UNIQUE constraints prevent corruption but concurrent creates throw a duplicate-key → generic 500. **Fix:** DB sequence per prefix, `SELECT … FOR UPDATE` on a counter row, or retry on unique-violation.
- **O10 — Round-then-sum vs sum-then-round tax drift.** `src/utils/pdf/xmlUtils.ts:~11`, `src/components/InvoiceEditor.tsx:~846,848`. Totals stored as raw floats and rounded independently at output; with multiple tax rates the header tax can differ from Σ per-category taxes by a cent (BR-CO-14 / BR-S-08). **Fix:** round each per-category amount first, then derive header totals as the sum of already-rounded parts; store the rounded values.
- **O11 — PDF line-total sum ≠ displayed subtotal.** `src/utils/pdfGenerator.ts:~216 vs ~276`. Line "Gesamt" is rounded per line but "Zwischensumme" uses the unrounded aggregate; fractional quantities / >2-decimal prices produce a 1-cent visual mismatch. **Fix:** compute subtotal as the sum of rounded line totals.
- **O12 — `require()` isn't the only ES-module trap; check `email.js`/`emailService.js` `customText` HTML injection.** `backend/services/emailService.js:~389,602`, `backend/routes/emailManagement.js:~795`. `customText`/`custom_message` inserted into outbound HTML with only `\n`→`<br>`, no escaping. Operator-controlled (low impact) but still HTML injection. **Fix:** HTML-escape before insertion.
- **O13 — Provider `value` objects unmemoized.** All six contexts (`InvoiceContext:~96`, `QuoteContext:~84`, `CustomerContext:~101`, `JobContext:~110`, `CompanyContext:~281`, `AppContext:~106`) build `value` inline → new identity every render → all consumers re-render. Callbacks are already `useCallback`'d. **Fix:** wrap `value` in `useMemo`.
- **O14 — `addJobEntry` leaves a phantom entry on failure.** `src/context/JobContext.tsx:~52-60`. Catch path pushes an optimistic client-UUID entry into state **and** re-throws; caller sees failure but a server-nonexistent job lingers (later ops 404). **Fix:** don't add to state before re-throwing, or don't re-throw — pick one strategy consistent with `updateJobEntry`/`InvoiceContext.addInvoice`.
- **O15 — Submit buttons not disabled during async save (double-submit).** `src/components/InvoiceEditor.tsx:~1392`, `QuoteEditor.tsx:~1257`. Double-click calls `addInvoice`/`addQuote` twice → duplicate documents (numbers generated server-side, no dedup). **Fix:** add `isSubmitting` state, disable the button while awaiting.
- **O16 — `InvoiceEditor` small-business items keep stored `taxRate`.** `src/components/InvoiceEditor.tsx:~810,838`. Loaded items keep e.g. `taxRate 19`; the select shows 0 but is disabled (never normalized) while `calculateTotals` uses the real rate → 19% VAT charged/saved. **Fix:** normalize item `taxRate` to 0 when `isSmallBusiness` on load and in `calculateTotals`. (Same class as F6 but on the load path; also check `JobEntryForm.tsx:~207,224` time entries.)
- **O17 — Calendar date parsed as UTC → wrong day west of UTC.** `src/components/Calendar.tsx:~135,253,361,402,545,743,775,909,941`. `new Date('YYYY-MM-DD')` = UTC midnight, then `.toDateString()` local shifts to the previous day. **Fix:** build from parts `new Date(y, m-1, d)` or compare the raw date string.
- **O18 — QuoteManagement bulk email ignores modal selections.** `src/components/QuoteManagement.tsx:~457`. Bulk mode re-derives recipients per customer and drops the user's `selectedEmails`/`manualEmails`/attachment selections. Also `isSendingEmail` (`~43`) is never assigned so email buttons are never disabled (dead spinner). **Fix:** honor selections per quote (or hide those inputs in bulk mode); wire up the sending flag.
- **O19 — Bulk operations over-report success.** `src/components/QuoteManagement.tsx:~300` (download alert counts `selectedQuoteIds.length`, not actual successes), and `JobManagement.tsx:~294-306,496` (passes all selected job ids incl. non-completed to `JobInvoiceGenerator`). **Fix:** count actual successes / pass only the completed subset.
- **O20 — `company.js` update not transactional.** `backend/routes/company.js:~311-321`. Company `UPDATE` and hourly-rates delete/re-insert run on separate pooled connections; mid-loop failure leaves company updated but rates partially wiped. **Fix:** wrap in one transaction.
- **O21 — `/history` limit unbounded.** `backend/routes/emailManagement.js:~359`, `backend/routes/email.js:~20`. `limit` never parsed/clamped; `parsePagination` (routeHelpers) clamps to 100 but isn't used here. **Fix:** clamp limit.

### LOW

- **O22** — `src/services/api.ts:~62`: `request()` reads only `errorData.error`; backup routes return `{ message }`, so those errors lose their server message. **Fix:** `errorData.error || errorData.message`.
- **O23** — `src/hooks/useLocalStorage.ts:~32-44`: functional updates computed from closed-over `storedValue`, not `setStoredValue(prev => …)`; batched updates clobber each other. **Fix:** use the updater form.
- **O24** — `src/hooks/usePagination.ts:~48-50`: `setCurrentPage` called during render (extra render on page-count change). **Fix:** clamp in an effect.
- **O25** — `backend/routes/customers.js:~290`: `POST /customers` skips `schemas.customer`; missing NOT NULL fields hit the DB as a 500 instead of 400. **Fix:** run `validateSchema` before insert.
- **O26** — `backend/routes/customers.js:~296`: `ORDER BY CAST(customer_number AS INTEGER)` throws for the whole query if any `customer_number` is non-numeric (possible after external restore), blocking all customer creation. **Fix:** filter to numeric or use a separate integer sequence.
- **O27** — `src/components/InvoiceEditor.tsx:~913-919` and `JobManagement.tsx:~218-224`: update paths don't call `refresh*()` while add paths do → stale data in other views after an edit. **Fix:** refresh in both branches.
- **O28** — `src/components/JobEntryForm.tsx:~331-368`: new materials use `id: Date.now().toString()` → duplicate React keys within the same ms. **Fix:** use `generateUUID()` (time entries already do).
- **O29** — `src/components/JobEntryForm.tsx:~249-309`: time auto-calc only runs when `diffHours > 0`; overnight/end-before-start entries silently ignored. **Fix:** handle wrap-around or show validation.
- **O30** — `src/components/JobManagement.tsx:~1119-1276`: `DocumentPreview` rendered twice with identical props (two stacked modals). **Fix:** delete one block.
- **O31** — `src/components/JobManagement.tsx:~147` & `~770`: month filter uses `new Date(y, month-1, day)` which overflows on the 31st; empty-state condition always true because default `statusFilter` is `'not-invoiced'`. **Fix:** normalize the day; gate empty-state on `jobEntries.length`.
- **O32** — `src/components/Calendar.tsx:~430`: after a cross-day move the moved job sorts to the top (existing jobs lack `jobPositions` and fall back to `999`) instead of the end. **Fix:** backfill positions or assign a position > existing.
- **O33** — `src/utils/pdf/zugferdGenerator.ts:~107,122` / `xrechnungGenerator.ts:~60,88`: country code is `=== 'Deutschland' ? 'DE' : 'DE'` — always `DE`. **Fix:** map country name → real ISO 3166-1 alpha-2.
- **O34** — `backend/database.js:~269`: `SET statement_timeout = ${timeoutMs}` string-interpolated (internal-only, not currently exploitable). **Fix:** validate integer or parameterize.
- **O35 — No typecheck gate + ~269 pre-existing `tsc` errors.** The Docker build uses `vite build` (esbuild), which never runs `tsc`, so type errors ship silently (root cause of F4). **Fix (incremental):** (1) add `tsc --noEmit` to CI / the build stage so new errors are caught; (2) burn down the backlog — most are the `logger.error(msg, err: unknown)` pattern (change the logger `meta` param to accept `unknown`, or wrap errors in a meta object at call sites) plus `noUnusedLocals` dead imports. Two representative real ones worth fixing regardless: `Calendar.tsx:~426` (`date: string` assigned where `Date` expected) and `JobManagement.tsx:~100` (`Property 'currency' does not exist on type 'Company'`).
- **O36 — `faviconUtils.ts` `link.sizes = size` type error (harmless at runtime).** `HTMLLinkElement.sizes` is typed read-only `DOMTokenList`; assignment works at runtime via `[PutForwards=value]` but TS flags it (`TS2540`). **Fix:** `link.setAttribute('sizes', size)`.

### Infra / deployment notes (not code bugs)

- Default DB password `belego123` in `docker-compose.yml`; document that operators must override `POSTGRES_PASSWORD` per instance.
- Postgres port published to host by default (`${DB_PORT:-5432}:5432`) — consider binding to `127.0.0.1` unless remote DB access is required.
- `frontend` build bakes `VITE_API_URL=http://localhost:${BACKEND_PORT}/api` — only works when the browser is on the same host. Fine if the upstream proxy rewrites `/api`, but worth documenting.

---

## Notes — checked and NOT bugs

- Migrations (`backend/migrations/*`) are idempotent (`IF NOT EXISTS`/`OR REPLACE`) and ordered; money columns are `DECIMAL(10,2)`, not float.
- `discountUtils.ts` discount clamping and the proportional global-discount distribution across tax rates are arithmetically consistent across all three code paths.
- `api.ts` DELETE handlers all return JSON bodies, so `response.json()` doesn't throw on deletes.
- `src/components/editors/` and `src/components/shared/` are empty directories.
