# Phase 1: Core and CLI

Part of [the implementation plan](00-overview.md).

**Goal:** Capture, edit externally, search by words or meaning, and recover the index without losing content.

## Task 1.1: Establish the package and runtime

**Files:** `pyproject.toml`, `uv.lock`, `.python-version`, `.gitignore`, `src/commonplace/__init__.py`, `src/commonplace/core/config.py`, `src/commonplace/core/models.py`, `src/commonplace/cli/app.py`, `tests/conftest.py`, `tests/core/test_runtime.py`.

**Interfaces:** Consume the overview contracts; produce `Settings`, the entry/query/result models, and the `cb` executable. Configuration precedence: CLI overrides, environment, user config, defaults. Require an explicit vault location on first use. Put the index and writer lock outside the content repository and isolate them per vault.

- [ ] Scaffold one Python package using Hatchling and a `src/` layout. Configure `[project.scripts]` with `cb = "commonplace.cli.app:app"`, Python 3.12 initially, Ruff and strict Pyright.
- [ ] Resolve core dependencies using uv: Typer, Pydantic, a safe YAML parser, a Markdown parser, a file watcher, an interprocess lock library, FastEmbed and sqlite-vec. Use dev groups for pytest, pytest-cov, Hypothesis, Ruff and Pyright. Record the verified lower bounds and lockfile.
- [ ] Add a runtime test that opens a temporary SQLite database, creates an FTS5 table, loads sqlite-vec, inserts a vector and retrieves it. This decides whether the chosen Python build is suitable before building on it.
- [ ] Create shared temporary-vault fixtures and settings; keep model downloads and all personal content outside fixtures and the app repo.

## Task 1.2: Read and write durable entries

**Files:** `src/commonplace/core/vault.py`, `src/commonplace/core/links.py`, `src/commonplace/core/errors.py`, `tests/core/test_vault.py`, `tests/core/test_links.py`.

**Interfaces:** `parse_entry(path: Path, vault_path: Path) -> Entry`; `render_entry(draft: EntryDraft) -> str`; writer operations feed `WriteResult` through the service. Link extraction produces target stems and retains unresolved targets.

- [ ] Implement safe frontmatter parsing, required-field validation, unknown metadata preservation, folder discovery and starter type aliases. Exclude `assets`, hidden tool directories and Git metadata from entry discovery.
- [ ] Generate globally unique date-prefixed stems under the writer lock; validate and reserve an explicit `requested_slug` without changing it on collision. Write to a temporary file in the destination directory and atomically rename it. Validate that types and paths cannot escape the vault. Title edits retain identity; expected-hash checks reject stale edits. Type moves preserve identity and adjust relative asset links when directory depth changes.
- [ ] Parse wiki-links outside inline/fenced code. Define aliases and heading targets explicitly; expose unresolved references. Preserve Markdown bodies, non-English text and ordinary relative attachment links.
- [ ] Verify semantic parse/write round trips under Hypothesis, same-title captures, concurrent cooperating writers, retained extra metadata, stale edits and interrupted writes. Do not test YAML formatting identity unless the writer explicitly promises it.

## Task 1.3: Build the disposable index and hybrid search

**Files:** `src/commonplace/core/index.py`, `src/commonplace/core/embeddings.py`, `src/commonplace/core/search.py`, `src/commonplace/core/watcher.py`, `tests/core/test_index.py`, `tests/core/test_search.py`, `tests/core/test_embeddings_smoke.py`.

**Interfaces:** The index consumes `Entry` and produces searchable rows, links and problems. The embedding adapter provides `embed_documents(texts: list[str]) -> list[list[float]]` and `embed_query(text: str) -> list[float]`; the search layer consumes `SearchQuery` and returns `list[SearchHit]`.

- [ ] Add schema/version handling, entries, tags, links, FTS, chunks, vectors and problems. Use content hashes to skip unchanged work. Reconcile removals and malformed replacements without leaving stale searchable content. Full rebuilds operate on derived tables and preserve future digest state tables.
- [ ] Build heading/paragraph chunks within the chosen model's token limit, retaining source offsets for excerpts. Record model identity, dimensions and chunking version; a configuration mismatch requires re-embedding before vector search. Never mix incompatible embeddings.
- [ ] Choose a multilingual model from FastEmbed's supported list using a small synthetic English/Portuguese retrieval set; record resource use and cold/warm capture latency. Cache model weights locally. Use real embeddings in a separately marked smoke test and deterministic embeddings in routine index tests.
- [ ] Merge BM25 and vector rankings with RRF, with stable tie-breaking and one hit per entry. Apply filters to candidate retrieval so filtering after a small top-k cannot starve results. Escape ordinary search text appropriately for FTS.
- [ ] Verify that create/edit/delete/malformed-file sequences produce the same searchable state incrementally and from scratch. Include stale chunk removal, unresolved-to-resolved links and a model swap. The watcher debounces partial external writes and has a full reconciliation recovery path.

## Task 1.4: Deliver the service and usable commands

**Files:** `src/commonplace/core/service.py`, `src/commonplace/cli/app.py`, `tests/cli/test_capture_search.py`, `tests/core/test_service.py`, `README.md`.

**Interfaces:** Implement the overview service methods. Expose a global `--vault` option and `add`, `search`, `recent`, `open`, `reindex`, `problems`; add `digest` and `serve` in their later phases.

- [ ] Route all commands through the service. Support positional capture text, `--from`, `--tags`, and `$EDITOR` templates when text is omitted. For a capture without a title, derive a bounded title from the first non-empty line; allow `--title` to override it.
- [ ] Update the index synchronously after a successful application write. Distinguish "file saved, index needs repair" from a failed capture. When embeddings are unavailable, preserve capture and clearly report text-only search until repaired.
- [ ] Reconcile external changes before standalone index reads. Define timeout/error behaviour when another process holds the writer lock. Avoid holding a database transaction during model downloads or long inference.
- [ ] Document configuring a separate vault, manual Git sync, model setup and `cb reindex` recovery. Demonstrate search after directly editing an entry with the web server absent.

## Checkpoint

Run from the repository root after the files exist:

```sh
uv run ruff check .
uv run pyright
uv run pytest tests/core tests/cli --cov=commonplace -m 'not embeddings'
uv run pytest tests/core/test_embeddings_smoke.py -m embeddings
uv run cb --help
```

Register the `embeddings` marker. Record a temporary-vault walkthrough: capture a quote, retrieve it by exact words and a paraphrase, edit its file, retrieve the change, rebuild, and retrieve it again. Measure warm capture latency; investigate visible delays before calling quick capture usable.

- [ ] Checkpoint passed and evidence recorded.

**Next:** [Papers](02-papers.md), or [MCP](03-mcp.md) if migration inputs are unavailable.
