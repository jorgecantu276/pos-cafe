# CLIP integration and recovery

Preserve the current accepted provider configuration of each installation. The owner reports Café's terminal works; old OFF/placeholder observations do not authorize disabling it. A fresh installation starts disabled until its actual merchant/device/credentials and acceptance are established. Tests and previews always use a simulated provider with a separate synthetic backend.

## Activation and cancellation boundary

Configuration-ready, HTTP 200, request registration and reader delivery are different observations. Confirm read-only reader availability and the accepted provider/device contract before any separately authorized live test. Do not recreate the historical production-connected test that blocked normal checkout.

Authenticated GET recovery accepts omitted/null `amount_paid` and `tip_amount`
only for exact `CANCELED` or `REJECTED`, with matching original provider ID,
reference and quoted amount, complete transaction detail and no paid transaction.
Explicit nonzero/malformed money, incomplete detail, unknown transaction states
or approval evidence retain the original pending request. Approved payments keep
all existing amount/currency/device/transaction/refund checks. Recovery never
sends another provider POST and remains available while automatic charging is off.

Use the provider simulator and a separate synthetic backend, accounts, retained
state and request/lock domain for tests. Another port, browser or simulated
printer does not isolate a production-connected window. Never reproduce a
cancellation failure against customer records.

## Setup

1. Have CLIP provision its PinPad application on the terminal. Sign into the café's own CLIP account and keep PinPad open and connected. The owner manages account verification and production credentials.
2. Verify the complete retained migration contract of the exact package against the explicit client backend. Apply necessary forward SQL only through deliberate reviewed maintenance with backup and recovery; this document does not establish current applied migrations. Do not use the historical development target.
3. Deploy ONLY the callback function to that same client project: `supabase functions deploy clip-webhook --project-ref <CLIENT_PROJECT_REF> --no-verify-jwt`. This endpoint intentionally receives CLIP's unauthenticated callbacks. Each attempt has a private random nonce; a callback only stores an identity hint. It cannot approve a sale. The Edge Function uses Supabase's provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; it does not need the CLIP token.
4. Keep the CLIP Basic token in a private file outside the release directory. Start from `clip-token.example.txt`; replace its placeholder locally, never in Git. In the café's private launcher JSON configure `ClipTokenFile` with its absolute path, `ClipSerial` with the terminal's API serial, and retain the client `SupabaseServiceRoleKey`. The configured serial must match the registered device for that client; do not copy a serial from an example. Never use `NEXT_PUBLIC` for the token.
5. After the activation qualification above and the separately authorized site/provider acceptance, set `ClipEnabled: true` and restart the launcher through the qualified release procedure. Function/PinPad registration alone is insufficient. The callback address is derived as `https://<client-project>.supabase.co/functions/v1/clip-webhook`; `ClipWebhookUrl` is an optional public HTTPS override. The launcher hashes the token into its instance configuration identity without printing it. Environment-based launches may use `config/clip.env.example` instead.

Keep `ClipEnabled: false` initially. Missing/placeholder credentials cannot enable automatic checkout. Disabling automatic payment later does not abandon existing requests: authenticated GET recovery still settles an already approved payment when the token remains available.

## Payment and recovery

The existing checkout identity is saved locally before I/O. The database validates the actor, shift, catalog, modifiers, total and pager, then stores an immutable quote WITHOUT a sale or loyalty award. The service claims the intent in PostgreSQL before the one provider POST. Only one unresolved attempt is allowed per cashier and terminal. Prices, preparation, customer name, exchange rate and pager remain frozen while the customer pays.

The POS queries the same payment automatically. A CLIP webhook is a hint; an authenticated provider GET must verify reference, amount paid, currency, zero tips/refunds, device, approval and one transaction before service-only SQL creates the sale and awards points atomically. Repeated/concurrent settlement returns the saved receipt. The cashier then uses the existing durable two-copy print dispatch. The callback never prints and never fabricates a successful sale.

