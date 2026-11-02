# Candidate database contract

The earlier ingredient/recipe inventory remains removed. On November 2 the user
authorized integrating the separate finished-product inventory locally. Migration
017 adds `pos_inventory_*` tables, admin RPCs, explicit activation (OFF initially),
atomic sale deductions, partial returns and private CLIP reservations. Legacy
stock fields/recipes remain inert. Checkout still validates staff, owned shift,
prices, modifiers, quantities, tender and request identity. See [inventory](../docs/inventory.md).

Retained migrations are `202610280001_secure_pos.sql`,
`202610280002_shift_expenses.sql`, `202610280004_reports.sql`,
`202610300005_single_drawer.sql`, `202610300006_loyalty_phone.sql` and
`202610300007_safe_drawer_rate.sql`, `202610300008_employee_drawer_recovery.sql` and
`202610300009_customer_correction.sql`, `202610300010_register_shortcuts.sql`,
`202610300011_recent_tickets.sql`, `202610300012_business_backups.sql`,
`202611020013_catalog_requests.sql`, `202611020014_customer_history.sql`,
`202611020015_order_pager.sql`, `202611020016_clip_payments.sql` and
`202611020017_inventory.sql`, in that order.
The removed, unreleased migration 003 is not part of this candidate. Do not
apply this revised draft to a database that already ran an earlier candidate;
that requires a deliberate forward migration.

The snapshot is the originally captured schema, not a sanitized customer backup
or an instruction to copy live business records. A fresh client project was
provisioned in the client's own account through the CLI on October 30, after the
local migration rehearsal. It contains the baseline, the retained migrations,
Sandra's administrator profile and the 82 products from the supplied menu, with
the confirmed milk options. No old-POS customers, sales or shifts were copied.
The owner selected an initial rate of 18 MXN per USD. Credentials, server keys and
the project-specific runtime configuration remain outside Git. The matching
application still needs to be installed on the café PC.

On November 2, migrations 013–016 were applied to the verified client project;
all 15 retained versions are synchronized. The CLIP receiver is deployed, but
automatic charging remains OFF with a placeholder token. An encrypted backup
and fingerprints verified preservation of all 28 existing exported tables.
Do not reapply these migrations or migrate the historical development target.
Migration 017 has been rehearsed ONLY on fresh local databases. It is not deployed
to that hosted client. The matching app requires it even while inventory is OFF.
See [integration readiness](../docs/integration-readiness.md) and
[CLIP deployment](../docs/clip-payments.md).

SQL tests reconstruct the historical schema and insecure defaults locally,
prove access controls, pricing, replay, concurrent sales, cash reconciliation,
loyalty, cancellation and complete report totals. They explicitly verify sales
with legacy zero stock and that legacy product/ingredient quantities stay
unchanged. A fresh disposable Auth/PostgREST acceptance stack exercises the current
UI/backend contract, stock writes/sales/returns and disabled CLIP. Browser quality
checks use the 82-product reference menu, without touching hosted data. Older
archives whose contracts do not match must not be reused silently.

Deploy only the matching app and database contract together after backup and
restore verification. Reconcile old browser-only shift/expense drafts before
cutover. Preserve sales and print journals across compatible app rollbacks.
Do not run old clients against the restricted schema or broaden grants to make
an old client work. Windows installation is described in
[deployment](../docs/windows-deployment.md).
