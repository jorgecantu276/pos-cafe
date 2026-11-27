# Café: supervised updater enrollment

Use this adapter on the actual Windows POS during its supervised maintenance
window. It changes the existing shortcut and the two updater configuration
fields. It never replaces application folders, applies SQL, launches Caja,
changes provider settings, copies a journal or publishes a release.

The engineering PC cannot stand in for the store. First accept the genuine PC
report through the existing private support procedure. The reader configuration
must pin the accepted machine/backend and identify its publisher. The report
must be an authenticated comment in that private repository, sampled in the last
48 hours. A downloaded reporting kit or an unpinned reader draft is insufficient.

Prepare the exact new bootstrap folder with the existing Windows builder and
release process. Keep it in its permanent location, and retain the old version.
Use its signed `pos-update.json` and the separately stored Ed25519 public key.
The signature must explicitly allow the actually installed predecessor. Complete
the family/package/recovery review before creating the enrollment approval.

Record the independent review in a private JSON file:

```json
{
  "format": "pos-cafe-enrollment-approval-v1",
  "independentReviewer": "named reviewer",
  "approvedAt": "ISO timestamp with timezone",
  "machineSha256": "accepted actual-machine hash",
  "backendIdentitySha256": "accepted backend identity hash",
  "installedCommit": "actual full predecessor commit",
  "bootstrapCommit": "reviewed full bootstrap commit",
  "bootstrapFilesSha256": "SHA256.json file digest",
  "publicKeySha256": "public SPKI DER SHA-256",
  "reportUrl": "https://github.com/owner/private-repo/issues/1#issuecomment-123",
  "databaseMaintenanceAccepted": false
}
```

This is procedural review evidence, not a cryptographic independent approval.
The adapter checks those bindings against actual local files, machine identity,
the signed manifest, full package hashes and the authenticated report. It does
not infer or manufacture family qualification. A changed migration contract
requires separately accepted maintenance and `databaseMaintenanceAccepted:true`;
the adapter still executes no SQL. The existing backend idle RPC must already
be available and return true.

Run with the source-pinned Node runtime. Every path below is a discovered actual
path, not a path to create blindly. The owner does not choose hashes or ports;
the maintainer prepares the exact arguments from the accepted records.

```powershell
node scripts/windows/cafe-enrollment.mjs inspect `
  --installed C:\actual\previous-package `
  --bootstrap C:\actual\accepted-bootstrap `
  --config C:\actual\private\pos-cafe-config.json `
  --shortcut 'C:\actual\Desktop\Cariñito Mío POS.lnk' `
  --key C:\actual\private\update-public.pem `
  --manifest C:\actual\private\pos-update.json `
  --support C:\actual\private\accepted-support-reader.json `
  --reporter C:\actual\existing-support\settings-v5.json `
  --approval C:\actual\private\enrollment-approval.json `
  --output C:\actual\private\enrollment-plan.json
node scripts/windows/cafe-enrollment.mjs apply `
  --plan C:\actual\private\enrollment-plan.json `
  --receipt C:\actual\private\enrollment-receipt.json
```

Inspection reads only. It requires the existing Windows print journal, issuer,
backup folder/key, matching target configuration, known shortcut ownership,
GitHub access and a closed application/backend. Unknown or unresolved state
refuses. Application and key folders cannot contain private client files.

Application rechecks all probes and exact input hashes under an exclusive local
enrollment lock. It saves the original config and shortcut to the private
receipt's `.previous.json`, stages files with their original ACLs, then switches
them. Failure restores only files still matching this operation's changed bytes.
The receipt and backup contain private material: keep their directory restricted
to the operator/maintainer and outside source, releases and cloud sync.

The first application leaves `AutoUpdate:false`. Rebind the **existing** accepted
support installation to the new bootstrap with its existing guarded installer:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  C:\actual\existing-support\agent-v5\Instalar-Soporte-GitHub.ps1 `
  -PlanPath C:\actual\reviewed-kit\setup-plan.private.json `
  -InstallDirectory C:\actual\accepted-bootstrap `
  -ConfigPath C:\actual\private\pos-cafe-config.json `
  -SupportHome C:\actual\existing-support -ActualizarRutaCaja
```

The maintainer resolves those paths from the already accepted support settings
and reviewed kit. This reuses its task/identity/transport and preserves support
state; do not reinstall a guessed kit or manually edit reporter identity. A fresh
`inspect-enable` refuses while `settings-v5.json` still selects the old package.
The old reporter cannot authenticate a new bootstrap by following an old path.

Open the fixed shortcut once,
confirm the correct business and preserved operational state, obtain its genuine
`verified_server` report, and independently accept that bootstrap/report context.
Then create a fresh `inspect-enable` plan with the same arguments, updated accepted
report URL/approval, and a new output
path, and apply it with a new receipt path. Enabling refuses until the shortcut
already selects the reviewed bootstrap and the current report identifies it.
The existing updater then downloads only signed compatible packages and retains
its closed-shift/payment/printing and startup fallback gates.

Finally observe one accepted signed update and its recovery behavior on that
actual PC. Enrollment or enabling alone does not prove delivery, physical paper,
provider operation or backup restoration. If no accepted real report exists,
the correct result remains blocked before any configuration or shortcut change.

Checks: `node --test scripts/windows/cafe-enrollment.test.mjs` exercises real
Windows shortcut staging with synthetic packages, a real temporary SQLite
journal and mocked read-only remote/machine probes. No test enrolls a business.
