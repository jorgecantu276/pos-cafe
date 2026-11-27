# POS Smoothies — agent instructions

This is the Smoothies variant of `jorgecantu276/pos-cafe`. It is pre-launch;
only Café is currently identified as live. Start with README.md and
`docs/products/smoothies.md`; read only the procedure relevant to the task.

## Product boundaries

- Preserve local Windows Supabase/PostgreSQL/Auth/Storage and offline cash sales.
  Docker/WSL supports the local backend. Removing it is a separate accepted migration.
- The chef student operates the PC-hosted POS from her iPad on the same LAN.
  Integrate the existing authenticated web workflow through a local HTTPS front;
  setup supplies one private IP and provisions TLS; actual device acceptance remains. The former
  read-only/remote-desktop guidance is superseded. Keep one local backend and state.
- The menu intake form is a component of this single product. The family folder
  groups app and intake; its separate Pages repository preserves URL/drafts/v1 JSON.
- Preserve private recipe trials → inactive catalog draft → explicit activation,
  weekly special, product-specific extras and planned inventory/count distinction.
- Use explicit product profiles, never backend URL heuristics. Café and Smoothies
  share architecture, never actual accounts, databases, credentials or journals.
- Historical Café menu, printers, exchange rates and task authorizations do not
  configure this client. Confirm client JSON, counts and hardware before delivery.

## Engineering and review

- Main agent coordinates/implements; a separate read-only agent reviews final
  evidence. Add owners only for separable work; keep unrelated cleanup separate.
- Reuse current business handlers and UI components. Prefer a small explicit
  change over another framework, generic engine or duplicated product logic.
- Use source-pinned runtime/locks; `npm ci`, `npm test`, `npm run typecheck`,
  `npm run lint`, `npm run build:verify`, then affected Smoothies functional drills.
- Scope checks to changed behavior. Qualification/release still require their
  exact-source/package/recovery and established all-three family promotion gates.
- A report is read-only. Reopen uses valid qualification and original state;
  missing evidence is a precise gate, not automatic permission for a release project.

## Data and delivery

- Verify synthetic backend/accounts/state before test writes. Another port or mock
  printing does not isolate a production-connected backend. Never guess/kill a PID.
- Preserve server pricing, atomic checkout/request identity, original receipts,
  uncertain payment/printing fences, current journals/WAL, keys and backups.
- No real charges, physical paper, hosted migration or installed-client change
  follows from a test. Do not disable an existing client's configured provider
  because a dated document describes an earlier OFF state.
- Build through existing portable tools; no SDK/npm steps on the store PC.
  Signed compatible updates use the existing updater. Schema changes require
  deliberate maintenance; folder rollback is not database rollback.
- Keep private configuration/runtime data outside Git and distributed artifacts.
  Source CI, demo qualification, customer package, publication and observed
  installation/site acceptance remain distinct. Use the private family operations
  catalog and current client evidence; do not infer an installed version from main.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
