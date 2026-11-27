> Registro histórico: conserva resultados y límites de su fecha. No describe la configuración actual ni concede permiso para desplegar, restablecer datos, cobrar o imprimir. Para estado y siguiente trabajo, consultar el [plan de Café](products/cafe.md).

# Café printer acceptance — October 31, 2026

The user personally confirmed the final corrective receipt, eight long-note
labels and automatic Bluetooth recovery. Software submission and paper output
were recorded separately. Final Windows queues were empty; the exported
journal audit contained no unresolved jobs.

The supplied evidence is in `outputs` and `work` under
`<PRIVATE_ACCEPTANCE_ROOT>`. Key records are
`ACCEPTANCE-SUMMARY.txt`, `APPROVED-TEST-SETUP.txt`, `ONSITE-RESULTS.txt`,
`final-queues.json`, `final-journal-audit.json` and
`approved-artifact-hashes.json`. Fiscal details, samples and mutable journals
stay outside Git. The approved standalone helper directory itself was not
included in this transfer; the preparation scripts document its incremental
changes. This integration ports those changes rather than running diagnostic
recovery tools.

## Accepted rendering and observed settings

| Destination | Rendering | Café preferences |
|---|---|---|
| POS80 Printer / POS80 / CP001 | Arial Bold body/issuer/meta 8.5 pt, headings 10 pt, total 11 pt, brand 12 pt; fixed quantity/unit/amount columns | Density 16, speed 75 mm/s; existing long default form retained; job form approximately 72 × 210 mm |
| Y813BT Sticker / Y813BT Label / COM3: | Uniform Arial Bold 8.5 pt; logical 32 × 57 mm artwork rotated 90 degrees inside the physical 57 × 32 mm form | Vendor Rotate Portrait, Windows Vertical, density 8, speed 4, Label With Gaps, gap 3 mm, offset 0 |

The user confirmed Hybsk 2.25 × 1.25 inch stock (57.15 × 31.75 mm).
The driver advertises 56.9 × 32 mm. Study Label was applied after a sticker
overlapped; the user observed movement followed by idle and approved all eight
corrected labels, including the sixth. Corrected output was confirmed; the
original intermittent feed failure's cause was not independently proven.
These settings are observations. The app does not set density/speed, change
Windows orientation, calibrate, pair, reset or install.

Increasing receipt density alone did not resolve the faint-body complaint.
Replacing mixed font weights with uniform bold text was accepted. Separate
missing output was traced physically to jammed/empty paper. Windows reported
ready and accepted jobs during some missing-paper observations, so `submitted`
remains a Windows handoff state, never proof of paper output.

## Recovery evidence

- Baseline repeat retained attempts/timestamps; the user confirmed no extra
  paper. Independent repeat-02 submitted once per destination, but its original
  quality was rejected. Final acceptance came from logged corrective Q02 proofs.
- Quality and missing-paper replacements used the same sale and journal, with
  explicit user review and the existing `replace_missing` audit operation.
  Receipt-only and label-only corrections preserved unrelated rows. The final
  eight long-note labels retained cup/folio identities and both final markers.
  Do not reuse the one-off recovery scripts or request IDs.
- Bluetooth-offline used one compact PRUEBA-BT cup: total 110, received 150,
  change 40. Windows accepted job 22 while power was off and later reported
  `Error, Printing, Retained` (raw 8210). On power-on the user observed that
  existing job print automatically, without replacement/cancellation. The same
  command retained attempts/timestamps; the user confirmed no extra paper.

Preserve the complete café test root at `<PRIVATE_PRINTER_TEST_ROOT>`,
especially `runtime\windows\windows-jobs.sqlite` and associated files.
Do not delete, replace or restore an older journal, or include one in a release.

## Integration boundary

The physically accepted flowing template was integrated into the POS at
commit 434ef81. The user then supplied the colored-sticker reference again and
explicitly requested its design for new labels. Current new documents select
the versioned reference-v2 black-only layout. The physical sticker supplies
the color. Earlier snapshots without that marker retain the accepted flowing
rendering, immutable text and cup footers. Obsolete reference metadata does
not select a different layout or reset submission state.
No taxpayer-specific style matching from the diagnostic scripts is copied;
the generic `meta`/`issuer` styles cover every issuer.

The V8 receipt remains unchanged. The prior flowing label is still the layout
covered by the physical combined test below; the new reference design has
local verification. Automated
rendering, continuation, journal/retry and production HTTP checks validate the
integration locally. The original acceptance did not install the
replacement POS, validate its hosted backend, verify drawer/cutter commands
or establish long-term hardware reliability.

## Exported hashes of the accepted standalone artifacts

Local integration verification: TypeScript and lint pass; 169 tests pass,
including six Windows rendering tests with no spooler calls. The isolated
production build passes eight print HTTP checks using loopback Auth/PostgREST
fixtures and mock adapters. The V7 bundle also preserves accepted results
across two invocations each of baseline, Bluetooth and long-notes: six mock
copies, no duplicates. These are local checks, not additional paper acceptance.

These SHA-256 values identify the café artifacts, not the changed repo helper:

| Artifact | SHA-256 |
|---|---|
| `physical-test-approved-v2.mjs` | `a1a369d0e26aaf7ce0f641694ed8134df04f7b33b1e9511e2e027b95a0e5f9b1` |
| `Test-CafePrinters-Approved-v2.ps1` | `6b5e2860379f019e4bd793047d6c43a50cd39009822598daba1faa5c38dcb13b` |
| `diagnostics/long-notes-label-tone-01/DesktopPrinter.cs` | `e0028a0c0a74d6e1b809db47dc89ebc578538184d6228d0ac7e5df44fb13e21a` |
| `diagnostics/long-notes-label-tone-01/windows-print.ps1` | `7fbceced79235e3d2ca12f54a87ec1df604a0c510246776406ef1c0c229d1acf` |
| `node.exe` | `1c331340fa6cac5e4294725959070a143fa0507195a78ad77eed7943f719aac9` |

