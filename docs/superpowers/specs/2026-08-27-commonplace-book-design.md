# Commonplace book - design

Date: 2026-08-27
Status: historical filesystem-first design; the partial Python prototype was retired and removed on 2026-09-11. The app now follows a hosted, database-first web/PWA architecture. See the [architecture review and migration proposal](../../plans/2026-09-11-hosted-commonplace-design.md).

## What this is

A self-hosted, whole-life commonplace book: one place for notes, ideas, quotes and book passages, code snippets, papers, lyrics, knitting patterns, projects, and a reading log. It is not a work tool that tolerates personal entries - it is a personal archive that happens to include work.

Three motions are first-class and equal:

- **Quick capture** - jot an entry in seconds from the terminal, a Codex or Claude session, or a phone, then get back to what you were doing
- **A place to think** - browse, connect, and wander between entries like a garden
- **AI agents as readers and writers** - Codex and Claude are equally supported clients; either can search, cite, and file into the same book

"Memory" means four things, all in scope: finding things again (full-text and semantic search), connecting things (wiki-links, backlinks, tags, graph), resurfacing things (a daily digest, related entries in the margin), and making that memory available to AI agents across sessions (MCP). The shared memory lives in the vault, independently of any agent's conversation history or provider.

Surfaces: this dev machine, other computers, and a phone. Phone access implies a small self-hosted server reachable over Tailscale.

## Architecture in one paragraph

Plain markdown files in a git repository are the single source of truth (the vault). A SQLite index - full-text, links, and embeddings - is a disposable cache over the files, always rebuildable. One Python core library owns parsing, writing, indexing, and search; three thin surfaces wrap it: a FastAPI web server with a React frontend, a typer CLI (`cb`), and an MCP server shared by Codex, Claude, and other compatible clients. Git provides sync, history, and backup.

## The vault

One private git repository of markdown files, organised by entry type:

```
commonplace/
  notes/      # longer-form thinking, observations
  ideas/      # sparks, might-build-this-someday
  quotes/     # quotes and book passages, with sources
  code/       # snippets worth keeping, one per file
  papers/     # absorbed from ~/arxiv-notes, plus future reading
  projects/   # hub pages for anything being made - software or knitting
  books/      # reading log: one entry per book, with status
  lyrics/     # song lyrics
  patterns/   # knitting patterns, usually with attached PDF/images
  assets/     # binary attachments: assets/YYYY/MM/filename
```

**Types are open, not fixed.** The folder set above is a starter, not a schema. The indexer discovers folders; `type` is the folder name as a string. Adding a new type means creating a folder. The UI renders unknown types generically and adds niceties for known ones.

**Entries** are markdown files with YAML frontmatter:

```markdown
---
title: Attention is a resource allocation problem
type: idea
tags: [ml, attention, writing]
created: 2026-08-27T14:30:00Z
source: https://...   # optional: url, book, person, arxiv id
---

Body in plain markdown. Links to other entries use [[wiki-links]]
targeting the filename stem, e.g. [[2026-08-12-kalman-quote]].
```

- Filename is identity: `YYYY-MM-DD-short-slug.md`, generated at capture time from date and title. Date-prefixed for chronological sorting in any tool, slugged for readability under `ls` and grep.
- Type-specific frontmatter: papers carry `arxiv_id` and `authors`; code entries carry `language` (body is one fenced block); books and papers carry `status` (`reading`, `finished`, `want-to-read`) so the Reading view can shelve both.
- A book passage is a quote with a long body whose `source` names the book and which wiki-links to the book's entry in `books/`.
- Tags carry the personal/professional divide (`knitting`, `work`, `ml`). No structural separation between life and work; filtering by tag provides any "view".
- **Attachments**: binary files live in `assets/YYYY/MM/`, referenced from entries with ordinary relative markdown links so images render in any markdown tool. Capture flows must handle attachments, especially photo capture from the phone. Plain git is fine for images at personal scale; git-lfs is a later option if needed.

Two deliberate properties: the vault is fully usable with zero software (grep, cat, git log, Obsidian pointed at the folder), and any agent session with filesystem access to the vault can read or write entries directly as files even without the MCP server.

## The index and search layer

