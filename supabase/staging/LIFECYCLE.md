# Local startup, restart and PWA acceptance

> Development reference: use isolated synthetic state only. Historical fixture
> counts and earlier schemas below do not establish the current Smoothies/client
> contract. Preserve the full current migration order and verify the script's
> prerequisites before running. No hosted deployment or production reset is implied.


Run `npm run test:lifecycle` with Docker Desktop running and ports 3110, 3111,
55460, 55462, 55463 and 55464 free. The normal staging preview on 3101 may remain
open. This is a browser-assisted acceptance drill, not an unattended test command.

The runner verifies the dedicated local Supabase identity, makes an encrypted
backup, and restores fresh disposable PostgreSQL/Auth/PostgREST services. It
changes only that clone's synthetic product catalog. It builds a clean production
copy with an explicit loopback API endpoint; it never copies `.env*`. Public
Supabase variables are build-time values: changing a launch environment alone
does not retarget an existing browser bundle.

After `READY`, open `http://127.0.0.1:3110/__lifecycle` in a dedicated test tab.
Use its buttons to install a legacy-worker fixture and verify the stale cached
probe response. This is a deliberately small simulation of an already installed
worker using known Workbox cache names; it is not a byte-for-byte copy of the
café's previous generated worker or a test of Windows PWA installation chrome.
Keep the fixture tab open alongside the actual owner's POS on the same origin.

Control the drill from a second terminal:

```powershell
node scripts/lifecycle/control.mjs backend-down
# Open/reload the POS: profile loading fails and protected access stays denied.
node scripts/lifecycle/control.mjs backend-up
# Reload: the existing authenticated session and open shift should recover.
# Add the test product twice, open payment details, choose Para Llevar and enter
# Borrador local de reinicio. Inspect unpaid cart draft in the fixture. Refresh,
# close/reopen the tab and stop/restart the app, then inspect the unchanged draft.
node scripts/lifecycle/control.mjs stop-app
node scripts/lifecycle/control.mjs restart
node scripts/lifecycle/control.mjs verify-draft
# Reduce quantity to one before the following checkout/stock assertion.
node scripts/lifecycle/control.mjs drop-next-checkout
# Buy one 'Prueba reinicio local' in the real UI using Tarjeta.
# It commits in the clone, but the gateway withholds the success response.
# Confirm the pending-review warning and disabled new-payment button.
node scripts/lifecycle/control.mjs upgrade
# Reload the POS to exercise its production registration effect. Inspect the
# fixture tab, then use Update installed worker and Check cached response.
# Legacy caches must disappear, the unrelated cache must stay, and the probe
# must return FRESH_NETWORK_RESPONSE. Pending recovery must remain available.
node scripts/lifecycle/control.mjs stop-app
node scripts/lifecycle/control.mjs restart
# Close/reopen the POS tab with the same browser profile and origin. Click
# Recuperar la misma venta; the original receipt must return successfully.
node scripts/lifecycle/control.mjs verify-sale
# Fixture cleanup removes its registration and unrelated cache. Close its tabs.
node scripts/lifecycle/control.mjs finish
```

`verify-sale` compares the receipt snapshot plus its order identity/status/ticket
envelope with the original committed response. It requires an actual replay of
the same UUID and checks one order and stock 5 → 4. `finish` verifies browser
worker evidence and the source staging business-data fingerprint before cleanup.
`abort` stops the drill and cleans its owned resources without claiming success.
Commands use ignored local files rather than a browser-accessible control API.
Results contain synthetic metadata only in `.staging-local/lifecycle/last-result.json`.

The app is stopped forcibly and restarted from the identical build, without
rebuilding. This tests Node process recovery on this development Windows PC.
It does not prove Windows reboot, startup registration, a watchdog, full browser
process restart, disk/power-loss durability, café hardware performance, hosted
Supabase availability, or the exact existing café PWA state. The app remains
online-only. Unsubmitted carts now persist per cashier/open shift, and pending
submitted requests retain priority in browser local storage. See [draft recovery](../../docs/cart-drafts.md).
Clearing site data, using a different
profile/origin or losing the PC also loses those browser recovery markers.

No café migration, production write, printer operation, GitHub push or PC sync is
performed by this drill. Use [recovery acceptance](RECOVERY.md) separately for
database backup/restore and compatible-release rollback.
