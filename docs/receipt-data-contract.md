# Receipt data contract

The reference image defines the layout. New production sale amounts are computed by `pos_checkout` from catalog IDs, quantities and allowed extra IDs, then read back from `orders.receipt_snapshot` by the local print endpoint. Browser prices and the synthetic hardware-test sample are not production price sources.

| Printed field | Authoritative source / rule |
| --- | --- |
| Quantity | Validated integer quantity, saved in `order_items.quantity` and the receipt snapshot |
| Product | Catalog name at checkout, saved in `order_items.product_snapshot` and the receipt snapshot |
| Unit price | `products.price + sum(selected allowed extras.price)`, saved in `order_items.unit_price`; already includes paid modifiers |
| Line amount | `quantity * unit_price`, saved in `order_items.total_price`; renderer uses integer cents from the confirmed unit price |
| Modifier names | Selected catalog extras saved with name, phase and price; `(incl.)` means included in the displayed unit price, not necessarily free |
| Total | `orders.total`, also stored in the receipt snapshot; current checkout sets subtotal to line sum and discount to zero |
| Folio | `orders.ticket_number`, padded to at least four characters for display |
| Date/time | `orders.created_at`, saved in the snapshot, displayed in `America/Matamoros` |
| Customer | `customers.name` selected by ID at checkout, saved in the snapshot; guest is `Invitado` |
| Service and notes | Validated checkout request saved in the snapshot; item preparation notes also saved with each order item |
| Payment | `orders.payment_method`, snapshotted; print label translation only |
| Received MXN/USD | `orders.tender_mxn` / `tender_usd`, snapshotted; shown for cash/mixed payments |
| Exchange rate | Open register's saved rate, copied to `orders.exchange_rate` and snapshot; shown when USD tender is present |
| Change | Server calculation `round(MXN + USD * rate, 2) - total` for cash/mixed, saved as `orders.change_mxn` |
| Label contents | Same saved customer, product, modifiers, notes, service, folio and timestamp; one label section per purchased unit, with cup counter |
| Logo, phone, social text and closing phrase | Business-approved application branding; not sale database fields |
| Instagram QR | Versioned `config/receipt-branding.json`, including the saved matrix and URL |
| RFC, regime, address, city and postal code | Validated installation-local `POS_RECEIPT_ISSUER_FILE`; not the sale database |

The local issuer profile still requires its complete identity for validation, but new receipts omit the individual/legal name and both CFDI lines as instructed. There is no added tax, fee or discount invented by the template. Legacy stored totals differing from line sums are shown with an explicit sale adjustment by the renderer; that branch is not the normal new checkout path.

Dispatch accepts an order ID, authenticates the employee and reads the confirmed database snapshot. It does not accept browser-supplied receipt prices, names or printer queues. Reprinting first reads the saved local document; without one it uses the original database snapshot. Legacy orders lacking snapshots require consistent stored unit/line amounts and explicitly identify missing information. These fallbacks require the migrated API schema; they do not make an unmigrated backend compatible.

## Hardware samples are not catalog validation

`scripts/printing/dual-test.ts` intentionally creates a synthetic `PRUEBA-D2` with a fictional Iced Matcha Latte, unit price MXN110, received MXN150 and change MXN40. Its modifier prices are sample zeros. It does not access a hosted database. Those values test layout, queues and journal behavior; they do not establish the real menu price or allowed modifier combination.

## Verification on October 31, 2026

Read-only GET queries against this development checkout's configured hosted backend returned 38 visible products and 58 extras. Matcha Cariño was MXN105 and Leche de Avena MXN15, in its permitted milk phase: under the repository checkout rule that configured combination is MXN120 per unit. The sample vanilla/espresso phases are not permitted by that product's currently visible wizard configuration. Catalog identity and allowed extras must be selected in the actual POS.

The latest five visible historical orders (folios 32–36) passed stored quantity × unit price = line amount and line sum − discount = order total. This limited historical arithmetic check does not establish the original preparation, tender or deployed checkout implementation.

The same hosted API returned PostgreSQL error 42703 for `orders.receipt_snapshot`, `request_id`, `request_payload`, `tender_mxn`, `tender_usd`, `exchange_rate`, `change_mxn`, and `order_items.product_snapshot`. This observation describes the legacy development `.env.local` target only. The November 2 target verification below supersedes the earlier inference that the client's database needed migration. No hosted writes, migration, business-data changes or physical prints were performed for this audit. Those original remote observations were limited to the configured anonymous role; denied metadata reads do not establish RPC absence.

## Client target verification and integration — November 2, 2026

The Supabase CLI link and the existing private `client-target.private.json` agree on the new client-owned project. It is a different project from the historical development `.env.local`. A read-only SQL transaction against that client project confirmed all 11 retained migrations, all eight receipt-contract columns, and a deployed `pos_checkout` body exactly equal to the tested migration. Its 82-product catalog contains Matcha cariño at MXN105 and the allowed avena milk option at MXN15, so the configured combination remains MXN120/unit.

The one existing order and its two saved items passed quantity/unit/line arithmetic, completed-order total, snapshot totals/payment/tenders/rate/change/timestamp, complete item-snapshot equality and server change arithmetic. No client sale, shift, catalog row or migration was created, updated or deleted. Schema compatibility is verified; full café-PC installation and operational acceptance are separate from this read-only check.

Build the client release using the existing explicit private client target, never infer its destination from the historical development `.env.local`. Do not migrate the legacy backend to correct that target mismatch. The local development environment remains separate. The prepared release manifest records the selected backend and source commit; the launcher rejects mismatching runtime settings.

`npm run test:db` now runs `scripts/receipts/contract-database-cases.mjs` after all migrations in disposable PostgreSQL 17. Its six cases cover card, cash with quantities and paid/free extras, mixed currencies with decimal cents, USD-only guest, other payment, and ignored spoofed client names/prices. It checks SQL order/item values against the generated receipt and labels, immutable catalog/customer history, replay deduplication and five rejected requests without partial orders/items. It can save synthetic evidence using `POS_RECEIPT_CONTRACT_EVIDENCE`.

`npm run test:printing` optionally consumes that evidence, returns those SQL snapshots from its loopback-only backend fixture, and verifies them through an isolated production build's real print and receipt endpoints. Windows CI now always passes the same temporary `POS_RECEIPT_CONTRACT_EVIDENCE` path to both database and HTTP steps, so all six SQL-to-document scenarios run on every verified PR/main build. It compares all financial/preparation lines and confirms that repeated requests/reprints create no extra simulated jobs. This is application integration evidence with mocked hosted reads and printers, not a live deployment or physical acceptance.

Audit results: 491 dedicated receipt/database assertions, 2,290 database assertions overall, 28 targeted receipt/reprint/Windows-layout tests, and 10 production HTTP acceptance checks passed. Existing café records and print journals were preserved.
