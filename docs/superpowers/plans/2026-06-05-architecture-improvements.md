# Architecture Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove 5 architectural friction points identified in the 2026-06-05 review: SQL query duplication (backend), shallow AppContextBridge (frontend), discount logic scatter, editor code duplication, and business logic in route handlers.

**Architecture:** Two parallel tracks (backend / frontend-context) then a sequential editor+discount phase. Backend track has zero frontend file overlap. Frontend-context track avoids InvoiceEditor/QuoteEditor (those are handled in Phase B). No test framework exists — verification is manual Docker build + UI walkthrough.

**Tech Stack:** React 18 + TypeScript (Vite), Node.js + Express + PostgreSQL (ES modules), Docker Compose, jspdf / pdf-lib / pdfkit

---

## Dependency graph

```
Phase A (parallel):
  ┌─ Task 1: backend/queries/        (no frontend overlap)
  ├─ Task 2: backend/services/       (depends on Task 1)
  └─ Task 3: frontend context hooks  (non-editor components only)

Phase B (sequential, after A):
  Task 4: useDocumentHelpers() hook
  Task 5: InvoiceEditor → individual hooks
  Task 6: QuoteEditor → individual hooks
  Task 7: Remove AppContextBridge
  Task 8: Extract shared editor sub-modules (ItemsSection, CustomerSelector)
  Task 9: Backend discount validation

Phase C:
  Task 10: Docker build + manual verification
```

---

## File map

### Created (backend)
| File | Responsibility |
|------|---------------|
| `backend/queries/invoiceQueries.js` | JSONB aggregation SQL for invoices |
| `backend/queries/quoteQueries.js` | JSONB aggregation SQL for quotes |
| `backend/queries/jobQueries.js` | JSONB aggregation SQL for jobs |
| `backend/services/invoiceService.js` | Invoice number generation + insert/update logic |
| `backend/services/quoteService.js` | Quote number generation + insert/update logic |

### Created (frontend)
| File | Responsibility |
|------|---------------|
| `src/hooks/useDocumentHelpers.ts` | Cross-context utilities: getCombinedHourlyRates, getCombinedMaterials |
| `src/components/shared/ItemsSection.tsx` | Shared drag-and-drop item list (Invoice + Quote) |
| `src/components/shared/CustomerSelector.tsx` | Shared customer picker with inline creation |

### Modified (backend)
| File | Change |
|------|--------|
| `backend/routes/invoices.js` | GET handlers call `invoiceQueries.*`; POST/PUT call `invoiceService.*` |
| `backend/routes/quotes.js` | Same pattern with `quoteQueries.*` + `quoteService.*` |
| `backend/routes/jobs.js` | GET handlers call `jobQueries.*` |

### Modified (frontend)
| File | Change |
|------|--------|
| `src/context/AppContext.tsx` | Remove `AppContextBridge` + `AppContext` + `useApp()` export; keep `AppProvider` + `DataLoader` |
| `src/components/InvoiceEditor.tsx` | Replace `useApp()` with individual hooks; replace item/customer section with shared sub-modules |
| `src/components/QuoteEditor.tsx` | Same as InvoiceEditor |
| All 20 other `src/components/*.tsx` | Replace `useApp()` with individual hooks |

---

## Phase A — Backend + Context (run in parallel)

---

### Task 1: Extract backend query modules

**Files:**
- Create: `backend/queries/invoiceQueries.js`
- Create: `backend/queries/quoteQueries.js`
- Create: `backend/queries/jobQueries.js`
- Modify: `backend/routes/invoices.js`
- Modify: `backend/routes/quotes.js`
- Modify: `backend/routes/jobs.js`

#### Step 1.1 — Create `backend/queries/invoiceQueries.js`

```javascript
import { query } from '../database.js';

const INVOICE_ITEMS_SUBQUERY = `
  LEFT JOIN (
    SELECT invoice_id,
           array_agg(
             jsonb_build_object(
               'id', id,
               'description', description,
               'quantity', quantity,
               'unitPrice', unit_price,
               'taxRate', tax_rate,
               'total', total,
               'order', item_order,
               'discountType', discount_type,
               'discountValue', discount_value,
               'discountAmount', discount_amount
             ) ORDER BY item_order
           ) as items
    FROM invoice_items
    GROUP BY invoice_id
  ) items_subquery ON i.id = items_subquery.invoice_id`;

const INVOICE_ATTACHMENTS_SUBQUERY = `
  LEFT JOIN (
    SELECT invoice_id,
           jsonb_agg(
             jsonb_build_object(
               'id', id,
               'name', name,
               'content', content,
               'contentType', content_type,
               'size', size,
               'uploadedAt', uploaded_at
             )
           ) as attachments
    FROM invoice_attachments
    GROUP BY invoice_id
  ) attachments_subquery ON i.id = attachments_subquery.invoice_id`;

function transformRow(row) {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    items: row.items || [],
    attachments: row.attachments || [],
    subtotal: parseFloat(row.subtotal),
    taxAmount: parseFloat(row.tax_amount),
    total: parseFloat(row.total),
    status: row.status,
    notes: row.notes,
    globalDiscountType: row.global_discount_type,
    globalDiscountValue: row.global_discount_value ? parseFloat(row.global_discount_value) : null,
    globalDiscountAmount: row.global_discount_amount ? parseFloat(row.global_discount_amount) : null,
    createdAt: row.created_at,
  };
}

export async function findAllInvoices() {
  const result = await query(
    `SELECT i.* ${INVOICE_ITEMS_SUBQUERY} ${INVOICE_ATTACHMENTS_SUBQUERY} ORDER BY i.created_at DESC`
  );
  return result.rows.map(transformRow);
}

export async function findInvoiceById(id) {
  const result = await query(
    `SELECT i.* ${INVOICE_ITEMS_SUBQUERY.replace(/GROUP BY invoice_id/g, 'WHERE invoice_id = $1\n        GROUP BY invoice_id')} ${INVOICE_ATTACHMENTS_SUBQUERY.replace(/GROUP BY invoice_id/g, 'WHERE invoice_id = $1\n        GROUP BY invoice_id')} WHERE i.id = $1`,
    [id]
  );
  return result.rows[0] ? transformRow(result.rows[0]) : null;
}
```

