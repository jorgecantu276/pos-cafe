# Windows client deployment

Keep the source repository and CI under the developer's GitHub account until
final client acceptance. The owner authorized merging PR #1 after employee-flow checks pass. Repository transfer is
the final handoff action, not a deployment prerequisite. The client can own its
Free Supabase organization from the start; GitHub and Supabase ownership are
independent. Do not place account passwords, management tokens, fiscal profiles
or service-role keys in Git or GitHub release files.

## Build here; run the prepared version on the café PC

On the development Windows x64 PC with Node 24.22.2 and `npm ci` completed,
prepare a private target JSON outside Git with `supabaseUrl` and
`supabaseAnonKey` (only the public anon/publishable key). Then run:

```
npm run release:windows -- C:\private\target.json C:\releases\pos-cafe-VERSION
```

This builds a separate source stage, produces Next's standalone server, bundles
the pinned portable Node executable and license, copies static photos/assets,
Windows print helpers and versioned SQL migrations, and writes SHA-256 hashes.
No npm install/build is needed on the café PC. The target public values are
compiled into the browser bundle: changing the local URL/key later requires a
new build. The launcher refuses a mismatch. Loopback builds are marked fixture
only and refuse physical printing. A source-dirty build is explicitly recorded;
publish only a reviewed commit whose Windows checks pass.

Package the prepared directory as a ZIP in a GitHub release only after its
target backend is configured and verified. Publishing/installing the final
client release requires the matching client database and configuration; a test
build using loopback is not that release.

## Local machine setup

Use a separate local folder such as `D:\POS-Cafe-Test\releases\VERSION`.
Leave the old POS and its records intact. Configure the sibling
`D:\POS-Cafe-Test\releases\pos-cafe-config.json` from the generated example,
outside the version folder. Store the print journal in a permanent local folder
such as `D:\POS-Cafe-Test\data`, and the private issuer profile outside releases.
The example starts with simulated printing; set `PrintMode` to `windows` only
for a deliberate physical acceptance run. Confirm sticker stock separately.
The service-role key for staff management, backups and optional CLIP belongs only
in this local private configuration. It is not the public build key. Keep
`ClipEnabled: false`; the real token goes in the external file referenced by
`ClipTokenFile`, never in the release or Git. See [CLIP setup](clip-payments.md)
and [integration readiness](integration-readiness.md).

After the responsible person has prepared this machine's private configuration,
the cashier double-clicks **Open-POS.cmd** inside the prepared release folder.
The default configuration is the sibling `pos-cafe-config.json`, outside the
version folder. No terminal commands, dependency installation or administrator
account are needed each morning. Keep the **Caja - POS Cafe** window open; it
can be minimized. Close that window, or press Ctrl+C there, to stop its server.

For a configuration in another local folder, the responsible person can make
an optional desktop shortcut once, from the prepared release folder:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-POS-shortcut.ps1 -ConfigPath D:\POS-Cafe-Test\private\pos-cafe-config.json
```

This explicit installer creates only **Caja POS Cafe** on the current user's
desktop. It refuses to replace an existing shortcut. Recreate the shortcut
deliberately when changing release folders; keep the same private configuration
and current external print journal. It creates no scheduled task, service or
automatic Windows startup entry.

The launcher uses bundled Node and binds only to `127.0.0.1`. Opening it again
reuses the same running release and unchanged configuration, after checking a
per-configuration Windows lock, live process identities, the actual local
listener and the server's launch identity. An occupied port belonging to an
unrelated application, another release or an unverified old POS is refused;
the other program is left running. Choose another local port in the private
configuration if the old POS needs 3000.

If the server exits unexpectedly, the same launcher makes at most three
restarts after 1, 2 and 4 seconds, with the same external print journal. It
performs no sale submission or print replay. After the limit it leaves a clear
message; the error log is `pos-cafe-config.json.server-error.log` beside the
private configuration. The adjacent `.instance.json` is temporary ownership
state, not a sales record or print journal. Do not copy it between PCs.

Run as the signed-in Windows cashier. The helpers install no drivers or services
and change no global Node installation. Network browser access is not enabled;
wireless HDMI can mirror this local screen. Actual Windows scaling, touch,
startup/restart behavior on the café PC and printer output still require testing.

## Automatic business-data copies

With the matching server service-role key configured, the launcher enables a
daily encrypted copy and a background checkpoint after a confirmed close or
handoff. The defaults are `pos-cafe-backups` and the separate
`pos-cafe-backup-recovery.key`, beside the private configuration. The owner
can check the last result under **Administración > Respaldos**. Keep these paths
outside all version folders, preserve the key, and copy the encrypted archive
and key separately off this PC. Backup failures do not block cashier operations.

The release includes the verifier under `backup-tools`. It checks and optionally
decrypts an archive; it does not restore a hosted project. See
[business-backups.md](business-backups.md) for the recovery limits and the
separate local print journal. Rehearse a full recovery before live use.

## Matching database and rollback

Provision the chosen client test project, apply the retained migrations 001, 002, 004, 005, 006, 007, 008, 009, 010, 011 and 012 in order and
create confirmed staff profiles. Review the legacy compatibility requirements
before applying to any existing database. Test against a separate synthetic
catalog and explicit test quantities, not live business records. Inventory has been removed at the owner's request; this candidate does not check or deduct pieces/ingredients. The app still
requires internet for cloud sales; it has no offline sales queue.

Keep every deployed release folder and the one current external print journal.
For an app rollback use the previously verified compatible release with the
same target and current journal. Never rewind/delete/replace that journal or
automatically reverse database migrations after trading. Recover uncertain
sales/print copies before changing versions. A same-disk D: folder is not an
off-machine backup; verify a separate backup/restore procedure before live use.

At final repository transfer review collaborator access, secrets and deploy
keys that remain associated with the repository. Paid GitHub features do not
transfer to a Free account; private-repository protected branches may be lost.
The running local POS does not use GitHub Actions minutes.
