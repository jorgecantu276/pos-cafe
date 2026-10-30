# One POS, one drawer, cashier handoff

Apply `202610300005_single_drawer.sql` after 001, 002 and 004 with the matching
app. No hosted migration is applied by development/tests. Migration preflight
refuses multiple open historical shifts; a responsible person must reconcile
them, rather than the migration inventing a close or count.

The database permits one globally open register. Logging into a different staff
account does not create another drawer or take over the existing session.
Logging out leaves the current shift open and does not transfer responsibility.

## Normal handoff

1. Finish or clear the unpaid order and resolve uncertain checkout/expense writes.
2. Tap **Cambiar cajero**, count physical MXN and USD, and select the next cashier.
3. Save the count. One transaction saves the outgoing Z close and reserves the
   drawer for the named incoming cashier. A changed closing preview rejects
   everything, so a concurrent sale cannot disappear between count and close.
4. The outgoing cashier signs out. The incoming cashier signs in with their own
   account, recounts what they received, and accepts. Their confirmed amount is
   the next opening balance; the outgoing shift's exchange rate is retained.
5. Different counts require an explanation. Both counts, cashier names, dates,
   difference and note remain visible in **Administración → Caja y tipo de cambio**.

An administrator can reassign a pending delivery if the intended recipient is
unavailable; a reason and audit record are required. Active drawer owners and
pending recipients cannot be deactivated until their responsibility is resolved.
The normal **Terminar turno** action closes without naming a successor, for end
of day. Actual cash remains subject to the recorded physical count; the app does
not operate the physical drawer mechanism or refund a payment.

Unknown handoff/acceptance responses retain the exact actor/request/payload in
browser storage. Recovery uses that identity; repeating it cannot create a
second incoming shift or repeat a close. Do not clear site data to resolve an
unknown outcome. SQL journals also protect different tabs/profiles/machines.

## Saved commercial exchange rate

The administrator saves MXN per USD once under **Caja y tipo de cambio**. No
default market rate is invented and no external exchange-rate service is used.
Cashiers see the saved value at opening but cannot edit it per shift. The value
persists in Supabase. Changes are allowed only with no open drawer and no pending
handoff, and apply to future fresh openings. Historical sales and handoffs keep
their original rate. MXN/USD cash totals are recorded in MXN equivalent; this is
not a separate-currency bank ledger or cash/card split tender.

## Quick loyalty enrollment

**Cliente → Nuevo cliente** requires a name and phone (10–15 digits). Surname
and birthday are optional. Customers do not need email, a password or an Auth
account. The new customer is selected for the current purchase. Phone is the
primary search field and appears in search results. Mexican ten-digit numbers
and their +52 format identify the same person; explicit other country prefixes
remain distinct. Punctuation is ignored. Duplicate phones are rejected, including
concurrent registrations and the older registration RPC. Existing customers are
preserved. Name/code search remains available, and an ambiguous search requires
choosing a result. Migration 006 enforces this on the server.

The existing 50-point welcome rule is preserved. Completed linked purchases add
`floor(total MXN / 10)` points, and retries do not award twice. Redemption,
expiration and birthday rewards are not introduced by this change. Enrollment
also persists and replays its own request if the response is lost.

Verification includes a fresh local PostgreSQL migration rehearsal, competing
openings, concurrent sale/handoff, repeated acceptance, wrong-account rejection,
discrepancy notes, administrative reassignment, rate-change restrictions, signup
replay and first-purchase loyalty. `test:cashiers` now exercises the one-drawer
flow through real local Auth/PostgREST in a matching owned synthetic restore;
its former interactive two-independent-shifts scenario is retired. Passing these
checks does not install the app or verify a physical printer.
