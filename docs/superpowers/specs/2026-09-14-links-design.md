# Links and backlinks - design

Date: 2026-09-14
Status: implemented on 2026-09-14.

## Why

The book can store and find entries but cannot connect them. The [original design](2026-08-27-commonplace-book-design.md) put wiki-links, backlinks and ghosts at the centre of "memory", and the [hosted design](../../plans/2026-09-11-hosted-commonplace-design.md) sketched an `entry_links` table and a `[[UUID|label]]` body syntax but left the exact syntax to be decided before shipping. This spec decides it.

## What it is

A link is written inside an entry's Markdown body. The database extracts links on every save into an edge table, and a new read function returns an entry's connections: what it links to, what links to it, and which links point at nothing yet. The reader renders body links as in-app links, lists backlinks below the entry, and lets a ghost link become a new entry in one press. The editor offers a picker when `[[` is typed.

No new service. Links are one table with two foreign keys in the existing PostgreSQL database. Backlinks, outgoing links and ghosts are each one join. A local graph, if ever wanted, is a recursive query over the same table.

## Decisions

- **Two body forms.** `[[id|Title]]` is what the picker writes; the ID is the entry's UUID and the title is a label kept for readability outside the app. `[[Some title]]` can be typed by hand. Both are ignored inside fenced and inline code.
- **IDs are the truth, titles are rendered live.** An ID link renders the target's current title, so renaming never goes stale. The label inside the brackets is not updated in the body; it is only what the export and other tools see.
- **Title links resolve at read time.** A `[[Some title]]` link matches an entry in the same space whose title equals it, case-insensitive and whitespace-trimmed. If several match, the oldest wins. If none match, it is a ghost. Nothing is rewritten when an entry with that title later appears; the link simply starts resolving.
- **Links stay within a space.** The picker lists the current space only. Backlinks and title resolution only consider entries whose space matches the source's. Moving an entry to the other space hides its connections rather than breaking them; moving it back restores them.
- **Parsed in the database.** `api.save_entry` parses the body and rewrites the source's link rows in the same transaction, so rows can never disagree with the text. Any later writer, including an agent through MCP, gets links without knowing the syntax.
- **Cross-owner targets become ghosts, silently.** An ID that belongs to another user, or to nothing, is stored as a ghost with the label as its title. Row-level security makes the foreign key unresolvable for the caller anyway; the save must not fail because of it.
- **Deleted entries fall out through the tombstone.** A link to a deleted target renders as a ghost with its label. A deleted source contributes no backlinks. No rows are removed on delete; the reads filter on `deleted_at is null` like everything else.
- **No graph database.** See "What it is". Revisit only if a query cannot be expressed as a few joins.

## Syntax

```
[[8f3c…-uuid|Winter scarf notes]]   ID link, written by the picker
[[Winter scarf notes]]              title link, typed by hand; ghost until an entry has that title
```

Grammar, applied outside code:

- Opens with `[[`, closes with the first `]]`.
- Inside: optional UUID, then optional `|`, then label. A UUID is recognised by shape; anything else before `|` is part of the title.
- Empty brackets, or a label that is only whitespace, are not links.
- Newlines are not allowed inside a link.
- A link whose ID is the entry's own ID, or whose title equals the entry's own title, is dropped at parse time.

Code exclusion: fenced blocks delimited by three or more backticks or tildes, and inline code delimited by matching backtick runs, are blanked before matching. Only the order of links matters, so code is simply removed before matching. Tilde fences are not recognised.

## Data

```sql
create table app.entry_links (
    owner_id uuid not null references auth.users(id),
    source_id uuid not null,
    target_id uuid,
    ghost_title text,
    position integer not null,
    foreign key (owner_id, source_id) references app.entries(owner_id, id),
    foreign key (owner_id, target_id) references app.entries(owner_id, id),
    check ((target_id is null) <> (ghost_title is null)),
    check (ghost_title is null or length(btrim(ghost_title)) between 1 and 300)
);
```

- `position` is the order of first appearance in the body, so outgoing links list in reading order.
- One row per distinct target or ghost title per source. Repeats in the body collapse to the first occurrence. Enforced by a unique index on `(owner_id, source_id, target_id)` and a unique expression index on `(owner_id, source_id, lower(btrim(ghost_title)))`.
- Both foreign keys are owner-aware, matching the existing `unique (owner_id, id)` on entries, so a row cannot join two owners' entries.
- Indexes on `(owner_id, target_id)` for backlinks and `(owner_id, lower(btrim(ghost_title)))` for title resolution.
- Row-level security and grants mirror `app.entries`: owner only, `authenticated` may select, insert and delete. The API functions are the only writers.

