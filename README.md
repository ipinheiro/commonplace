# Commonplace

A private, online-first personal knowledge app. A React web interface connects through a data-access layer to Supabase Auth and PostgreSQL, which stores the canonical entries across devices.

The first slice supports email/password sign-in, Markdown entry capture, browsing, text search and editing. Saves include revision checks and retry receipts so stale edits produce a conflict and interrupted requests can be retried safely.

## Run locally

Follow the [hosted setup guide](docs/hosted-setup.md) to prepare Supabase and configure `frontend/.env.local`. Then:

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

Open `http://localhost:5173`. The interface runs locally during development; saved entries live in the configured cloud database.

## Verify

```sh
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:browser
node frontend/scripts/check-connection.mjs
```

Browser tests use installed Google Chrome and simulated API responses. Database tests execute the migration in embedded PostgreSQL; neither substitutes for the live two-session walkthrough in the setup guide.

## Direction

See the [architecture and migration plan](docs/plans/2026-09-11-hosted-commonplace-design.md) and [implementation progress](docs/plans/hosted-progress.md). Deployment, installable PWA support, tags, entry links, sources, attachments and agent access are later steps. Drafts currently stay in memory; offline capture is not implemented.

The earlier local Python prototype is unfinished reference work and is not required to run the web app.
