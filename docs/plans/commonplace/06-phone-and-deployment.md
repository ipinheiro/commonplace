# Phase 6: Phone access and a lasting home

Part of [the implementation plan](00-overview.md).

**Goal:** Capture from a real phone over Tailscale, and restore the application and book on another machine.

## Task 6.1: Finish installable mobile capture

**Files:** `frontend/public/manifest.webmanifest`, `frontend/public/icons/`, `frontend/src/components/Capture.tsx`, `frontend/src/styles.css`, `docs/mobile-acceptance.md`.

**Interfaces:** Installed app uses the same API and capture contracts as the browser; network availability is required for saving. Declare name, icons, start URL and display mode in the manifest.

- [ ] Verify installation requirements in the actual phone browser. Add manifest/icons and any required app-shell handling without introducing offline write queues.
- [ ] Exercise thumb-friendly type/tag selection, camera/photo attachment, keyboard opening, long text and navigation back from capture.
- [ ] On a dropped connection, retain the in-progress draft in the current view and show a retry state; do not claim it is saved until the server confirms. Test ambiguous responses so retries do not casually create duplicate entries; add a narrowly scoped capture request identifier if needed.

## Task 6.2: Run behind Tailscale

**Files:** `docs/deployment.md`, `src/commonplace/core/config.py`, `tests/api/test_deployment_config.py`.

**Interfaces:** `cb serve` binds to loopback; Tailscale Serve provides the HTTPS URL inside the tailnet. Configure the permitted host/origin and the timezone used by digest requests.

- [ ] Prepare a reproducible deployment command, installed frontend assets, persistent vault/index locations and model cache. Choose the personal machine that will host it before applying machine-specific service configuration.
- [ ] Configure Tailscale Serve for the app port and verify HTTPS access from the phone. [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve)
- [ ] Verify entry/asset access inside the intended tailnet and absence of unintended LAN/public exposure. Record startup/restart instructions. Add systemd or other service packaging only for the selected host.

## Task 6.3: Rehearse sync, backup and recovery

**Files:** `docs/deployment.md`, `docs/recovery.md`, `README.md`.

**Interfaces:** The private Git vault, installed app and configuration are sufficient to rebuild all derived content. Digest history is expendable. Embedding model weights must be available locally or downloadable during setup.

- [ ] Document explicit Git sync, conflict handling and the need to commit/push attachments as well as entries. Uncommitted content is not backed up remotely by Git alone.
- [ ] Clone the vault into a separate location, build/install the app, reindex, and verify text/semantic search, links, attachments, reading status and both local agent configurations.
- [ ] Start the restored server and capture a photo from the real phone. Confirm it can be retrieved from a computer and that restart preserves content and the current daily digest when the original index remains present.
- [ ] Record recovery evidence and operational limitations, including independent-clone digest differences and the online capture requirement.

## Checkpoint

```sh
uv run pytest --cov=commonplace -m 'not embeddings'
uv run pytest tests/core/test_embeddings_smoke.py -m embeddings
uv run ruff check .
uv run pyright
npm --prefix frontend run test -- --run
npm --prefix frontend run build
uv build
```

The automated checks supplement the real phone installation/capture check and recovery rehearsal; they do not replace them.

- [ ] Automated checks passed.
- [ ] Real phone capture and retrieval passed.
- [ ] Clean restore passed and evidence recorded.
