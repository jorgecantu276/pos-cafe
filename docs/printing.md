# Printing for Cariñito Mío

The October 30 request replaces manual post-sale print choices. One completed
sale records a browser outbox entry before checkout recovery is retired. The
dispatcher creates the required jobs in one durable local transaction and attempts
the printer handoffs concurrently. Printer speeds and connectivity
determine when paper actually emerges; simultaneous physical completion cannot
be promised.

## Dessert preparation

New orders group regular products in **Postres** into one preparation document
on the same Y813BT sticker queue as drinks. It uses the existing
57 × 32 mm form and rotation with the `desserts-compact-v1` label layout. It lists
quantities, modifiers and notes without prices, with a **POSTRES** heading,
customer, folio and delivery control. Drinks retain one label per cup; their
cup count excludes desserts. Each brownie with ice cream and each **Rebanada
cheesecake** (plain, frutos rojos, lotus, plátano, resses or tortuga) gets its own
label per piece in the same job as the drink labels. These labels share their
own **POSTRE** count, keeping each product's name, modifiers and notes.
The grouped job is created when the order contains other desserts.

The dessert job has its own `desserts` journal audience and recovery controls.
Phone preparation keeps the unpaid warning; pickup payment sends only the paid
customer receipt. Existing journal sources retain their exact original copy set
and saved documents, including older per-dessert labels. Replaying an old order
never adds a new dessert comanda. Previously saved receipt-shaped dessert
documents keep their POS80 queue and receipt rendering. Saved `reference-v2`
dessert documents keep their original sticker rendering and continuations.
Both explicit sticker layouts use the barista printer profile; documents
without either marker retain the receipt printer profile.

New dessert lists must fit **one physical sticker**. The renderer measures all
names, quantities, modifiers and notes with Arial Bold, selecting the largest
size that fits from 8.5, 8, 7.5, 7 and 6.5 pt. It never removes text or creates
continuation labels for this format. If the full content does not fit at 6.5 pt,
preparation fails before printer handoff with `dessert-content-too-long`;
the dessert job stays blocked and the cashier sees a clear message. The
customer receipt and drink jobs keep their independent journal states.
`-LayoutOnly` returns this error with exit code 1 and emits no partial preview.
Physical readability of this new compact layout remains to be checked on the
café PC. A rollback build must understand the compact layout and `desserts`
to recover pending new jobs;
keep the current journal and do not substitute a pre-dessert build for recovery.

## Recovery across cashier changes

The responsible administrator can open **Administración → Impresión** at
`/admin/impresion` without opening a drawer. This screen lists outstanding local
copies from all cashiers and the last 20 completed/cancelled copies, with the
original cashier's name. A safe retry affects only the selected queued/blocked
copy; a successful customer ticket is not resent when recovering its barista
label. Cashiers retain access only to their own queue. The original sale and
financial cashier ownership never change.

For an uncertain outcome, inspect both physical paper and the Windows queue.
The administrator can acknowledge that paper printed, without any resend. If
paper is confirmed missing and no job for that copy remains in Windows, the
administrator can explicitly authorize one replacement. The same reviewed
replacement is available for a copy accepted by Windows but later confirmed
missing. This requires a checked inspection statement, written reason and an
explicit duplicate warning. Active submissions cannot be overridden. A queued
Windows job may print later: do not authorize replacement while it remains.

The local SQLite journal records the responsible actor, original cashier,
ticket/copy, previous state, action, reason and time. The last 50 reviews appear
on the screen; older reviews remain in the journal. Recovery stores its request
identity before sending and replays exactly that request after a lost response
or refresh. Preserve the existing journal when upgrading. Normal polling and
cashier retry still never resend an uncertain or accepted copy automatically.

## Preparación telefónica y pago

La preparación original usa `phone:UUID`, con documentos pendientes de pago e
identidad separada del recibo pagado. Cobrar asegura y despacha la preparación
faltante, incluso tras respuesta perdida y cambio de cajero; no repite copias
aceptadas o inciertas. **Pedidos por teléfono → Pagados → Comprobar comanda**
permite recuperarla después. El estado financiero se confirma sin esperar al
papel; nunca se vuelve a cobrar para resolver la impresión. Una venta cancelada
impide nuevos envíos y mantiene las revisiones históricas.

## Exact machine profile

### Owner's customer receipt reference — October 31

