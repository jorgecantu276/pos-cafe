# POS Smoothies — product and progress

Reconstructed 2026-11-25 from the conversation coverage below and current source.
This is a business-to-implementation plan, not a release or installation receipt.
The owner currently identifies **only Café as live**. Smoothies is pre-launch.

## Business outcome and chosen shape

A chef student should run her own approachable smoothie bar, experiment privately,
and move a recipe to the menu deliberately. It must feel like her business, not
a Café copy. Selling continues without internet on a Windows PC; an iPad on the
same Wi-Fi is her operating device, using the existing POS web workflow in Safari.
The PC owns the application, local backend and retained state. This LAN browser
path is integrated in the candidate source; actual device acceptance remains.

The owner's November 25 clarification supersedes the earlier read-only mirror
guidance. One product includes both the POS and its menu intake form. The form
has a separate Pages repository for its public link, not a separate client or
business application. Both appear under `smoothies/app` and `smoothies/intake`.

The owner considered direct PostgreSQL and then explicitly chose to keep the
working local Supabase stack. Preserve PostgreSQL/Auth/Storage on the PC and
Docker/WSL prerequisites until a separately accepted migration proves parity.
Each client retains separate accounts, database, credentials and backups even
where source and API architecture are shared with Café.

| Business need | Technical owner / implementation | Acceptance evidence or remaining gap |
| --- | --- | --- |
| Build the real menu from the client's form | `lib/smoothies-import.ts`, `app/api/smoothies-import/route.ts`, catalog import UI | Preserve product/size/extra identities, review changes, transactional apply and duplicate/replay protection. Client JSON/menu approval still required. |
| Offer only suitable extras | Catalog assignment and shared server option rules | Per-product/presentation eligibility; exclusive milk replacement versus combinable extras. Reject stale recovered options. |
| Prepare inventory before opening | Planned inventory and opening-count workflow | Planned quantity is not real stock. Blank remains pending; explicit zero is confirmed only through a physical count. Recount after unit changes. |
| Enjoy learning without accidentally changing sales | Private recipe book, saved trials/comparison, inactive catalog draft and explicit activation | Recipe notes stay private; exact recipe-to-product link and safe navigation preserve work. Do not create another trial to recover a transient success message. |
| Make daily work clear and appealing | `lib/pos-profile.ts`, Smoothies register/admin, special-of-week and builder | Product-specific extras, responsive totals/color, visible folio/change and connected workflows; historical previews are not onsite usability acceptance. |
| Operate from her iPad, including internet loss | PC-local runtime, one HTTPS LAN front and same-origin browser API | Candidate integrates login/cookies, photos, print/import/backup origins and private certificate setup. Actual Safari, device trust, reboot and internet-loss acceptance remain. |
| Preserve the whole business | `lib/smoothies-backup-assets.mjs`, restore-local/restore-contract tools | Encrypted database plus catalog photos and print journal; off-PC destination and separately retained key must be established. |
| Receive compatible updates automatically | Signed pilot feed, `scripts/smoothies/auto-update.mjs`, `Launch-Smoothies.ps1` | Signature/hash/product/channel checks, no downgrade, unchanged database contract, closed-shift/payment/printing gate, failed-start fallback. Installed client enrollment is not evidenced. |

## Progress and unfinished work

- The current source review brings the independently accepted shared recipe
  recovery and bounded checkout-abandonment fixes into this variant. Recipe
  requests survive reload under their original account, cannot be replaced by
  another new save, and use the verified account for the RPC. The existing
  recipe deep links, exact menu-product state and explicit activation remain.
  This source correction does not update a published package or installation.

- Historical readiness work published `pos-v1.0.0-rc.3` with a signed Smoothies
  updater. Publication does not establish a client installation. Test counts in
  that chat describe that historical revision only.
- The qualified PC demo remains tied to `00e6211...` from the Smoothies checkout
  of `pos-cafe`; current source corrections do not move that qualification.
  Café's selected revision differs. Profiles exist,
  but source convergence is conditional on retained-data/business parity.
- The November 23 consolidation pilot had scoped independent acceptance. Later
  runnable-package experiments remain engineering candidates; some full Smoothies
  runtime checks were blocked by occupied ports. Do not activate a folder because
  its name contains latest/final.
- The source family manifest's version intent, published pilot feed, qualified
  demo and an actual store installation are separate records.

## Next milestones and completion criteria

### Complete device acceptance for the integrated LAN workflow

1. The candidate reuses the family's existing private-IP HTTPS front and backend proxy contract;
   keep Next, Auth/Storage and PostgreSQL on the PC/loopback. Use one configured
   public origin and shared origin validation for browser reads and writes.
2. The configured origin now covers login/cookies, catalog, receipt/phone print outbox,
   menu import and backups. Allow only the Smoothies RPCs actually used. Extend
   existing handlers; do not add an alternate checkout or remote-desktop workflow.
3. Keep canonical backend photo URLs in saved catalog records and rewrite only
   their browser projection. Prove that a photo uploaded from iPad is included in
   the encrypted asset backup and restored correctly.
4. Test Safari login → products/extras → cash payment → one saved sale → existing
   print outbox, then reload/reconnect and loss of internet with LAN active.
   Validate certificates, touch/keyboard and Windows restart on the actual devices.

### Prepare the client installation

1. Receive the client's JSON, review products/prices/sizes/extras with her, and
   import without duplicating or converting planned inventory into stock.
2. Select one exact candidate through the catalog; finish applicable profile,
   retained upgrade, recovery and independent review checks. Preserve the existing
   all-three family promotion contract.
3. Enroll the actual PC once: local stack, branded shortcut, private settings,
   backup/key locations and update trust. Record actual installation identity.
4. Using the [LAN setup](../smoothies-lan.md), on destination equipment prove reboot and
   iPad browser operation: select products/extras, enter payment, save one sale, reconnect/reopen
   without duplication and reconcile the saved record with internet disconnected
   but LAN active. Accept printers if required and confirm opening counts.
5. Demonstrate one compatible signed update and failed-start recovery with retained
   records, then enable the agreed automatic channel. Schema-changing packages
   remain deliberate maintenance, not automatic migration.

## History coverage and precedence

All available turns and older item cursors were exhausted for:

- `01a1daf2-9278-7ad3-bae4-14575d2df146` — **Adaptar POS Cafe para smoothies**:
  30 turns; original business, intake form, offline/iPad choice, private recipes,
  extras/counts/assets, Supabase decision and installation simplification.
- `01a1eaaa-d511-73a3-b4c0-226c63c59026` — **Assess app readiness for client**:
  4 turns; readiness blockers, rc.3 publication/update evidence and simplified
  recipe → inactive product → explicit menu activation.
- `01a1ef94-6535-7f73-9ac7-6f91b6fbf417` — **Check GitHub for POS smoothies**:
  1 turn; confirms source in `pos-cafe` and separate intake repository.
- `01a1e181-4ee9-77b0-bccb-0530aa164ba9` — **Update POS product line work**:
  6 turns; separate client data, explicit profiles and one synchronized family
  release series. Historical speculation about a Papelería rewrite is superseded
  by the November 23 plan preserving WPF/SQLite.

Additional evidence: November 23 **Review POS products for maintainability**
(`01a209bb-f8fe-7421-aa31-63ce8be90669`) approved maintenance plan and phase
handoffs, plus the current owner clarification that only Café is live. This
coverage does not claim all historic test logs, every subagent transcript or
actual store devices were reverified. Do not copy demo passwords/client data into
this document. Keep progress here; exact accepted artifacts remain in the catalog.
