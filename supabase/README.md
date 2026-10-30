# Candidate database contract

Inventory, supplies, recipes, costing and CSV import were removed on October 30
at the user's request. Checkout checks staff, owned shift, prices, modifiers,
quantities, tender and request identity; it never checks/deducts stock. The app
has no inventory screens or mutation RPCs. Captured legacy stock tables/columns
are historical schema evidence, kept inaccessible to browser writes. No hosted
business data has been deleted or migrated.

Retained migrations are `202610280001_secure_pos.sql`,
`202610280002_shift_expenses.sql` and `202610280004_reports.sql`, in that order.
The removed, unreleased migration 003 is not part of this candidate. Do not
apply this revised draft to a database that already ran an earlier candidate;
that requires a deliberate forward migration. No client database has run it.

The snapshot is the originally captured schema, not a sanitized customer backup
or an instruction to copy live business records. Before creating the client
project, prepare its baseline schema and confirmed admin identity, review all
three migrations, and rehearse on an isolated synthetic database. The client
account is awaiting email verification. No live hosted setup has been performed.

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
