# Cashier switching and multiple-tab acceptance

> Development reference: use isolated synthetic state only. Historical fixture
> counts and earlier schemas below do not establish the current Smoothies/client
> contract. Preserve the full current migration order and verify the script's
> prerequisites before running. No hosted deployment or production reset is implied.


Run `npm run test:cashiers` with the dedicated staging stack running. It reserves
loopback app/gateway ports 3111/3110 and disposable restore ports
55460/55462/55463/55464. Leave the unrelated TV demo and normal previews running.
The command is browser-assisted, not unattended automation.

The runner reads the guarded local staging database, makes an encrypted snapshot,
and restores fresh local PostgreSQL, Auth and PostgREST services. All account,
shift, recipe, customer and sale fixtures are created only in that restore. Two
synthetic cashiers, CajaA and CajaB, exercise historical session isolation. Current
single-drawer behavior must use the applicable migration-005 handoff contract;
separate simultaneous open drawers are not a current acceptance target. Their random test
credentials are in ignored `.staging-local/cashiers/access.json`; never publish
that file or copy credentials into reports.

Before opening the browser, 20 concurrent authenticated RPC retries must return
one receipt and apply one product decrement, one recipe decrement and one loyalty
award. Reusing the request with a different payload and having B use A's register
must both fail without an extra order.

At READY, use the actual login/cashier UI at `http://127.0.0.1:3110/`. The separate
`/cashier-check` page exists only in the disposable production build. Its controls
record the local test session/draft state or sign out that cloned test session;
no test controls are added to the owner's application.

1. Log in as A. Add one Café prueba pestañas and save order note `Caja A`. Record
   the draft in the fixture tab. Sign out there, which must clear A's visible
   cart in other tabs while retaining the saved draft.
2. Log in as B. The initial cart must be empty. Create quantity 2 and note `Caja B`;
   record it. Sign out and log in as A. Only A's quantity 1/note should return.
   Record both saved records, then run `verify-cashiers`.
3. Open two A cashier tabs. Edit quantity in one. The other must show a conflict
   warning, disable new payment and be unable to overwrite the saved revision.
   Use its retry control to load the newer draft; restore quantity 1 for payment.
4. Open payment in both tabs and select Tarjeta. Run `hold`, then attempt Confirmar
   Pago in both tabs. Only one checkout may reach the gateway; the other window
   must report an in-progress sale. `status` reports one held request. Run
   `release`, then `verify-sale`; one order and stock 10 → 9 must result.
5. Start another A sale, use `hold` and `drop-next`, and submit it. Sign out while
   it waits, then log in as B. B must still have its own quantity 2/note, with no
   A receipt or financial warning. Record B before and after `release`. A's saved
   request commits once but its response is withheld. Sign back in as A, recover
   the same sale and run `verify-switch`; there must be two distinct A sales,
   no B test sale and stock 8. B's draft must remain unchanged.
6. Remove only the test drafts through the cashier controls and record empty
   draft/pending maps. Sign out the test session, close test tabs and run `finish`.

Commands run from another terminal:

```powershell
node scripts/cashiers/control.mjs status
node scripts/cashiers/control.mjs hold
node scripts/cashiers/control.mjs release
node scripts/cashiers/control.mjs drop-next
node scripts/cashiers/control.mjs verify-cashiers
node scripts/cashiers/control.mjs verify-sale
node scripts/cashiers/control.mjs verify-switch
node scripts/cashiers/control.mjs finish
```

`abort` releases test gates and cleans the owned app/containers without claiming
acceptance. `finish` compares the source staging business fingerprint before
cleanup. Results contain synthetic metadata, not passwords or JWTs, under
`.staging-local/cashiers/last-result.json`.

The normal owner layout stays unchanged. Browser Web Locks serialize checkout,
recovery and abandonment for the same cashier/origin. Unsupported browsers block
new financial actions rather than skip coordination. PostgreSQL request identity
and exact-payload replay remain authoritative if the page closes, a response is
lost, or clients use different browser processes. A delayed response captures its
original draft binding and recovery key; a disconnected binding may retire its
own saved record but cannot clear the next cashier's visible cart.

Tabs in one browser profile share a login session. Signing in as B changes that
profile's active cashier across its tabs; those tabs do not provide independent
concurrent A/B logins. Use separate browser profiles or devices for that. The same
cashier has one shared draft per open shift, with conflicts reloaded explicitly.
Distinct new orders with distinct request IDs remain legitimate separate sales;
these tests do not detect arbitrary business duplicates across unrelated drafts.

This runs on the Windows development PC with Chromium and local service failure
simulation. Actual café hardware, other browser builds, Windows boot, physical
printing and hosted configuration need their own acceptance. There is no live
café database write, new production migration, GitHub push or PC sync.
