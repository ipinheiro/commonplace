# Phase 2: Absorb the paper archive

Part of [the implementation plan](00-overview.md).

**Goal:** Bring existing papers into the vault and keep the existing arxiv writer feeding it.

## Task 2.1: Establish the actual import contract

**Files:** `docs/arxiv-import.md`, `tests/fixtures/arxiv/`, `tests/imports/test_arxiv.py`.

**Interfaces:** Existing arxiv files and writer behaviour produce a documented mapping to `EntryDraft`, including `arxiv_id`, authors, tags, dates, source and reading status.

- [ ] Inspect the existing `~/arxiv-notes` structure and the writer's actual output format, filename rules and overwrite behaviour. Its contents have not been inspected during planning.
- [ ] Create synthetic representative fixtures, including incomplete metadata and attachments. Identify whether later writer updates can overwrite canonical frontmatter.
- [ ] Decide which compatibility parsing remains necessary after import; do not assume a symlink changes the writer's format or naming rules.

## Task 2.2: Implement repeatable import and continued ingestion

**Files:** `src/commonplace/core/imports/arxiv.py`, `src/commonplace/core/vault.py`, `src/commonplace/cli/app.py`, `tests/imports/test_arxiv.py`.

**Interfaces:** `plan_import(source: Path) -> ImportPlan` describes proposed creates, skips, conflicts and asset copies; `apply_import(plan: ImportPlan) -> ImportReport` writes through the core. Define both result models alongside the importer. CLI: `cb import arxiv SOURCE --dry-run`, followed by the same command without `--dry-run` to apply.

- [ ] Preserve provenance and tags, assign canonical stems where needed, and rewrite imported internal links/asset references using an explicit source-to-destination map.
- [ ] Make repeated import idempotent using preserved source identity and hashes. Report divergent versions rather than overwrite an edited entry.
- [ ] Implement compatibility handling for new notes and updates from the existing writer, based on task 2.1. If the writer cannot safely target canonical files, resolve that integration before switching the live path.

## Task 2.3: Verify and switch the source path

**Files:** `docs/arxiv-import.md`, `tests/imports/test_arxiv_live_writer.py`.

**Interfaces:** Verified import plus compatible subsequent writes permits the existing path to become a symlink to `papers/`. The original directory remains available as a recovery copy.

- [ ] Test import, repeat import, a newly written note, and a subsequently updated existing note in a temporary directory; compare content, metadata, links and index results.
- [ ] Run a dry run on the real archive and review counts/conflicts. Apply the import and verify content before switching paths.
- [ ] Pause the existing writer for the switch, retain the original directory under an explicit backup name, create the symlink, and verify one subsequent write. Record rollback instructions. Request filesystem escalation if needed when the real migration is executed.

## Checkpoint

```sh
uv run pytest tests/imports --cov=commonplace
uv run ruff check .
uv run pyright
```

The live switch also requires recorded evidence that the actual arxiv writer produces a searchable entry without losing metadata. Fixture tests alone do not establish that compatibility.

- [ ] Checkpoint passed and evidence recorded.

**Next:** [MCP](03-mcp.md).
