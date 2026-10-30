# Cariñito Mío POS

Next.js 16.4.3, React 19, Supabase, TypeScript, Tailwind and Zustand. Build and test on this development Windows PC; distribute reviewed releases to the café PC through GitHub. The default is a plain Spanish touch workspace that preserves the original catalog-left/order-right workflow. Retain the owner and Juniper layouts with `POS_REGISTER_UI=owner` or `POS_REGISTER_UI=prototype`. See [workspace design and rollback](docs/workspace.md).

## Development

Use Node.js 24.22.2 on Windows x64 for the verified candidate, then `npm ci`. The cafe PC reports an i5-8250U, 7.92 GB RAM and Windows 11 x64; its existing Node 24.15.0 embeds patched SQLite 3.51.3 but differs from our tested pin. App performance and display scaling still need measurement. The replacement is not installed there yet; the old POS remains separate.

Keep `.env.local` untracked with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Account creation also requires the server-only `SUPABASE_SERVICE_ROLE_KEY`. Never expose it through a `NEXT_PUBLIC_` variable. Use a separate Supabase project and synthetic data for development writes.

`npm run dev` starts the app at http://127.0.0.1:3000. This is a cloud-dependent POS; installation as a PWA does not provide offline sales. New screens require the versioned database migration. If RPCs/columns are absent, financial operations fail closed; there is no fallback to unsafe legacy writes. Do not apply the migration to production simply to make a preview work.

## Verification

- `npm test`: synthetic cart, actual POS component/cashier flow, async loading/abort, service-worker cache retirement, event-handler, user-route, recovery, cancellation and printing regressions. No live business writes or physical print jobs.
- `npm run test:db`: starts isolated PostgreSQL 17.6 on loopback port 55439, reconstructs the captured schema with minimal Auth-role fixtures, reproduces the original anonymous escalation, applies the migration, and checks authorization, rollback, authoritative pricing, idempotency, concurrent sales/closing races, and recovery. Needs that port free. Synthetic clusters are created in a new per-user OS temporary directory and stopped in `finally`; no manually created sibling folder is required. Windows uses `pg_ctl` for restricted-token startup in elevated runners and retains bounded native startup diagnostics.
- `npm run typecheck`: TypeScript.
- `npm run test:recovery`: encrypted local backup, fresh-cluster restore, atomic restore failure and compatible production-app rollback after a synthetic sale. Requires local staging; see [recovery drill](supabase/staging/RECOVERY.md).
- `npm run lint`: full rules, with zero warnings permitted. No rule suppression for legacy pages.
- `npm run build:verify`: production webpack build in ignored `.build-check-*`, separate from active dev output. Local environment files are copied to ignored scratch; never share that directory. Dependencies are linked locally, and scratch is retained for inspection.
- `node scripts/smoke-production.mjs http://127.0.0.1:3100`: against an isolated production server, checks login redirects, unauthorized API rejection, manifest and uncached service-worker delivery.

The legacy PWA plugin, its duplicate older Next.js dependency, and the unused Supabase auth helper were removed. The replacement worker retains `/sw.js` so installed clients can update, retires known legacy caches, and does not intercept network requests. It provides no offline sale queue. Verify updates on an existing installed café client in staging.

The lockfile installs without audit findings in both full and runtime-only audits at verification time. Re-run `npm audit` and `npm audit --omit=dev` before a release; do not use forced downgrades to satisfy an audit.

The PostgreSQL tests prove SQL behavior, not complete Supabase Auth/PostgREST deployment behavior. `npm run staging:start` and `npm run staging:test` exercise real local Auth/PostgREST and the Next.js cookie/API boundary with synthetic data. See [local staging instructions](supabase/staging/README.md). `npm run staging:app` runs the default workspace UI against that local stack on port 3101 without changing `.env.local`. `npm run test:lifecycle` is a browser-assisted drill for production startup, lost-response recovery after process restart and replacement of an installed legacy-worker fixture; see [procedure and limitations](supabase/staging/LIFECYCLE.md). Hosted configuration, Windows boot/watchdog setup and the exact installed café PWA remain separate acceptance checks.

## Checkout and closing recovery

Unpaid carts now survive refresh and app-process restart in the same browser profile. Drafts are scoped to the authenticated cashier and open shift; quantities, extras, preparation/order notes, order type and customer selection restore against the current catalog. Storage errors and conflicting tabs block new payment, and completed sales retire their unpaid draft before clearing recovery protection. See [draft behavior and limits](docs/cart-drafts.md).

The browser persists a per-user checkout UUID and exact request before calling `pos_checkout`. PostgreSQL derives the cashier, checks staff status, owned open shift, prices, extras, quantities and tender; it commits the complete sale and customer changes atomically. Duplicate requests return the same receipt; different payloads cannot reuse its identity. Receipts save product/modifier/preparation and tender snapshots.

