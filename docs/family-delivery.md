# POS family delivery

The native repository's `POS family delivery candidate` workflow builds Café,
Smoothies and native Papelería together, using the existing builders and common
family verifier. It reads public web source at an exact commit; no cross-repository
private token or signing key is needed. Main changes and an hourly source check
select the current web main commit after its exact push/manual verification run
passes. Unchanged source reuses a nonexpired candidate from a successful family
run with the same native and web commits. Missing/in-progress/failed source CI
is reported as `waiting-source-ci`; it never means a package was built.
`POS_WEB_CANDIDATE_SHA` pins integration PR tests; manual dispatch selects
`web_sha` explicitly and requests a fresh candidate. Reads are bounded, so an
unusually busy history can conservatively rebuild rather than infer acceptance.

Ordinary runs use a synthetic loopback Café target. A manual `customer_target`
build requires `CAFE_PUBLIC_TARGET_JSON` in the private native repository,
containing only the independently verified `supabaseUrl` and `supabaseAnonKey`.
It must match the actual Café installation. Never put service credentials in that
secret or substitute a development backend. Customer configuration is not actual
device acceptance.

The candidate artifact contains all three packages, their ZIPs and
`family-candidate.json`. The receipt binds every package file and ZIP to the
family version, web commit and native commit. Download and extract the artifact
without changing package contents. Candidate source may be on a reviewed branch;
source integration and customer qualification remain explicit.

```powershell
node scripts/releases/family-delivery.mjs inspect C:\private\candidate\family-candidate.json
node scripts/releases/family-delivery.mjs acceptance-template C:\private\candidate\family-candidate.json C:\private\family-acceptance.json
```

The generated acceptance starts `NOT_QUALIFIED`. An independent reviewer records
the final source review and the actual new-install, retained-upgrade and recovery
results for **each** of Café, Smoothies and Papelería, with exact evidence-file
hashes. Keep this record outside Git and distribution artifacts. This is a named
procedural review, not cryptographic proof of reviewer identity. Failed/missing
checks remain unqualified; a rehearsal can never be promoted to customers.

Publish from the clean exact web source, after pushing its immutable lightweight
tag (`pos-<first-seven-commit-characters>` for Café; the family release tag for
Smoothies). Existing different tags/assets must not be moved or overwritten.

```powershell
node scripts/releases/family-delivery.mjs publish-cafe C:\private\candidate\family-candidate.json C:\private\family-acceptance.json C:\private\cafe-signing.pem C:\private\notes.txt <accepted-predecessor-commit>
node scripts/releases/family-delivery.mjs publish-smoothies C:\private\candidate\family-candidate.json C:\private\family-acceptance.json C:\private\smoothies-signing.pem C:\private\notes.txt
```

These commands reuse existing signature, actual-ZIP verification, immutable GitHub
release and feed-promotion tools. Direct publisher calls also require
`POS_FAMILY_CANDIDATE` and `POS_FAMILY_ACCEPTANCE`; both are revalidated before
signing or publishing. Signing keys stay on the maintainer machine. Runtime data,
private configuration, backups, report credentials and customer menus are not
uploaded by this workflow. Actual Café enrollment and the first accepted machine
report remain separate; application updates never apply database migrations.

Papelería's accepted archive remains part of the private family artifact. No
native automatic updater or installed client is implied by building it. Punto
retail has its own customer-package and installation contract and is outside this
three-product promotion gate. Smoothies intake retains its existing Pages path.