> **Note:** The current `GET /:id` route uses `WHERE invoice_id = $1` inside the subqueries, while `GET /` does not. Copy the exact SQL strings from the existing route handlers to preserve this behaviour — don't simplify the WHERE clause positioning.

#### Step 1.2 — Update `GET /` in `backend/routes/invoices.js`

Replace lines 8–82 (the `router.get('/', ...)` handler) with:

```javascript
import { findAllInvoices, findInvoiceById } from '../queries/invoiceQueries.js';

router.get('/', async (req, res) => {
  try {
    const invoices = await findAllInvoices();
    res.json(invoices);
  } catch (error) {
    logger.error('Failed to fetch invoices', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});
```

#### Step 1.3 — Update `GET /:id` in `backend/routes/invoices.js`

Replace lines 85–162 with:

```javascript
router.get('/:id', async (req, res) => {
  try {
    const invoice = await findInvoiceById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (error) {
    logger.error('Failed to fetch invoice', { error: error.message, invoiceId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});
```

- [ ] **Step 1.4 — Create `backend/queries/quoteQueries.js`**

Follow the exact same pattern as `invoiceQueries.js`. Read `backend/routes/quotes.js` lines 1–132 to copy the exact SQL strings. The transform function for quotes differs — check the existing `row` mapping in `quotes.js` carefully and copy it verbatim into `transformRow`. Key quote-specific fields: `quoteNumber` (from `quote_number`), `validUntil` (from `valid_until`).

- [ ] **Step 1.5 — Update `GET /` and `GET /:id` in `backend/routes/quotes.js`**

Same pattern as invoices.js steps 1.2–1.3, using `findAllQuotes` / `findQuoteById` from `quoteQueries.js`.

- [ ] **Step 1.6 — Create `backend/queries/jobQueries.js`**

Read `backend/routes/jobs.js` lines 60–160 to copy the exact SQL. Job-specific subqueries aggregate `job_time_entries` and `job_materials`. Copy the `transformRow` from the existing mapping carefully.

- [ ] **Step 1.7 — Update `GET /` and `GET /:id` in `backend/routes/jobs.js`**

Same pattern, using `findAllJobs` / `findJobById` from `jobQueries.js`.

- [ ] **Step 1.8 — Commit**

```bash
git add backend/queries/ backend/routes/invoices.js backend/routes/quotes.js backend/routes/jobs.js
git commit -m "refactor(backend): extract JSONB aggregation into query modules"
```

---

### Task 2: Extract backend service layer

**Files:**
- Create: `backend/services/invoiceService.js`
- Create: `backend/services/quoteService.js`
- Modify: `backend/routes/invoices.js` (POST, PUT, DELETE handlers)
- Modify: `backend/routes/quotes.js` (POST, PUT, DELETE handlers)

**Depends on:** Task 1 (import from `invoiceQueries.js` / `quoteQueries.js` inside services)

#### Step 2.1 — Create `backend/services/invoiceService.js`

