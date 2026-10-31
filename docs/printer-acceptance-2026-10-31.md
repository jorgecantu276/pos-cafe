# Café printer acceptance — October 31, 2026

The user personally confirmed the final corrective receipt, eight long-note
labels and automatic Bluetooth recovery. Software submission and paper output
were recorded separately. Final Windows queues were empty; the exported
journal audit contained no unresolved jobs.

The supplied evidence is in `outputs` and `work` under
`D:\Codex\2026-10-31\prepare-and-execute-the-cari-ito`. Key records are
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

Preserve the complete café test root at `D:\Cafe-Printer-Test-2026-10-31`,
especially `runtime\windows\windows-jobs.sqlite` and associated files.
Do not delete, replace or restore an older journal, or include one in a release.

## Integration boundary

The repo already contained a local reference sticker design with name/folio,
divider rules, modifiers and date/service footer. This change retains that
content and incorporates the accepted typography and vertical orientation.
Fields stack on narrow stock; continuations preserve all identifiers and notes.
Saved pre-metadata documents retain their flowing layout and immutable text.
No taxpayer-specific style matching from the diagnostic scripts is copied;
the generic `meta` style covers every issuer.

The accepted standalone renderer and this combined reference design are
different layouts. Automated rendering, continuation, journal/retry and
production HTTP checks validate the integration locally. Its exact paper
output needs a new café check. The original acceptance did not install the
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
