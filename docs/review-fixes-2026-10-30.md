> Updated scope: inventory, recipes, supplies, costing and CSV were removed by the user on October 30. Older inventory verification below is historical and does not describe this candidate. Use retained migrations 001, 002 and 004 and the current Windows checks.

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

## Follow-up using actual PC evidence

The later console output confirms Windows x64 / interactive PowerShell 5.1,
i5-8250U (4 cores/8 threads), 7.92 GB RAM, and both exact queues and ports.
The receipt form is 71.88 x 210.06 mm; the selected label form is 56.9 x 32 mm.
Both satisfy the helper's 1.5 mm tolerance. The receipt's long default is still
3276.09 mm, so browser-dialog reprints/closing reports need the short form
selected; automatic jobs select it explicitly.

The helper incorrectly applied a bit mask to obsolete `Win32_Printer.PrinterState`
enum values. For example Printing=11 was rejected even for a healthy queue.
The corrected predicate uses `PrinterStatus` and `DetectedErrorState`, allowing
busy/printing queues and withholding known faults/offline states. Its actual
PowerShell function passes 27 synthetic state cases; the full suite passes 116
tests. V6 includes this fix and the newly observed machine metadata. Prior local
SQL and HTTP checks remain as documented above; no SQL or app-route code changed
in this follow-up.

Realtek 0BDA:A728 and the Y813BT entries report device code 0; Intel Bluetooth
code 22 means disabled. This is not evidence requiring Intel driver repair.
Matching USB-ID reports in Pop!_OS/Home Assistant concern Linux kernel scanning
and do not establish a Windows SPP fault. Microsoft documents USB 3.0 device
interference as a possible Bluetooth issue; test the actual arrangement before
changing a working adapter/port. Nulltonex guidance supports model-specific
Windows drivers and custom label sizes; keep the current matched baseline.

The user corrected Windows timezone to Central Standard Time for Matamoros.
The replacement has not been migrated or installed; no project/listener found
is expected. Physical paper, loaded-roll alignment, reconnection and full
replacement deployment remain acceptance work. The built-in receipt printer
does not require opening the POS unit for USB-disconnection testing.

Sources:
- https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-printer
- https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-pnpentity
- https://support.microsoft.com/en-us/windows/fix-bluetooth-problems-in-windows-723e092f-03fa-858b-5c80-131ec3fba75c
- https://github.com/pop-os/pop/issues/4135
- https://github.com/home-assistant/operating-system/issues/5079
- https://nulltonex.com/pages/y813bt-video-tutorial-1