A single SQLite database outside the vault (XDG data dir, e.g. `~/.local/share/commonplace/index.db`). Cardinal rule: it can always be rebuilt from the files. It is never backed up, synced, or precious.

Contents:

- `entries` - one row per file: slug, path, type, title, tags, dates, status, source, content hash for change detection
- `links` - every `[[wiki-link]]` as (from, to) pairs, including unresolved targets. A link to an entry that does not exist yet is data, not an error - a "you meant to write this" signal
- FTS5 table over titles and bodies, BM25 ranking
- Embedding vectors via sqlite-vec. Long entries (papers especially) are chunked by heading/paragraph into a few hundred tokens per chunk, embedded per chunk; search rolls chunks up to their parent entry

**Embeddings are local**: a small multilingual model via fastembed (ONNX runtime, no torch dependency) - multilingual because lyrics and passages will not all be in English. The exact model is a config value chosen at implementation; `cb reindex --re-embed` handles a future model swap.

**Search is hybrid**: BM25 and vector results merged with reciprocal rank fusion. Exact words win when remembered, meaning wins when not. No reranker, no LLM in the search path.

**The indexer** has two modes: full rebuild (`cb reindex`, also the recovery story) and a live file-watcher running with the server, picking up edits from any source - UI, CLI, agents writing files directly, a git pull. A malformed file is skipped and recorded in a problems list surfaced in the UI and CLI; never a crash.

Non-goal for v1: no image understanding. Photos and pattern PDFs are found through the text of the entry they are attached to.

## The Python side - one core, three doors

A single uv-managed package:

```
commonplace/
  core/    # vault: parse/write entries, slugs, links; index: sqlite, fts, vectors, watcher; search
  api/     # FastAPI app
  cli/     # typer app (`cb`)
  mcp/     # shared MCP server for Codex, Claude, and other compatible clients
```

**Core** owns parsing and writing entry files, slug generation, link extraction, indexing, and hybrid search. The three surfaces are deliberately boring wrappers so every search and every write is the same code path. All writes go through one vault-writer that composes frontmatter, picks the slug, writes the file, and updates the index synchronously; the watcher reconciles anything written behind its back.

**API**: entries CRUD, search, backlinks, graph data, tags, asset upload, digest, problems. FastAPI serves the API under `/api` and the built React app on the same port - one process, one URL.

**Auth is network-level.** Tailscale is the security boundary; the app has no user accounts. Revisit only if it is ever exposed beyond the tailnet.

**CLI** (`cb`): `cb add quote "..." --from "Ursula K. Le Guin" --tags reading`; bare `cb add idea` opens `$EDITOR` on a template. Plus `search`, `recent`, `open`, `digest`, `reindex`, `problems`, `serve`.

**MCP server**: runs locally over stdio against core directly (works even when the web server is down). Few, sharp tools: search, get entry, create entry, add link, recent, digest.

Codex and Claude use the same tool contracts and vault, with client-specific connection setup documented for each. No core behaviour depends on a particular agent or provider. Phase 3 includes verifying that both clients can search, retrieve, create, and link entries through MCP; digest verification follows in phase 5. Sessions need the MCP connection or local vault access configured to use the book.

**Papers absorption**: an import command converts `~/arxiv-notes/` into `papers/` entries, preserving tags; then `~/arxiv-notes` becomes a symlink into the vault so the existing arxiv MCP keeps writing new notes straight into the book. The arxiv note format is verified at implementation time and the indexer taught to read it.

## The web UI

**Stack**: Vite + React + TypeScript, TanStack Query for server state, Tailwind for styling, CodeMirror 6 for editing. Client state minimal; the server is the source of truth.

**Character before components**: a book and a garden, not a dashboard. Typography-first, generous whitespace, warm light and dark themes. Entry types get subtle visual identity - a quote reads like a quotation, code gets highlighting, a book shows its status, patterns lead with images - so a mixed stream scans effortlessly.

Views:

