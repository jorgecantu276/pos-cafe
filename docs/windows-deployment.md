# Windows client deployment

Build on the development PC; stores run an accepted prepared package. Source, release publication, installation and site acceptance are separate states. Current product status is in [Café](products/cafe.md); historical delivery evidence remains in [delivery-readiness](delivery-readiness.md).

## Prepare the exact package

Use the Node/runtime requirements declared by the project and packaging scripts on Windows x64. Run `npm ci` and required checks. Keep the target JSON outside Git; it contains `supabaseUrl` and the public `supabaseAnonKey`, never the service-role key.

```powershell
npm run release:windows -- C:\private\target.json C:\releases\pos-cafe-VERSION
```

The builder stages source separately, compiles Next standalone, bundles Node/license, static assets, Windows helpers, SQL contract and recovery tools, then writes `release.json` and `SHA256.json`. Public backend values are compiled into browser files; changing runtime URL/key cannot retarget the build. Loopback `fixtureOnly` builds are test artifacts and cannot qualify a physical-print deployment. Publish only accepted clean source and exact verified bytes, through the family gate.

## First installation or supervised upgrade

1. Read the actual installed release, backend/configuration identity and supported predecessor. A latest GitHub release or old chat is not an installation receipt.
2. Prepare a new local version folder. Stage and verify it before replacing active code; refuse unknown processes or locked files before copying. Preserve a compatible previous package.
3. Keep configuration, issuer profile, original print journal/WAL/sidecars, backup archives/key and provider secrets outside all version folders. Example roots such as `C:\private` are placeholders, not discovered client paths. Set `RequireExistingPrintJournal: true` for an upgrade; a typo must not silently create an empty journal.
4. Preserve existing accepted printer/provider settings. New installations start with simulated/disabled external capabilities until their device/site acceptance; old examples do not authorize disabling a working store.
5. Verify staff login, one branded shortcut, the intended Caja window, startup/reopen, representative saved operations, backups and recovery. Changed paper/provider routes need their own actual acceptance.

From the accepted package, the responsible installer can create the shortcut once:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-POS-shortcut.ps1 -ConfigPath C:\private\pos-cafe-config.json
```

`Open-POS.cmd` directly starts the packaged server for supervised maintenance. The managed shortcut uses `Open-Caja.ps1` and the same external configuration. No npm/build is required on the store PC. Keep the correct stable launcher when enrolling automatic updates; do not choose whichever old extracted folder happens to exist.

## Runtime and automatic updates

The launcher binds to loopback, authenticates release/configuration/process/listener identity, and reuses only the matching instance. It leaves foreign listeners alone. Unexpected server exit allows bounded 1/2/4-second restarts using the same journal; after the limit, inspect the adjacent `.server-error.log`. `.instance.json` is transient ownership metadata, never customer data to copy between PCs.

Café automatic updating defaults OFF. One-time enrollment verifies the fixed launcher, exact device/configuration, public signing key, supported predecessor, idle RPC and first genuine report. Accepted signed packages stage separately and activate only under their safe gate. Missing/unresolved payment, handoff or printing evidence defers activation. No application updater applies SQL automatically. See [windows-auto-update](windows-auto-update.md).

The actual cashier/desktop session is required for the current printing integration. This launcher does not install drivers, change global Node, enable a LAN listener or provide offline cloud-backed sales. Physical scaling, printers and reboot behavior require actual device evidence.

## Backups, database compatibility and rollback

Configured service credentials enable encrypted daily business copies and close/handoff checkpoints; inspect confirmed success in Administración → Respaldos. Keep encrypted copies off the machine and the original recovery key separately. [business-backups](business-backups.md) defines what the archive omits, including the separate local print journal and provider setup.

Compare the exact package migration contract to the chosen client backend. [Supabase](../supabase/README.md) describes source ownership; historical applied counts are not current inventory. Optional finished-product stock requires explicit activation and new physical counts. Preserve current Clip state and unresolved payment identities. Never migrate a legacy development target to fix a configuration mismatch.

Rollback means selecting a verified compatible application while keeping current business/journal data. It is not reversing SQL or restoring an older database after new sales. Preserve failed artifacts and current evidence; use reviewed forward repair when necessary. Repository/account transfer is a separate owner decision, not an installation prerequisite.
