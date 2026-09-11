# Commonplace implementation plan

Date: 2026-09-11
Status: archived on 2026-09-11. The partial Python prototype was removed at the user's request after the hosted app was deployed. These phase files describe the retired filesystem-first approach; their source paths are historical. Follow the [hosted architecture](../2026-09-11-hosted-commonplace-design.md) and [implementation progress](../hosted-progress.md) for current work.

Based on [the design](../../superpowers/specs/2026-08-27-commonplace-book-design.md).

**Goal:** Build a personal markdown archive with quick capture, reliable retrieval, browsing and resurfacing, accessible from the CLI, Codex, Claude, and a phone.

**Architecture:** A single Python core reads and writes the vault and maintains a rebuildable SQLite index. CLI, MCP and HTTP adapters share that core; React consumes the HTTP API. The app repository and private content vault are separate repositories.

**Stack:** uv, Python, Typer, SQLite FTS5, sqlite-vec, FastEmbed, MCP Python SDK, FastAPI, Vite, React, TypeScript, TanStack Query, Tailwind, CodeMirror 6.

## How to work through this plan

Use the executing-plans skill when implementation begins. Work through the phase files in order and record the commands and results at each checkpoint. The checkboxes below represent future work, not completed work. Paths in task descriptions are relative to the repository root. Later phases define deliverables and interfaces; expand their implementation details against the completed core and locked library versions before coding them.

## Global constraints

- Markdown files are the single source of truth; the index lives outside the vault and is always rebuildable.
- Entry types are open strings discovered from folders. Preserve unknown frontmatter fields.
- Local multilingual embeddings; hybrid FTS + vector search with RRF. No LLM in search or digest.
- All application writes use one vault writer; the watcher reconciles external writes.
- Codex and Claude share one MCP interface. Local stdio MCP works with the web server stopped.
- Atomic entry writes, malformed-file reporting, no bulk deletion.
- Tailscale is the security boundary; no user accounts.
- No offline capture, image understanding, spaced repetition or task management in v1.
- Test core behaviour with real temporary files and SQLite, Hypothesis for round trips, and dependency substitutes only where useful. API coverage uses TestClient; frontend tests target logic and important interactions.
- Use uv, fully annotated Python, Hatchling packaging, Ruff and strict Pyright. Resolve type failures at their source with the fixing-type-errors skill; `# type: ignore` is not the fix.

## Proposed defaults to make the design implementable

These resolve omissions or inconsistencies in the design and should be carried into it as implementation establishes them.

1. **Types:** Store the folder name, such as `ideas`, in frontmatter and the index. Accept the spec's singular starter names (`idea`, `quote`, etc.) as explicit input aliases. Do not singularise arbitrary custom types. The sample `type: idea` currently conflicts with the folder-name rule.
2. **Identity:** Filename stems are unique across the whole vault. The writer allocates a numeric suffix on collisions. Editing a title preserves the filename. Moving to another type preserves the stem. External duplicate stems are reported as ambiguous instead of resolving arbitrarily; an external rename can leave a ghost link. An automated rename-and-rewrite operation is outside the initial slice.
3. **Writes:** Use a per-vault interprocess writer lock and content-hash checks for edits. SQLite transactions serialize index updates. These protect cooperating application processes; arbitrary external editors still require watcher reconciliation and Git recovery. A file saved successfully but not indexed returns a result that explicitly says it was saved and needs reindexing.
4. **Freshness:** The server watches continuously. Standalone CLI and MCP operations reconcile changed files before index-backed reads, so direct file edits are discoverable even without `cb serve`.
5. **Sync:** Begin with documented, explicit Git commit/pull/push. Do not build automatic conflict resolution into capture. Never overwrite a conflicted file from the app; report it as a problem.
6. **Digest:** Persist each day's selection as well as resurfacing history, so recording a view cannot change the next request's selection. Use a configured timezone. One server supplies the shared web/phone digest; independent clones have local rotation history and may differ. If identical digests from local MCP on every machine are required, a shared-state mechanism is an additional design decision.
7. **Versions:** Start by evaluating Python 3.12 with uv on this Mac. Set dependency floors to versions actually verified and retain lockfiles. Choose the embedding model only after a multilingual retrieval smoke test and resource measurements.

## Phases and progress