New customer documents follow the two supplied WhatsApp references: the exact
Cariñito Mío Taller Repostero logo, centered phone, divider rules, prominent
TICKET DE VENTA and total, measured item columns, Instagram QR, closing phrase
“Para el postre y una sonrisa, siempre hay espacio.” and `@_carinitomio`.
RFC, regime and establishment address remain below payment. Per the owner's
later instructions, new customer receipts omit the issuer's legal/personal
name and both CFDI lines. The complete issuer profile remains stored locally
for validation; the printed brand is Cariñito Mío.
The large title/total use Arial Bold 14/15 pt; body/issuer stay at the accepted
8.5 pt. The closing phrase uses bold italic serif type. Test samples remain
explicitly marked. Existing saved documents retain their original text/design.

`public/receipt-branding/carinito-logo-v1.jpg` is an unchanged copy of the
supplied 12.47.19 PM logo JPEG (SHA-256
`216050c4bfb1869e803bcbd7fd947c1ce6c62323be2f519b94022ad45c4d85df`).
Only rendering crops its white margins and thresholds it for thermal contrast.
Keep this versioned asset available to Windows helpers and browser reprints.
Release packaging copies public assets; the standalone kit explicitly includes
the same logo in its manifest. Missing required assets block preparation before
the submission fence rather than silently dropping the logo.

