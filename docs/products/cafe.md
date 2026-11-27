# Café — product plan and current progress

Reviewed November 25, 2026. Café is the only product the owner currently identifies as live. This document translates the accumulated business decisions into work an agent can implement and verify. It is not proof of the version currently running at the store, and historical deployment permission is not standing permission to change a client.

## Business purpose and operating model

Cariñito Mío needs a dependable counter POS that ordinary employees can use on one Windows POS and one cash drawer. The owner wants a simple Spanish cashier flow, correct money and shift records, customer and preparation printing, menu maintenance, and remote delivery through GitHub. Preserve product-specific operations instead of turning it into a generic dashboard or recipes platform.

The core cashier journey is: open or receive the drawer → identify products/options → review the order → take payment → record one sale → produce its saved customer receipt and required preparation copies → recover uncertain operations by their original identity → count and close or hand over the drawer. Closing a shift and logging out are separate transitions.

## Business need → implementation → acceptance

| Business need | User-visible workflow | Technical responsibility | Acceptance and current boundary |
| --- | --- | --- | --- |
| Fast, uncomplicated selling | Products and order together; total and Cobrar remain visible; edit an order line directly | Shared register handlers, role-specific navigation, practical viewport/touch controls | Complete sale at actual POS scaling; no false saves, clipped Save button or unrelated dashboard modules |
| Correct money and staff handoff | Explicit cash count, one drawer, named successor, saved exchange rate | Atomic checkout; request identity; drawer/handoff guards; server-owned prices; integer-cent MXN/USD accounting | Lost response/reload/account change cannot duplicate money. Preserve exact current installed behavior and historical receipts |
| Border cash payments | Show total in whole USD as requested; received cash and change appear naturally in checkout | Shared conversion/rounding across checkout, drawer and handoff; saved rate distinct from active-shift snapshot | Known MXN/USD examples reconcile; new rate never rewrites the open shift or old receipts |
| Drinks and desserts reach preparation | Correct per-cup and special-dessert labels; paid non-drink preparation queue | Immutable per-copy documents, journal and cancellation/preparation fences; latest routing rules | Actual packaged path and expected paper content. Windows acceptance is not physical paper proof |
| Phone pickup | Save a quoted unpaid order; recover preparation; charge at pickup | Persistent phone/order/preparation identities distinct from paid sale and print journal | Lost preparation response followed by another cashier and pickup payment still permits original preparation recovery, with no repeat customer charge |
| Straightforward menu/inventory | Edit existing products/options; simple finished-product counts where enabled | Catalog preview/revision validation; existing opt-in stock model | Do not revive Café ingredient recipes from old branches. Unknown counts/prices remain unknown, not fabricated defaults |
| Loyalty without invented policy | Phone-first customer lookup and simple enrollment | Normalized identity, required name/phone, optional birthday, existing points rules | Clear sale clears the customer; stale tabs/accounts do not transfer a customer or draft. New redemption policy requires a business decision |
| Survive failure | Reopen original work; distinguish uncertain payment/printing from failed operations | Account-scoped drafts; authenticated instance; backups, journals and supported repair/rollback | Test backend loss, duplicate submission, two successive shifts and restart against the exact package; no data rewind |
| Easy delivery | One branded Caja shortcut; first setup once; later accepted versions arrive automatically | Bundled runtime, verified staging, supported predecessor, fixed launcher, signed updates | Fresh-machine install, reopen, compatible retained upgrade and recovery; no developer SDK/npm steps for the operator |
| Remote awareness | Know installed version, latest report, backup status and active incidents | Private sanitized reporter and new/active/resolved lifecycle | Accept first genuine device report. Missing report is unknown/unreachable, not healthy |

## Settled decisions and historical corrections

- Later explicit instructions supersede earlier assumptions. Recipes/ingredient modeling were removed from Café; later simple inventory work is opt-in and must not silently reactivate old stock. The barista preparation destination is not a third staff role.
- Keep the accepted owner/prototype rollback surfaces until deliberately retired; both must share current business/recovery handlers. Do not make a UI rollback a rollback of financial fixes.
- Catalog changes in the backend and installed program changes are different deliveries. A saved menu may appear immediately, while a new UI/runtime needs an accepted application update.
- Preserve current Clip configuration and secrets. The owner now reports Clip works; historical AGENTS entries saying OFF are not authority to disable a working installation. Historical November 21 checkout recovery and November 24 empty-reader evidence do not establish today's reader/provider state. Observe current configuration read-only before enrollment and simulate provider tests elsewhere.
- Preserve journal, WAL/sidecars, documents, audit records, backups and private configuration outside replaceable application code. An uncertain Windows handoff never authorizes blind resend.
- One family version series and all-three Café/Smoothies/Papelería promotion remain established policy. Product candidates may be built independently; source identity and client identity remain separate.

## Progress: distinguish source, delivery and installation

