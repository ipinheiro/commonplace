# Hosted Commonplace implementation progress

The [hosted architecture](2026-09-11-hosted-commonplace-design.md) is the active plan. The unused local Python prototype was removed on 2026-09-11 at the user's request after hosted capture and phone access were confirmed. Its original design documents remain as historical context.

- [x] Direction approved; original filesystem-first plan paused.
- [x] Entry migration with ownership, revisions, retry receipts and private SQL interface.
- [x] Local database behaviour checks: 12 passed against embedded PostgreSQL.
- [x] Hosted migration reported applied; public connection probe confirms API schema access restrictions and disabled signups.
- [x] Web capture, list, search and editing verified with simulated hosted responses.
- [x] Failure/conflict and session privacy tests passed: 7 UI tests, 19 total with database tests.
- [x] Browser and mobile viewport checks passed: 2 browser tests; production build passed.
- [x] User confirmed local sign-in and hosted capture worked.
- [x] User confirmed the saved entry appears after signing into the production app on their phone.
- [x] Frontend deployed to Vercel.
- [x] PWA manifest and icons implemented; all 3 browser checks passed against production, including Chrome installability.
- [x] Removed the untracked Python prototype, package configuration, lockfile, virtual environment and generated Python artifacts; archived the original plan.
- [x] Migrated local dependency management and scripts to Bun 1.4.2; clean installation, 19 Vitest tests, 3 browser tests, formatting and production build passed.
- [x] Deployed the Bun migration after GitHub authorization; fresh Vercel build, public HTTP 200 and all 3 production browser checks passed.
- [x] Export script writes entries and images to a local folder; verified against production on 2026-09-13 after applying the sort-order migration the hosted project was missing.
- [x] Entry delete tombstones the row through `api.delete_entry` with a two-step button in the reader; 3 database and 3 UI tests. The hosted project needs the delete migration applied before deploying.
- [x] Delete deployed on 2026-09-14: migration applied to both Supabase projects, delete tried on a preview, production deployed from develop and all 15 browser checks passed against it. Vercel Authentication had come to cover the production address and was set back to previews only.
- [ ] User confirmed home screen installation (phone browser access already confirmed).
- [ ] Supabase Auth Site URL updated to the production address (user step).

## Verification scope

PGlite executes the application migration unchanged. Test bootstrap supplies Supabase's auth roles, user table and UID helper; it does not test Supabase Auth or PostgREST. The stale-revision tests exercise competing revisions sequentially. Live checks of overlapping independent connections and second-account isolation remain beyond the user's successful capture/read walkthrough.

The user reports applying the hosted migration and Auth setup. The public connection probe now passes: Auth HTTP 200, registration disabled, anonymous `api` RPC access denied with HTTP 401 / `42501`, and `app` unexposed with `PGRST106`. The dashboard showed only `api` while the running API retained `public, graphql_public`. Resetting the role setting and reloading did not resolve the mismatch; the probe passed after the explicit `authenticator` schema setting and reload described in the setup guide. The user then confirmed the local app worked with hosted data. Automated browser checks use simulated API responses and do not establish live hosted save behaviour.

The user approved deployment and PWA installation next, bringing these daily-use tasks forward before knowledge relationships. The Vercel production deployment is ready and its stable HTTPS URL returns HTTP 200 without a Vercel login. The deployed frontend passed desktop, phone viewport and installability checks. Supabase sign-in still protects entries. The user confirmed signing in on their phone and seeing the previously saved entry. Actual home screen installation and saving a new entry from the phone remain device walkthrough steps. The app remains online-only, without a service worker or offline content cache.

Vercel CLI uses the user's email-based account. The initial deployment succeeded before the GitHub login connection was configured. The user subsequently authorized GitHub to resolve commit-author verification during the Bun migration. Automatic Git deployments are not configured. The setup guide records how to redeploy.

## Bun migration verification

The [Bun migration research](2026-09-11-bun-migration.md) records the tooling decisions. Bun 1.4.2 (`744846f84`) was installed with its official installer. All 252 unique package/version pairs and integrity hashes match the previous npm lockfile. A clean frozen installation succeeded; a subsequent frozen installation left `bun.lock` unchanged. No untrusted dependency scripts were reported. The temporary npm-installed dependencies and npm lockfile were removed.

Node 24.21.0 still executes Vite, Vitest and Playwright through Bun's script commands. All 19 tests, the production build and formatting passed. All 3 browser checks passed with Playwright starting Vite through Bun. The read-only Supabase connection check passed through its Bun script. Bun's runtime configuration was checked to ensure it does not preload the Supabase environment variable before Vite handles environment files. The existing bundle-size warning remains.

Vercel's install and build commands now select Bun 1.4.2 explicitly. The first migration deployment was blocked by commit-author verification (`TEAM_ACCESS_REQUIRED`), which CLI 59.16.0 displayed as `UNKNOWN`. After the user authorized GitHub, the deployment succeeded with the existing GitHub noreply commit email. A fresh Linux build installed dependencies using `bunx bun@1.4.2 install --frozen-lockfile` and completed the TypeScript/Vite build. It is ready and aliased to the production address. No personal commit email or Git push was required.

The updated production app returned HTTP 200 without Vercel login and passed all 3 browser checks: desktop entry workflows, phone layout/capture and PWA installability. Automated account and entry operations still use simulated API responses, as described above.

## Commit checkpoints

Use separate conventional commits for design records, test/build tooling, database behaviour and the web interface. User requested atomic commits on 2026-09-11. Environment files stay untracked. No push is requested.
