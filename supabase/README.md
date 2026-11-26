# Database contract

The application uses Supabase/PostgreSQL, Auth and restricted server-side RPCs. Source SQL and the accepted package define compatibility; documentation is not an applied-migration ledger for a client.

## Source of truth

- `migrations/`: retained forward migrations, applied in their declared order by a deliberate maintenance procedure. The removed, unreleased migration 003 is not restored.
- `schema.snapshot.json`: captured baseline schema used by tooling; not a client backup or evidence that later migrations are installed.
- `smoothies/`: additional Smoothies-specific migrations, separate from Café behavior.
- `functions/clip-webhook/`: notification receiver; a callback is a hint, not authority to approve a payment.

Do not rewrite already applied SQL or assume a migration number from another branch has the same meaning. Compare exact files/contracts, client backend identity and supported predecessor before changing an existing installation. Forward changes, encrypted preflight backup and a compatible recovery path are required. Automatic application updates do not apply SQL.

## Business invariants

Checkout validates staff, owned drawer, prices, allowed options, amounts and request identity in one transaction. Replays recover the original result. Closing/handoff, phone orders, payment journals, expenses and inventory have durable request/revision guards; do not bypass them to clear an uncertain result.

Café finished-product inventory is explicit opt-in; unknown stock differs from zero. Legacy ingredient/recipe fields are inert. Smoothies recipes remain a product-specific capability. New in-person payments require a delivery control; persisted phone pickup orders have their own exception and preparation identity. See [inventory](../docs/inventory.md), [single drawer](../docs/single-drawer.md), [phone orders](../docs/phone-orders.md) and [CLIP](../docs/clip-payments.md).

## Development and deployment

`npm run test:db` rebuilds disposable local PostgreSQL and checks permissions, concurrency, replay, money, reports and recovery. [Staging](staging/README.md) adds isolated real Auth/PostgREST and browser checks. It never uses a client backend as a fixture. A missing function is a failed check, not an acceptable substitute for its behavior.

A release must match both the application and database contract. Never broaden grants so an old app can run, rewind data after trading, or migrate a historical development target to fix a client-target mismatch. Keep private credentials and actual deployment receipts outside Git. The dated [integration record](../docs/integration-readiness.md) preserves historical deployment evidence; [product plans](../docs/products/cafe.md) identify current unresolved gates. Windows preparation is in [windows-deployment](../docs/windows-deployment.md).
