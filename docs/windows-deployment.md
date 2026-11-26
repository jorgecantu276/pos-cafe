# Windows delivery — choose the product-specific path

For Smoothies, use [installation and daily operation](smoothies-local.md) and
[product progress](products/smoothies.md). Its portable installer provisions the
local Supabase stack and uses the existing signed Smoothies pilot updater. The
shared Café target-bound packager/launcher is a different delivery contract.
Do not substitute it or apply historical Café deployment commands to this client.

## Candidate and first installation

1. Resolve exact product/profile/source and accepted artifact through the private
   family catalog. Preserve separate demo/customer build directories and data.
2. Build on development Windows with source-pinned Node and locked dependencies.
   Package through `scripts/smoothies/package-windows.mjs`; include runtime/license
   and actual file manifest. The operator does not install npm or compile code.
3. Test exact installer, login, import, cash sale, retry, restart and encrypted
   recovery on isolated synthetic state. Independent review evaluates final source
   and package. Source CI alone is not a store-ready installer.
4. Enroll the actual Windows account once: Docker/WSL prerequisites, branded
   shortcut, local backend, client configuration, persistent journal/backups,
   recovery key and trusted update public key. Never publish private data/keys.
5. Accept reboot/offline operation, iPad read-only mirror, opening counts,
   off-PC recovery and physical printers when required. Only Café is currently
   identified as live; this document is not a Smoothies installation receipt.

## Compatible automatic updates

The installed Smoothies launcher checks signed product/channel/version manifests,
ZIP/hash/file index and database contract. It stages new bytes separately, waits
for closed shift and resolved handoff/payment/printing work, and activates with
startup verification. A failed start retains the prior app and current data.
Offline update lookup does not prevent opening the installed local POS.

A changed database contract requires deliberate maintenance. No updater approval
permits applying SQL, replaying money or printing, replacing the current journal,
or restoring an old database over newer sales. Keep the exact previous compatible
application, configuration, keys, current journals/WAL and backups.

## Family and remote-support boundaries

Individual product candidates build independently. Promotion preserves the current
all-three Café/Smoothies/Papelería release/source binding, signing trust and client
predecessor checks. Publication is separate from installed-device observation.

A store needs its own accepted reporter/update enrollment before remote health or
automatic deployment can be claimed. Use outbound approved-package checks and
sanitized private reports; do not install a general GitHub Actions runner on a
cash register. GitHub issue/PR approval is not permission to reset a store.

Legacy Café deployment details and installation examples remain in their owning
product source/history. They do not establish Smoothies defaults or renew old
merge, provider, paper, production SQL or repository-transfer authorizations.