`app.save_entry` after writing the entry: delete the source's rows, parse the saved body, insert the new rows. Targets are validated with a single query against the owner's entries; anything not found becomes a ghost row. The mutation receipt covers the whole transaction as today, so a retried save neither duplicates nor drops rows.

## API

One new function, returning everything the reader needs in one call:

```
api.entry_connections(p_entry_id uuid) returns jsonb
{
  "links":     [{ "id", "title", "kind" }],          outgoing, resolved, in body order
  "backlinks": [{ "id", "title", "kind", "entry_date" }],  entries in the same space linking here, newest first
  "ghosts":    [ "title", … ]                         outgoing links that resolve to nothing, in body order
}
```

- `links` resolves ID rows whose target is live and in the same space, and title rows that match a live same-space entry.
- `backlinks` unions ID rows targeting this entry and title rows equal to this entry's title, from live sources in the same space, excluding the entry itself.
- `ghosts` is the remainder: title rows with no match, plus ID rows whose target is deleted, missing or in the other space, using the stored label.
- Missing or deleted entry: `PT404`, as `get_entry`.
- `get_entry`, `list_entries` and their payloads do not change.

## Editor

The body stays a textarea. When the caret is directly after `[[` with no closing `]]` on the same line, a list appears anchored below the textarea, filtered by the text typed after `[[`. Results come from the existing `list_entries` search in the current space, limited to the first page, debounced like the main search. Choosing an entry with Enter, Tab or a press replaces the partial text with `[[id|Title]]` and closes the list. Escape closes it; typing `]]` closes it and leaves whatever was typed as a title link. Arrow keys move through the list. A `textarea` cannot take the `combobox` role, so the list is a labelled `listbox` beneath it and a polite status line announces how many entries match.

The preview renders links exactly as the reader does, so what you see is what will save. The preview cannot know live titles for ID links until they are saved, so it shows the label from the brackets.

## Reader

Body rendering runs one transform before Markdown: each link outside code becomes a standard Markdown link. A resolved link becomes `[Current title](#entry/<id>)`. A ghost becomes `[label](#ghost/<encoded label>)`. `react-markdown` receives a custom anchor component that renders `#entry/` targets as ordinary in-app links, and `#ghost/` targets as a dotted button that opens the capture editor with the title filled in and the current space and no kind preselected. Every other link keeps the existing behaviour.

Below the context details, when `backlinks` is non-empty, a "Linked from" section lists each backlink with its type label, date and title, in the same list style as the library. It is absent when empty. No "Links to" section: the outgoing links are already visible in the text.

Connections are fetched with a query keyed by entry ID and refreshed after any save or delete, alongside the existing invalidations.

## Export

No change. Bodies already contain the link text, entry filenames already are IDs, and the labels keep title links readable outside the app.

## Testing

Database, in the existing embedded PostgreSQL suite:

- Parsing: ID form, title form, repeats collapse, links inside fenced and inline code are ignored, empty brackets are not links, order follows the body.
- Ownership: an ID owned by another user becomes a ghost and the save succeeds.
- Rename: retitling the target keeps an ID link resolved and the rendered title follows.
- Title resolution: a hand-typed title link starts resolving once an entry with that title exists in the same space; case and surrounding whitespace do not matter; the other space does not count.
- Delete: deleting the target turns the link into a ghost; deleting the source removes the backlink.
- Space: a backlink from the other space is not listed.
- Receipt: a retried save leaves exactly one row per link.

UI, in the existing jsdom suite:

- Typing `[[` opens the picker, choosing inserts `[[id|Title]]`, Escape closes.
- A rendered link navigates to the entry; a ghost opens the editor with the title filled in.
- "Linked from" appears only when there are backlinks.

Browser: one test that the picker is usable at the phone viewport.

## Documentation

- README: the features list mentions links and backlinks; the current limits no longer say links are missing.
- Hosted setup guide: the new migration is applied to both Supabase projects, following the existing rule that every migration file is applied in order.
- Progress doc: one line when shipped.

## Out of scope

A graph view, a "Links to" panel, unlinked mentions, rewriting labels in bodies when titles change, link autocomplete for tags or images, cross-space links, links from an entry to itself, and a richer editor than a textarea with a list. Agent access is the next piece and will call `save_entry` and `entry_connections` as they are.
