# Hosted Commonplace implementation progress

The [hosted architecture](2026-09-11-hosted-commonplace-design.md) is the active plan. The earlier local Python prototype remains unfinished reference work.

- [x] Direction approved; original filesystem-first plan paused.
- [x] Entry migration with ownership, revisions, retry receipts and private SQL interface.
- [x] Local database behaviour checks: 12 passed against embedded PostgreSQL.
- [ ] Hosted migration applied; API schema exposure and signup restrictions verified.
- [x] Web capture, list, search and editing verified with simulated hosted responses.
- [x] Failure/conflict and session privacy tests passed: 7 UI tests, 19 total with database tests.
- [x] Browser and mobile viewport checks passed: 2 browser tests; production build passed.
- [ ] Shared hosted save verified from separate browser sessions.
- [ ] Frontend deployed for access from all devices.

## Verification scope

PGlite executes the application migration unchanged. Test bootstrap supplies Supabase's auth roles, user table and UID helper; it does not test Supabase Auth or PostgREST. The stale-revision tests exercise competing revisions sequentially. A live database/API pass is still required for independent concurrent connections and schema-exposure checks.

The user reports applying the hosted migration and Auth setup. The latest public connection probe confirms registration is disabled but still rejects the `api` schema with `PGRST106`, reporting `public, graphql_public` as exposed. Schema configuration needs to take effect before the authenticated walkthrough. The browser checks use simulated API responses and do not establish live hosted save behaviour. No frontend deployment or installable PWA has been completed.

## Commit checkpoints

Use separate conventional commits for design records, test/build tooling, database behaviour and the web interface. User requested atomic commits on 2026-09-11. Environment files stay untracked. No push is requested.
