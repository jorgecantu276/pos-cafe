# Daily business backups

The Windows launcher supplies `POS_BACKUP_DIR`, `POS_BACKUP_KEY_FILE`,
`POS_DATABASE_CONTRACT_DIR` and `POS_RELEASE_COMMIT`. Automatic backup also
requires the server-only `SUPABASE_SERVICE_ROLE_KEY` and matching Supabase URL.
Without these settings it stays disabled. No Docker, PostgreSQL client install,
Windows scheduled task or cashier action is required.

After migration `202610300012_business_backups.sql` is applied, the production
server checks at startup and hourly while the app remains open. It saves once
per calendar day in America/Matamoros and retries failed attempts on the next
hour. Closing the PC/app prevents a scheduled copy; reopening checks again.
`/admin/respaldos` lets an active owner inspect last success/failure, create a
copy and download the last confirmed encrypted archive. Cashiers cannot access
backup status/downloads, the snapshot RPC or recovery key. After a confirmed
shift close/handoff, the register may request a background checkpoint with
`POST /api/backups` and `X-Pos-Backup: checkpoint`. Active staff receive only
`{accepted:true}`; the checkpoint never blocks the close or returns data. It
bypasses the daily skip, coalesces concurrent work and has a one-minute cooldown.

Use permanent private local folders outside every release. Keep the raw 32-byte
recovery key outside the backup directory. The app generates it only before
the first archive; a missing original key is an error, never a silent key
replacement. Preserve this key across upgrades and copy it separately to a
secure off-PC location. Windows folder permissions must restrict the private
configuration, service key and recovery key to the responsible account. A
backup/key stored on the same computer does not protect against theft or disk
failure; the owner must also keep an encrypted copy off the PC. Every later
backup authenticates the previous confirmed archive with the same key first;
replacing the file with a different 32-byte key fails instead of rotating it.

Each `.posbackup` file uses AES-256-GCM authenticated encryption over gzip JSON,
with a fresh random nonce. It includes all `public` and `cafe_private` table
rows, `auth.users` and `auth.identities`, current column descriptions and
business sequence counters. One service-role-only STABLE RPC takes a single
MVCC statement snapshot; concurrent sales do not produce a mix of table
snapshots. Sequence counters may advance past included rows and must retain
that higher value. Original database JSON text is preserved so large numeric
values are not rounded by JavaScript. The archive also contains the release's
baseline `schema.snapshot.json` and every bundled migration with SHA-256 hashes.

Complete bytes are flushed, authenticated and read back before an atomic
publication replaces last-success metadata. Network/disk errors preserve the
previous confirmed archive. Retention keeps up to the latest 14 named completed
copies within 512 MiB; the current confirmed copy is always retained. The owner
page displays retained copy count and total bytes. Unrelated files and links
are untouched. A temporary file left by a
power cut is never considered a successful backup. This is a modest backup for
the single-PC café, with a 256 MiB uncompressed archive limit; exceeding that
limit reports failure instead of creating a partial copy.

## Verify or decrypt a copied archive

On a separate trusted machine with Node 24.22.2 and this matching source:

```
node scripts/backups/inspect.mjs D:\recovery\backup-FILE.posbackup E:\private\recovery.key
```

This authenticates/decrypts in memory, checks required tables and contract
hashes, and prints only timestamps/counts. A wrong key, edited/truncated archive,
missing table or altered contract fails. To explicitly export a private
plaintext recovery file, append an absolute output path. It must not already
exist. That JSON contains personal data and Auth password hashes; protect it
and remove the temporary plaintext after the recovery work is complete. The
`snapshotJson` member is the exact database JSON, including numeric precision.
Synthetic tests verify encryption/decryption, CLI export, permissions,
day boundaries, concurrent requests, retention and preservation after failure.
The isolated PostgreSQL check also rehydrates every captured table into
temporary typed clones and compares exact row multisets and numeric values,
while confirming that source rows and sequence counters stay unchanged. This
checks data fidelity; those clones do not reproduce hosted Auth configuration,
triggers or foreign-key restoration.

## Recovery limits and print journal

This is a logical business-data export, not a complete Supabase project restore.
It does not include Storage objects, provider/service configuration, API keys,
JWT secrets, Auth sessions, database roles/extensions or a hosted restore
orchestration. Hosted Auth import and full project restoration have not been
validated by these tests. Before live use, a recovery engineer must rehearse
loading the matching schema and these rows/sequence counters into a separate
compatible target, check staff/customer access and reconcile any sales after
the snapshot. Never load a backup over a live café database to test it.

The durable local Windows print journal is deliberately excluded from these
cloud business snapshots. Preserve its current external directory across every
upgrade and app rollback. A separate journal copy requires the app stopped or
a SQLite-aware consistent backup. Never replace it with an older copy or
blindly replay jobs: a copy handed to Windows may already have printed, and
old journal state could send it twice. Any real recovery must reconcile
uncertain sales and paper output before printing resumes.