If the POST acknowledgment is lost, no automatic POST retry is permitted: CLIP's documented reference field does not promise creation idempotency. A late nonce-protected webhook can recover the missing provider ID. If it never arrives, the owner opens Configuración → Terminal CLIP and verifies the provider's `pinpad-…` identifier. That action only looks up CLIP; its reference/amount/device must match. Unknown or partial results remain blocked; do not charge again to compensate. The backend also blocks closing/handoff and ordinary checkout/abandonment while an unresolved payment exists. A verified cancellation/rejection with zero paid amount, or the specifically documented unavailable-device error, permits abandoning the failed request. Canceling a saved POS sale does not refund CLIP; existing cancellation warnings remain.

The integration deliberately disables split payments, tips, installments, DCC and terminal-side retries. Browser roles cannot write approvals, access the journal/nonces or call settlement functions. Provider/card detail is verified transiently and reduced to reference, amounts, terminal and transaction ID; raw card data and the token are not stored or returned. The dynamic encrypted business backup includes payment records and webhook hints.

## Physical pager 1–30

New in-person checkout requires a manually selected Control de entrega 1–30; a persisted phone pickup order has its explicit no-control exception. It persists in the unpaid draft, validated checkout payload, order and receipt snapshot. The customer receipt prints CONTROL prominently. Each barista cup and each physical continuation page repeats its control identity. The number clears for the next order. Previous snapshots and print journals are never changed. No radio/base communication or automatic pager activation is implemented.

## Verification and limitations

Run `npm test`, `npm run test:db`, `npm run typecheck`, `npm run lint` and `npm run build:verify`. Tests use real isolated PostgreSQL and simulated provider responses for approval, concurrency, price changes, unavailable devices, lost responses, callback recovery, permissions and replay. Windows LayoutOnly checks render both copies without touching a spooler, including long-note continuation pages with the pager. These do not prove a real bank charge or new physical paper output. CLIP PinPad has production-only acceptance: perform the final authorized charge after credentials/provisioning, never from an automated test.

Official contracts: https://developer.clip.mx/reference/post_payment-1 ; https://developer.clip.mx/reference/get_payment ; https://developer.clip.mx/reference/webhook ; https://github.com/ClipMX/mobile.android.blaze.pinpad.sdk .

Local verification on November 2: 193 tests and 2,394 PostgreSQL assertions passed; typecheck/lint passed; an isolated production build and relocated Windows package (2,276 file hashes) passed. A browser test at 1093×560 showed all 30 controls without scrolling, preserved control 30 across reload, saved one synthetic MXN20 sale through real local Auth/PostgREST, confirmed pager 30 in its immutable SQL receipt, and rendered both actual Windows document layouts without a spooler call. The following order reset to Sin control. CLIP tests used a simulated provider and real PostgreSQL for callback/lost-ack settlement. No client-cloud migration, Edge Function deployment, café installation, real CLIP charge or physical print is implied by these results.

## Authorized cloud deployment — November 2, 2026

> Historical evidence only. This deployment permission and then-current settings do not establish current client/provider state.

The owner subsequently authorized deploying the migrations and callback while keeping automatic CLIP payments off. The CLI link and the existing private client target both identified `<CLIENT_PROJECT_REF>`; the legacy development target was not changed. Before deployment, an encrypted, decrypt-verified business backup captured the client backend, and the deployed checkout body matched the verified baseline.

Migrations 013, 014, 015 and 016 were applied successfully. The final migration list contains all 15 retained versions and `db push --dry-run` reports no pending changes. `clip-webhook` version 1 is ACTIVE at `https://<CLIENT_PROJECT_REF>.supabase.co/functions/v1/clip-webhook`, with JWT verification disabled specifically for this nonce-protected notification receiver. HTTP checks returned 405 for GET, 400 without a nonce and 200 for a correctly shaped notification with an unknown request/nonce. The last check produced no journal records; payment and hint counts remain zero. Anonymous notification RPC access and authenticated settlement access remain denied; only the service role can settle.

Post-deployment database fingerprints matched all 28 pre-existing exported tables, excluding only the newly added nullable pager column from the order comparison. The existing sale, 82 products, original receipt snapshots and private configuration were preserved. The three new request/payment tables are empty. Evidence and the encrypted backup remain in the private deployment workspace, with its recovery key outside the backup folder. No CLIP token was uploaded or configured, no real charge or physical print was performed, and no café-PC app installation or configuration change was made. Those were disabled/placeholder settings at that date, not an instruction to change the current store.
