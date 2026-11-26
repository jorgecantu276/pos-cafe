# Printing — shared contract and Smoothies acceptance

Smoothies starts with simulated printing. Configure actual printer queues, stock
and issuer information only during deliberate destination acceptance. Café's
historical printer settings are not this client's settings. See
[local operation](smoothies-local.md) and [product progress](products/smoothies.md).

## Durable documents and recovery

One paid sale creates immutable receipt/preparation documents and independently
tracked copies. Local SQLite journals preserve request identity, copy state,
original actor, destination and audit records. A print error never cancels a
confirmed sale or permits charging it again. Keep current journals and WAL/SHM,
private configuration and saved documents outside replaceable release folders.

Distinguish rendered, submitted, Windows-accepted, queued and physically observed
paper. A spool acknowledgment does not prove paper. Automatic retries never resend
accepted or uncertain copies. Review paper and the actual Windows queue before
explicitly authorizing replacement; an existing job may still emerge later.
Recover the original job/copy identity, with an audit reason, rather than creating
a fresh sale or clearing the journal. Accepted replacements remain explicit.

Administration's printing recovery can review outstanding copies across cashiers;
cashiers retain their own scope. Recovery does not alter financial ownership.
Lost-response review requests reuse their saved identity. Preserve blocked and
uncertain states across refresh, cashier changes and application updates.

## Shared formats and product differences

The shared source retains historical layouts `reference-v2`, `desserts-compact-v1`
and receipt-shaped documents. Preserve the layout and destination stored with an
old document; never reinterpret or resend it to apply a newer design. A compatible
rollback must understand documents already created by the newer release.

Where enabled by the product, drinks use per-cup labels; historical Café dessert
routing uses separate grouped/per-piece preparation. Those Café menu rules are
not an instruction to add desserts or require two printers for Smoothies.
A compact label that cannot fit its complete text remains blocked; do not silently
truncate preparation or mark an unprinted document as delivered.

Phone preparation, if enabled for the product, uses unpaid `phone:UUID` documents
separate from its later paid customer receipt. Pickup payment preserves the
original preparation identity; it does not automatically repeat accepted paper.
Cancellation stops new preparation but cannot recall paper already submitted.

## Configuration and local checks

Keep these values installation-local; use placeholders in source documentation:

```dotenv
POS_PRINT_MODE=mock
POS_PRINT_DATA_DIR=C:/POS/private/printing
POS_RECEIPT_ISSUER_FILE=C:/POS/private/receipt-issuer.json
```

Use `windows` mode only with approved actual queues, stock and issuer data.
Missing an existing journal during upgrade is a blocking condition, not permission
to create an empty replacement. Never copy another client's journal/issuer profile.

```powershell
npm run test:printing
npm test
```

The HTTP printing drill uses a verified synthetic backend and mock queues. It
must not contact live business records or call the physical spooler. Package and
source tests do not establish real driver, Bluetooth, stock, cutter or drawer
behavior. The receipt SQL/HTTP linkage uses `POS_RECEIPT_CONTRACT_EVIDENCE` when
specified by the existing test procedure; see [receipt contract](receipt-data-contract.md).

## Historical evidence and next acceptance

[Café printer acceptance, October 31](printer-acceptance-2026-10-31.md) preserves
observed paper results, exact artifact hashes and subsequent layout boundaries.
It is dated evidence for that equipment; no new printer proof is claimed here.
For Smoothies, identify required printers first, then prove receipt/preparation
content, readability, uncertain-job recovery and restart without duplicate copies
through the exact installed app. Preserve the current journal during all tests.
