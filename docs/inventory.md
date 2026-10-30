# Inventory and register candidate

This unreleased candidate adds `202610280003_inventory.sql` after migrations 001
and 002. No hosted database, opening count or real menu record was changed.

## Register appearance and UI rollback

The default register is the plain Spanish touch workspace, connected to the
existing authenticated checkout, shift, draft and recovery handlers. It uses the
actual catalog prices and MXN amounts. It does not adopt the demonstration's
tax, USD sample menu, simulated payments or browser-only sales ledger.

Set server environment `POS_REGISTER_UI=owner` and restart the production app to
use the retained owner layout with the SAME current transaction and inventory
contracts. Remove the setting or use `workspace` to restore the default. Use `prototype` for the retained Juniper appearance. See [workspace design](workspace.md).
The root page is dynamic so this switch does not require a source/database
rollback. Tests render all three layouts through an actual sale and draft recovery.

A separate pre-change source snapshot and SHA-256 manifest were saved outside
the repository before these edits. That older source is an archival recovery
copy, not a schema-compatible application rollback after migration 003. Do not
restore the older application or rewind the database after new trading. Prefer
the appearance switch when the concern is the UI.

## Tracking is explicit

- `product`: deduct finished pieces only.
- `recipe`: deduct confirmed ingredients only; no fictional drink count.
- `both`: deduct finished pieces and ingredients at sale, preserving the previous
  policy for existing products. Do not consume those ingredients again when
  recording received finished production.
- `untracked`: deliberately deduct neither pieces nor ingredients. It allows
  sales without finished-stock counts but makes no stock/ingredient promise.

Migration 003 keeps all existing quantities and defaults to `both`; it does not
classify live products or disable their stock checks automatically. Physical
counts, tracking choices and true recipes remain owner decisions. Metadata
creation starts at zero; opening quantities must be audited counts or entries.
Migration 001 still requires existing invalid balances to be reconciled first.

## Replenishment, counts, waste and audit

Admin → Inventario provides entries, waste, physical counts, tracking rules,
full recipes by option combination and the latest 100 movements. Catalog and
supply editors change metadata, not a stale absolute stock balance. Base units
are immutable through ordinary editing. New items start at zero. Deactivation
retains history rather than deleting a stock identity.

`pos_adjust_inventory` serializes with checkout and records actor, request,
before/after/delta, revision, base unit and reason. Entries and waste are additive;
counts require the displayed revision so a sale followed by an equal-sized entry
cannot hide a stale count. There is no manufactured past movement history.

The browser persists an administrator-scoped UUID and exact payload before I/O.
Unknown responses retain it; retries use the same request. Web Locks coordinate
tabs, and the server journal coordinates profiles/machines. Actor binding rejects
a request sent after an account switch. Permission or lock failures retain an
uncertain request because they can occur before replay lookup. Only confirmed
business/data rejections retire an absent operation. The UI must not clear site
data as a way to resolve an uncertain movement.

Stock balances and the new audit/recipe tables cannot be written directly by
browser roles. Administrator RPCs enforce authorization and validation. Existing
sale replay remains valid after this migration, including older receipts.

## Shared pieces and ingredient variants

A presentation can reference one root piece SKU and an integer pieces-per-sale
value. Tortuguitas 5pz can consume five Tortuguitas, and Nubesitas 6pz can consume
six single pieces. This does not infer cake slicing or production yield. Nested
stock sources and cycles are denied. A presentation must reconcile its own stock
to zero before sharing another balance. Checkout aggregates single items and
packs before testing stock, preventing concurrent overselling.

Recipes are COMPLETE ingredient lists keyed by a product and the sorted exact
set of selected extra IDs. A milk choice does not imply ingredient replacement.
When a recipe-tracked product has no confirmed recipe for the chosen options,
checkout fails before any stock/order change. A configured almond recipe deducts
almond and does not automatically deduct the base dairy recipe as well. The base
recipe mirrors `product_recipes` for existing base-cost reads; full variant costs
remain outside the base ingredient estimate. See [reporting](reporting.md).

The supplied 82 menu presentations and milk surcharge rules are fixtures only.
Database tests and the preview use deliberately synthetic counts/recipes, never
claimed as the café's counts or recipe quantities. The preview's chosen tracking
policies demonstrate operation; they are not a production import plan.

## Local verification

- `npm test`: shared recovery plus both register appearances, inventory decimal
  conversion, storage failures, concurrent tabs and exact request recovery.
- `npm run test:db`: original 001/002 baseline, migration 003, inventory grants,
  every real-menu presentation, restock/resale, pack aggregation/races, recipe
  substitutions and replay. Fresh embedded PostgreSQL 17.6 only.
- `npm run test:shift-http`: upgrades only its newly owned archive restore and
  rechecks expenses/closing against all four migrations, real Auth/PostgREST,
  real-menu HTTP arithmetic and the 1,109-sale cap case.
- `npm run test:inventory-http`: restores a verified encrypted synthetic archive
  into owned loopback Docker services; applies missing candidate migrations;
  tests real HTTP privileges, replenishment retries, packs, stale counts and
  ingredient variants. The source staging database is not connected.
- Add `-- --preview` to the inventory HTTP command for a production app through
  the same-origin loopback gateway at port 3110 (app 3111). It creates only local
  synthetic accounts, saves ignored access/ready files and holds its owned
  disposable stack until a matching runId stop request. No café environment
  file is copied into that build.

Physical touch accuracy, peripherals, café startup, live data reconciliation,
hosted migration/restore and owner acceptance remain release gates.
