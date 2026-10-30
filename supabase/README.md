# Database contract and release procedure

`schema.snapshot.json` is verified catalog metadata from the café Supabase project, PostgreSQL 17.6. It contains definitions and permissions, not business rows or credentials. Eighteen public tables originally had no policies; seventeen disabled RLS and shifts enabled it without policies. Broad grants also permitted table operations outside RLS such as TRUNCATE. Two legacy stock functions accepted unsafe signed inputs.

`migrations/202610280001_secure_pos.sql` is the candidate repair, tested on isolated PostgreSQL 17.6 on this Windows PC. It has NOT been applied to production. `preflight.sql` is aggregate-only and read-only, for the original schema.

## Permissions

| Caller | Allowed behavior |
| --- | --- |
| Anonymous | Explicitly projected login directory only; no base-table access, stock or sale RPCs |
| Active cashier/barista | Catalog/customer reads; own orders/items/register/shift reads; customer registration; owned opening/checkout/close/recovery RPCs |
| Active administrator | Staff-safe profile reads; bounded profile-management RPC; catalog/supply/recipe administration; all sale/register/shift reads; cancellation RPC |
| Next.js user-creation route | Authenticates caller and checks active administrator before creating a server-only service client; compensates failed profile creation |

Profiles do not expose PINs to browser clients. Client writes to profiles, orders, order items, customer balances and shift summaries are revoked. Private helpers have fixed empty search paths and explicit grants. Both default-role names `cashier` and `barista` remain supported. All existing parallel legacy tables are protected and preserved.

New future objects receive no broad client default grants when created by the controlled migration owner. Supabase-managed-owner defaults are not silently modified; future migrations must explicitly set policies/grants and use the approved owner. Do not assume every future object is protected automatically.

## RPC contract

- `pos_login_profiles()`: table projection of id, full_name, username, avatar_url only.
- `pos_manage_profile(...)`: administrator profile changes/deactivation; immutable login identity and last-admin protection.
- `pos_register_customer(...)`: validated identity fields; server-controlled unique code and original 50-point welcome policy. Returns one JSON object.
- `pos_open_shift(request, cash, rate)`: persistent owner, unique request, one open register per cashier, validated amounts. Returns one JSON object.
- `pos_checkout(request, payload)`: one transaction, server catalog prices, allowed extra IDs, positive integer quantities, exact expected total, sufficient aggregate product/ingredient stock, customer row locking, immutable receipt/tender and stock snapshots. Identical requests return the same JSON receipt; payload mismatch fails. Register locking serializes closing against checkout. Recipe rows are aggregated and configuration stabilized during consumption.
- `pos_abandon_checkout(request)`: serializes with that cashier/request; refuses existing committed sales and records a permanent tombstone for an absent sale. A delayed checkout cannot later commit under an abandoned identity.
- `pos_close_shift(register, counted, expenses)`: owned closing, authoritative linked-sales calculation, immutable saved summary, identical retry return, no post-close sales. Returns one JSON object.
- `pos_cancel_sale(order)`: administrator only, once-only new-sale loyalty/spending reversal, actor/time recorded. No refund or inventory return; closed-register corrections require reconciliation. Legacy sales get no invented stock/loyalty reversal.

The browser never falls back to legacy multiwrite checkout. A scalar JSON return is intentional for the write-RPC response contract; SQL composite/table responses and the login list are not interchangeable in PostgREST.

## Inventory policy and data preservation

The candidate preserves the original dual product-plus-recipe deduction, now strictly checked. This requires actual maintained product counts. It may be the wrong long-term rule for made-to-order drinks; do not silently infer tracking from category or from the default ten. New products default to zero and have an explicit initial-count input; ordinary name/price editing no longer overwrites stock. An audited stock-adjustment/purchase/waste workflow is provided by migration 003; see [inventory operations](../docs/inventory.md). Existing balances still require physical reconciliation before deployment.

Read-only live preflight found 3 negative/missing product balances, 11 products at ten, 1 administrator candidate, and zero pending sales, duplicate normalized aliases, Auth-alias mismatches, unsupported roles, open registers, invalid recipe lines, duplicate recipe pairs, invalid supply balances, invalid prices or duplicate ticket-number groups. These counts do not establish actual physical stock or prove historical totals correct. The migration aborts on invalid inventory and does not reset existing balances.