The user explicitly chose `https://www.instagram.com/_carinitomio/` for the
“MENÚ E INSTAGRAM” QR. `config/receipt-branding.json` contains its precomputed
37 × 37 matrix, including four-module quiet zones, generated with qrcode 8.2
at error-correction M. The renderer draws five 203-dpi dots per module; browser
reprints use the same matrix as inline SVG. No external image/QR service or
runtime Python dependency is involved. New journal documents snapshot the QR
matrix and target. The 203-dpi preview was independently decoded to that URL.
The later PRUEBA-R8 café test physically passed paper readability/contrast,
alignment, complete output and a phone scan of the printed QR. Its same-command
repeat produced no extra paper and preserved prior journal history. See the
[follow-up acceptance record](printer-acceptance-2026-10-31.md#follow-up-v8-customer-receipt-and-concurrent-dual-output).

For a customer-only café check, use `scripts/printing/package-receipt-test.mjs`
with a new absolute output directory. This separate package requires the
ORIGINAL nonempty journal and existing issuer profile via `-ExistingKitRoot`.
Inspection/preview is read-only; `-PrintTest` saves one new PRUEBA-R8
sample in that original runtime and selects only the customer copy for ensure
and dispatch. It creates no barista row and checks that unrelated jobs, source
records and the recovery audit stay unchanged. Normal POS sales still ensure
both copies atomically. Repeating the receipt command preserves its identity
and submission fence. A missing original journal or missing sample for an
already journaled receipt ticket stops the test instead of starting afresh.
The ZIP includes `CAFE-PC-PROMPT.txt`; no journal, issuer data or old-case runner
is packaged. Do not overlay the old café kit or run its full two-printer suite
when checking only this new receipt.

For remote testing of BOTH current outputs, build with
`scripts/printing/package-current-tickets.mjs`. The separate V9 package includes
`Test-CurrentTickets.ps1` and a Spanish AnyDesk/Codex prompt. It requires the same
original nonempty journal and issuer profile in place. Its new PRUEBA-D2 sample
uses the current no-CFDI receipt and reference-v2 sticker. Both documents are
previewed first and must fit one page/label before dispatch. The wrapper checks
both queue identities, forms, faults and pending jobs without changing them.
Both new copies dispatch concurrently through the actual POS journal/adapter;
old rows and recovery history are checked unchanged. Repeating the same sample
preserves accepted/uncertain guards. The package contains no journal or issuer
data. Physical approval requires the person at the café to confirm paper/photos;
AnyDesk and Windows queue acceptance alone do not establish paper output.

### Current label: black artwork on colored stock

The user subsequently clarified that new stickers should match the supplied
María López / Iced Matcha photo. Their blue/yellow/pink color comes from the
physical stock. New POS documents explicitly select `labelLayout=reference-v2`:
customer name and folio/cup identity at top, a larger drink name, dashed
modifiers on individual lines, two black divider rules, and service opposite
Matamoros date/time at bottom. No colored background or outside border is drawn.
Arial Bold sizes are 9 pt name, 12 pt drink, 8.5 pt instructions, 8 pt service
and 7 pt identity/date. The footer uses a two-line date and 12-hour time.

The physical 57 × 32 mm form and 90-degree artwork rotation remain unchanged.
Explicitly versioned per-cup metadata is saved with each new document. A long
note continues onto identified labels repeating name, folio/cup, drink and
service/date/time; instructions are not clipped. An oversized identity that
cannot leave room for instructions blocks preparation instead of printing
overlapping text. PNG preview export optionally supports transparency; physical
printing draws only the black text/rules onto the pre-colored sticker.

Existing documents without this version marker retain their physically approved
flowing layout, text and footer. Obsolete `cupLabels` metadata stays ignored.
No saved document, journal identity or accepted/uncertain state is reset to apply
the new design. Normal confirmed POS sales still dispatch both copies together.
The V8 customer receipt retains the owner's later no-CFDI/no-personal-name
wording. After the remote V9 dual test, the user reported that both outputs
worked and requested only removal of the individual issuer name. This is the
user's reported physical result for the reference design, distinct from the
earlier transferred flowing-label logs and from full POS installation.

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
The user physically confirmed this exact roll on October 31. Confirm it again
after media changes; the recorded observation cannot inspect the current roll.

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
The standalone kit did not configure the café POS server. Use a permanent local disk path outside the
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
on the development PC or full café POS. The standalone kit did print marked
samples on October 31. Network/Auth/order-read failure retains the
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
printed. The owner's later instruction removes CFDI wording from new receipts;
previously stored snapshots are not rewritten. Do not copy
dated or merchant-specific invoicing restrictions from the reference receipts.

Barista labels use a Starbucks-inspired reading order: customer name,
full menu drink name, milk/options, item instruction, order
instruction, then a small folio/cup count/order type/time footer. Each unit has
its own section. No Starbucks logo, invented size/recipe code or payment data
is added. Labels use uniform Arial Bold 8.5 pt. The accepted legacy receipts use
Arial Bold 8.5 pt body/issuer/meta, 10 pt headings, 11 pt total and 12 pt brand;
the newer logo receipt uses the title/total styles described above. Quantity,
unit price and line amount use measured left/middle/right columns, rather
than relying on spaces to align proportional type.
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

## Physical acceptance and subsequent tests

The October 31 standalone test passed after corrections to font weight,
orientation, paper loading and label learning. Bluetooth recovered the existing
Windows job after power-on; same-case repeats produced no extra paper. See
[the acceptance record](printer-acceptance-2026-10-31.md) for approved settings,
evidence hashes and the boundary between that renderer and the newer reference
design. Later PRUEBA-R8 physically accepted the branded receipt/QR, and PRUEBA-D1
passed concurrent V8 receipt plus the previously approved flowing Bluetooth
label. The user later requested the versioned reference sticker layout described
above; the earlier physical test did not exercise that design. These tests
do not establish full-POS, cutter or drawer acceptance.

The source builder now produces **V9**, incorporating the accepted V8 receipt
and the newly requested black-only reference label. Its runtime is Node 24.22.2 x64 with
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
configuration. The acceptance session did not deploy the café app or run live migrations.

## Verification

El estado de impresión del POS ocupa una fila de 48 px. Si una consulta falla,
muestra **Estado sin comprobar**; los detalles se abren al tocar la fila y no
desplazan el menú. Las copias pendientes conservan su contador y las salidas
inciertas siguen requiriendo comprobar el papel antes de cualquier reposición.

La vista local de administración usa `mock` con un diario aislado y muestra
**Prueba**. No debe arrancar con impresión desactivada y presentar ese fallo de
configuración como si se hubiera averiado una impresora. Esto no cambia la
configuración `windows` ni los diarios del café.

`npm test` covers actual checkout handlers/UI, failed outbox persistence,
per-copy concurrency, restart fences, stale worker recovery, Bluetooth retries,
lost HTTP/spool acknowledgments, cashier isolation and real-menu content.
The Windows-only layout test compiles the actual helper and measures/wraps
long notes on a bitmap; it performs no device discovery or print operation.
`node scripts/printing/http-drill.mjs` tests a production Next build with owned
loopback Auth/PostgREST fixtures and simulated queues. It is not real hosted
Auth or physical acceptance. Existing `npm run test:db` uses disposable local
PostgreSQL. No verification requires live café data.
