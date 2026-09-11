# Connect the hosted Commonplace app

The current delivery is the first hosted slice: sign-in, note capture, listing, text search and editing. Tags, links, sources, attachments, offline capture and MCP are later milestones. PostgreSQL owns saved entries; the browser keeps only an in-memory query cache and current draft.

## 1. Prepare Supabase

The project URL and publishable key belong in `frontend/.env.local`, following [the example](../frontend/.env.example). This file is ignored by Git. The browser uses the publishable key, never a secret/service-role key.

In your Supabase project:

1. Open the SQL Editor and run the complete [entry migration](../supabase/migrations/202609110001_entries.sql). It is wrapped in a transaction. Run it once on the fresh project; subsequent schema changes should use new migration files.
2. In the Data API settings, set **Exposed schemas** to **`api` only**. Keep `app` unexposed. SQL grants and ownership policies protect the private records; only the defined API functions should be reachable.
3. In Authentication settings, **disable new user signups** and anonymous sign-ins. Provision your own confirmed email/password user through the dashboard. Do not share your password or secret keys with the agent.
4. Open **Authentication → URL Configuration**. Set **Site URL** to `http://localhost:5173` and save. Once the frontend is deployed, replace this with its HTTPS address (for example, `https://your-app.vercel.app`). This setting tells Supabase where to send users for authentication redirects; it does not host the app. The initial email/password sign-in does not use redirects. See [Supabase's redirect URL documentation](https://supabase.com/docs/guides/auth/redirect-urls).

The local `supabase/config.toml` records these settings for a local Supabase stack; it does not change a hosted project's dashboard settings automatically.

Check the connection and unauthenticated access from the repo root:

```sh
node frontend/scripts/check-connection.mjs
```

Expected: Auth HTTP 200, registration disabled, `api` anonymous access denied with `42501`, and `app` unexposed with `PGRST106`. This check is read-only and does not print credentials. It does not prove authenticated save behaviour; complete the walkthrough below.

## 2. Run locally

Use a current Node release compatible with the locked Vite version (Node 24 was used here).

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

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

Choose Vercel or Cloudflare Pages and import this repository. Set:

- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `dist`
- Environment: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`

These values are build-time configuration. Rebuild after changing them. SPA fallback configuration is included for both providers. Add the resulting HTTPS URL to Supabase Auth configuration and repeat the shared-data walkthrough. A custom domain can follow later.

The application connects directly to the hosted Supabase API; it does not require the Python prototype or a server process on your computer. No frontend deployment has been made merely by creating these files.

## Checks

```sh
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:browser
```

Browser checks use installed Google Chrome, start the development server when needed, and simulate Supabase responses. They cover desktop sign-in, capture, reading, editing and search, plus phone layout and capture. They do not write to the hosted database.

The old Python prototype is unfinished and is outside these frontend checks. Do not use its file-based writer as a second authoritative store for hosted content.
