# Route handlers keep their own try/catch instead of routing through asyncHandler

`backend/utils/routeHelpers.js` provides `asyncHandler`, and `backend/server.js` has a global
error-handling middleware, so it looks like the ~105 `try/catch` blocks across `backend/routes/*.js`
are removable boilerplate. They are not, and we are deliberately leaving them in place.

## Why

The `try/catch` blocks are structurally similar but their *contents* are not duplicated. Measured
2026-08-22: of the route-level catches that return a 500, **35 out of 35 carry a distinct German
error message** (`'Fehler beim Laden der Stundensätze'`, `'Fehler beim Erstellen des Stundensatzes'`,
…). The global middleware responds with a generic `{ error: 'Internal server error' }`. Since
`src/services/api.ts` surfaces `errorData.error` and the frontend now shows those messages to the
user in an `alert`, converting to `asyncHandler` would replace 35 specific diagnostics with one
generic string — losing information, not concentrating it.

Additionally, only ~50 of the 105 catches are route-level responders at all: ~44 are inner catches
inside loops that deliberately do not respond, 6 perform a transaction `ROLLBACK` (`jobs.js`,
`company.js`, `backup.js`) and must stay exactly where they are, and 5 return non-500 codes.

## Also rejected: `transformRow` for query row mapping

`routeHelpers.transformRow` only renames snake_case keys to camelCase. The hand-written mappers in
`backend/queries/*.js` additionally call `parseFloat()` on NUMERIC columns — `pg` returns those as
**strings** — and apply `|| []` defaults and conditional null handling. Swapping in `transformRow`
would ship `subtotal: "238.00"` instead of `238` and break arithmetic in the frontend.

## Consequences

`routeHelpers.js` is mostly unused by design. If it is ever adopted, the route-level messages must
be preserved — e.g. via an `AppError(message, statusCode)` thrown from handlers and rendered by the
global middleware. Do not "clean up" the per-route catches without that in place.