## Follow-up: V8 customer receipt and concurrent dual output

The later transfer at `<PRIVATE_ACCEPTANCE_ROOT>\outputs` and `work`
adds physical acceptance of the branded receipt. The earlier 12:35 PM files
remain the first-session evidence; the V8 and SIMULTANEOUS records at 1:09 PM
and 1:14 PM describe the new tests. No additional print was performed while
reviewing this transfer, and no runtime fix was indicated by its results.

### Receipt-only PRUEBA-R8 — passed

`V8-final-confirmation.json`, `V8-duplicate-protection.json`, `V8-RESULTS.txt`
and `V8-ACCEPTANCE-RESULT.txt` record:

- User personally confirmed the complete, clear one-page paper: supplied logo,
  text, 110 total / 150 received / 40 change, issuer, phrase/handle and alignment.
- User scanned the printed QR and confirmed the selected Instagram destination.
- The identical-command repeat left the same customer job at one attempt and
  timestamp `2026-10-31T18:05:37.014Z`; user confirmed no extra paper.
- Exactly one customer row/source was added, no barista row. All 12 previous
  jobs, prior sources and nine recovery-audit records stayed unchanged; the
  journal reached 13 jobs. Original non-journal files, issuer and old reports
  were preserved. The receipt queue was empty.

The auxiliary independent audit initially compared SQLite null-prototype rows
against ordinary JSON objects and failed on their prototypes. Its read-only
normalization then confirmed equal field values. The bundled runner compares
SQLite snapshots with each other; this was not a production journal error or
a reason for replacement/recovery.

### Concurrent PRUEBA-D1 — passed for V8 receipt + approved flowing label

`SIMULTANEOUS-RESULTS.txt`, `SIMULTANEOUS-result.json` and the supplied
`work/test-simultaneous.mjs` record a separately authorized synthetic order.
The runner composed the V8 customer document/adapter with the earlier approved
uniform vertical label document/adapter and dispatched both through the same
PrintJournal API. It did not replay PRUEBA-R8 or modify the original helpers.

Both audiences submitted once, sharing the same folio, with one receipt page
and one label. User personally confirmed both samples complete, readable,
aligned and finished. The prior 13 jobs, sources and recovery history remained
unchanged; both queues were empty. No duplicate-check repeat was performed for
this dual case. Concurrent handoff does not promise identical paper timing.

This validates the V8 receipt alongside the previously approved flowing label.
At test time the repo also contained a different `cupLabels` reference design,
which was not validated by that run. The subsequent POS integration selects
the accepted flowing template and removes that untested renderer.
No full POS installation, live sale, migration, driver/preference change,
pairing, queue cancellation, journal reset or recovery replacement was part of
either follow-up test.

The original active journal remains in place at
`<PRIVATE_PRINTER_TEST_ROOT>\runtime\windows\windows-jobs.sqlite`, with its
companions. Keep the V8 stable sample/result there. The V8 code/evidence stays
in the separate `<PRIVATE_RECEIPT_TEST_ROOT>` folder.

| Transferred follow-up record | SHA-256 |
|---|---|
| `outputs/V8-ACCEPTANCE-RESULT.txt` | `ff99d5fb3677e87aa31d68018694565faa796b39b3b564c57e7576f647c944dd` |
| `outputs/V8-final-confirmation.json` | `fa947db50f0871b1611f438f6566c385838d06a682267aa16946d94479eee50f` |
| `outputs/V8-duplicate-protection.json` | `1b83587552ef3c0fa804f9d56244ca1982aa5343451e63cd83d77d5ce47019bb` |
| `outputs/SIMULTANEOUS-RESULTS.txt` | `8049434feb1bbbc292ded02762dfa1ecdac99dd3c3ce85dc6861563fced7fbc8` |
| `outputs/SIMULTANEOUS-result.json` | `898d38565de81aef0f39984051fdb1e1e419f0cc80e40a720eac32c6f803f7b3` |
| `work/test-simultaneous.mjs` | `25995a6e657ce55360aecaf218fed5fc1ff9807e395ed102c6520d8eb06b85b8` |

## Later remote dual reference-label result

After receiving the V9 package and AnyDesk instructions for both current
outputs, the user reported “funciono” and requested only removal of the
individual issuer name from the customer receipt. New POS receipts therefore
omit that generic legal-name line, while preserving RFC, regime, address,
amounts, logo and QR. The barista label remains reference-v2 with black artwork
on colored stock. This records the user's physical confirmation; it does not
invent additional transferred logs, photos or duplicate-test evidence.
Historical documents and the current café journal are never rewritten or
replayed to apply the wording change.

## POS integration verification

The integration uses one source generator and the normal authenticated print
endpoint for both outputs. A production HTTP check submits one completed
sale concurrently from four requests, verifies the branded receipt and current
versioned label content in the mock spool, and renders both using the isolated
production app's actual PowerShell/C# helper and bundled logo. The one-cup
sample fits one customer page and one vertical label. Restart/retry submits
neither again. Existing checkout/outbox, cashier access and journal protections
remain covered. This is local integration verification, not a claim that the
replacement POS has been installed on the café PC.

Validation passed: 170 tests, TypeScript, lint, and an isolated production build
with nine print HTTP checks. Those checks include actual production document
rendering for both accepted layouts and duplicate protection after restart.
