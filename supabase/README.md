# Candidate database contract

Inventory, supplies, recipes, costing and CSV import were removed on October 30
at the user's request. Checkout checks staff, owned shift, prices, modifiers,
quantities, tender and request identity; it never checks/deducts stock. The app
has no inventory screens or mutation RPCs. Captured legacy stock tables/columns
are historical schema evidence, kept inaccessible to browser writes. No hosted
business data has been deleted or migrated.

Retained migrations are `202610280001_secure_pos.sql`,
`202610280002_shift_expenses.sql`, `202610280004_reports.sql`,
`202610300005_single_drawer.sql`, `202610300006_loyalty_phone.sql` and
`202610300007_safe_drawer_rate.sql`, `202610300008_employee_drawer_recovery.sql` and
`202610300009_customer_correction.sql`, in that order.
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

SQL tests reconstruct the historical schema and insecure defaults locally,
prove access controls, pricing, replay, concurrent sales, cash reconciliation,
loyalty, cancellation and complete report totals. They explicitly verify sales
with legacy zero stock and that legacy product/ingredient quantities stay
unchanged. Actual Auth/PostgREST acceptance needs a new synthetic archive whose
contract matches this revision; older inventory-era archives are rejected.

Deploy only the matching app and database contract together after backup and
restore verification. Reconcile old browser-only shift/expense drafts before
cutover. Preserve sales and print journals across compatible app rollbacks.
Do not run old clients against the restricted schema or broaden grants to make
an old client work. Windows installation is described in
[deployment](../docs/windows-deployment.md).
