# Administrative reporting — local candidate

Requires the retained migrations 001, 002 and 004 and the matching application. Nothing in this work applies migrations to the hosted café or syncs a café PC. Old synthetic staging markers deliberately fail the new contract check; do not overwrite a marker or upgrade a retained source to run tests.

`pos_sales_report`, `pos_shift_history` and `pos_customer_report` are read-only administrator-only RPCs. Each returns a scalar JSON snapshot with complete aggregate totals and a 50-row history page; the API's 1,000-row cap cannot truncate those totals. Stable functions use one PostgreSQL statement snapshot for rows, counts and aggregates. Timestamps sort by creation time and UUID. Errors/timeouts never become zero or the previous filter's totals.

Sales and closed-shift history support Histórico, Hoy and inclusive date ranges. PostgreSQL's current clock and `America/Matamoros` define Today. Each range endpoint resolves its own local midnight, including 23/25-hour DST days. The upper timestamp bound is exclusive. Future rows are excluded. Reports show update time and use Matamoros for display/reprints. Actualizar resets page/creation ceiling. Subsequent pages retain a creation-time ceiling to exclude sales dated after the initial request. This is not an immutable cross-page audit export: in-flight transactions, backdated records and cancellations can appear in subsequent reads. Each response's rows and totals share one snapshot; refresh if history changes while paging.

Sales search covers ticket, UUID and stored product name (catalog fallback for legacy items), across the selected period. It applies to history, top products and money alike. Sales sum final stored completed-order totals including discounts. Top quantities come from completed order items. Payment groups are sales attribution in MXN, not expected drawer balance. Existing authoritative shift summaries remain responsible for tender/change/expense reconciliation. Closed-shift history filters closing time and sums stored closing reports.

The overview shows today's real completed sales and current registered-customer/active-product counts. It makes no readiness assertion. Customer ranking sums completed orders associated with each customer; pending/canceled orders and cached loyalty spending are not treated as completed sales. Points preserve their original loyalty journal. Name/phone search and ranking cover the full customer list.


Local verification:

- `npm test`, `npm run typecheck`, `npm run lint`.
- `npm run test:db`: fresh embedded PostgreSQL, all migrations, real-menu volume, cents/discounts/statuses, 1,211-row paging, timezone/DST, closing totals, 1,103-customer ranking, access denials.
- `npm run test:reports-http`: requires a new verified synthetic archive with this financial schema, then runs the retained sales/shift/customer reports through local Auth/PostgREST. It does not restore the removed inventory implementation. No hosted writes or source-staging connection are permitted.

Hosted migration rehearsal, café reconciliation, peripherals, Windows startup/recovery, owner/cashier acceptance remain release gates.
