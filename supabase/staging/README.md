# Local Supabase acceptance environment

> Development reference: use isolated synthetic state only. Historical fixture
> counts and earlier schemas below do not establish the current Smoothies/client
> contract. Preserve the full current migration order and verify the script's
> prerequisites before running. No hosted deployment or production reset is implied.


This is a separate Docker-backed PostgreSQL 17, GoTrue Auth and PostgREST stack. It contains synthetic data only. It does not link to either hosted Supabase project, clone business rows or change the normal `.env.local`.

Use the pinned Supabase CLI installed by `npm ci`. On this Windows development PC, Docker Desktop with its WSL 2 Linux engine must be running. Docker/WSL are development tools here; installing them on the café PC is not a deployment requirement.

```powershell
npm run staging:start
npm run staging:test
npm run staging:app
```

`staging:start` creates the dedicated local network and starts the services. On Windows it compiles the small versioned `docker-loopback.cs` launcher with the installed Windows .NET compiler. Only this CLI process uses that launcher: it makes the four configured port bindings explicitly `127.0.0.1` and forwards all other arguments/streams to the installed Docker binary. Docker Desktop otherwise published implicit bindings on all interfaces despite the network default. Global Docker settings and installed vendor files are unchanged. The runner verifies actual bindings before any bootstrap/test writes and stops the stack if they fail. It rejects remote Docker hosts, linked project directories, unexpected local database/API ports and all hosted Supabase URLs.

The first start requires an empty local public schema and Auth directory. Bootstrap reconstructs captured catalog definitions, creates one synthetic administrator through real Auth, applies the exact candidate migration and records a private identity/source fingerprint. No production export rows are loaded. A later source mismatch or partial bootstrap fails visibly; it is not silently reset or patched. Inspect and reconcile that disposable local stack explicitly if this happens.

| Service | Address |
|---|---|
| Auth and PostgREST API | `http://127.0.0.1:55451` |
| Local PostgreSQL | `127.0.0.1:55452` |
| Local Studio | `http://127.0.0.1:55453` |
| Local test mail | `http://127.0.0.1:55454` |
| Owner UI against staging | `http://127.0.0.1:3101` |

The app command copies source into fresh ignored scratch without any `.env*`, Git data or existing builds. It supplies only local endpoint/key values to that process. The ordinary port-3000 preview is separate. Local administrator credentials are stored in `.staging-local/credentials.json`; starting the preview writes `.staging-local/app-access.txt`. These are test credentials, ignored by Git, and must not be shared as production configuration.

The test command verifies the private staging identity before any fixture writes, then builds and starts a temporary production copy of the actual Next.js app on port 3101 against local Supabase. Keep that port free when testing. It exercises real password login, SSR cookies, refresh rotation, anonymous projection/table denial, staff/admin page and API authorization, Auth/profile provisioning, catalog RLS, nested order-item/product joins, scalar JSON financial RPCs, price rejection, concurrent retries, stock/loyalty effects, cancellation, abandonment, closing and deactivation. It also checks production worker delivery. Negative checks must reach SQL permission/validation errors; a missing PostgREST function is a test failure.

Every run creates uniquely named synthetic fixtures and retains them for inspection. Results are written to `.staging-local/last-result.json`. Failures are not converted into passing/skipped checks. The temporary test app stops in cleanup; the local Supabase services remain available.

```powershell
npm run staging:stop
```

Stop affects this dedicated local project only and retains its synthetic volumes. No reset, hosted push, login/link, production migration or café-PC synchronization command is part of this workflow.

`npm run test:recovery` separately backs up staging, restores a fresh disposable cluster and tests production build rollback while preserving new sales. See [recovery procedure and boundaries](RECOVERY.md). It does not overwrite this source staging database or stop the port-3101 preview.

`npm run test:lifecycle` adds browser-assisted production startup, lost-response checkout recovery after process restart, and replacement of an already controlling legacy-worker fixture. See [lifecycle procedure and boundaries](LIFECYCLE.md). It uses a fresh disposable restore and leaves this source staging database unchanged.

`npm run test:cashiers` adds two real synthetic cashier logins, conflicting tabs, simultaneous payment attempts, switching accounts during a pending sale and 20 concurrent RPC retries. See [cashier/tab procedure](CASHIERS.md). It uses the same dedicated restore ports, so run it separately from the lifecycle/recovery drills.

This verifies the local Supabase service boundary. Hosted settings/custom hooks, Windows boot/watchdog behavior on the café PC, measured network conditions, the exact installed café PWA state and physical printers still need their own acceptance checks. The legacy-worker fixture does not prove an upgrade from every existing café browser state.

References: [Supabase local development](https://supabase.com/docs/guides/local-development), [Docker Windows setup](https://docs.docker.com/desktop/setup/install/windows-install/), [Docker bridge port binding](https://docs.docker.com/engine/network/drivers/bridge/).
