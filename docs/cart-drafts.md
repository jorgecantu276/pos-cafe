# Unpaid cart recovery

Unsubmitted carts now persist in browser local storage immediately when their
items or order details change. There is no debounce or reliance on an unload
handler. The owner’s normal layout, product controls and payment dialogs stay
the same. A conditional warning appears only when recovery/persistence fails.

The versioned record is `mi_cafe_cart_draft:v1:<authenticated-user-id>`. It contains
one stable draft/checkout UUID, shift ID, revision, line IDs, product/extra IDs,
quantities, preparation notes, order type/note and selected customer ID. Customer
names, phone numbers, credentials, payment status and tender inputs are not saved
in this record. User-entered preparation/order notes still belong to this browser
profile; this is ordinary local persistence, not encrypted off-device backup.

Restoration waits for a verified active staff identity, catalog and owned open
shift. Another user or a new shift does not inherit that cart. A session change
disconnects persistence and clears the visible in-memory cart while retaining the
original user’s saved draft. Component unmount also disconnects before clearing
memory, so navigation cannot accidentally erase the saved record.

Products and extras are rebuilt from the current catalog. Saved unit prices only
detect changes; they never authorize payment. A changed price recalculates the
cart and prompts the cashier to review it. Missing/inactive products, unavailable
extras, malformed records and invalid quantities block recovery without silently
dropping lines or overwriting the record. The selected customer is read again
through normal authenticated access, with a timeout. Failed customer recovery
must be retried, replaced or removed explicitly before payment.

Writes compare the previously observed stored record. Another tab’s revision
blocks overwriting/submitting stale state and offers a reload. The draft UUID
becomes the checkout UUID, so two restored copies cannot create two independent
sale identities. PostgreSQL remains authoritative for exact-payload replay,
actor/shift ownership, prices, availability, tender and atomic stock changes.

Checkout, recovery and abandonment also use a per-cashier browser Web Lock. A
second tab gets a warning while the first request is unresolved. If the session
changes during that request, its response keeps the original cashier's immutable
draft binding/recovery key. A disconnected binding never clears another cashier's
visible store. Auth changes trigger a fresh identity/catalog/shift validation.
See [real cashier/tab acceptance](../supabase/staging/CASHIERS.md) for the browser
and concurrent database procedure and the shared-login behavior of browser tabs.

The submitted checkout marker always takes precedence over an unpaid draft.
An uncertain submission restores the existing recovery warning, not a fresh
payable cart. On completed/cancelled recovery or confirmed abandonment, the local
unpaid record is retired before its submitted-request guard is removed. A local
storage failure retains that guard. Successfully paid carts therefore cannot
reappear as unpaid orders after refresh or restart. Printing still uses the saved
server receipt and the durable customer/barista print outbox.

Storage quota/access failures keep the in-memory cart, display a warning and
block new payments. Retry can save the current in-memory draft after storage
recovers. A conflict reloads the newer saved draft. Explicit discard confirms
before removing the unpaid draft; it never clears a submitted financial guard.

Verification includes real POS React remount/customer restoration/session switch,
customization and price changes, damaged/blocked storage, cashier/shift isolation,
stale-tab conflicts, failed retirement, and pending-checkout precedence. The local
production browser drill also restores a two-item MXN74 draft and takeaway note
after refresh and same-build process restart, then confirms a MXN37 checkout with
a deliberately lost response remains one sale with one stock decrement. A later
reload has no unpaid cart.

This works in the same browser profile and origin while site storage is retained.
It is not cross-device synchronization, an offline payment queue, a guarantee of
power-loss durability, or a replacement for database backup. Windows reboot,
full-browser-process restart and the actual café hardware remain separate physical
acceptance checks. Clearing site data/private browsing can remove drafts. The app
still needs Supabase connectivity to verify the session/catalog and save sales.
