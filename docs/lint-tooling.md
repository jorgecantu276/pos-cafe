# Code checks

Run `npm run lint` with the pinned Oxlint version. TypeScript checking remains
`npm run typecheck`; CI runs both commands and both dependency audits.

The previous ESLint/Next development toolchain depended on Minimatch 3 and 10.
The patched Minimatch 11 API does not provide the legacy callable default
export and regular-expression helpers required by those plugins. Oxlint's
native React, TypeScript, accessibility, imports and Next.js rules remove that
dependency chain without maintaining a custom matcher adapter or disabling the
audit gate.

The config carries over the applicable enabled rules and severities from the
previous JavaScript and TypeScript presets. JSX variable tracking is native.
React compiler build-configuration/gating rules have no direct native
equivalent; this project does not enable React Compiler. The previous React
deprecated-API rule has no direct native equivalent. These are tooling coverage
differences, not runtime changes.

Internal anchor navigation deliberately reloads financial state and includes
API downloads; the native Next link rule also flags these and is disabled.
The previous Next rule only examined the Pages Router directory, which this
App Router project does not have. React global-assignment checking remains
enabled in app code; test harnesses may capture render results outside a
component, so that diagnostic is disabled only under `tests/`.

The lint regression test supplies invalid snippets to the actual CLI to check
that React hooks, TypeScript and accessibility diagnostics still fail linting.
