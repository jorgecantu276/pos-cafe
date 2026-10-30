# Two-copy printing for Cariñito Mío

The October 30 request replaces manual post-sale print choices. One completed
sale records a browser outbox entry before checkout recovery is retired. The
dispatcher then creates both jobs in one durable local transaction and attempts
the USB and Bluetooth handoffs concurrently. Printer speeds and connectivity
determine when paper actually emerges; simultaneous physical completion cannot
be promised.

## Exact machine profile

`config/cafe-printers.json` records the original supplied café discovery:

| Destination | Exact queue / driver | Connection | Job paper form |
|---|---|---|---|
| Customer | POS80 Printer / POS80; observed driver 5.1.1.43 | CP001 USB; VID4B43/PID3830; 203 dpi | Explicit 72 × 210 mm advertised form |
| Barista | Y813BT Sticker / Y813BT Label; VEVOR; observed driver 1.1.3.1 | Y813BT-E08D, Bluetooth SPP COM3; 203 dpi | Hybsk 2.25 × 1.25 inch (57.15 × 31.75 mm); 57 × 32 mm driver form |

The receipt queue's observed default was 72 × 3276 mm. The helper selects the
advertised 72 × 210 mm form for the job to avoid inheriting that long page.
Bluetooth APIs reported conflicting 57 × 32 and approximately 100 × 150 mm
defaults. The user subsequently supplied Hybsk packaging images specifying
2.25 × 1.25 inches, equivalent to 57.15 × 31.75 mm, matching the advertised
57 × 32 mm form. This stock is selected in the machine profile and test kit.
Tomorrow still needs a physical check that this exact roll is loaded.