| Phase | Plan | Usable result | Checkpoint |
|---|---|---|---|
| 1 | [Core and CLI](01-core-and-cli.md) | Capture and search from the terminal | Core/CLI tests, real embeddings smoke, lint and types |
| 2 | [Papers](02-papers.md) | Existing and new arxiv notes join the book | Import and subsequent-write compatibility tests |
| 3 | [MCP](03-mcp.md) | Both agents use the same archive | Protocol tests and a recorded session in each client |
| 4 | [Web](04-web.md) | Browse, capture, edit and search visually | API tests, frontend tests/build and browser walkthrough |
| 5 | [Memory](05-memory.md) | Digest, related entries, graphs and reading shelves | Rotation invariants and cross-surface behaviour |
| 6 | [Phone and deployment](06-phone-and-deployment.md) | Installable phone capture over the tailnet | Real-device capture and a clean recovery rehearsal |

- [ ] Phase 1: Core and CLI
- [ ] Phase 2: Papers
- [ ] Phase 3: MCP
- [ ] Phase 4: Web
- [ ] Phase 5: Memory
- [ ] Phase 6: Phone and deployment

Phase 3 depends on phase 1, not on the paper migration. If the existing arxiv writer needs additional work, continue with MCP while that migration is unresolved.

## Shared contracts

Define these in `src/commonplace/core/models.py`, validated at the boundary. Keep filesystem paths internal and expose vault-relative paths to clients.

| Contract | Fields / behaviour |
|---|---|
| `Settings` | `vault_path: Path`, `index_path: Path`, `embedding_model: str`, `timezone: str`; same configuration for every surface |
| `EntryDraft` | `title: str`, `type: str`, `body: str`, `tags: list[str]`, `created: datetime`, `source: str \| None`, `metadata: dict[str, JsonValue]` |
| `Entry` | Draft fields plus `slug: str`, `path: str`, `content_hash: str`; metadata includes type-specific fields |
| `WriteResult` | `entry: Entry`, `indexed: bool`, `problem: str \| None`; communicates partial indexing failure without prompting duplicate capture |
| `SearchQuery` | `text: str`, optional type/tag/date filters, `limit: int`; validate limits and define tag matching as all selected tags |
| `SearchHit` | `entry: Entry`, `excerpt: str`, `score: float`; one hit per entry, including its best relevant chunk |
| `Problem` | `path: str`, `code: str`, `message: str`; malformed content, ambiguous identities, conflicts and index failures |

`JsonValue` is Pydantic's recursive JSON value type. Preserve ordinary YAML metadata semantically; normalize supported YAML dates into explicit string representations at the boundary. Known fields get specific validation. Parsing must not invent changing timestamps on each rebuild.

The application service in `src/commonplace/core/service.py` owns these typed operations:

```text
create_entry(draft: EntryDraft, requested_slug: str | None = None) -> WriteResult
get_entry(slug: str) -> Entry
update_entry(slug: str, draft: EntryDraft, expected_hash: str) -> WriteResult
delete_entry(slug: str, expected_hash: str) -> None
add_link(source: str, target: str, expected_hash: str) -> WriteResult
search(query: SearchQuery) -> list[SearchHit]
recent(limit: int) -> list[Entry]
problems() -> list[Problem]
reindex(re_embed: bool = False) -> list[Problem]
```

Validation, missing entry and edit conflict errors have distinct domain exceptions, mapped to the CLI, MCP and HTTP conventions in the adapters. `requested_slug` supports importing identities and writing a ghost's target: validate it as a filename stem and reject collisions instead of suffixing an explicitly requested identity. `add_link` permits a missing target and does not duplicate an existing link. Full-draft edits preserve metadata that the caller has not intentionally changed.

## Documentation checks

Consulted on 2026-09-11; recheck version-specific APIs during their phase.

- uv separates runtime dependencies from development dependency groups. Use `uv add` to establish verified version bounds and lock resolution. [uv dependency documentation](https://docs.astral.sh/uv/concepts/projects/dependencies/)
- FastEmbed provides local text embeddings and multilingual model choices. Verify the selected model's query/passage conventions and token limit before implementing chunking. [FastEmbed documentation](https://qdrant.github.io/fastembed/)
- sqlite-vec loads into an SQLite connection; macOS's bundled SQLite can lack extension support. Test the actual uv-selected runtime first. [sqlite-vec Python documentation](https://alexgarcia.xyz/sqlite-vec/python.html)
- The MCP SDK currently documents v2 as stable, with changed APIs from v1. Use the installed version's documentation instead of copying old FastMCP examples. [Official Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- FastAPI's lifespan context owns startup and shutdown resources. [FastAPI lifespan documentation](https://fastapi.tiangolo.com/advanced/events/)
- Check the selected Vite release's Node requirement before scaffolding React/TypeScript. [Vite guide](https://vite.dev/guide/)
- Tailscale Serve exposes a local service inside the tailnet and supports HTTPS for the phone URL. [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve)