| Area | Verified historical/current evidence | What is not established |
| --- | --- | --- |
| Live Café | Owner currently identifies Café as live. Direct November 21 terminal samples show rc.5 / `b4f1c8c0f62aa238da94171675c75efc40bce6ba` installed | Current machine version must be read again; do not assume latest release is installed |
| rc.6 | Published `cafe-v1.0.0-rc.6`, with integrated payment display and installer instructions | That chat ends without an installation receipt |
| Existing manual updater | Historical `410ead4` and `99d1675` installations preserve configuration, original journal/backups and previous version; running-process refusal was observed | Historical success is not acceptance for an arbitrary predecessor/schema |
| Automatic updater | Stage 2 `13cb0615ae4ee0c0984657944627c38155fc1908` had isolated signing/staging/closed-shift/rollback checks but rollout was unfinished. Recovered in the current delivery branch with read-only pending-print checks and default OFF | Not enabled on Café; keys, idle RPC, fixed shortcut and actual predecessor must be enrolled and accepted |
| Source improvements | Recovery/demo/toolchain changes have independently reviewed draft integration work; this document accompanies the current branch | Main integration, published family qualification and actual client deployment are separate results |
| Reporting | Private operator kit and reader/watcher exist | First genuine accepted Café PC report is still required before claiming remote coverage |
| Offline selling | A prior implementation turn was interrupted | Do not advertise offline checkout; local Windows installation alone does not remove cloud backend dependence |
| Missing Lotus label | Saved ticket 0749 rendered both pages and Windows accepted a batch | Why the second physical label was absent remains unproven; do not claim fixed or replay it |

## Next milestones, in order

### Cash + card split candidate — November 27, 2026

Café checkout adds **Mixto** beside **Tarjeta** for peso cash plus card. Enter the card amount, receive the remaining cash, and return peso change. With CLIP enabled only the card portion is sent; otherwise the cashier confirms that partial amount on the terminal. The existing **MXN + USD** tab and stored `mixto` retain their cash-currency meaning. The split uses `efectivo_tarjeta`, with `orders.card_amount_mxn` and an immutable receipt breakdown. Drawer cash and reports allocate the portions separately; new saved cortes freeze their `payments` breakdown while older cortes remain unknown for that field.

This candidate requires deliberate forward migration `202611270026_split_payments.sql` with the matching application. Existing migration bytes, historical receipts, provider configuration and updater migration refusal remain unchanged. The owner explicitly placed deployment on hold: development, synthetic verification and a draft feature PR only. Do not merge, apply live SQL, publish a package/feed or install the feature until the owner authorizes release. The CD chat owns the subsequent release gates; this feature remains separate from its transport changes.

### CD integration — November 26, 2026

The delivery candidate now combines the current Café business contracts and
Smoothies LAN/recipe workflow without changing Café's direct backend, auth-cookie
defaults or photo URLs. `docs/family-delivery.md` describes the exact three-package
build and acceptance-bound publication. `docs/cafe-enrollment.md` adds supervised
bootstrap with retained configuration/shortcut, Windows ACLs and a separate enable
gate. These are engineering changes; the first actual Café PC report remains
pending. The owner plans to run the reviewed diagnostic kit after closing.

### Integration review — November 25, 2026

The reviewed source starts at local `4a78f59` on top of delivery source `6eab492`. GitHub CLI confirmed that Café delivery PR #31 and the cumulative #29/#30 stack remain drafts; remote `main` is a separate revision. No stack was merged and no installed/provider configuration was changed.

Two confirmed root causes were repaired in source: abandoning an uncertain checkout now bounds a stalled RPC wait and retains the original pending marker; the shared Smoothies recipe editor now persists the exact trial request by account before sending, exposes recovery after reload, and blocks new saves until reconciliation. Recipe capability remains disabled in Café. Its separate Smoothies branch needs the same behavioral fix while preserving its newer editor features.

