> Current single-drawer handoff and saved-rate behavior also requires migration 005. See [single drawer](single-drawer.md). The original multi-cashier independent-shift test scenarios below precede that constraint.

# Expense journal and verified closing

> Scope: inherited shared-source reference. Café-specific examples and dated
> acceptance results below are historical; they are not Smoothies menu, printer,
> provider, rate or deployment defaults. Use [Smoothies progress](products/smoothies.md)
> and [local operation](smoothies-local.md) for this product. No old deployment
> authorization is renewed by this document.


The cashier keeps the same expense controls, closing panel and manual printing
choices. Expense controls wait for server acknowledgment; a failed or uncertain
save shows a Spanish recovery message instead of changing the displayed journal.

## Database contract

Apply `202610280002_shift_expenses.sql` after `202610280001_secure_pos.sql` as one
coordinated app/database release. Neither migration has been applied to the live
café by this work. Do not run an old application against the new closing contract.

`cash_registers.expenses_detail` and `expenses_revision` are the current durable
state. `cafe_private.shift_expense_requests` is an append-only audit of submitted
expense revisions and identities. Browser roles have no direct write access to
the state or access to the private journal. `pos_shift_expenses` derives the
cashier, locks that cashier's register, validates cents/description/limits, checks
the expected revision, and commits the journal and current state together. The
same UUID/payload can be retried, including after the register closes. Reusing an
identity with different contents or submitting an obsolete revision is rejected.

`pos_shift_summary` locks the register for a consistent read and aggregates all
linked completed sales on the server. API row caps cannot truncate this scalar
result. Card sales do not count toward drawer cash. MXN/USD `mixto` retains its
existing meaning; this is not cash/card split tender. Cancellation and pending
statuses are excluded. Preview and final closing use the same cash classification
and the same authoritative summary rather than separate calculations.

The four-argument `pos_close_shift` accepts the counted amount, displayed expense
array and server preview. Under the checkout register lock it rejects changes
to expenses, their revision or cash/total sales since that preview. It records
the same authoritative totals and exactly one closed report. The unchecked
three-argument entry point is no longer executable by browser roles.

## Browser recovery

Before a write, the browser saves the exact cashier-scoped expense request or
closing payload in localStorage. A transport error or 12-second deadline retains
it. A confirmed SQL rollback can retire its request; an acknowledged successful
write retires it only after validating the returned state/report. Web Locks
prevent two tabs from replacing the same pending browser request, and database
revision checks also protect separate browser profiles/machines.

Refresh/login recovers pending expense requests, then pending closing requests,
before loading/opening a new register. Direct logout does not delete these keys.
Expense acknowledgments arriving after a cashier switch cannot publish into the
next cashier's panel. Confirmed expenses are recovered from the server even if
browser storage is lost; an unacknowledged request still needs its local identity
or responsible-person reconciliation.

Cashier-scoped legacy `mi_cafe_shift:<user>` expenses are imported only into an
untouched server journal, through the same persisted idempotent request. The old
record is retained until acknowledgment. A different nonempty/revised server
history fails closed for reconciliation; no speculative merge is performed.
Unattributed global `mi_cafe_shift` records from the original application must be
reconciled before release; ownership cannot safely be inferred.

## Verification

- `npm test`: actual page handlers, browser recovery/storage/race fixtures,
  existing owner-layout component test using the real $80 cappuccino, and real
  menu arithmetic/modifier/pack cases. No physical printing.
- `npm run test:db`: fresh embedded PostgreSQL only; both migrations,
  permissions, journal replay, stale/concurrent revisions, malformed expenses,
  all 82 supplied menu presentations through checkout, milk variants, more than
  1,000 sales, card/cancellation exclusions, stale previews, and close replay.
- `npm run test:shift-http`: verifies a retained encrypted synthetic archive,
  restores into owned disposable loopback Docker containers, applies the new
  migration there, and tests real GoTrue/PostgREST. It never connects to source
  staging or a hosted target, and removes its own containers in `finally`.
  Requires a compatible locale/ACL-complete archive under ignored local recovery
  storage and the normal local Docker runtime. It deliberately has no production
  fallback. The retained source archive remains unchanged.

The normal existing staging database still has its previous schema/hash and is
left intact for other local demos. Its identity guard will refuse the changed
candidate until a separate controlled staging upgrade/rebuild occurs. Do not
edit its identity marker to bypass that refusal. The HTTP drill updates the
marker only inside its newly owned migrated restore.

Production rollback must retain an app compatible with the new journal and
four-argument closing contract. Returning to the previous source without a
compatible database contract is unsafe. Preserve all new sales/expense history;
do not rewind a database after trading resumes.

These checks establish software behavior with synthetic records. Real opening
cash counts, live migration/restore operations, Windows boot/watchdog behavior and
physical printer/TV acceptance remain deployment requirements.
