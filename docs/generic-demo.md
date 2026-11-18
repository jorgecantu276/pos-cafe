# Café Demo — exact pre-dashboard baseline

This demonstration uses **1204ca8b7470763da23ffd5881d545d10df2f8f4** (6 November 2026), the direct parent of the TV redesign **52983609f34e0a2bb0fdff0dd85d1a57fe9d890e** on `codex/redesign-tv-dashboard`. The redesign branch is not an ancestor of current main. Selecting current main, or merely hiding its dashboard, would not reproduce this baseline. The chosen parent already contains the original TV page; “pre-dashboard” here means before that redesign, not before the first TV page ever existed.

`codex/generic-pre-dashboard-demo` branches directly from that parent. Dependencies/lockfile, application, database snapshot and migrations remain at the baseline. `scripts/demo/baseline-files.json` pins their canonical hashes (text CRLF is normalized to LF). Startup refuses a changed source tree or dependency set. Do not merge this historical branch into main to roll back the product.

## Run on a development computer

Requirements: Node **24.22.2 x64**, npm, Docker Desktop running Linux containers, and Edge/Chrome (Chromium on Linux for the browser check). Docker must use the local default endpoint. First startup may download Supabase images. The app requires the local backend; this is not an offline-sales implementation.

```sh
git switch codex/generic-pre-dashboard-demo
npm ci
npm run demo
```

Open **http://127.0.0.1:3127**. The launcher prints the location of `access.private.json`, containing randomly generated local credentials:

- `demo_cashier` / **Caja Demo**: the populated, open register.
- `demo_admin` / **Responsable Demo**: catalog, inventory, customers, history and settings. One global open drawer means this administrator does not get a second independent selling shift.
- `demo_second` / **Caja Relevo Demo**: second cashier for a deliberate drawer handoff.

The latest run directory is recorded in `.staging-local/generic-demo-latest.txt`. No reusable default password, hosted Supabase key or customer account is shipped. On Windows, `mode: 0600` is advisory; protect the checkout with your user account's normal filesystem access controls.

The app is bound to loopback 3127, API to 55621 and database to 55622. The isolated stack's auxiliary ports are 55623/55624 when required by the CLI. Existing occupied ports cause a failure; no unrelated process or stack is stopped. Do not expose the demo to the network.

**Stop with Ctrl+C in its terminal.** The launcher shuts down only the app/stack it created. Each invocation creates a new synthetic database and resets the demonstration by replacement; interactive demo changes are disposable. The seeder is replay-safe inside a completed run and never resets interactive transactions. A partial seed is deliberately refused: start a fresh run. Ignored source/build/evidence folders remain locally for review; no customer journal is opened or replaced.

## Original data and feature coverage

The fixture is authored in `scripts/demo/menu.mjs` and never imports `tests/fixtures/real-menu.json`, the customer's menu seed, approved menu SQL, private targets, backups or sales. Similar generic coffee terms and the two exact chai temperature tokens are needed by the existing name recognizer; product combinations, amounts, IDs, customer identities and contacts are synthetic.

The initial run contains **34 products, 27 extras, 5 categories, 8 favorites, 4 loyalty customers, 3 staff accounts, 19 sales (including one cancelled sale and one paid phone pickup), one closed shift, one open shift, 2 pending phone orders and one cancelled phone order**. All financial records and operational movement history are created through the baseline RPCs, including replay of each ordinary sale. Product/extra catalog rows are inserted only into the freshly claimed empty demo database. Timestamps are actual run time so recent-ticket screens work; monetary inputs and product IDs are reproducible.

| Capability | Demonstration and validation |
| --- | --- |
| Categories/search/favorites | Bebidas, Postres, Botellas, Cocina, Despensa; accented names, fractional MXN prices, inactive product/extra, eight favorite cards. |
| Grouped families | Iced Coffee, Matcha, Nevado, Frappuccino, Chai Latte. Unequal prices show “Desde”; equal prices do not. |
| Sizes/variants | Separate 16/20 oz product IDs and prices. Maple/cacao/cardamom iced drinks and garden-vanilla matcha have matching sizes. Seasonal-orange iced has only 16 oz and is unavailable; pear matcha has only 20 oz. Compatible modifiers/notes survive a size switch; unmatched preparations require reselection. |
| Modifier groups | Tamaño, Tipo de Leche, Leche alternativa, Endulzante, Sabor, Espuma, Creamer, Helado gourmet, Temperatura, Acabado, Preparación. Free and paid alternatives, decimal surcharges and multiple same-phase optional flavor extras. Ice cream and temperature require a choice in the UI; milk/size are exclusive. |
| Pricing/invariants | Server recalculates base plus selected extras times integer quantity; mismatched totals, negative/sub-cent catalog prices, inactive/foreign/duplicate extras, multiple milk/size options, fractional/zero quantities, stock excess, inactive/unavailable products and invalid pagers are rejected. Ordinary, CLIP quote and phone quote SQL paths are checked. Rejection rollback and immutable sale replay are asserted. |
| Inventory | Explicitly enabled only in the new demo DB. Counted versus availability modes; unknown, zero, low and normal counts; all six units. Counts, receipt, waste, CSV import history, sale deductions, phone holds and explicit partial cancelled-sale return. Legacy `products.stock` remains null/inert. |
| Photos | Two explicit bundled generic photo URLs plus fallback photos. HTTP verification uploads a generic photo through real local Storage and fetches it. No customer photos are loaded. |
| Orders/payments | Local/takeaway, MXN cash, mixed MXN/USD at synthetic 17.25 rate, manual card, notes, multiple lines/quantities, pagers 1–30, loyalty purchases, cancellations and closed/current shifts. Automatic CLIP stays off, with no provider token or real charges. |
| Phone orders | Pending, paid-at-pickup and cancelled records; no pager; reservations with explicit return decisions. Verification changes a catalog price and pays the frozen earlier quote. Customer phone contacts do not enroll a loyalty member automatically. |
| Catalog operations | Admin editing/reactivation and revision recovery remain baseline behavior. Existing tests cover permission checks, concurrent edits, deactivation/reactivation and preserved snapshots; fixture includes inactive rows to inspect/reactivate. |