Fresh synthetic checks cover the actual checkout cancellation handler, committed recipe save with lost response/reload, exact replay, account separation, sign-out, late replies and an SDK session switch before sending. The full suite passed 399 tests with zero skips; lint, TypeScript, an isolated Café production build, 3,171 PostgreSQL assertions, twelve simulated printing HTTP scenarios and two signed Windows updater checks passed. Independent code review accepted the final implementation without blockers. These do not prove physical printing, live provider behavior or actual machine enrollment. Current required CI and retained customer/package acceptance remain delivery gates. The integration source map is in [shared-pos-local](../shared-pos-local.md#mapa-de-integración).

The review retained both cashier appearances because they share current handlers. It found no reason to introduce another financial workflow or combine the distinct updater adapters. Direct iPad LAN access remains a Smoothies milestone with browser/backend/printing/import/backup/photo integration acceptance; it is not a completed Café feature.

1. Obtain one read-only installation/report receipt from the actual Café machine: installed release, config/backend fingerprints, original journal, startup entry, update/report tasks and safe operating state. Keep secrets private. This selects the actual predecessor without trusting folder names or latest GitHub release.
2. Finish the reviewed candidate containing the recovered updater and current Café features. Run current business/printing/recovery checks and required CI on the final revision. Verify the forward idle-RPC migration against the correct backend deliberately; never migrate automatically during update.
3. Complete one supervised bootstrap/enrollment: retain original data/config/provider settings, install the fixed launcher and public update key, verify the first real report, and prove signed compatible update plus safe startup failure recovery. The automatic updater uses stricter closed-shift, pending handoff/payment and unresolved-print gates than a supervised manual maintenance update.
4. Publish only the accepted exact package through the existing family gate and signing path. Once the pilot passes, allow automatic compatible releases; schema/backend changes remain deliberate maintenance transitions.
5. Keep a small dependency/advisory queue and useful incident reports. Ship repairs through the same reviewed PR/package path instead of one-off production scripts.

## Coverage and evidence limits

The November 23 reverse-engineering review exhausted available turn pages for 33 Café chats: early 11/162 turns, middle 11/164 turns, recent 11/176 turns. This synthesis rereads those structured event/lesson/coverage records, plus directly rereads the latest deployment/payment chats listed below and the current source. It does not claim to have independently reopened every screenshot, private attachment or command stdout. Failed command metadata alone is not a production incident.

Source records: `deployment-history-early.json`, `deployment-history-middle.json`, `deployment-history-recent.json` in the private November 23 review workspace. They are historical evidence, not shipped application data or credentials. The exact covered chat list follows; chat IDs are provenance, not current configuration. Additional direct review: `01a20edb-8688-7a91-93f5-115a128c8755` — Review Clip API setup. Current owner corrections in the ongoing family-workspace chat take precedence over stale product status.

| Review group | Chat | ID |
| --- | --- | --- |
| early | Planear punto de venta para cafeterí | `01a17f3e-7add-7401-b3cc-1c3efe8763a3` |
| early | Capture wireless HDMI device data | `01a17fd8-ccc4-73c3-8905-052836fd2f1e` |
| early | Download POS Cafe repository | `01a17fea-420d-7af1-a0db-fb932894fbb1` |
| early | Plan integrations and live dashboard | `01a18091-e7d0-7082-9d04-432d738c70ff` |
| early | Modernize Cafe POS UI | `01a1829e-ea75-74a1-9bad-82376a2da9b7` |
| early | Review POS launch risks | `01a183ba-f18a-7300-8a0c-5459b0a78425` |
| early | Assess POS coffee pilot readiness | `01a18458-dcd1-7a12-b868-d4c263eea13e` |
| early | Update ticket machine integration | `01a18db7-f9f9-78e2-88b9-92894b25cdd3` |
| early | Check commits and merges | `01a18dfa-a24a-72b0-8787-d3d0cb59680a` |
| early | Define simple POS inventory data | `01a18e9e-fec2-77d3-a15b-199b86b94efc` |
| early | Prepare for ticket printer testing | `01a1926e-0464-7db0-b652-4d0c5fe59e34` |
| middle | Open the app | `01a192bb-b1b7-78b1-934f-dbce7e94a7d6` |
| middle | Update sticker design locally | `01a192cc-5b79-7d32-8821-b524dd7e8501` |
| middle | Find POS order add-ons | `01a192e6-130f-7bb2-ae31-f47d5b933fa1` |
| middle | Integrate terminal with payments | `01a192e9-7fd3-7551-a029-a29bb98156f9` |
| middle | Diseña un UI coherente para POS | `01a19cbe-74b7-7121-a4b3-32aa6f44fc3f` |
| middle | Proponer manual de POS café | `01a1a862-d40f-70d3-9d74-b232e5d91aae` |
| middle | Check Coffee POS readiness | `01a19ef3-d128-7c00-a2f9-6dd28ad16492` |
| middle | Review printing workflow scripts | `01a1ade5-c212-7750-ab14-8093165d1af3` |
| middle | Actualizar README de POS Cafe | `01a1b3e5-e899-7240-bda7-84a615f29ccd` |
| middle | Find Sandra's Supabase password | `01a1b3ec-bbf5-7c40-8387-a34ec9736d83` |
| middle | Open POS Cafe | `01a1b7d4-1161-7d52-8971-e64a864371d9` |
| recent | Revisa POS Cafe y su soporte | `01a1bd25-411e-7ee1-9704-eb9fd355dcfa` |
| recent | Open POS cafe demo | `01a1ccf3-5065-7212-961c-4d1c3e4dacb9` |
| recent | Revisar tablero del POS café | `01a1da4b-5842-7770-9347-b82da5b15fad` |
| recent | Revisar pagos automáticos en POS Café | `01a1dada-3c2c-7d12-b1cc-0be3d001433c` |
| recent | Revisar avance de tres tareas | `01a1dbc2-b995-7d32-aca5-e2234d8020ad` |
| recent | Review POS cafe deployment pipeline | `01a1e071-b912-7d93-9ed8-2bb9dcf1894b` |
| recent | Discuss Clip PIN pad integration | `01a1e101-2e72-7320-9f45-5c307ea6c085` |
| recent | Pitch POS Café features | `01a1e5c7-066a-7b00-bfca-9f0c359c5c37` |
| recent | Implement offline checkout | `01a1e5dc-1938-76e0-9a1f-55ee1cb67563` |
| recent | Check terminal API and dashboard setup | `01a1eb27-1f55-7f00-a87e-e87c6644e179` |
| recent | Corrige productos y total en dólares | `01a1ffc2-7be8-75a3-9b82-7ed42c56070f` |
