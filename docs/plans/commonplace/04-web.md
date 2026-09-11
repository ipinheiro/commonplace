# Phase 4: Build the book interface

Part of [the implementation plan](00-overview.md).

**Goal:** A warm, readable interface for capture, browsing, editing and search, including attachments.

## Task 4.1: Establish the visual specification

**Files:** `docs/design/web-visual-spec.md`, `docs/design/mockups/`.

**Interfaces:** Stream, quote entry with backlinks, and mobile capture mockups define typography, spacing, themes, type treatments and responsive behaviour for the React implementation.

- [ ] Run the design pass described in the spec. Claude Design is the named design tool, independent of runtime agent compatibility; if unavailable, record an equivalent visual workflow before implementation.
- [ ] Refine the three screens visually, including empty states, save progress/errors, custom entry types and long content. Keep graph/editor interaction design for working code.
- [ ] Record selected visual decisions and assets as a reviewable specification.

## Task 4.2: Expose the core over HTTP and handle assets

**Files:** `src/commonplace/api/app.py`, `src/commonplace/api/dependencies.py`, `src/commonplace/api/entries.py`, `src/commonplace/api/search.py`, `src/commonplace/api/assets.py`, `src/commonplace/core/assets.py`, `src/commonplace/cli/app.py`, `tests/api/test_entries.py`, `tests/api/test_assets.py`, `tests/api/test_lifespan.py`.

**Interfaces:** `create_app(settings: Settings) -> FastAPI`; `/api/entries` for create/list; `/api/entries/{slug}` for get/update/delete; `/api/search`, `/api/tags`, `/api/types`, `/api/problems`, `/api/entries/{slug}/backlinks`, and `/api/assets`. Use typed request/response models and shared service methods. Updates/deletes require an expected hash; conflicts return HTTP 409. Lists use bounded pagination with stable ordering.

- [ ] Add FastAPI and the ASGI server. Lifespan owns the service and watcher, shuts them down cleanly, and reconciles files at startup. Keep blocking embedding work off the event loop. [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/)
- [ ] Add collision-safe uploads to `assets/YYYY/MM/`, with bounded sizes and paths constrained to the vault. The response contains a vault-relative asset path; core composes the relative Markdown link from the entry's actual folder.
- [ ] Serve attachments and render Markdown with safe URL/HTML handling. Enforce same-origin mutation requests and expected host/origin configuration while retaining network-level authentication.
- [ ] Test the HTTP-to-file-to-search round trip, stale edits, malformed files, image paths, upload failures, deletion, and watcher shutdown using real core dependencies in TestClient.

## Task 4.3: Implement stream, capture, entry and search

**Files:** `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts`, `frontend/src/api.ts`, `frontend/src/App.tsx`, `frontend/src/styles.css`, `frontend/src/views/Stream.tsx`, `frontend/src/views/Entry.tsx`, `frontend/src/views/Search.tsx`, `frontend/src/components/Capture.tsx`, `frontend/src/components/EntryEditor.tsx`.

**Interfaces:** TypeScript types follow the API schemas; TanStack Query owns remote state. Entry links use stable slugs. The editor sends the content hash loaded with the entry and retains unsaved text on conflict.

- [ ] Scaffold Vite's React/TypeScript template, select a compatible Node runtime, and lock dependencies. Add TanStack Query, Tailwind and CodeMirror 6 using their installed versions' official setup guides. [Vite scaffolding](https://vite.dev/guide/)
- [ ] Implement the visual specification, mixed-type stream, type/tag filters, generic custom types and keyboard-accessible capture. Prioritise mobile capture layout immediately.
- [ ] Render entry content, attachments, wiki-links and backlinks. Add CodeMirror editing, link autocomplete and paste-to-attach. Preserve unknown metadata through edits.
- [ ] Implement hybrid search with type/tag/date filters, useful snippets, loading and empty states. Keep entered text on failed saves and show index-repair problems where actionable.

## Task 4.4: Deliver one-process operation

**Files:** `frontend/src/components/Capture.test.tsx`, `frontend/src/components/EntryEditor.test.tsx`, `src/commonplace/api/static.py`, `tests/api/test_static.py`, `pyproject.toml`, `README.md`.

**Interfaces:** `cb serve` serves `/api`, assets and the built frontend from one port. Production frontend assets are included in the installed package; development may use a Vite proxy.

- [ ] Add frontend tests for failed-save draft retention, stale-edit handling and attachment link insertion; avoid snapshot-only or styling tests.
- [ ] Package the frontend build and test direct navigation to an entry URL. Unknown API and asset paths must return appropriate errors instead of the SPA shell.
- [ ] Walk through capture, attach, browse, edit, follow backlink and search in light/dark themes and a narrow viewport. Check keyboard focus and capture shortcut behaviour while editing.

## Checkpoint

```sh
uv run pytest tests/api --cov=commonplace
uv run ruff check .
uv run pyright
npm --prefix frontend run test -- --run
npm --prefix frontend run build
uv build
```

Verify the built package serves the frontend from a clean installation, not just the source checkout.

- [ ] Checkpoint passed and browser evidence recorded.

**Next:** [Memory](05-memory.md).
