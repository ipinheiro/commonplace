# Hosted Commonplace decision log

## 2026-09-11 — User changes the architectural direction

**Context:** The original design made Markdown files authoritative and a local SQLite index disposable. An unfinished core/CLI implementation was underway.

**Options considered:** Continue file authority with hosted synchronization; make a shared cloud database authoritative.

**Decision:** The user requests a private online-first web/PWA app backed by shared PostgreSQL, preferably Supabase. Pause implementation and review the architecture before a large rewrite. This direction is confirmed; the detailed design remains proposed.

**Consequences:** Filename identity, Git-based device sync, local file locks and Tailscale-only authentication no longer define the product. Preserve the current implementation for review and possible import/export reuse.

## 2026-09-11 — Fresh infrastructure setup confirmed

**Context:** No deployment configuration or hosted backend exists in the repository.

**Options considered:** Reuse an existing Supabase/hosting project; propose a fresh setup.

**Decision:** The user explicitly confirmed a fresh setup.

**Consequences:** No existing provider settings, account configuration, region or deployment need to be preserved. This does not itself select a paid plan or provision infrastructure.

## 2026-09-11 — Recommend a provider-backed web app and a contained data module

**Context:** There is no existing web frontend or Python HTTP backend to migrate. A separate backend is optional for the initial CRUD use case.

**Options considered:** React plus FastAPI plus hosted PostgreSQL; React plus Supabase's authenticated API, Auth and Storage.

**Proposed decision:** Start with React and a small application data-access module backed by Supabase. Use PostgreSQL functions for atomic mutations, private application tables, and owner-based access policies. Keep Python available for optional local import/export and future batch work.

**Consequences:** One frontend deployment and one hosted data platform establish multi-device access. Provider-specific authentication/storage still require deliberate migration if the backend changes; hiding SDK calls does not make the entire system provider-independent.

## 2026-09-11 — Recommend stable identity and safe online editing before offline work

**Context:** Multiple devices can edit the same entry, and a network retry can follow an uncertain save outcome.

**Options considered:** Last-write-wins and device timestamps; UUIDs, server revision checks and idempotent writes; complete offline sync now.

**Proposed decision:** UUID identities, server timestamps, atomic expected-version checks, request identities and deletion tombstones. Preserve drafts and report conflicts; defer merge engines and offline replicas.

**Consequences:** The initial online app avoids silent lost updates and duplicate capture. Future offline synchronization still needs an explicit change-feed and conflict policy design.

## 2026-09-11 — Recommend portable exports and staged migration

**Context:** Cloud records become precious, unlike the old disposable index; attachment objects are separate from database backups.

**Options considered:** Depend only on provider backups; retain exports and verify recovery including objects.

**Proposed decision:** Keep Markdown bodies, export structured metadata/IDs and attachment bytes, and rehearse restoration. Import only if actual existing content exists. Avoid dual writing and skip the former arxiv symlink migration.

**Consequences:** The data can outlive the first provider. Retiring the local prototype is safe after hosted behaviour and any real content migration are verified.
