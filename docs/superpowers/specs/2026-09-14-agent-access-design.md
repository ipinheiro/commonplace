# Agent access - design

Date: 2026-09-14
Status: approved, not yet implemented.

## Why

The book can be written, searched and linked from the app, but not from a Claude Code or Codex session. The [original design](2026-08-27-commonplace-book-design.md) made agents equal readers and writers of the book through one MCP server with "few, sharp tools", and the [hosted design](../../plans/2026-09-11-hosted-commonplace-design.md) kept that as a later milestone: agents connect as an authenticated client and obey the same save and version rules as the app. This spec decides how.

## What it is

A local MCP server, started by the agent client over stdio, that signs in as the owner and calls the existing `api` functions over PostgREST. Nothing new is hosted and nothing new is exposed on the internet. It runs on any machine that has the repo and a saved session, which today is this Mac and the work machine.

Not a remote server. Phone and claude.ai access would need a hosted process with an OAuth flow that speaks for the account; that is a later piece if it is ever wanted. Not a move to GCP: the "only my email" property already holds, since signups are disabled and one account exists; signing in with Google instead of a password is a small later item on Supabase, not a reason to move the database.

## Decisions

- **TypeScript, in the repo, beside the export script.** Same runtime, same Supabase client, same Zod schemas in `frontend/src/domain`. The server is the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`, 1.30.0 at the time of writing, which accepts the Zod 4 already installed).
- **A stored session, not stored credentials.** One interactive sign-in per machine writes the Supabase session to a file only the owner can read. The server loads it and Supabase refreshes it. The password is never written anywhere.
- **Space is a parameter, default `personal`.** Any session can name `work`. Nothing is fixed per machine.
- **Create and update, no delete.** An update carries the version the agent read, and a stale version fails without writing, exactly as in the app. Agents cannot remove entries.
- **Links are body text.** `[[Title]]` and `[[id|Label]]` in a body are parsed by the database trigger on save, so there is no separate link tool. The tool descriptions teach the syntax.
- **The process never dies on a bad call.** Missing session, bad input and database refusals all come back as tool errors the agent can read and act on.

## Files

- `frontend/scripts/mcp.ts` - the process the clients start. Loads `frontend/.env.local` the way the export does (the environment wins over the file), loads the session, builds a Supabase client on the `api` schema, registers the tools from the core, and serves them over stdio. With the argument `login` or `logout` it runs that command instead and exits. Everything it logs goes to stderr; stdout is the protocol channel.
- `frontend/scripts/mcp-core.ts` - tool definitions, input schemas and output shaping, against a small client interface so tests run them with a fake. Reuses `entrySchema`, `pageSchema`, `contextSchema`, `entryContext`, `entryDate` and `entrySpace` from `frontend/src/domain/entries.ts`, `connectionsSchema` and `linkTargetSchema` from `frontend/src/domain/links.ts`, and `linksToText` for excerpts.
- `frontend/scripts/mcp-session.ts` - the session file: path, read, write, remove, and the storage adapter handed to the Supabase client.
- `frontend/package.json` - `"mcp": "node scripts/mcp.ts"` beside `export`; `@modelcontextprotocol/sdk` as a dependency.
- Tests in `frontend/tests/mcp.test.ts` and `frontend/tests/mcp-session.test.ts`.

## Sign-in

`bun run --cwd frontend mcp login` asks for email and password in the terminal (or reads `COMMONPLACE_EMAIL` and `COMMONPLACE_PASSWORD` when there is no terminal, as the export does), signs in with `signInWithPassword`, and writes the session file. `bun run --cwd frontend mcp logout` signs out that session at Supabase, so its refresh token is revoked, and removes the file. Either command reports what it did on stdout and exits non-zero on failure.

The session file lives at `$XDG_CONFIG_HOME/commonplace/session.json`, falling back to `~/.config/commonplace/session.json`. It is written with mode `0600` through a temporary file and rename, and the directory is created with mode `0700`. Its shape:

```json
{ "url": "https://<ref>.supabase.co", "session": { …what supabase-js stores… } }
```

The server hands Supabase a storage adapter whose `getItem` reads the file and returns the stored session only when the file's `url` equals the configured project URL, whose `setItem` rewrites the file with the current URL, and whose `removeItem` deletes it. The adapter reads the file on every access rather than caching it, so two servers running at once (Claude Code and Codex, say) both see the latest refreshed token instead of one of them refreshing with a token the other already rotated. A session saved against production is therefore never used against the dev project, and pointing the server at the dev project (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the client's environment block) simply means signing in once more, into a file that then belongs to dev.

The server starts whether or not a valid session exists. Before each tool call it asks Supabase for the current session; if there is none, or a refresh has failed, the tool returns an error telling the agent to run `bun run --cwd frontend mcp login`. An auth refusal from the database (`42501`, `PGRST301`, `PGRST302`, `PGRST303`) returns the same message.

## Tools

Every tool except `get_entry` takes an optional `space` of `personal` or `work`, `personal` by default. Every tool returns JSON as its text content so both clients read it the same way. Errors are returned with `isError` and a one-line message; the database code, when there is one, goes to stderr.

**`search_entries`** `{ query?: string (≤500), kind?: string, space?, limit?: 1..100 = 20 }`
Calls `list_entries` with `p_order = 'newest'`. Returns `{ entries: [{ id, title, kind, date, tags, excerpt }] }` where `date` is the entry date (the context date, else the creation date) and `excerpt` is the first 300 characters of the body after `linksToText`. An empty query lists the most recent entries. No paging: an agent that needs more than 100 matches refines the query.

**`get_entry`** `{ id: uuid }`
Calls `get_entry` and `entry_connections`. Returns `{ id, title, kind, body, space, date, tags, url, source, images: [name], version, createdAt, updatedAt, links: [{ id, title, kind }], backlinks: [{ id, title, kind, entryDate }], ghosts: [title] }`. Images are names only. `space` is not an input here; the ID is enough. A missing or deleted entry returns "not found".

**`search_titles`** `{ query: string (1..300), space? }`
Calls `search_titles` with `p_limit = 8`. Returns `{ titles: [{ id, title, kind }] }`. The description says this is how to find an ID for `[[id|Label]]` or confirm a title exists for `[[Title]]`.

**`list_kinds`** `{ space? }`
Pages through `list_entries` with an empty query and limit 100, as the app's type filter does. Returns `{ kinds: [{ kind, count }] }` sorted by kind.

**`save_entry`** `{ id?: uuid, version?: integer ≥1, title?: string (1..300), body?: string (≤1,000,000), kind?: string (1..64), space?, date?: 'YYYY-MM-DD' | '', tags?: string[] (≤30, each 1..64), url?: string (http or https, ≤2048), source?: string (≤1000) }`

- Create: `id` and `version` absent; `title`, `body` and `kind` required. Context is the given fields over the defaults of `contextSchema`; `images` is `[]`. The server generates the request ID (`crypto.randomUUID()`) and the entry ID.
- Update: `id` and `version` both present (one without the other is a bad input). The server calls `get_entry`, applies the given fields over the current title, body, kind and context, keeps `images` and every field not given, and calls `save_entry` with `p_expected_version = version`. This is what keeps an agent's body edit from dropping the entry's photos.
- Returns `{ id, title, kind, space, version }` of the saved entry.
- A stale version (`PT409`) returns "This entry changed since version N. Read it again and retry." and writes nothing. `PT404` returns "not found". `22023`, `23514`, `23502`, `22P02` return "invalid" with the raw code on stderr.

The tool description explains: bodies are Markdown; `[[Title]]` links to the entry with that title in the same space and stays an unresolved link until one exists, which is fine; `[[id|Label]]` links by ID and is preferred when the ID is known; links are ignored inside code.

## Client setup

Documented in the setup guide as a new section, "7. Connect Claude Code and Codex":

```sh
bun run --cwd frontend mcp login
claude mcp add -s user commonplace -- node /absolute/path/to/commonplace/frontend/scripts/mcp.ts
codex mcp add commonplace -- node /absolute/path/to/commonplace/frontend/scripts/mcp.ts
```

The script resolves `.env.local` relative to itself, so the clients need no working directory. To point a client at the dev project, add `-e VITE_SUPABASE_URL=… -e VITE_SUPABASE_PUBLISHABLE_KEY=…` (Claude Code) or `--env` (Codex) and sign in again. The guide also notes that `mcp logout` revokes the saved session and that deleting the file has the same effect on that machine.

## Testing

Unit, in Vitest with a fake client, following `frontend/tests/export.test.ts`:

- `search_entries`: request mapping (query, kind, space, limit, newest), output shape, excerpt uses link labels and is cut at 300, default limit 20, limit 101 rejected.
- `get_entry`: merges the entry and its connections, images as names, `entryDate` on backlinks, not found on `PT404`.
- `search_titles`: `p_limit` 8, empty query rejected.
- `list_kinds`: counts across pages, sorted.
- `save_entry`: create sends a fresh request ID and full context with empty images; update reads first, keeps images and fields not given, sends the expected version; `id` without `version` and `version` without `id` rejected; `PT409` returns the stale-version message and does not retry; bad `date`, `url` and tag counts rejected before any call.
- No session: every tool returns the login message and makes no database call.
- Wiring: an in-process MCP client over `InMemoryTransport.createLinkedPair()` lists the five tools and calls `search_entries` against the fake.

Session file, in a temporary directory:

- Written with mode `0600`, directory `0700`; read back; a file with a different `url` reads as no session; `removeItem` deletes it; a change written to the file by another process is seen on the next `getItem`.

Live, by hand: `mcp login`, add to Claude Code, ask it to search the book, create an entry linking to an existing title, then update that entry; confirm in the app that the link resolves and the photos survived the update. The export tests, database tests and browser tests do not change.

## Documentation

- README: agent access moves from current limits to the features list, one line: Claude Code and Codex can search, read, create and update entries through the MCP server.
- Hosted setup guide: section 7 above; the intro line that lists MCP as a later milestone is updated.
- Direction memory: agents shipped; semantic search is next.

## Out of scope

A remote or hosted server, OAuth, phone or claude.ai access, deleting entries, uploading or viewing images, paging beyond 100 results, MCP resources or prompts, a Python server, Google sign-in, and any change to the database or the `api` schema. If agent use shows that title-link labels need to survive a target's deletion in the API payload, a `label` column on `entry_links` is a separate small change.
