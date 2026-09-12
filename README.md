# Commonplace

A private, online-first personal knowledge app. A React web interface connects through a data-access layer to Supabase Auth and PostgreSQL, which stores the canonical entries across devices.

The first slice supports email/password sign-in, Markdown entry capture, browsing, text search and editing. Saves include revision checks and retry receipts so stale edits produce a conflict and interrupted requests can be retried safely.

Home screen installation is supported; see the [installation instructions](docs/hosted-setup.md#5-install-on-your-phone). An internet connection is required.

## Run locally

Follow the [hosted setup guide](docs/hosted-setup.md) to prepare Supabase and configure `frontend/.env.local`. Install Bun 1.4.2 and Node 24, then:

```sh
bun install --cwd frontend --frozen-lockfile
bun run --cwd frontend dev
```

Open `http://localhost:5173`. The interface runs locally during development; saved entries live in the configured cloud database.

## Verify

```sh
bun run --cwd frontend test
bun run --cwd frontend build
bun run --cwd frontend test:browser
bun run --cwd frontend check:connection
```

Use `bun run --cwd frontend test`, including `run`, to invoke Vitest; `bun test` invokes Bun's separate test runner.

Browser tests use installed Google Chrome and simulated API responses. Database tests execute the migration in embedded PostgreSQL; neither substitutes for the live two-session walkthrough in the setup guide.

## Direction

See the [architecture and migration plan](docs/plans/2026-09-11-hosted-commonplace-design.md) and [implementation progress](docs/plans/hosted-progress.md). Tags, entry links, sources, attachments and agent access are later steps. Drafts currently stay in memory; offline capture is not implemented.
