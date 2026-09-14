# Connect the hosted Commonplace app

The current delivery is the first hosted slice: sign-in, note capture, listing, text search and editing. Tags, links, sources, attachments, offline capture and MCP are later milestones. PostgreSQL owns saved entries; the browser keeps only an in-memory query cache and current draft.

## 1. Prepare Supabase

The project URL and publishable key belong in `frontend/.env.local`, following [the example](../frontend/.env.example). This file is ignored by Git. The browser uses the publishable key, never a secret/service-role key.

In your Supabase project:

1. Open the SQL Editor and run every file in [`supabase/migrations/`](../supabase/migrations/) in filename order, starting with the [entry migration](../supabase/migrations/202609110001_entries.sql). Each is wrapped in a transaction. Run each once; when a new migration file is added to the repo, apply it before deploying a frontend that depends on it. A project that is behind the repo fails with `PGRST202` when the app or the export calls a function whose arguments changed.
2. In the Data API settings, set **Exposed schemas** to **`api` only**. Keep `app` unexposed. SQL grants and ownership policies protect the private records; only the defined API functions should be reachable.
3. In Authentication settings, **disable new user signups** and anonymous sign-ins. Provision your own confirmed email/password user through the dashboard. Do not share your password or secret keys with the agent.
4. Open **Authentication → URL Configuration**. Set **Site URL** to `http://localhost:5173` and save. Once the frontend is deployed, replace this with its HTTPS address (for example, `https://your-app.vercel.app`). This setting tells Supabase where to send users for authentication redirects; it does not host the app. The initial email/password sign-in does not use redirects. See [Supabase's redirect URL documentation](https://supabase.com/docs/guides/auth/redirect-urls).

The local `supabase/config.toml` records these settings for a local Supabase stack; it does not change a hosted project's dashboard settings automatically.

Check the connection and unauthenticated access from the repo root:

```sh
bun run --cwd frontend check:connection
```

Expected: Auth HTTP 200, registration disabled, `api` anonymous access denied with `42501`, and `app` unexposed with `PGRST106`. This check is read-only and does not print credentials. It does not prove authenticated save behaviour; complete the walkthrough below.

### If the API disagrees with the dashboard

If the dashboard shows only `api` but requests return `PGRST106` listing `public, graphql_public`, the running API configuration differs from the dashboard. Supabase documents [resetting or explicitly setting the authenticator schema configuration](https://supabase.com/docs/guides/troubleshooting/pgrst106-the-schema-must-be-one-of-the-following-error-when-querying-an-exposed-schema).

For this project's initial hosted setup, resetting `pgrst.db_schemas` and reloading did not resolve the mismatch. The connection check passed after running this in the SQL Editor:

```sql
ALTER ROLE authenticator SET pgrst.db_schemas = 'api';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
```

This is an explicit database role override. Keep it aligned with the dashboard if exposed schemas change in future. It does not modify entries. Rerun the connection check after changing it.

## 2. Run locally

Install [Bun 1.4.2](https://bun.com/docs/installation) and Node 24. Bun manages dependencies and runs package scripts; Vite, Vitest and Playwright continue to use Node. Open a new terminal after installing Bun so its PATH is available.

```sh
bun install --cwd frontend --frozen-lockfile
bun run --cwd frontend dev
```

Commit `frontend/bun.lock` when dependencies change. Use `bun run --cwd frontend test` (including `run`) for Vitest; `bun test` uses a different runner. `frontend/bunfig.toml` leaves environment-file loading to Vite and the connection-check script. See the [migration research](plans/2026-09-11-bun-migration.md) for the version-pinning and compatibility decisions.

Open `http://localhost:5173` and sign in with your provisioned user. Sessions persist only within the current browser tab using session storage. Explicit sign-out removes the session, query cache and open draft. A session expiry keeps an open draft in memory for the same account; signing in as another user discards it.

## 3. Verify the shared data

1. Open the app in two separate browser tabs and sign into the same account.
2. Capture a uniquely titled test note in one tab. Refocus/reload the other tab and find it.
3. Open the same note for editing in both tabs. Save in the first. Saving the old version in the second must produce a conflict and retain that second draft.
4. Compare the latest entry; only explicitly choose to save your draft against its new revision if intended.
5. Interrupt a save with browser network controls. Retrying the unchanged request must produce one saved entry.
6. Sign out; verify previously opened content disappears. A second account must not read or modify the first account's entries.

The test suite runs the real migration in embedded PostgreSQL with test auth infrastructure. It checks database ownership/revisions/retries and frontend failure handling. It does not replace a live Supabase Auth/PostgREST pass or tests of overlapping independent database connections.

## 4. Deploy the frontend

The frontend was deployed to Vercel on 2026-09-11. Set Supabase Auth's **Site URL** to your deployment's HTTPS address (for example, `https://your-app.vercel.app`).

The first deployment used the Vercel CLI from `frontend`. The production build settings contain only the Supabase URL and publishable key. GitHub automatic deployments are not connected; signing into Vercel with email works for CLI deployments. No Git push was made.

To deploy an update from this already linked workspace, run the checks below, then:

```sh
bunx vercel@59.16.0 deploy --prod --yes --cwd frontend
```

The project has two production addresses. The deploy command updates the one it prints, but the original `commonplace-rust.vercel.app` address, the one installed on the phone and used as the Supabase Site URL, kept serving a three-day-old build after the deploy on 2026-09-14. After every production deploy, check that this address serves the new bundle, and if not point it at the deployment the command printed:

```sh
bunx vercel@59.16.0 alias set <deployment-url> commonplace-rust.vercel.app --cwd frontend
```

For a fresh checkout, first sign in with `bunx vercel@59.16.0 login` and link the existing project with `bunx vercel@59.16.0 link --project commonplace --cwd frontend`, selecting the account that owns it. Local `.vercel` state and environment files stay outside Git. `.vercelignore` excludes local environment files and test artifacts from uploads; Vercel supplies the production build variables.

### Preview environment

Vercel's Preview environment is the dev environment. It has its own Supabase project, set through the Preview values of the same two variables, so it holds separate accounts and entries. Every migration has to be applied in both projects' SQL Editors; the app, the export and the connection check follow whichever project `frontend/.env.local` names. To check that a project has a function without signing in, call it anonymously with that environment's publishable key: `42501` means the function exists and refused the anonymous caller, `PGRST202` means the migration is missing.

Deploy a preview from the linked workspace with:

```sh
bunx vercel@59.16.0 deploy --yes --cwd frontend
```

Vercel Authentication is set to protect preview deployments only, so a preview URL redirects to a Vercel login while the production address stays public. The setting is under **Deployment Protection** in the project settings. When it protects every `vercel.app` address, the installed app on a phone is redirected to the Vercel login as well, and the production browser checks cannot run.

If Vercel blocks a deployment because the commit author lacks access, connect the author's GitHub account under [Vercel account authentication](https://vercel.com/account/settings/authentication). This is separate from enabling automatic Git deployments. Keep the GitHub noreply commit email. Vercel documents the [author and account access requirements](https://vercel.com/docs/deployments/troubleshoot-project-collaboration#team-configuration). During the Bun migration, CLI 59.16.0 showed this block as `UNKNOWN`; `bunx vercel@59.16.0 inspect <deployment-url> --json` exposed the actual `BLOCKED` state. Retry deployment after resolving account access.

If setting up Git-based deployment later, use:

- Root directory: `frontend`
- Install command: `bunx bun@1.4.2 install --frozen-lockfile`
- Build command: `bunx bun@1.4.2 run build`
- Output directory: `dist`
- Environment: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`

These values are build-time configuration. Rebuild after changing them. SPA fallback configuration is included for Vercel and Cloudflare Pages. Repeat the shared-data walkthrough after deployment. A custom domain can follow later.

The application connects directly to the hosted Supabase API; it does not require a server process on your computer.

## 5. Install on your phone

Open your deployment's HTTPS address on your phone:

- **iPhone:** In Safari, open Share, choose **Add to Home Screen**, keep **Open as Web App** enabled if shown, then tap **Add**. See [Apple's instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios).
- **Android:** In Chrome, open the menu, choose **Add to home screen → Install**. See [Google's instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en).

Launch the new Commonplace icon and sign in with your existing Commonplace account. Installation may use a separate browser session, so signing in again is expected. Check that your existing entry appears, save one from your phone, then refresh your computer's view to confirm it appears there too.

The manifest sets the app name, icon, scope and standalone display. Browser installability is checked in a normal Chrome profile; actual phone installation still needs a device check. Installation is supported [without a service worker](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable). No service worker, offline database or persistent cache of personal API responses is installed. An internet connection is required; unsaved drafts remain in memory and can be lost when the app is closed.

## 6. Export your book

The export writes every entry and image to a folder on your computer. It signs in with your own account through the publishable key, so it sees exactly what the app sees. From the repo root:

```sh
bun run --cwd frontend export
```

You are prompted for your email and password; the password is not echoed and is never written to disk. For scheduled runs, set `COMMONPLACE_EMAIL` and `COMMONPLACE_PASSWORD` in the environment instead.

The default output is `export/` at the repo root, which Git ignores. Pass `--out <dir>` to write somewhere else, for example a private Git repository.

```
export/
  manifest.json                 when it ran and how many entries and images it holds
  entries/<entry-id>.json       one file per entry, exactly as the API returns it
  images/<owner>/<entry>/<id>   image bytes, at the same path the app stores them
```

Entry files are named by ID, so repeated runs overwrite in place and remove entries you have since deleted. Deleting keeps the row in the database with a `deleted_at` timestamp; the app and the export no longer see it, but nothing is removed from storage and a later restore piece can bring it back. Images already on disk are skipped and never removed. A run that returns no entries keeps the existing files and exits non-zero, so a wrong account or an empty project cannot silently empty the folder. A failed image download is reported and the command exits non-zero after finishing everything else.

Restoring an export into a fresh project is not yet implemented. The export contains every field the API returns plus the image bytes, so nothing is lost; the restore tooling is a separate piece of work.

The export was verified against the production project on 2026-09-13: both spaces listed, every image downloaded, and the manifest counts matched the files on disk. The first attempt failed with `PGRST202` because the project was one migration behind the repo; applying the missing migration fixed it.

## Checks

```sh
bun run --cwd frontend test
bun run --cwd frontend build
bun run --cwd frontend test:browser
```

Browser checks use installed Google Chrome, start the development server when needed, and simulate Supabase responses. They cover desktop sign-in, capture, reading, editing and search, plus phone layout and capture. They do not write to the hosted database.

The installation check additionally validates the served manifest, decodes the PNG icons and asks Chrome for installability errors. To run these checks against production:

```sh
PLAYWRIGHT_BASE_URL=https://your-app.vercel.app bun run --cwd frontend test:browser
```

Production verification passed all 3 browser checks on 2026-09-11. Sign-ins and saves in these automated checks use simulated API responses; the user walkthrough verifies real account access and shared entries.
