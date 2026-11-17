# Owner TV dashboard

Open `/tv` on the local app after signing in as an active administrator. Access is checked both at the page and on every read-only `/api/tv` request. There is no public display token or service-role client. This screen displays private sales information: use an owner-visible TV.

When a TV session expires, select **Iniciar sesión**. After a successful sign-in the app returns automatically to `/tv` and resumes updates. Opening `/tv` without a session also preserves this destination. A failed sign-in keeps the destination for the next attempt. Ordinary sign-in still opens the POS; only the exact `/tv` return target is accepted, and administrator access is still required.

Choose **Extend these displays** in Windows, move a separate browser window onto the TV, then select **Pantalla completa** (or press F11 in Chrome/Edge). Keep the cashier window on the PC. The dashboard emphasizes the daily sales total and adapts its layout to 1080p and smaller screens. The HDMI device currently advertises 1080p/60 Hz; physical wireless transmission and extended display behavior still require acceptance testing with the paired hardware.

## Data and refresh

- Polls every five seconds after the previous request completes. No Supabase Realtime publication or schema migration is needed. Slow requests do not overlap; reads time out after 12 seconds and retry. Returning online or focusing the window triggers an immediate attempt.
- Only completed orders count toward sales, average ticket, hourly totals and payment totals. All money is MXN; amounts aggregate in integer cents. Mixed payments show the whole order total, not an inferred cash/card split.
- Pending orders mean payments requiring review; these are not kitchen preparation statuses. Cancelled orders are excluded from revenue. Recent orders show the last seven entries for the day. Unknown statuses remain unclassified.
- The business day and all times use `America/Matamoros`, including daylight-saving changes. Each poll resolves that day's boundaries and paginates in deterministic order. Fetching over 19,999 orders or encountering any failed page rejects the entire refresh rather than presenting partial totals. Updates across multiple pages can briefly reflect different moments during concurrent cancellations; the next successful poll reconciles them.
- A failed update retains the last successful snapshot with a visible warning and timestamp. After 20 seconds without a fresh snapshot, or when the Matamoros date changes, the screen marks it stale. Before the first successful load it shows dashes, not zero sales. Authorization loss clears displayed figures and asks for an administrator login. No figures are stored locally or cached by the endpoint.
- This uses the application's existing Supabase configuration, cookies and row-level security. It only selects permitted order columns; it does not fetch customer names, notes or phone numbers, and cannot create/edit/cancel orders or print.

## Local validation and release

Run `npx tsx --test tests/tv-dashboard.test.ts tests/tv-dashboard-ui.test.ts`, then lint, typecheck and `npm run build:verify`. Tests use synthetic clients/fetch responses only. The UI test covers automatic updates, network failure, timeout, reconnection and permission loss; domain tests cover pagination, partial-read rejection, authorization and DST/day rollover.

No production connection or live business mutation is needed to run these checks. Verify real TV readability, screen sleep settings, session expiry and network interruption on the café PC before release. Keep the PC/browser awake while displaying. This is cloud-backed operation, not offline reporting. Release with the normal source deployment only after approval; rollback by returning to the previous source release. No database change or data rollback is required.