The user confirms **Nulltonex** branding. Its [Y813BT support](https://nulltonex.com/pages/y813bt-video-tutorial-1)
and [model-specific driver selection](https://nulltonex.com/pages/y813) take
precedence over model-family examples from other brands. Keep the existing
driver baseline until measured; an app-only sample does not verify our Windows
queue path. Keep the small cafe label size above; the vendor's shipping-label
example is not our selected stock.

The helper checks the named queue's driver and port and selects a matching
advertised form. It never falls back to the default printer, PDF or AnyDesk,
changes Windows defaults, pairs devices, installs drivers, or sends RAW,
ESC/POS, cutter or drawer commands. Driver version is recorded for comparison;
the supplied report does not establish how to match every package/file version
field programmatically. Physical model/roll/cutter/drawer remain unverified.

## Runtime configuration

Use the tested Node 24.22.2 Windows x64 runtime (including built-in SQLite) and
run the local POS under the signed-in Windows user's desktop session. The
PowerShell/.NET desktop helper is not a Windows service printing integration.
The verified runtime embeds SQLite 3.53.4. Journal creation rejects SQLite older
than 3.51.3 before opening the journal, addressing the published WAL-reset fix.
Keep `scripts/printing/windows-print.ps1` and `DesktopPrinter.cs` in the release.
Chrome/Edge must open the POS through localhost or 127.0.0.1.

Server-only environment settings, stored locally and never committed:

```text
POS_PRINT_MODE=windows
POS_PRINT_DATA_DIR=C:\POS-Cafe-Data\printing
POS_PRINT_CUSTOMER_QUEUE=POS80 Printer
POS_PRINT_BARISTA_QUEUE=Y813BT Sticker
POS_PRINT_BARISTA_STOCK_CONFIRMED=1
POS_PRINT_BARISTA_WIDTH_MM=57.15
POS_PRINT_BARISTA_HEIGHT_MM=31.75
POS_RECEIPT_ISSUER_FILE=C:\POS-Cafe-Data\receipt-issuer.json
```

Those paths are deployment examples, not directories created by these changes.
No café environment was modified. Use a permanent local disk path outside the
source/release folder. Give the signed-in POS account access; never use a
network share or a shared journal across two physical PCs. Preserve the entire
directory, including SQLite WAL/SHM files when active. Do not delete or roll
back the journal to reprint jobs. Changing the directory loses duplicate
protection. Retained documents contain customer names/notes; protect the folder
with the same access restrictions as the POS. Back up consistently with the
application stopped or through SQLite-aware backup.

`POS_PRINT_MODE=mock` writes only synthetic spool records and uses a separate
`mock-jobs.sqlite`; Windows uses `windows-jobs.sqlite`. Omission/disabled mode
withholds dispatch and retains print intents. No real print mode was enabled
on the development PC or café PC. Network/Auth/order-read failure retains the
print intent; the existing POS still depends on cloud access and does not gain
offline sales or offline access authorization from this feature.

## Content and recovery

The customer receipt uses the actual Mexican Starbucks and Café Punta del Cielo
receipts linked below as visual references, checked against RMF 2026 rule
2.7.1.21 and CFF 29-A I/III. It includes issuer identity, establishment address,
place/date, folio, item descriptions, quantities, unit prices, line amounts,
total MXN, payment, tender and change. This is a sales ticket; generating or
stamping CFDIs, global invoicing, tax calculation and fiscal record obligations
are separate work. The layout alone does not establish complete tax compliance.

The issuer profile supports placeholders while the registered name, RFC, tax
regime and official establishment address are pending. The client subsequently
supplied a constancia on October 30; its receipt fields are kept in a separate
local profile, outside versioned source. No real issuer identity is added to
fixtures or the example configuration. The portable kit can include that profile
when the builder receives its absolute path as the optional third argument.
Preview and hardware-test receipts retain an explicit test warning even with
complete issuer information.
For real Windows sale dispatch, the customer copy is withheld until the issuer
profile is complete; the barista copy can proceed independently. Copy
`config/receipt-issuer.example.json` outside the release, fill all six fields and
set the absolute server-only `POS_RECEIPT_ISSUER_FILE` path. `taxRegime` must
contain its three-digit SAT code and description, for example the form
`NNN - description`; do not guess the client's regime. Validation checks shape,
not SAT registration or authenticity. No real issuer details are committed.
After configuration, retry the blocked customer copy. Only its unsubmitted
placeholder document is replaced. Accepted/uncertain jobs never reset.

No invented VAT rate, fiscal UUID, seal, invoicing portal or request deadline is
printed. Customers are directed to the cashier to request a CFDI. Do not copy
dated or merchant-specific invoicing restrictions from the reference receipts.

Barista labels use a Starbucks-inspired reading order: bold customer name,
bold full menu drink name, milk/options, emphasized item instruction, order
instruction, then a small folio/cup count/order type/time footer. Each unit has
its own section. No Starbucks logo, invented size/recipe code or payment data
is added. The actual Windows renderer uses styled fonts at the selected size.
No remote images or QR services are needed. Small labels continue onto further
identified labels instead of clipping instructions. Every styled barista label,
including each continuation, reserves its folio/cup-count footer. Long notes
from different drinks cannot lose their cup association when labels detach.
The local issuer reader and kit builder accept a leading UTF-8 BOM, including
files saved with Windows PowerShell 5.1's UTF8 encoding.

Reference material (reviewed October 30, 2026):
- Actual Starbucks México ticket, PDF page 3, SCJN expense packet:
  https://www.scjn.gob.mx/sites/default/files/fix/2026/01/PMGAFM-019-2025%20VP%20st_Censurado.pdf
- Actual Café Punta del Cielo ticket, PDF page 10, Chihuahua public expense file:
  https://sds.chihuahua.gob.mx/transparencia/registro/administrativo/428_2018.pdf
- SAT RMF 2026, rule 2.7.1.21, PDF pages 108–109:
  https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/RMF_2026-DOF-28122025.pdf
- CFF, article 29-A I/III: https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf
- SAT invoicing practices: https://www.sat.gob.mx/minisitio/Factura/solicita_consideraciones.htm
The real receipt examples demonstrate layout; their age and contents are not
proof that every printed statement meets today's requirements.

The authenticated API accepts only an order UUID and optional audience. It
re-reads the completed sale snapshot under existing RLS and permits only that
cashier's jobs. It cannot call checkout, charge, alter stock, or choose an
arbitrary queue/path/document supplied by the browser. After Windows preparation,
each copy re-reads the authoritative sale status before crossing the durable
submission fence. Cancellation observed at this check cancels outstanding
preparation; a failed read blocks submission. A stale worker cannot make a
cancelled job retryable. Cancellation racing after this final read cannot
atomically recall a Windows handoff; accepted paper jobs cannot be recalled.

| State | Retry behavior |
|---|---|
| queued | Recover automatically from browser/server restart |
| preparing | Safely reclaim expired preparation using an atomic claim |
| blocked | Explicit retry of this audience; no charge or successful-copy reprint |
| submitting | Durable fence already committed; never blindly resend |
| submitted | Accepted by Windows; Windows owns queue/paper/reconnect recovery |
| uncertain | Handoff failed or process died after the fence; inspect queue and paper, no automatic resend |
| cancelled | No new preparation job |

The SQLite primary key is `(order_id,audience)`; both jobs are inserted
atomically. Claimed preparation must win a compare-and-set before receiving
permission to print. The `submitting` fence commits before the helper receives
`PRINT`. Lost HTTP responses, double clicks, another tab, a new application
process and retries cannot reset it. Receipt snapshots and targets already
recorded are not replaced by current cart/catalog/queue changes. The sole
document-completion exception is the unsubmitted customer issuer draft above.

At-most-once application submission is not proof of exactly-once paper output.
Driver/device behavior, partial output, an operator's separate Windows reprint,
and deleting the local journal are outside that guarantee. If a handoff outcome
is uncertain, stopping for physical reconciliation is necessary to avoid a
duplicate. Do not press charge again or bypass this guard by deleting files.

## Tomorrow's physical test

The current kit is **V5**, superseding V4. Its runtime is Node 24.22.2 x64 with
SQLite 3.53.4. When upgrading an existing installation, preserve its persistent
journal in place; never replace it with a fresh kit's empty journal to retry
previous orders.

The portable hardware kit contains the same bundled document generator,
SQLite dispatcher and Windows adapter, plus Node 24.22.2 and the exact machine
profile. It creates only a clearly marked synthetic sample sale on local disk;
it can read an included `receipt-issuer.json` using the same local issuer reader.
There is no Supabase client, credential, network bridge or business data write.
It does not install/replace the deployed café POS.

1. Extract the complete ZIP to one stable folder and retain it between retries.
2. Run the default read-only inspection. Check both exact queues, driver/port
   matches, Windows x64, desktop session and installed forms. It captures the
   previously missing CPU/RAM information without printing or changing settings.
3. Power on the devices and verify that the pictured Hybsk 2.25 × 1.25 inch
   labels are loaded. Confirm the driver advertises the 57 × 32 mm form. If a form or port is
   wrong, correct it deliberately on the café PC before the paper test.
4. Run the explicit physical test using the preselected dimensions. It uses a
   saved `PRUEBA-001` sample: one customer receipt and a barista job with two cup
   sections, milk choice, no-ice instruction and order notes. Nothing is charged.
5. Check folio match, accents, readable text, margins, label alignment, page feed
   and that the final instruction survives overflow. Record actual timing.
6. If Bluetooth fails before submission, reconnect and rerun the SAME command
   in the SAME folder. Only a safely missing copy may submit. Accepted/uncertain
   jobs remain guarded; inspect Windows rather than deleting the record.

The V4 kit also accepts `-TestCase baseline`, `repeat-02` through `repeat-20`,
`bluetooth-offline`, `usb-offline`, `paper-out` and `long-notes`. These are
different synthetic orders saved under stable UUIDs in the same journal.
Repeat a case to verify restart/retry protection; choose a different case only
when intentionally starting a new test order. The case name does not create a
physical fault: disconnect the named device or remove paper deliberately for
that test, then inspect Windows/paper and retry the same case after recovery.
`long-notes` uses two distinct drinks with individually numbered continuations.
The mock path exercises no hardware and cannot prove these physical faults.

The mixed-item verification clicks the actual workspace UI for both cashier
and admin: two oat-milk caramel cups with one note, a whole-milk caramel with
another note, and an almond-milk vanilla. This keeps three lines, four cups and
MXN425. The exact captured UI payload can be passed into the disposable SQL
suite with `POS_MULTI_ITEM_EVIDENCE`; `POS_MULTI_ITEM_DB_EVIDENCE` records its
confirmed snapshot for the production HTTP drill. No catalog or schema import
is performed against a real café. These fixtures use fictitious UUIDs/stock
and menu-reference names/prices. Two previously failing regressions now cover
Windows UTF-8 BOM profiles and cup identity on every continuation label.

The test kit is for hardware acceptance, not an already accepted production
deployment. After hardware acceptance, the full POS must use the reviewed app,
compatible schema, existing release/backup procedure and local machine
configuration. No GitHub sync, café app deployment or live migration was done.

## Verification

`npm test` covers actual checkout handlers/UI, failed outbox persistence,
per-copy concurrency, restart fences, stale worker recovery, Bluetooth retries,
lost HTTP/spool acknowledgments, cashier isolation and real-menu content.
The Windows-only layout test compiles the actual helper and measures/wraps
long notes on a bitmap; it performs no device discovery or print operation.
`node scripts/printing/http-drill.mjs` tests a production Next build with owned
loopback Auth/PostgREST fixtures and simulated queues. It is not real hosted
Auth or physical acceptance. Existing `npm run test:db` uses disposable local
PostgreSQL. No verification requires live café data.
