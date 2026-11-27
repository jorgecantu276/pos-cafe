# Local backup, restore and deployment rollback drill

> Development reference: use isolated synthetic state only. Historical fixture
> counts and earlier schemas below do not establish the current Smoothies/client
> contract. Preserve the full current migration order and verify the script's
> prerequisites before running. No hosted deployment or production reset is implied.


Run `npm run test:recovery` with the existing local staging services running. Ports 55460, 55462–55464 and 3110–3112 must be free. The ordinary previews at 3000/3101 remain separate. This command is a development acceptance drill, not a production deployment installer or hosted Supabase restore command.

## What is backed up

The runner checks the dedicated loopback Docker/Supabase identity before accessing any database. It exports a read-only repeatable-read snapshot and passes its snapshot ID to `pg_dump --format=custom`. It also captures cluster roles including their password hashes, database settings and locale, service image identities/configuration, and synthetic local administrator access.

The result is an AES-256-GCM envelope at `.staging-local/recovery/<run-id>/backup.aes-gcm.json`. Each archive member has a SHA-256 digest; the envelope authenticates its contents. The random decryption key is stored separately under `.staging-local/recovery/keys/`. Temporary plaintext host dump files are removed. All of this remains ignored by Git and excluded from builds. Password hashes and service secrets are never included in user-facing test results.

Keep both the envelope and key to recover it. Their current separation on one development disk tests encryption/integrity, not off-device disaster protection, key escrow or a scheduled backup service. Production needs a retention policy and a protected copy/key recovery plan away from the café PC.

## How restore is tested

The destination is a newly initialized PostgreSQL cluster in a run-owned container, using the exact local source image. It has no source volume mounted and publishes its database port only on loopback. Its database files are disposable tmpfs test storage; it is removed after the drill. No restore command targets `postgres` on the source staging container or either hosted project.

Cluster globals restore first. The destination uses the source bootstrap identity `supabase_admin`; only its duplicate `CREATE ROLE` statement is skipped, while its saved attributes, password hash and memberships are restored. This is necessary for PostgreSQL 17's `GRANTED BY` membership chains. Database creation preserves the source encoding, ICU/libc locale, ACLs and per-database role settings.

Restore inputs are streamed to the container and hashed there. Docker Desktop's copy-to-tmpfs behavior is not assumed. `pg_restore --single-transaction --exit-on-error` is first tested against an intentional table conflict: previously created schema objects must roll back. The conflict fixture is removed, then the complete restore must succeed.

The runner compares every non-system base table's data and counts. It also compares application/Auth/private schemas, table/column privileges, role attributes/memberships, functions, policies, constraints, triggers, default grants, database configuration and sequences including `is_called`. Row hashes use a locale-independent ordering. ACL order and implicit default ACLs are normalized using PostgreSQL's actual defaults; privileges are not omitted from comparison.

Real GoTrue and PostgREST services then start against the restored database with the saved service settings. A thin loopback HTTP router supplies their URL prefixes; it does not reproduce Kong rate limiting/TLS. Tests verify restored password login, token identity, projected login data, anonymous denial and pre-backup sale recovery.

## How app rollback is tested

Two independent production builds of the same repaired candidate run on ports 3111/3112 against the restored clone. The owner UI source is unchanged. An authenticated probe exists only in each scratch build so the drill can identify the active release and inject readiness failure. Each release records its build ID, artifact hash and database contract fingerprint.

A loopback gateway at 3110 and an atomic activation journal exercise these cases:

1. A failing candidate is rejected before switching the gateway or journal.
2. A legacy/incompatible database contract is rejected. The original insecure Next.js/app version is never launched.
3. A healthy candidate activates, then a synthetic sale commits in the restored clone.
4. The candidate process is deliberately killed. The drill controller verifies and switches back to the retained compatible production build.
5. The committed receipt remains unchanged on retry, stock is deducted once, and the restored ticket sequence advances beyond old tickets.

This proves the local switching/recovery protocol, not an installed Windows watchdog, startup service, installer or café deployment package. The previous compatible release must be retained and health checked before any real activation.

## Database rollback policy

A pre-traffic clean restore must match the backup. A destructive rewind is refused once business or Auth data differs. After new sales exist, roll back only to a database-compatible app, preserving the current database, or use a reviewed forward repair. Never blindly replace it with the earlier backup or return to unrestricted legacy checkout.

An actual production transition from the original schema still needs its own coordinated pre-migration backup and hosted restore acceptance. The drill's source is the already repaired synthetic staging schema. It does not reverse the production migration, restore hosted encryption root keys or establish provider-level point-in-time recovery.

Browser-local expense drafts and uncertain checkout markers, printer drivers/configuration, external image assets, OAuth/provider settings outside the saved local configuration and off-device backup storage need separate handling. Reconcile/export browser-only drafts before deployment; a database dump cannot recover them.

Results are written to `.staging-local/recovery/last-result.json`. A failed check fails the command; no result is treated as passed because a dump file merely exists. Cleanup verifies run-specific Docker labels before removing disposable restore containers. Encrypted backups, keys, build artifacts and the journal remain available locally for inspection.

References: [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html), [database locale creation](https://www.postgresql.org/docs/17/sql-createdatabase.html), [Supabase hosted backup/restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