No old business table or sale is dropped, no old amounts are backfilled, and no existing ticket sequence is reset. The migration adds nullable legacy-compatible snapshots/links and partial request uniqueness. Legacy own-cashier attribution, preparation names, stock reversals and historic loyalty cannot be guessed; administrators retain history access.

## Deployment gates

The local candidate now also includes `202610280002_shift_expenses.sql`. Apply it
after the first migration with the matching application. It adds durable expense
revisions/audit requests and replaces browser access to unchecked closing with a
four-argument preview-checked contract. The existing local staging instance is
not upgraded automatically. See `docs/shift-expenses.md` for recovery, isolated
HTTP acceptance and compatible rollback requirements.

1. Reconcile invalid stock using physical counts and choose maintained stock rules. Check the eleven default-ten balances rather than treating them as verified stock.
2. Review preflight in the original production schema. Reconcile any browser-only old shift/expense drafts before maintenance; an empty cash_registers table does not prove no legacy browser shift exists.
3. Verify a recoverable backup and restore in an isolated environment. Reproduce representative sanitized old records, permissions and defaults in a separate Supabase staging project.
4. In staging, run SQL migration as the controlled owner and exercise actual Auth cookies, anonymous directory, staff/admin RLS, joins, write RPC JSON, retries, cancellations, user provisioning and PWA upgrade. PostgreSQL-only tests do not replace this.
5. Build and validate the Windows release here; retain exact source/migration and dependency versions. Confirm cafe Node 24.14.1 Windows x64, process startup/restart, internet failure behavior and automatic customer/barista printing.
6. Stop the old app during coordinated deployment. Apply the versioned migration once, deploy the matching app, reload PostgREST schema, clear/update old installed service workers, and smoke-test before reopening the till. Never run old clients against the restricted schema or broaden grants to make them work.

SQL runs inside BEGIN/COMMIT and fails atomically. The file is an initial versioned migration, not an idempotent rerunnable SQL snippet. Rollback before any post-release transactions may use a tested restore; after new sales exist, use a forward repair/reconciliation and preserve those records. Reverting code to legacy checkout would reintroduce the original failure and does not safely undo new sale data.

## Test boundaries

`npm run test:db` reconstructs captured public tables, constraints and legacy function definitions, minimal auth.uid/role fixtures and original grants/defaults. It verifies the original escalation, new denial, legitimate staff/admin controls, inventory-preflight rollback, price/quantity/tender errors, failure after stock writes, duplicate recipe aggregation, receipt replay, concurrent last-stock sales, serialized close, cancellation and abandonment. All fixture records are synthetic and the server binds only to loopback.

It does not emulate the full managed Supabase Auth service, PostgREST deployment/cache, custom schemas/hooks outside the snapshot, real payment terminals, internet latency measurements or printer drivers. Those remain explicit staging/physical acceptance gates.

The additional [local Supabase acceptance workflow](staging/README.md) now runs real GoTrue, PostgREST and a production Next.js build in an isolated Docker stack. Its 42 checks passed, including real cookie Auth/refresh, user provisioning, RLS joins, JSON write-RPC contracts, concurrent replay, cancellation/closing and deactivation. Browser login, customization and a synthetic sale also passed. No hosted project was used for those writes. The CLI's local database is PostgreSQL 17.11; the separate disposable SQL suite still runs the captured schema on PostgreSQL 17.6. Hosted Auth configuration/custom hooks and physical acceptance remain distinct.

## Inventory and report candidates

Apply 003 and 004 only after 001/002 as part of a reviewed matching release. The plain Spanish touch workspace is the default; `POS_REGISTER_UI=owner` and `POS_REGISTER_UI=prototype` retain compatible UI alternatives. Report RPCs are read-only administrator functions with full server totals, 50-row pages, and Matamoros date boundaries. See [report contracts](../docs/reporting.md). `npm run test:reports-http` upgrades a new owned synthetic archive restore only; source staging and the café are never connected. The hosted project has not received these changes.
