# Windows client deployment

Keep the source repository and CI under the developer's GitHub account until
final client acceptance. Leave PR #1 in draft for review. Repository transfer is
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
client release is still pending the client's email verification and target
project; a test build using loopback is not that release.

## Local machine setup

Use a separate local folder such as `D:\POS-Cafe-Test\releases\VERSION`.
Leave the old POS and its records intact. Configure the sibling
`D:\POS-Cafe-Test\releases\pos-cafe-config.json` from the generated example,
outside the version folder. Store the print journal in a permanent local folder
such as `D:\POS-Cafe-Test\data`, and the private issuer profile outside releases.
The example starts with simulated printing; set `PrintMode` to `windows` only
for a deliberate physical acceptance run. Confirm sticker stock separately.
The service-role key, if needed for staff management, belongs only in this local
private configuration. It is not the public build key.

Run as the signed-in Windows cashier, not as SYSTEM:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-POS.ps1
```

The launcher uses the bundled Node, binds only to `127.0.0.1`, refuses an occupied
port, opens the default browser and retains the server until the launch window
is closed. Choose another local port in the configuration if the old POS needs
3000. It installs no drivers or services and changes no global Node installation.
Network browser access is not enabled; wireless HDMI can mirror this local
screen. Actual Windows scaling, touch and printer output still require testing.

## Matching database and rollback

Provision the chosen client test project, apply the retained migrations 001, 002, 004 and 006 in order and
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
