# Sizes and product-specific options

A size is a real catalog presentation with its own permanent product ID and price.
Café retains its accepted catalog, prices, exclusive milk choices and saved
receipt contracts. For Smoothies, the client's approved JSON defines names,
sizes, prices, milk choices and eligible extras; Café's menu is not a default.
See [local import workflow](smoothies-local.md).

Changing size preserves only compatible preparation/options. If no equivalent
exists, require a new choice before adding the item. Server validation remains
authoritative; an old cart with no-longer-eligible extras must be reviewed.

Distinguish a single-choice milk replacement from extras that can be combined.
Importing the same approved file must not duplicate products/options. A corrected
file preserves identities and lets the operator review actual changes. Planned
inventory is separate from physical counts.

The shared migration `202611050023_alternative_milk_choice.sql` guards an exclusive
alternative-milk group across manual checkout, provider quotes and phone orders.
Check the current local migration contract rather than assuming a historical Café
backend deployment applies to this installation. Existing receipts and phone
quotes retain their original accepted price/options.

`npm run test:db` exercises option validation and historical receipt recovery on
an isolated synthetic catalog. The Café-specific catalog script
`scripts/catalog/november-matcha-extras.sql` is a historical client adjustment,
not a Smoothies setup/default menu or permission to run that SQL.