A lost response retains that request. `Recuperar la misma venta` retries the same transaction, not a second charge. `Descartar solicitud sin venta` succeeds only after the server proves no sale exists under its serialized key and records an abandonment tombstone. Delayed requests with that key then fail. A committed sale cannot be abandoned. Recovery of an already cancelled sale clears the pending marker without claiming another sale. Legacy uncertain markers still require responsible-person reconciliation.

The café has one POS/drawer: only one open shift is permitted. Cashier handoff records the outgoing count, then requires the named incoming cashier to sign in and confirm receipt. The owner saves the USD/MXN rate once; cashiers do not re-enter it per shift. See [one drawer, rates and quick loyalty signup](docs/single-drawer.md). Shift opening is persistent and owned. Expense additions/deletions now save into a durable, revision-checked server journal with an audit trail. Logout does not discard them. Closing preview and final closing use one server summary over all completed sales, without API row-cap truncation. Closing rejects a changed preview and returns the same stored report on retries; uncertain expense/close requests recover after refresh/login. Printing uses the confirmed report. This requires the second versioned migration; see [expense and closing contract](docs/shift-expenses.md).

Cancellation is administrator-only. Physical refunds remain manual. For new sales it reverses recorded loyalty awards and spending once. Historical rows without those snapshots receive no guessed reversal. Closed-shift cancellation requires a separate reconciliation workflow.

## Customer and barista printing

Confirmed sales save a cashier-scoped print intent and automatically dispatch two independent jobs: customer receipt to `POS80 Printer` (USB CP001) and preparation labels to `Y813BT Sticker` (Bluetooth COM3). The server reads the immutable receipt snapshot and keeps a durable per-copy SQLite journal. See [configuration, recovery and physical testing](docs/printing.md). Physical printing is opt-in and remains disabled until local configuration is provided. Historical reprints and closing reports retain the Windows print dialog.

Customer tickets use Mexican receipt references with a separate local issuer profile. The client's supplied constancia has been transcribed into local configuration outside versioned source; examples and fixtures retain fictitious details. Set server-only `POS_RECEIPT_ISSUER_FILE` for real customer dispatch. The isolated hardware kit accepts the same profile and always prints a marked test. Barista labels prioritize name, drink and modifiers in a Starbucks-inspired layout on the selected Hybsk 57.15 × 31.75 mm stock. CFDI stamping and global invoicing are separate from ticket printing.

- USB `POS80 Printer`, driver POS80 5.1.1.43, CP001, VID4B43/PID3830, 203 dpi: dispatch explicitly selects the advertised 72 × 210 mm form instead of inheriting the observed 3276 mm default. Actual roll and physical output remain unverified.
- Bluetooth `Y813BT Sticker`, driver Y813BT Label 1.1.3.1, device Y813BT-E08D, SPP COM3, 203 dpi: discovered paired but disconnected. Confirm loaded stock; each cup has its own section and overflow continues on identified labels. The job selects the confirmed form explicitly.
- Retries never charge or resubmit an accepted copy. Uncertain spool outcomes require queue/paper reconciliation. Windows acceptance is not proof of physical output.
- `node scripts/printing/http-drill.mjs` builds an isolated production app with its own loopback Auth/PostgREST fixtures and mock printers, exercises parallel submissions/retries/restarts/cancellation and never reads live café data or sends physical jobs.

## Release status

The October 31 hardware-test candidate and acceptance steps are recorded in [the test plan](docs/test-plan-2026-10-31.md). Windows CI verifies clean installation, lint, TypeScript, unit/UI/layout tests, disposable PostgreSQL, dependency audits, an isolated production build and production printer recovery using synthetic loopback fixtures.

See `supabase/README.md` and [Windows deployment](docs/windows-deployment.md). The client's Supabase signup is awaiting email verification. The matching app and retained migrations 001, 002, 004 and 005 have not been installed/applied on the café PC or hosted client project. PR #1 remains draft; main has not been merged.

Keep the app and database migration in one planned release. Build here, verify a compatible Windows runtime artifact and actual café Node/runtime, then sync the reviewed source/migrations and release artifact. Do not require the café PC to become the build machine. Local Auth/PostgREST acceptance, encrypted backup/cold-restore/compatible-app rollback, production process restart and legacy-worker fixture upgrade drills pass. Hosted restore, off-device backup operations, Windows boot/watchdog setup and physical acceptance remain release work. Do not roll back to the old unrestricted checkout after tightening the database.

Touch workspace, sales and shift controls, dashboard metrics and reporting pagination/aggregates are implemented. Inventory, supplies, recipes, costing and the CSV importer were removed at the user's explicit request; checkout never checks/deducts quantities. See [report contracts and limits](docs/reporting.md). Promotions, settings persistence and password reset remain incomplete. Client database configuration, deployment and operational acceptance remain outstanding. Passing local verification is not full operational acceptance.