- **Capture, everywhere** - a quick-capture box openable from any screen with one keystroke, front-and-centre on the phone: type picker, text, tag autocomplete, photo/file attach. The most important screen on mobile.
- **Stream** - home: recent entries across all types, filterable by type and tag chips. A "resurfaced for you" strip on top.
- **Entry page** - rendered markdown, images inline, clickable wiki-links; side panels for backlinks and related entries (embedding neighbours). Edit in place with CodeMirror: markdown highlighting, `[[` link autocomplete, paste-an-image-to-attach.
- **Search** - one box, hybrid results, filters for type/tag/date.
- **Graph** - local graph on every entry page (this entry, its links, one hop out) plus a global graph page. Force-directed, coloured by type.
- **Reading** - shelf view of `books/` and `papers/` by status.

**Phone**: a PWA, installable, capture flow designed thumb-first. v1 limitation: no offline mode - capture requires the tailnet reachable. Offline-first sync is a large complexity jump, added later only if reaching the server proves flaky in practice.

**Design pass**: the UI phase opens with a Claude Design canvas of the character-defining screens - the stream, an entry page (a quote with backlinks), and the mobile capture flow - refined visually before implementation. The mockups are a visual spec to implement by hand in React, not generated code. Graph view and editor interactions are iterated in working code instead.

## Memory - resurfacing and the digest

Principle: a commonplace book you only add to is a write-only archive; the value is old entries returning at the right moment.

- **Related entries** while reading and writing: embedding neighbours on every entry page (passive resurfacing).
- **The daily digest**: a rotating selection of about five entries, shown as a strip on the stream, a digest page, and `cb digest`. Drawn from:
  - **On this day** - entries created on this date in earlier years
  - **Long unseen** - old entries not touched or shown in a long while (the core of the rotation)
  - **Orphans** - entries with no links in or out: "does this connect to anything yet?"
  - **Ghosts** - unresolved wiki-links: entries referenced but never written, offered as prompts

Mechanics: computed on request (no cron, no background jobs), seeded by the date so the whole day shows one stable set across devices. The index records when each entry was last surfaced so the rotation does not repeat; that state lives in a small table that survives reindexing (losing it causes repeats, not corruption).

Not in v1: spaced-repetition scheduling, LLM-written digest narratives, email/push delivery. The MCP `digest` tool is free once the digest exists, so a Codex or Claude session can open with what the book surfaced today.

## Deployment, safety, testing

**Deployment**: two things exist - the vault (a private git repo on personal GitHub) and the app (a single `cb serve` process). A new machine is `git clone` + `cb reindex`. Develop and run on the dev box first; for phone access, the same process runs on a personal machine behind Tailscale. Since the vault holds whole-life content, a personal long-term home is the eventual destination. Docker/systemd are packaging details added at that move.

**Safety**: entry writes are atomic (write temp file, rename). Git is the undo for content; `cb reindex` is the undo for the index; the problems list absorbs malformed files. Nothing in the system bulk-deletes; only deleting a file removes an entry.

**Testing**, scaled to risk: core gets the real attention - frontmatter parse/write round-trips under hypothesis, indexer tests asserting incremental updates match a from-scratch rebuild, search sanity checks. API endpoints get TestClient coverage. Frontend gets light treatment (Vitest where there is logic worth testing).

## Build phases

Each phase ends with something usable:

1. **Vault + core + CLI** - capture and search from the terminal; Codex and Claude can already read/write entries with local vault access
2. **Papers absorbed** - import `~/arxiv-notes`, symlink so the arxiv MCP keeps feeding in
3. **MCP server** - thin over core; document setup and verify shared tools in both Codex and Claude so connected sessions gain the book early
4. **Web UI** - Claude Design pass first, then stream, capture, entry page, search
5. **Memory** - graph views, reading shelf, digest and resurfacing
6. **Phone** - PWA polish, Tailscale, move to its long-term home

## Decisions log

- Files as truth, index as cache (over database-as-truth and Obsidian-as-platform)
- Agent-independent memory; Codex and Claude are equally supported through one shared MCP interface and direct local file access
- Absorb `~/arxiv-notes` as `papers/`; tasks are out of scope entirely (a task system may come later)
- Types are open strings discovered from folders, not a fixed enum
- One vault for whole life; tags separate domains, not repos
- FastAPI + React/TS (over Python-only server-rendered)
- Local multilingual embeddings via fastembed; hybrid FTS + vector search with RRF
- Tailscale as the entire auth story
- No offline mode, no image understanding, no spaced repetition, no LLM in search or digest for v1