## Generic customer ticket; no preparation tickets

The user's demo-only presentation changes are applied to a fresh, allowlisted scratch copy, never to production application files:

- **Café Demo** identity, original cup/seal artwork and a simple black-and-white customer receipt. No customer name/logo, phone, Instagram link, QR destination, issuer or hardware discovery details are copied into the demo experience. The ticket says **DEMOSTRACIÓN · SIN VALOR FISCAL**. The sample issuer is fictitious.
- Only **customer** jobs enter the new local journal, including phone customer acknowledgments. **No barista or dessert/preparation ticket is created or dispatched**. The source generator and baseline tests remain intact; audience filtering is an explicit demo overlay requested by the user. This does not turn off phone reservations or change when a sale is paid.
- Printing is always **mock** and CLIP always off. Receipt previews use saved server snapshots and the baseline renderer. Ordinary reprint actions still open the baseline browser print dialog if chosen by the user; the automatic demo never sends physical paper.
- UI layout, payment/recovery handlers, prices, validations and database RPC code are unchanged. The overlay report in each run (`overlay.json`) lists altered files/hashes and substituted assets. The baseline's internal username email adapter remains for Auth compatibility and is not a customer contact or real inbox.

## Checks and evidence

```sh
npm test
npm run typecheck
npm run lint
npm run test:db
npm run demo:test
npm run demo:verify
```

`demo:test` runs the original snapshot/migrations in disposable PostgreSQL 17 and tests this original catalog and its invariants. Its SQL-only harness omits the Storage-only migration 022; the full HTTP rehearsal applies **all 22 retained migrations (001, 002, 004–023)** with real local Auth, PostgREST and Storage.

`demo:verify` builds the sanitized production app in a separate folder, signs into real local Auth, checks receipt snapshots, uploads/fetches a generic photo, asserts customer-only jobs for mixed drink/dessert sales and phone orders, verifies submission deduplication, and opens the register and size selector at 1366×768 in a headless browser. It saves register, sizes and ticket screenshots, a standalone customer-ticket HTML and `verification.json` under `<run>/app-*/demo-evidence/`, then stops its stack. It requires a supported installed browser. This check intentionally blocks external browser requests.

## Baseline limits

There is **no native combo/bundle engine, automatic combo discount, tax/pricing schedule, timed availability, ingredient recipe costing or stock deduction per modifier** in this version. A multi-item order is not a bundle. Coupons/loyalty redemption are not an approved selling workflow. No such behavior has been invented in the demo. Availability is manual or driven by finished-product stock. The existing family recognizer depends on specific category/name patterns; the demo exercises those patterns instead of redesigning the schema.

Some rules differ by layer: required temperature/ice-cream selection and Creamer exclusivity are UI rules; the server explicitly enforces size/standard-milk/alternative-milk exclusivity. The demo does not silently strengthen server behavior. A catalog change requires refresh/review before a fresh sale; saved phone/sale snapshots preserve agreed prices.

This is the historical Next **16.4.3** application, not the later rc3 release; fidelity deliberately excludes subsequent framework and product changes. It is for isolated demonstration, not a replacement production release. Mock jobs and browser screenshots do not validate a physical printer, terminal, deployment PC or every hardware/recovery scenario. Existing baseline tests remain the broader regression evidence; no exhaustive claim beyond the explicit coverage above is made.

During local verification, Next emitted a security upgrade recommendation after compiling/type-checking. The launcher records that notice as `framework-notice.txt` and retries the identical build at most once, using Next's supported retry mechanism; other build failures remain failures. Keep this historical demo local. A framework upgrade belongs in a separate version and would break the requested exact baseline.
