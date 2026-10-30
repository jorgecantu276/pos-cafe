<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Development and deployment workflow

- Build and implement changes on this development PC. The café PC receives releases through GitHub; do not make the café PC the primary development environment.
- Use the plain Spanish touch workspace by default, per the user's latest instruction. Keep the original catalog-left/order-right workflow, compact product choices, item controls shown after tapping an order line, stable payment area and no decorative motion/blur. Retain UI rollback with server environment `POS_REGISTER_UI=owner` or `POS_REGISTER_UI=prototype`; all appearances share the repaired business/recovery handlers. Per the user's October 30 instruction, confirmed sales automatically dispatch customer and barista copies through the local Windows dispatcher; historical reprints and closing reports retain the Windows dialog. Preserve the durable per-copy journal and never blindly retry an uncertain spool handoff.
- Assess every change against the café PC's deployment conditions, rather than assuming this development PC's capabilities match production. Use isolated test data and mocked external services for simulations; do not modify live business records as part of verification.
- Target environment from the café PC discovery report: Windows 11 Pro 24H2, x64, build 26100.9711; Chrome and Edge; a local Next.js application with cloud Supabase dependencies. The observed app ran on port 3000 with `next dev --webpack`; this describes the current setup, not a production deployment requirement.
- Receipt queue: `POS80 Printer`, USB through vendor port `CP001`, driver version 5.1.1.43, 203 dpi, advertised page width 72 mm. Physical model, roll width, cutter, drawer, and raw command support remain unverified.
- Sticker queue: `Y813BT Sticker`, device `Y813BT-E08D`, Bluetooth SPP on COM3, driver version 1.1.3.1, 203 dpi. Discovery found it paired but disconnected, with conflicting 57 × 32 mm and approximately 100 × 150 mm defaults. Confirm loaded stock before selecting a print profile; do not assume ESC/POS support.
- Exercise slow or unavailable internet, Supabase errors and timeouts, uncertain save responses, duplicate submissions, refresh/restart recovery, unavailable printers, and Bluetooth disconnection when relevant to the change. Cloud-backed operation is not offline sales support.
- A user-provided Windows display screenshot shows 1366×768 at 60 Hz and Intel UHD Graphics 620. CPU, RAM, storage, actual display scaling and measured network performance remain unknown. Use clearly labeled conservative simulation parameters until measured; do not invent hardware specifications or claim exact performance equivalence.
- Keep simulated checks distinct from physical acceptance checks. Printer output, Bluetooth recovery, cutter/drawer behavior, and actual café-PC startup/performance require validation on that PC. A successful mocked print or browser print-dialog interaction does not prove a physical print.
- Before preparing a release, run the production build and relevant checks in isolation from the running development output, document environment requirements and rollback, and keep credentials out of Git. Synchronize source and versioned migrations through GitHub; retain machine-specific configuration locally.
