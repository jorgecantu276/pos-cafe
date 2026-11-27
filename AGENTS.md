# POS Café / Smoothies — agent guide

## Start with the task

- Read the relevant product report: `docs/products/cafe.md` or `docs/products/smoothies.md`.
- The private family operations catalog owns product/client/package selection. Do not infer current installation from a folder, branch, latest release or old chat.
- Status/open requests inspect and reuse valid evidence; they do not trigger builds, qualification, resets or deployment. A missing gate is a result to report.
- For code changes, identify the affected behavior and acceptance criteria first. Reuse existing components and scripts; avoid unrelated refactors, new frameworks and speculative abstractions.
- Always use a separate independent reviewer. The main agent coordinates/implements; add implementers only for separable responsibilities. Review the final integrated revision. Follow `docs/quality-workflow.md` for cross-area work.

## Build and verify

- Use runtime/toolchain versions from `package.json`, lockfiles and packaging scripts; do not duplicate pins in prose. Use `npm ci`.
- Core checks: `npm test`, `npm run typecheck`, `npm run lint`. Run affected database, HTTP, printing or recovery checks from `package.json`; required CI remains mandatory.
- Build with `npm run build:verify`. Windows packaging uses `npm run release:windows -- <absolute-private-target.json> <new-output-directory>`; Smoothies has its own package script.
- Test changed behavior on the exact integrated package. Reuse unchanged valid evidence; rerun after relevant changes/failures. Report actual commands/results and unresolved limits.
- Keep tests synthetic with a verified separate backend, accounts, request/lock domain, runtime state and simulated providers/printing. Another port or browser does not isolate production.

## Preserve business contracts

- One physical POS/drawer: counted closing/handoff, explicit owner/cashier roles, saved rate for future openings and immutable active-shift/sale rates.
- Server-owned prices and atomic checkout; original actor/request identity survives timeouts, reloads and cashier changes. Never retry money with a new identity to clear uncertainty.
- Phone promises remain separate from paid sales. Preserve original preparation identity and post-payment recovery; pickup payment must not duplicate preparation or customer charges.
- Café inventory is opt-in finished-product stock; unknown differs from zero. Do not revive removed Café ingredient/recipe logic. Smoothies' explicit recipe capability remains separate.
- Preserve current client provider configuration. Defaults/examples may be disabled, but old “CLIP OFF” notes are not permission to disable a working store. Never enable a provider without its accepted contract/device/configuration.
- Keep immutable receipt snapshots, per-copy print journal, audit and WAL/sidecars. Windows acceptance is not physical paper proof. Never blindly resend accepted/uncertain jobs or rewrite old documents for new layouts.
- Receipt/label design, current routing, USB/Bluetooth profiles and recovery are documented in `docs/printing.md`; dated physical results are in `docs/printer-acceptance-2026-10-31.md`.

## Delivery and recovery

- Develop here; stores consume accepted packages through GitHub. Do not edit an installed immutable release or use a store as a general Actions runner.
- Preserve the one-family version series and all-three promotion gate. Independent product candidates are allowed; no candidate/CI result alone proves release, installation, provider or site acceptance.
- Keep private targets, credentials, issuer data, journals, backups and machine identity out of Git and distributables. Verify exact backend/configuration and supported predecessor before updating.
- New installer/update source must preserve current business data, keys and journals. App rollback is not database rewind; use a compatible retained package or reviewed forward repair.
- Automatic Café updating defaults OFF until one-time enrollment and actual acceptance. Never apply database migrations automatically. Preserve safe closed-shift/payment/handoff/printing gates. See `docs/windows-auto-update.md`.
- A past chat's deployment/reset/print authorization is historical. Current task scope controls publication, live SQL, provider calls, physical output and client installation.
- Keep instructions short. Record a new rule only for demonstrated recurring friction; current plans belong in product reports, dated evidence in existing historical documents.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
