# October 30 review fixes

The reviewed baseline was `feea91f`. These changes address reproduced software
defects and the verified runtime issue. PR #1 remains draft and main is not merged.

- Middleware uses Supabase `getAll`/`setAll`, forwarding every refreshed or deleted
  cookie and the SDK's cache headers through normal, redirect and denied responses.
  The regression uses the actual installed SSR/Auth libraries with synthetic
  expired sessions, including multi-chunk refresh, shrink and deletion.
- Checkout has a 12-second application deadline. A timeout remains an uncertain
  write, retaining the exact request UUID/payload for recovery. Login, initial
  authentication and resource loading also have bounded waits. Late results
  cannot clear the pending checkout record or authorize a second charge.
- Each print copy rechecks the saved sale after asynchronous preparation and
  before the submission fence. Cancellation cancels pending preparation; failed
  eligibility reads block printing. Failed stale workers cannot resurrect a
  cancelled job. Cancellation racing after the final read cannot recall a job
  already crossing the Windows handoff boundary.
- Register and administrator reprints share `/api/receipts` and the original
  customer document when it exists in the local journal. Otherwise they rebuild
  from the immutable sale snapshot with an explicit current-issuer notice.
  Legacy records explicitly identify missing original fields. Pending sales
  cannot issue a sales receipt. Reprints retain a Windows dialog and a visible
  reprint/cancelled marker; this endpoint never submits a job or changes a sale.
- Node 24.22.2 x64 / SQLite 3.53.4 is pinned in CI, package engines, instructions
  and V5 packaging. The packager verifies the loaded engine; the print journal
  rejects vulnerable older SQLite engines before opening its data file. UNC
  network paths are rejected. Persistent journal/backup discipline still matters.
- The settings screen no longer presents a fake save action or invented receipt
  preview. Unconnected coupon mutation controls are disabled and their checkout
  limitation is explicit. This does not implement a promotion engine or receipt
  configuration editor. Base-cost reports retain their existing estimate label.

## Verification

Node 24.22.2 Windows x64 passed lint, TypeScript, 115 unit/UI/layout tests,
1,831 disposable PostgreSQL assertions and full/runtime-only dependency audits
with zero findings. The production print/reprint HTTP drill passed against
synthetic Auth/PostgREST responses and mock printers, including concurrency,
retry, restart, uncertain outcomes and cashier separation. It builds its own
isolated production application with a fictitious issuer profile.

The real local Auth/PostgREST inventory/report drill passed 15 checks using
alternate loopback ports 55560/55562/55563/55564. A process-local test loader
changed only port literals and its output folder; repository safety checks,
archive verification, synthetic restore ownership and cleanup remained active.
Existing preview services were left running. This was not a hosted migration or
a browser/hardware end-to-end test.

The extracted V5 ZIP passed ten manifest hashes and 24 sample cases twice:
48 simulated copies, zero duplicates, zero physical jobs. It uses the bundled
runtime, not the PC's installed Node. These checks do not prove physical paper
output or Bluetooth/USB recovery.

## Remaining acceptance

Physical stock/queues/driver compatibility, paper output, Bluetooth recovery,
cafe-PC startup and performance remain on-site checks. Nulltonex branding is
user-confirmed; PC/USB-printer model is pending. Unidentified HDMI receives only
generic connection checks. TV manufacturer research is excluded.

Production stock reconciliation, backups, all four coordinated migrations and
correct release environment remain deployment gates. GitHub runner execution
was blocked by account payment/spending settings at the earlier run; local
passes do not imply hosted CI passed. No merge, hosted business write, driver
installation or cafe-PC deployment is performed by this fix.