```javascript
import { pool, query } from '../database.js';
import { findInvoiceById } from '../queries/invoiceQueries.js';
import logger from '../utils/logger.js';

export async function generateInvoiceNumber(issueDate) {
  const invoiceYear = new Date(issueDate).getFullYear();
  const yearPattern = `RE-${invoiceYear}-%`;

  const [lastResult, startResult] = await Promise.all([
    query('SELECT invoice_number FROM invoices WHERE invoice_number LIKE $1 ORDER BY created_at DESC LIMIT 1', [yearPattern]),
    query('SELECT start_number FROM yearly_invoice_start_numbers WHERE year = $1', [invoiceYear]),
  ]);

  const yearStartNumber = startResult.rows.length > 0 ? startResult.rows[0].start_number : 1;

  if (lastResult.rows.length === 0) {
    return `RE-${invoiceYear}-${String(yearStartNumber).padStart(3, '0')}`;
  }

  const lastNum = lastResult.rows[0].invoice_number;
  if (lastNum && lastNum.startsWith(`RE-${invoiceYear}-`)) {
    const parsed = parseInt(lastNum.substring(`RE-${invoiceYear}-`.length));
    if (!isNaN(parsed)) {
      const next = Math.max(parsed + 1, yearStartNumber);
      return `RE-${invoiceYear}-${String(next).padStart(3, '0')}`;
    }
  }
  return `RE-${invoiceYear}-${String(yearStartNumber).padStart(3, '0')}`;
}

export async function createInvoice(data) {
  // data shape: { customerId, items, notes, attachments, issueDate, dueDate, status,
  //               globalDiscountType, globalDiscountValue, globalDiscountAmount,
  //               subtotal, taxAmount, total }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const customerResult = await client.query('SELECT name FROM customers WHERE id = $1', [data.customerId]);
    if (customerResult.rows.length === 0) throw new Error('Customer not found');
    const customerName = customerResult.rows[0].name;

    const invoiceNumber = await generateInvoiceNumber(data.issueDate);

    const invoiceResult = await client.query(
      `INSERT INTO invoices (invoice_number, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [invoiceNumber, data.customerId, customerName, data.issueDate, data.dueDate,
       data.subtotal, data.taxAmount, data.total, data.status, data.notes,
       data.globalDiscountType, data.globalDiscountValue, data.globalDiscountAmount]
    );
    const invoiceId = invoiceResult.rows[0].id;

    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      await client.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [invoiceId, item.description, item.quantity, item.unitPrice, item.taxRate,
         item.total, i, item.discountType || null, item.discountValue || null, item.discountAmount || null]
      );
    }

    for (const att of data.attachments) {
      await client.query(
        `INSERT INTO invoice_attachments (invoice_id, name, content, content_type, size) VALUES ($1,$2,$3,$4,$5)`,
        [invoiceId, att.name, att.content, att.contentType, att.size]
      );
    }

    await client.query('COMMIT');
    return findInvoiceById(invoiceId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

> Read the full POST handler in `backend/routes/invoices.js` (lines 164–end of the POST route) before writing this service to make sure no fields are missed. The service function receives already-calculated `subtotal`, `taxAmount`, `total` from the frontend; it does NOT recalculate them.

#### Step 2.2 — Replace POST handler in `backend/routes/invoices.js`

```javascript
import { createInvoice } from '../services/invoiceService.js';

router.post('/', async (req, res) => {
  try {
    const {
      customerId, items = [], notes = '', attachments = [],
      issueDate = new Date().toISOString().split('T')[0],
      dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status = 'draft',
      globalDiscountType = null, globalDiscountValue = null, globalDiscountAmount = null,
      subtotal, taxAmount, total,
    } = req.body;

    const invoice = await createInvoice({
      customerId, items, notes, attachments, issueDate, dueDate, status,
      globalDiscountType, globalDiscountValue, globalDiscountAmount,
      subtotal, taxAmount, total,
    });
    res.status(201).json(invoice);
  } catch (error) {
    logger.error('Failed to create invoice', { error: error.message, stack: error.stack });
    if (error.message === 'Customer not found') return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});
```

- [ ] **Step 2.3 — Create `updateInvoice` and `deleteInvoice` in `invoiceService.js`**

Read the PUT and DELETE handlers in `backend/routes/invoices.js` and extract the transaction logic into `updateInvoice(id, data)` and `deleteInvoice(id)` functions. Follow the same pattern as `createInvoice`. The PUT handler must:
1. Delete existing `invoice_items` where `invoice_id = $1`
2. Re-insert all items from `data.items`
3. Handle `invoice_attachments` — check the existing PUT handler carefully for attachment logic

- [ ] **Step 2.4 — Replace PUT and DELETE handlers in `backend/routes/invoices.js`** with thin wrappers calling `invoiceService.updateInvoice` and `invoiceService.deleteInvoice`.

- [ ] **Step 2.5 — Create `backend/services/quoteService.js`** following the same pattern. Read `backend/routes/quotes.js` fully for quote-specific fields: `quoteNumber` (prefix `AN-` not `RE-`), `validUntil`.

- [ ] **Step 2.6 — Replace POST/PUT/DELETE handlers in `backend/routes/quotes.js`** with thin wrappers.

- [ ] **Step 2.7 — Commit**

```bash
git add backend/services/ backend/routes/invoices.js backend/routes/quotes.js
git commit -m "refactor(backend): extract invoice/quote creation logic into service modules"
```

---

### Task 3: Replace `useApp()` in non-editor components

**Files (modify only — do NOT touch InvoiceEditor.tsx or QuoteEditor.tsx):**
- `src/components/Dashboard.tsx`
- `src/components/Calendar.tsx`
- `src/components/CustomerManagement.tsx`
- `src/components/DocumentPreview.tsx`
- `src/components/DynamicColors.tsx`
- `src/components/JobEntryForm.tsx`
- `src/components/JobInvoiceGenerator.tsx`
- `src/components/JobManagement.tsx`
- `src/components/InvoiceManagement.tsx`
- `src/components/Layout.tsx`
- `src/components/QuoteManagement.tsx`
- `src/components/ReminderManagement.tsx`
- `src/components/ReminderSendModal.tsx`
- `src/components/ReportingManagement.tsx`
- `src/components/Settings.tsx`

**Hook mapping reference** (what each `useApp()` destructure maps to):

| `useApp()` field | Individual hook |
|-----------------|----------------|
| `customers`, `addCustomer`, `updateCustomer`, `deleteCustomer`, `refreshCustomers` | `useCustomers()` |
| `invoices`, `addInvoice`, `updateInvoice`, `deleteInvoice`, `refreshInvoices` | `useInvoices()` |
| `quotes`, `addQuote`, `updateQuote`, `deleteQuote`, `refreshQuotes` | `useQuotes()` |
| `jobEntries`, `addJobEntry`, `updateJobEntry`, `deleteJobEntry`, `refreshJobEntries`, `addJobSignature` | `useJobs()` |
| `company`, `updateCompany`, `hourlyRates`, `materialTemplates`, `addHourlyRate`, `updateHourlyRate`, `deleteHourlyRate`, `getHourlyRates`, `addMaterialTemplate`, `updateMaterialTemplate`, `deleteMaterialTemplate`, `getMaterialTemplates`, `addInvoiceTemplate`, `updateInvoiceTemplate`, `deleteInvoiceTemplate`, `getInvoiceTemplates` | `useCompany()` |
| `loading` | `useLoading()` (from `AppContext.tsx`) |
| `generateInvoiceFromJobs` | see Task 4 |
| `getHourlyRatesForCustomer`, `getMaterialTemplatesForCustomer`, `getCombinedHourlyRatesForCustomer`, `getCombinedMaterialTemplatesForCustomer` | see Task 4 |

#### Step 3.1 — Update `src/components/Dashboard.tsx`

Current:
```typescript
import { useApp } from '../context/AppContext';
// ...
const { invoices, customers, updateInvoice, loading, company } = useApp();
```

Replace with:
```typescript
import { useInvoices } from '../context/InvoiceContext';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
// remove useApp import
// ...
const { invoices, updateInvoice } = useInvoices();
const { customers } = useCustomers();
const { company } = useCompany();
// loading: check if Dashboard uses loading; if yes, keep a useLoading() call
// exported useLoading from AppContext.tsx — add: export { useLoading } from './AppContext' if not already exported
```

- [ ] **Step 3.2 — Update `src/components/Layout.tsx`**

```typescript
import { useCompany } from '../context/CompanyContext';
const { company } = useCompany();
```

- [ ] **Step 3.3 — Update `src/components/DynamicColors.tsx`**

```typescript
import { useCompany } from '../context/CompanyContext';
const { company } = useCompany();
```

- [ ] **Step 3.4 — Update `src/components/DocumentPreview.tsx`**

```typescript
import { useCompany } from '../context/CompanyContext';
import { useCustomers } from '../context/CustomerContext';
const { company } = useCompany();
const { customers } = useCustomers();
```

- [ ] **Step 3.5 — Update `src/components/CustomerManagement.tsx`**

```typescript
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
const { customers, addCustomer, updateCustomer, deleteCustomer, refreshCustomers } = useCustomers();
const { getHourlyRates } = useCompany();
```

- [ ] **Step 3.6 — Update `src/components/InvoiceManagement.tsx`**

```typescript
import { useInvoices } from '../context/InvoiceContext';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
const { invoices, deleteInvoice, updateInvoice } = useInvoices();
const { company } = useCompany();
const { customers, addCustomer } = useCustomers();
```

- [ ] **Step 3.7 — Update `src/components/QuoteManagement.tsx`**

```typescript
import { useCompany } from '../context/CompanyContext';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
const { company } = useCompany();
const { customers } = useCustomers();
const { refreshInvoices } = useInvoices();
```

- [ ] **Step 3.8 — Update `src/components/Settings.tsx`**

```typescript
import { useCompany } from '../context/CompanyContext';
const { company, updateCompany } = useCompany();
```

- [ ] **Step 3.9 — Update `src/components/ReminderManagement.tsx`**

```typescript
import { useCompany } from '../context/CompanyContext';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
// Line 14:
const { company } = useCompany();
const { customers } = useCustomers();
const { refreshInvoices, invoices } = useInvoices();
// Line 731 (sub-component):
const { company } = useCompany();
```

- [ ] **Step 3.10 — Update `src/components/ReminderSendModal.tsx`**

```typescript
import { useCompany } from '../context/CompanyContext';
import { useCustomers } from '../context/CustomerContext';
const { company } = useCompany();
const { customers } = useCustomers();
```

- [ ] **Step 3.11 — Update `src/components/ReportingManagement.tsx`**

```typescript
import { useCustomers } from '../context/CustomerContext';
const { customers } = useCustomers();
```

- [ ] **Step 3.12 — Update `src/components/Calendar.tsx`**

```typescript
import { useJobs } from '../context/JobContext';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
const { jobEntries, updateJobEntry, addJobEntry, refreshJobEntries } = useJobs();
const { customers, addCustomer, refreshCustomers } = useCustomers();
const { company } = useCompany();
```

- [ ] **Step 3.13 — Update `src/components/JobManagement.tsx`**

Read the current destructure at line ~50 carefully. It uses many fields. Map each to the correct individual hook using the table above. `generateInvoiceFromJobs` — skip for now; it will be provided by `useDocumentHelpers()` in Task 4. Add a TODO comment at its call site.

- [ ] **Step 3.14 — Update `src/components/JobEntryForm.tsx`**

Current destructure at line ~26 uses: `addCustomer, refreshCustomers, company, getMaterialTemplates, addMaterialTemplate, updateMaterialTemplate, deleteMaterialTemplate, addHourlyRate, updateHourlyRate, deleteHourlyRate, getHourlyRates, getHourlyRatesForCustomer, getMaterialTemplatesForCustomer, getCombinedHourlyRatesForCustomer, getCombinedMaterialTemplatesForCustomer`.

`company, getMaterialTemplates, addMaterialTemplate, updateMaterialTemplate, deleteMaterialTemplate, addHourlyRate, updateHourlyRate, deleteHourlyRate, getHourlyRates` → `useCompany()`

`addCustomer, refreshCustomers` → `useCustomers()`

`getHourlyRatesForCustomer, getMaterialTemplatesForCustomer, getCombinedHourlyRatesForCustomer, getCombinedMaterialTemplatesForCustomer` → add a TODO comment; will be provided by `useDocumentHelpers()` in Task 4.

- [ ] **Step 3.15 — Update `src/components/JobInvoiceGenerator.tsx`**

```typescript
import { useJobs } from '../context/JobContext';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useCompany } from '../context/CompanyContext';
const { jobEntries: jobs, updateJobEntry } = useJobs();
const { customers } = useCustomers();
const { addInvoice, refreshInvoices } = useInvoices();
const { company } = useCompany();
```

`generateInvoiceFromJobs` used here — add a TODO comment; will be wired in Task 4.

- [ ] **Step 3.16 — Export `useLoading` from `AppContext.tsx`**

Add this line to the re-exports section (around line 22):
```typescript
export { useLoading } from './AppContext'; // if useLoading is defined in this file
```

Actually `useLoading` is defined inside `AppContext.tsx` at line 100. Either export it from there or check if any component actually uses the `loading` field from `useApp()`. If only `Dashboard` uses it, just remove it and handle loading state locally.

- [ ] **Step 3.17 — Commit**

```bash
git add src/components/Dashboard.tsx src/components/Calendar.tsx src/components/CustomerManagement.tsx src/components/DocumentPreview.tsx src/components/DynamicColors.tsx src/components/JobEntryForm.tsx src/components/JobInvoiceGenerator.tsx src/components/JobManagement.tsx src/components/InvoiceManagement.tsx src/components/Layout.tsx src/components/QuoteManagement.tsx src/components/ReminderManagement.tsx src/components/ReminderSendModal.tsx src/components/ReportingManagement.tsx src/components/Settings.tsx src/context/AppContext.tsx
git commit -m "refactor(frontend): replace useApp() with individual context hooks in non-editor components"
```

---

## Phase B — Editor + Bridge removal (sequential after Phase A)

---

### Task 4: Create `useDocumentHelpers()` hook

**Files:**
- Create: `src/hooks/useDocumentHelpers.ts`

This hook provides the cross-context utilities that previously lived in the AppContextBridge (`getHourlyRatesForCustomer`, etc.) and `generateInvoiceFromJobs`. It reads from multiple individual context hooks internally.

#### Step 4.1 — Create `src/hooks/useDocumentHelpers.ts`

```typescript
import { useCustomers, getCombinedHourlyRatesForCustomer, getCombinedMaterialTemplatesForCustomer, getHourlyRatesForCustomer, getMaterialTemplatesForCustomer } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { useInvoices } from '../context/InvoiceContext';
import { useJobs, generateInvoiceFromJobs } from '../context/JobContext';
import { HourlyRate, MaterialTemplate } from '../types';

export function useDocumentHelpers() {
  const { customers } = useCustomers();
  const companyCtx = useCompany();
  const { addInvoice } = useInvoices();
  const { jobEntries, updateJobEntry } = useJobs();

  const getHourlyRatesForCustomerFn = (customerId?: string): HourlyRate[] =>
    getHourlyRatesForCustomer(customers, companyCtx.hourlyRates, customerId);

  const getMaterialTemplatesForCustomerFn = (customerId?: string): MaterialTemplate[] =>
    getMaterialTemplatesForCustomer(customers, companyCtx.materialTemplates, customerId);

  const getCombinedHourlyRatesForCustomerFn = (customerId?: string) =>
    getCombinedHourlyRatesForCustomer(
      customers,
      companyCtx.hourlyRates,
      companyCtx.company.showCombinedDropdowns ?? false,
      customerId
    );

  const getCombinedMaterialTemplatesForCustomerFn = (customerId?: string) =>
    getCombinedMaterialTemplatesForCustomer(
      customers,
      companyCtx.materialTemplates,
      companyCtx.company.showCombinedDropdowns ?? false,
      customerId
    );

  const generateInvoiceFromJobsFn = async (
    jobIds: string[],
    type: 'single' | 'daily' | 'monthly',
    date?: Date
  ) => {
    await generateInvoiceFromJobs(
      jobIds, type, jobEntries, customers, companyCtx.company, addInvoice, updateJobEntry, date
    );
  };

  return {
    getHourlyRatesForCustomer: getHourlyRatesForCustomerFn,
    getMaterialTemplatesForCustomer: getMaterialTemplatesForCustomerFn,
    getCombinedHourlyRatesForCustomer: getCombinedHourlyRatesForCustomerFn,
    getCombinedMaterialTemplatesForCustomer: getCombinedMaterialTemplatesForCustomerFn,
    generateInvoiceFromJobs: generateInvoiceFromJobsFn,
  };
}
```

- [ ] **Step 4.2 — Wire `useDocumentHelpers()` into TODO sites from Task 3**

In `JobEntryForm.tsx`, `JobManagement.tsx`, `JobInvoiceGenerator.tsx`: replace each `// TODO` comment with `const { getCombinedHourlyRatesForCustomer, ... } = useDocumentHelpers();` as appropriate. Add `import { useDocumentHelpers } from '../hooks/useDocumentHelpers';` to each file.

- [ ] **Step 4.3 — Commit**

```bash
git add src/hooks/useDocumentHelpers.ts src/components/JobEntryForm.tsx src/components/JobManagement.tsx src/components/JobInvoiceGenerator.tsx
git commit -m "refactor(frontend): extract cross-context utilities into useDocumentHelpers hook"
```

---

### Task 5: Update InvoiceEditor to use individual hooks

**Files:**
- Modify: `src/components/InvoiceEditor.tsx`

#### Step 5.1 — Replace `useApp()` calls in `InvoiceEditor.tsx`

Current code has two `useApp()` calls:
1. Line 56: `const { company } = useApp();`
2. Lines 469–483: Large destructure

Replace import at top of file:
```typescript
// Remove: import { useApp } from '../context/AppContext';
import { useInvoices } from '../context/InvoiceContext';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { useDocumentHelpers } from '../hooks/useDocumentHelpers';
```

Replace line 56:
```typescript
const { company } = useCompany();
```

Replace lines 469–483 destructure:
```typescript
const { invoices, addInvoice, updateInvoice, refreshInvoices } = useInvoices();
const { customers, addCustomer, refreshCustomers } = useCustomers();
const {
  company: _company, // already declared above — either merge or rename
  getInvoiceTemplates, addInvoiceTemplate, updateInvoiceTemplate, deleteInvoiceTemplate,
  getMaterialTemplates, getHourlyRates,
} = useCompany();
const {
  getHourlyRatesForCustomer,
  getMaterialTemplatesForCustomer,
  getCombinedHourlyRatesForCustomer,
  getCombinedMaterialTemplatesForCustomer,
} = useDocumentHelpers();
```

> The two `company` declarations need to be merged — either remove the first `useCompany()` call and keep only the second, or restructure to a single `useCompany()` call.

- [ ] **Step 5.2 — Verify `InvoiceEditor.tsx` TypeScript compiles**

Run:
```bash
INSTANCE=<your-instance>
docker compose --env-file .env.$INSTANCE -f docker-compose.yml build frontend 2>&1 | grep -E "error|warning"
```

Expected: zero TypeScript errors. Fix any `noUnusedLocals` / `noUnusedParameters` errors.

- [ ] **Step 5.3 — Commit**

```bash
git add src/components/InvoiceEditor.tsx
git commit -m "refactor(InvoiceEditor): replace useApp() with individual context hooks"
```

---

### Task 6: Update QuoteEditor to use individual hooks

**Files:**
- Modify: `src/components/QuoteEditor.tsx`

- [ ] **Step 6.1 — Replace `useApp()` calls in `QuoteEditor.tsx`**

Same pattern as Task 5. QuoteEditor's destructure (line ~438) uses: `customers, company, addQuote, updateQuote, getMaterialTemplatesForCustomer, getHourlyRatesForCustomer, getCombinedMaterialTemplatesForCustomer, getCombinedHourlyRatesForCustomer`.

```typescript
import { useQuotes } from '../context/QuoteContext';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { useDocumentHelpers } from '../hooks/useDocumentHelpers';

const { addQuote, updateQuote } = useQuotes();
const { customers } = useCustomers();
const { company } = useCompany();
const {
  getMaterialTemplatesForCustomer,
  getHourlyRatesForCustomer,
  getCombinedMaterialTemplatesForCustomer,
  getCombinedHourlyRatesForCustomer,
} = useDocumentHelpers();
```

- [ ] **Step 6.2 — Verify TypeScript compiles** (same docker build command as 5.2)

- [ ] **Step 6.3 — Commit**

```bash
git add src/components/QuoteEditor.tsx
git commit -m "refactor(QuoteEditor): replace useApp() with individual context hooks"
```

---

### Task 7: Remove AppContextBridge

**Files:**
- Modify: `src/context/AppContext.tsx`

**Depends on:** Tasks 5 + 6 complete (no more `useApp()` calls anywhere)

#### Step 7.1 — Verify no remaining `useApp()` usage

```bash
grep -rn "useApp" /Users/namysloj/Projects/Belego/src/
```

Expected output: empty. If any remain, fix them before proceeding.

#### Step 7.2 — Delete `AppContextBridge`, `AppContext`, `AppContextType`, and `useApp()` from `AppContext.tsx`

Remove:
- `interface AppContextType { ... }` (lines 28–81)
- `const AppContext = createContext<AppContextType | undefined>(undefined);` (line 87)
- `function AppContextBridge({ children }...) { ... }` (lines 112–237)
- `<AppContextBridge>` usage inside `AppProvider` (line 310)
- `export function useApp() { ... }` (lines 327–333)

Keep:
- All re-exports of individual hooks (lines 18–22)
- `LoadingContext`, `useLoading`, `LoadingContextType` (lines 93–106)
- `DataLoader` (lines 247–293)
- `AppProvider` (lines 299–321) — remove `<AppContextBridge>` wrapper, keep everything else

After edit, `AppProvider` should look like:
```typescript
export function AppProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);

  return (
    <LoadingContext.Provider value={{ loading, setLoading }}>
      <CustomerProvider>
        <InvoiceProvider>
          <QuoteProvider>
            <JobProvider>
              <CompanyProvider loading={loading}>
                <DataLoader>
                  {children}
                </DataLoader>
              </CompanyProvider>
            </JobProvider>
          </QuoteProvider>
        </InvoiceProvider>
      </CustomerProvider>
    </LoadingContext.Provider>
  );
}
```

Also export `useLoading` so components that use `loading` can import it:
```typescript
export { useLoading };
```

- [ ] **Step 7.3 — Verify TypeScript compiles**

```bash
docker compose --env-file .env.$INSTANCE -f docker-compose.yml build frontend 2>&1 | grep -E "error TS"
```

Expected: zero TS errors.

- [ ] **Step 7.4 — Commit**

```bash
git add src/context/AppContext.tsx
git commit -m "refactor(AppContext): remove AppContextBridge shallow pass-through"
```

---

### Task 8: Extract shared editor sub-modules

**Files:**
- Create: `src/components/shared/ItemsSection.tsx`
- Create: `src/components/shared/CustomerSelector.tsx`
- Modify: `src/components/InvoiceEditor.tsx`
- Modify: `src/components/QuoteEditor.tsx`

**Goal:** Extract the item management UI (drag-and-drop rows + add/remove) and customer picker into shared modules. Do NOT attempt a full DocumentEditor abstraction — too risky. Two focused extractions only.

#### Step 8.1 — Create `src/components/shared/CustomerSelector.tsx`

Read the customer selection section in `InvoiceEditor.tsx` (search for `showCustomerForm`, `newCustomerData`, `handleCustomerSelect`). Extract it into a component:

```typescript
interface CustomerSelectorProps {
  customers: Customer[];
  selectedCustomerId: string | undefined;
  onSelect: (customerId: string, customerName: string) => void;
  onCreateNew: (customerData: Omit<Customer, 'id' | 'customerNumber' | 'createdAt'>) => Promise<Customer>;
  onRefresh: () => Promise<void>;
}

export function CustomerSelector({ customers, selectedCustomerId, onSelect, onCreateNew, onRefresh }: CustomerSelectorProps) {
  // Move all customer search state and inline creation form from InvoiceEditor here
}
```

Replace the identical section in both `InvoiceEditor.tsx` and `QuoteEditor.tsx` with `<CustomerSelector ... />`.

- [ ] **Step 8.2 — Create `src/components/shared/ItemsSection.tsx`**

Read the item management section in `InvoiceEditor.tsx` — the `SortableInvoiceItem` component and the items array rendering. Extract into:

```typescript
interface ItemsSectionProps {
  items: InvoiceItem[];
  discountsEnabled: boolean;
  taxRates: number[];
  onChange: (items: InvoiceItem[]) => void;
}

export function ItemsSection({ items, discountsEnabled, taxRates, onChange }: ItemsSectionProps) {
  // Move SortableInvoiceItem + DndContext + SortableContext + item CRUD logic here
}
```

`QuoteEditor.tsx` has `SortableQuoteItem` which is structurally identical to `SortableInvoiceItem`. Verify the props match — the items in both are `InvoiceItem[]` (check `src/types/index.ts`). If they share the same type, one `ItemsSection` covers both.

Replace in both editors.

- [ ] **Step 8.3 — Verify TypeScript compiles**

```bash
docker compose --env-file .env.$INSTANCE -f docker-compose.yml build frontend 2>&1 | grep -E "error TS"
```

- [ ] **Step 8.4 — Commit**

```bash
git add src/components/shared/ src/components/InvoiceEditor.tsx src/components/QuoteEditor.tsx
git commit -m "refactor(editors): extract CustomerSelector and ItemsSection into shared sub-modules"
```

---

### Task 9: Add backend discount validation

**Files:**
- Modify: `backend/services/invoiceService.js`
- Modify: `backend/services/quoteService.js`

The frontend `validateDiscount()` in `discountUtils.ts` already handles client-side validation. The backend should reject invalid discount values at the persistence boundary.

#### Step 9.1 — Add `validateDiscountInput` to `backend/services/invoiceService.js`

```javascript
function validateDiscountInput(type, value, subtotal) {
  if (!type || value == null) return; // no discount is valid
  if (value < 0) throw new Error('Rabattwert kann nicht negativ sein');
  if (type === 'percentage' && value > 100) throw new Error('Prozentrabatt kann nicht über 100% liegen');
  if (type === 'fixed' && subtotal != null && value > subtotal) throw new Error(`Festbetrag kann nicht höher als ${subtotal.toFixed(2)}€ sein`);
}
```

Call it at the top of `createInvoice()` and `updateInvoice()`:
```javascript
validateDiscountInput(data.globalDiscountType, data.globalDiscountValue, data.subtotal);
```

Also validate per-item discounts in the items loop:
```javascript
for (const item of data.items) {
  const itemTotal = item.quantity * item.unitPrice;
  validateDiscountInput(item.discountType, item.discountValue, itemTotal);
}
```

- [ ] **Step 9.2 — Same in `quoteService.js`**

- [ ] **Step 9.3 — Update error handling in route handlers to surface 400 for validation errors**

In `backend/routes/invoices.js` POST/PUT handler:
```javascript
} catch (error) {
  if (error.message.startsWith('Rabatt') || error.message === 'Customer not found') {
    return res.status(400).json({ error: error.message });
  }
  logger.error('Failed to create invoice', { error: error.message });
  res.status(500).json({ error: 'Failed to create invoice' });
}
```

- [ ] **Step 9.4 — Commit**

```bash
git add backend/services/invoiceService.js backend/services/quoteService.js backend/routes/invoices.js backend/routes/quotes.js
git commit -m "feat(backend): add server-side discount validation"
```

---

## Phase C — Verification

### Task 10: Docker build + manual verification

**Depends on:** All previous tasks complete.

- [ ] **Step 10.1 — Build frontend (lint + type check)**

```bash
INSTANCE=<your-instance>
docker compose --env-file .env.$INSTANCE -f docker-compose.yml build frontend
```

Expected: Build completes with zero ESLint errors and zero TypeScript errors.

- [ ] **Step 10.2 — Start all services**

```bash
docker compose --env-file .env.$INSTANCE -f docker-compose.yml up -d
```

- [ ] **Step 10.3 — Verify backend health**

```bash
curl http://localhost:<BACKEND_PORT>/health
```

Expected: `{"status":"OK",...}`

- [ ] **Step 10.4 — Manual UI walkthrough (golden paths)**

Open `http://localhost:<WEB_PORT>` and verify each flow:

| Flow | What to check |
|------|--------------|
| Dashboard loads | Invoices + customers appear, no console errors |
| Create invoice with items + item discount | Invoice saved, correct totals |
| Create invoice with global discount | Correct total after discount |
| Submit invoice with invalid discount (e.g. 150%) | Frontend and backend both reject |
| Create quote, convert to invoice | Quote status updates, invoice created |
| Create job, add time entries + materials | Job saves correctly |
| Generate invoice from job | Invoice created with correct line items |
| Customer management | CRUD works, customer-specific rates visible |
| Settings — company update | Company data persists |
| Email send modal | Opens without errors |
| Backup | JSON backup downloads |

- [ ] **Step 10.5 — Check for broken `useApp` import** (sanity check)

```bash
grep -rn "useApp" /Users/namysloj/Projects/Belego/src/
```

Expected: empty.

- [ ] **Step 10.6 — Commit verification note**

```bash
git commit --allow-empty -m "chore: architecture improvements verified via manual Docker walkthrough"
```

---

## Self-review

**Spec coverage:**
- ✅ Candidate 1 (discount validation): Task 9
- ✅ Candidate 2 (editor sub-modules): Task 8 (scoped to CustomerSelector + ItemsSection — full DocumentEditor abstraction excluded as too risky)
- ✅ Candidate 3 (query extraction): Task 1
- ✅ Candidate 4 (AppContextBridge): Tasks 3, 4, 7
- ✅ Candidate 5 (service layer): Task 2

**Gaps / notes:**
- The `InvoiceEditor.tsx` and `QuoteEditor.tsx` still contain significant duplication beyond what's extracted in Task 8. Full deduplication would require a multi-week effort with live testing at each step. Task 8 extracts the two highest-value shared modules (customer selector, items section) — the rest is left for a future plan.
- `useLoading` is exported in Task 7 but only relevant if `loading` state is used outside `DataLoader`. If no component actually needs it after the bridge is removed, skip the export.
- Backend `updateInvoice` / `updateQuote` in Task 2 must carefully handle attachment diffs — the existing route likely has logic for updating vs. replacing attachments. Read it carefully before extracting.
