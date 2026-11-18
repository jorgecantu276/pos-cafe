# Generic demo validation — 18 November 2026

Baseline: `1204ca8b7470763da23ffd5881d545d10df2f8f4`, parent of the separate TV redesign `52983609f34e0a2bb0fdff0dd85d1a57fe9d890e`. The original older TV page remains. No production application source, schema, lockfile, sales, menu or print journal was changed.

Local environment: Windows x64, pinned Node 24.22.2, baseline Next 16.4.3, npm-installed locked dependencies, Docker Linux containers, PostgreSQL 17 and headless Edge at 1366×768.

| Check | Result |
| --- | --- |
| Full test suite | 288 passed; no failures/skips. |
| Baseline database suite | 2,897 assertions passed on disposable PostgreSQL. |
| Original demo database checks | 142 passed, including real RPC seeding/replay, active products in all three price paths, invalid requests with rollback, stock/availability, phase choices, invalid catalog amounts and frozen phone payment after a price edit. |
| TypeScript / lint / whitespace | Passed. |
| Fidelity | 175 canonical baseline file hashes plus original dependency/engine objects; source remains unchanged after generating the demo overlay. |
| Production build | Compiled, type-checked and started. Framework emitted its historical security-upgrade notice; supported one-time same-command retry completed. Notice retained locally. No dependency upgrade was made. |
| Real local HTTP | Signed in synthetic cashier/admin; retrieved generic receipt; two sales and one phone acknowledgment produced exactly three mock customer submissions. Replayed sale requests produced no additional submissions. No preparation jobs. CLIP off. |
| Storage | Synthetic admin uploaded a bundled generic image to local catalog Storage and fetched its public local URL. |
| Browser | Real login, populated register and cashier identity, 16/20 oz grouped-drink selection; external requests blocked. Screenshots captured only after catalog loaded. |
| Visual review | Populated generic register, size dialog and narrow generic customer ticket were visually inspected and independently approved. Ticket preview uses the unchanged baseline reprint renderer. |

The committed `demo-verification.yml` repeats the checks in GitHub Actions. Remote CI results are separate from the successful local results above.

No real payment, physical print, hosted migration, production data write or café-PC deployment occurred. This is a disposable demonstration, not a production release. See [run guide and exact feature limits](generic-demo.md), including absent native bundles, timed pricing/availability, ingredient inventory and loyalty redemption.
