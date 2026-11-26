# POS Smoothies

Windows POS for a smoothie bar: local selling, private recipe trials, menu and
extras, opening counts and encrypted backups. The PC uses local Supabase
(PostgreSQL/Auth/Storage). The target workflow is to operate the same POS from
Safari on her iPad over the local Wi-Fi. The LAN workflow uses one configured
HTTPS address with the existing PC backend. Setup prepares its certificate;
acceptance on the actual PC, iPad and network is still required.
Internet is needed for initial downloads and update checks, not local cash sales.

**Status:** pre-launch. The owner identifies only Café as live. Historical signed
Smoothies pilot packages and isolated test results do not prove a store install.
See [product progress and next milestones](docs/products/smoothies.md).

## Start here

- [Install, daily operation, offline acceptance and iPad operation](docs/smoothies-local.md).
- [Shared-source/profile decisions](docs/shared-pos-local.md).
- [Backup and recovery contract](docs/business-backups.md).
- [Development and independent review](AGENTS.md).

The iPad uses the same authenticated workflow, including printing through the PC,
menu import and backups. See the [LAN setup and device acceptance](docs/smoothies-lan.md).
The [site-values template](config/smoothies-site.example.json) keeps unknown device,
network, backup and menu facts as `null`. The installer consumes that private file;
the matching checklist leaves every live observation pending until tested.
Configured encrypted backup copies and sanitized installation diagnostics are
included in the portable package.

The client completes this product's [menu intake form](https://jorgecantu276.github.io/formulario-smoothies/)
and sends its JSON. Review menu/prices/extras before importing. Planned inventory
is not physical stock; confirm opening counts explicitly. Recipe trials stay
private until a product draft is deliberately activated.

The family workspace has one `smoothies` product folder: `app` for this POS and
`intake` for its form. Separate source/deployment histories do not create another
product or client.

## Source and builds

This folder is a variant checkout of `jorgecantu276/pos-cafe`, not a separate
GitHub repository. Café and Smoothies may currently select different accepted
commits. Do not replace this variant with an arbitrary Café/main/scratch build.
Use the family operations catalog to resolve source, qualified package and client.

Development uses the runtime pinned by source/workflow. Keep configuration and
all databases, credentials, backup keys and print journals outside Git.

```powershell
npm ci
npm test
npm run typecheck
npm run lint
npm run build:verify
```

Use `scripts/smoothies/package-windows.mjs` for a portable candidate. It includes
Node and compiled app; the operator should not install npm/developer tools.
Functional local drills include `scripts/smoothies/import-drill.mjs`,
`local-sale-drill.mjs`, `acceptance-ui.mjs` and `acceptance-update.mjs`.
Read each script's prerequisites and use a verified synthetic backend.
CI retains the uninstalled Windows candidate ZIP. Full installed LAN acceptance
runs on a fresh hosted Windows 2025/Ubuntu WSL2 machine when explicitly selected
with `run_installed_acceptance`. It verifies real Docker transport and trusted
synthetic HTTPS, then exports hash-bound sanitized evidence. Actual PC setup,
iPad Safari and physical printing remain equipment acceptance.

Recipe saves and explicit recovery use the shared `lib/recipe-trial.ts` owner:
pending writes survive reload, retain their original account/payload and block
new trials until resolved. The newer recipe-to-menu links and inactive-product
activation flow stay in place. The register also bounds a stalled abandonment
request while preserving its saved recovery identity.

## Delivery boundaries

The existing signed pilot updater verifies product/channel/version/files, stages
separately, waits for closed shift and resolved payment/printing work, and retains
the previous application after failed startup. It refuses database-contract
changes. Initial enrollment, real hardware, off-PC backups and destination
recovery still require acceptance. Do not deploy a demo as a customer package.

Keep the established one-family version and all-three promotion gate. Individual
candidate checks may run independently; publishing and installation are separate.

Other inherited documents describe shared contracts or dated Café experiments.
Their menu, printer, currency and deployment examples are not Smoothies defaults
or permission to change a live client. The product report and source contracts
identify the applicable variant; real configuration remains private.
