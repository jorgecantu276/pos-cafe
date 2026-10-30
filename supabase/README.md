# Candidate database contract

Migration 006 adds the requested simple finished-product inventory after removal
of the earlier recipe-based design. Checkout retains its staff, shift, price,
modifier, tender and replay checks. Its order-item insert also enforces current
availability and deducts known product counts in the same transaction. Recipes,
ingredient costing and captured legacy stock balances remain unused. No hosted
business data was changed by this branch. See [inventory operation](../docs/inventory.md).

Retained migrations are `202610280001_secure_pos.sql`,
`202610280002_shift_expenses.sql`, `202610280004_reports.sql` and
`202610300006_simple_inventory.sql`, in that order.
The removed, unreleased migration 003 is not part of this candidate. Do not
apply this revised draft to a database that already ran an earlier candidate;
that requires a deliberate forward migration. No client database has run it.

The snapshot is the originally captured schema, not a sanitized customer backup
or an instruction to copy live business records. Before creating the client
project, prepare its baseline schema and confirmed admin identity, review all
four migrations, and rehearse on an isolated synthetic database. Confirm the
release chat's current hosted setup state before rollout; this branch deploys nothing.

SQL tests reconstruct the historical schema and insecure defaults locally,
prove access controls, pricing, replay, concurrent sales, cash reconciliation,
loyalty, cancellation and complete report totals. They explicitly verify sales
with legacy zero stock and that legacy product/ingredient quantities stay
unchanged. Inventory cases additionally exercise initial unknown counts, manual
adjustments, atomic CSV batches, stale revisions, sale rollback, concurrent last-piece
sales and partial/idempotent sellable returns. Actual Auth/PostgREST acceptance needs a new synthetic archive whose
contract matches this revision; older inventory-era archives are rejected.

Deploy only the matching app and database contract together after backup and
restore verification. Reconcile old browser-only shift/expense drafts before
cutover. Preserve sales and print journals across compatible app rollbacks.
Do not run old clients against the restricted schema or broaden grants to make
an old client work. Windows installation is described in
[deployment](../docs/windows-deployment.md).
