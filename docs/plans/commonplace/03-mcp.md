# Phase 3: Connect Codex and Claude

Part of [the implementation plan](00-overview.md).

**Goal:** Both agents can search, retrieve, create and link entries through one local MCP server.

## Task 3.1: Add the stdio adapter

**Files:** `src/commonplace/mcp/server.py`, `src/commonplace/mcp/__main__.py`, `pyproject.toml`, `uv.lock`, `tests/mcp/test_protocol.py`.

**Interfaces:** `python -m commonplace.mcp` starts the configured server. Expose `search`, `get_entry`, `create_entry`, `add_link`, `recent`; reserve `digest` for phase 5. Inputs and outputs use the overview's service contracts and structured schema validation.

- [ ] Add and lock the official MCP SDK. Read its installed major version's server, lifespan and stdio documentation before implementing the adapter; the current upstream documentation uses v2 APIs. [Official SDK](https://github.com/modelcontextprotocol/python-sdk)
- [ ] Delegate tool operations to the same core service, with the same vault and index settings as the CLI. Keep protocol output on stdout and diagnostics on stderr.
- [ ] Return titles, stems, vault-relative paths and relevant excerpts so agents can cite actual entries. Surface validation and stale-edit errors clearly. Do not add agent-specific storage or search behaviour.

## Task 3.2: Verify actual protocol behaviour

**Files:** `tests/mcp/test_protocol.py`, `tests/mcp/test_concurrent_clients.py`.

**Interfaces:** A subprocess running the stdio entry point is driven by the official SDK client against an isolated vault.

- [ ] Verify initialization, tool discovery and schema validity, create/get/search, repeated add-link, missing target links and invalid arguments.
- [ ] Stop the HTTP server, edit a file directly, and verify that the MCP search discovers the change.
- [ ] Run two clients creating entries with the same title and verify separate files and consistent results. Confirm protocol stdout is clean.

## Task 3.3: Document and exercise both clients

**Files:** `docs/agent-setup.md`, `README.md`.

**Interfaces:** Document client-specific launch/configuration settings pointing to the same executable and vault. State the exact Codex and Claude clients and versions tested; cloud sessions without local filesystem/stdio access are not covered by this local transport.

- [ ] Check installed client help and current official setup documentation when writing the concrete configuration. Use the openai-docs skill for Codex setup details.
- [ ] In a real Codex session and a real Claude session, search for a fixture, retrieve it, create a sourced entry and add a link. Confirm both entries appear in CLI search.
- [ ] Record required configuration, the local-file fallback and troubleshooting. If one client is unavailable, report its manual acceptance check as outstanding rather than infer compatibility from protocol tests.

## Checkpoint

```sh
uv run pytest tests/mcp --cov=commonplace
uv run ruff check .
uv run pyright
```

Record both real-client walkthroughs in `docs/agent-setup.md`.

- [ ] Checkpoint passed and evidence recorded for both clients.

**Next:** [Web](04-web.md).
