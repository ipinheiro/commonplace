# Phase 5: Resurface and connect

Part of [the implementation plan](00-overview.md).

**Goal:** Old entries return usefully; connections and reading progress become browsable.

## Task 5.1: Build stable daily selections

**Files:** `src/commonplace/core/digest.py`, `src/commonplace/core/index.py`, `tests/core/test_digest.py`.

**Interfaces:** `DigestItem` contains `kind`, `entry_slug: str | None`, `target_slug: str | None`, and `reason`; `DailyDigest` contains `day: date` and `items: list[DigestItem]`. `digest(day: date) -> DailyDigest` is exposed through the service. A ghost has a target stem without an invented entry.

- [ ] Add separate state tables for dated selections and last-surfaced/last-opened timestamps; preserve them across normal reindexing. A deleted database loses rotation history but no content.
- [ ] Add `record_open(slug: str) -> None` to the service and call it on deliberate entry opens in each surface. Search indexing, result previews and background prefetches must not count as reading an entry.
- [ ] Select about five distinct items from anniversaries, long unseen entries, orphans and ghosts using deterministic ordering and the configured timezone. Explicitly define leap-day behaviour, empty-vault behaviour and fallback when a category is empty.
- [ ] Persist selection and surfaced timestamps in one transaction on first request; subsequent requests read the selection. Handle later deleted entries without silently rerolling the remaining day's items.
- [ ] Verify repeated and concurrent requests, next-day rotation, unseen weighting, unresolved links, timezone boundaries and reindex preservation with an injected clock. A date seed alone is insufficient once selection mutates history.

## Task 5.2: Add graph, neighbours and shelves

**Files:** `src/commonplace/core/connections.py`, `src/commonplace/core/service.py`, `src/commonplace/api/memory.py`, `tests/core/test_connections.py`, `tests/api/test_memory.py`.

**Interfaces:** `related(slug: str, limit: int) -> list[SearchHit]`; `graph(slug: str | None) -> GraphData`, where nodes distinguish entries from ghosts and edges reference stable stems; `reading(status: str | None) -> list[Entry]`. Add `/api/digest`, `/api/graph`, `/api/reading` and `/api/entries/{slug}/related`.

- [ ] Aggregate chunk neighbours to parent entries, exclude the current entry and duplicate hits, and handle entries with no usable embeddings.
- [ ] Define local graph as the current entry and its immediate incoming/outgoing neighbours with links among those nodes. Add a bounded global graph response suitable for the vault size.
- [ ] Filter books and papers into reading shelves using the specified statuses; represent missing status explicitly without rewriting files during reads.

## Task 5.3: Deliver memory across the surfaces

**Files:** `frontend/src/views/Digest.tsx`, `frontend/src/views/Graph.tsx`, `frontend/src/views/Reading.tsx`, `frontend/src/components/RelatedEntries.tsx`, `src/commonplace/cli/app.py`, `src/commonplace/mcp/server.py`, `tests/cli/test_digest.py`, `tests/mcp/test_digest.py`.

**Interfaces:** Web, `cb digest` and MCP `digest` consume `DailyDigest`; graph and reading use task 5.2's schemas. All clients sharing an index see the same persisted daily selection.

- [ ] Add the stream strip and digest page, entry neighbours while reading/editing, local/global force-directed graphs coloured by type, and reading shelves.
- [ ] Make ghosts useful prompts with a capture action prefilled for the target identity. The writer validates that the proposed target is still absent.
- [ ] Verify digest results through CLI, HTTP and MCP using the same index; exercise the new tool in both Codex and Claude. Document that independent clones can have different rotation history.

## Checkpoint

```sh
uv run pytest tests/core/test_digest.py tests/core/test_connections.py tests/api/test_memory.py tests/cli/test_digest.py tests/mcp/test_digest.py --cov=commonplace
uv run ruff check .
uv run pyright
npm --prefix frontend run test -- --run
npm --prefix frontend run build
```

Manually verify related entries, local/global graph navigation, reading status changes and ghost capture.

- [ ] Checkpoint passed and evidence recorded.

**Next:** [Phone and deployment](06-phone-and-deployment.md).
