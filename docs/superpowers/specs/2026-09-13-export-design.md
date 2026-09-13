# Export - design

Date: 2026-09-13
Status: approved design, not yet implemented. First of four pieces agreed on 2026-09-13: export, delete, links and backlinks, agent access. Restore is a separate later piece.

## Why

Saved entries and image bytes live only in the hosted Supabase project. The free plan has no downloadable backups, and the [hosted design](../../plans/2026-09-11-hosted-commonplace-design.md) asks for a portable export so the data can outlive the provider. Nothing implements that today.

## What it is

A script that runs on your own computer, signs in as you, and writes every entry and every image to a folder. It needs no change to the app, the database or the API. It does not restore anything; restore gets its own design once this exists.

## Decisions

- **Runs locally, not in the app.** A Bun package script at `frontend/scripts/export.ts`, run as `bun run --cwd frontend export`, following the existing connection check. A browser download of many images is fragile and phone storage is awkward. It is TypeScript, run natively by Node 24, so it can reuse the app's domain schemas.
- **JSON, not Markdown.** Each entry file is the API response exactly as the app receives it. Immune to frontmatter parsing edge cases and trivially restorable. Readability is not the goal of this piece.
- **Export only.** A faithful restore into a fresh project has to deal with a new owner ID, re-uploaded image paths and the stamp trigger overwriting creation timestamps. Those are restore questions and are deferred.

## Output

Default folder `export/` at the repository root, ignored by Git. The default is resolved from the script's own location, not the shell's working directory, so it lands in the same place however the command is invoked. An `--out <dir>` flag overrides it and is resolved from the shell's working directory, so the folder can be a private Git repository anywhere on disk.

```
export/
  manifest.json                 exported_at, format version, entry and image counts
  entries/<entry-id>.json       one entry, as returned by the list function
  images/<owner>/<entry>/<id>   raw bytes, path identical to the storage path in the entry's metadata
```

Entry filenames are entry IDs, so repeated runs overwrite in place and a Git repository of the folder shows real diffs. Image paths mirror storage so the references inside each entry stay valid without rewriting. Original filenames are already inside each entry's image metadata.

Entry files from a previous run that were not seen in this run are removed, so the folder mirrors the book once delete exists. Image files are never removed.

A run that returns no entries never removes files; if the folder already held entries, the run reports it and exits non-zero.

## Credentials

The Supabase URL and publishable key come from `frontend/.env.local`, read the same way the connection check reads it. Email and password come from `COMMONPLACE_EMAIL` and `COMMONPLACE_PASSWORD` for scheduled runs. When either is absent the script prompts on the terminal, with password input hidden. Nothing about the session or password is written to disk. The script signs out locally when it finishes.

## Flow

1. Sign in with email and password using the Supabase JS client, which is already a dependency.
2. For each space, `personal` then `work`, call the `list_entries` function with a limit of 100 and follow `next_cursor` until it is null, passing `entry_date`, `created_at` and `id` back exactly as the app does. Write each entry as it arrives.
3. Collect every image path from each entry's `metadata.images`. Skip any file already on disk, since storage paths are immutable. Download the rest through the storage client and write the bytes.
4. Remove stale entry files. Write the manifest. Print a summary: entries per space, images downloaded, images skipped, failures.
5. Exit non-zero if any download or write failed, after finishing everything else, so one bad image does not hide the rest of the backup.

The script talks to the Supabase client directly rather than importing the app's data module, because that module reads Vite environment variables that do not exist under Node.

## Errors

- Missing URL or key: stop before signing in with a clear message.
- Sign-in failure: stop with a message that does not echo the email or password.
- A list call failure: stop. A partial entry set with a fresh manifest would be misleading.
- An image download failure: record it, continue, report at the end, exit non-zero.
- The output folder is created if absent. Images are downloaded to a `.part` file and renamed on success, so an interrupted download is never mistaken for a finished one. Entry files are written directly; the next run overwrites them.

## Testing

Vitest tests in `frontend/tests/` against a fake client object with `auth`, `rpc` and `storage` surfaces. They cover:

- Paging: every page's cursor is passed back correctly, both spaces are walked, and the loop ends when the cursor is null.
- Layout: entry files, image paths and manifest counts match the fixtures.
- Skipping: an image already on disk is not downloaded.
- Stale removal: an entry file from a previous run that is absent from this run is removed, and image files are untouched.
- Failure reporting: one failed image download leaves every other file written and produces a non-zero exit.

One manual run against the production project, recorded in the setup guide, confirms the real client behaves like the fake.

## Documentation

- README: current limits no longer say export is unimplemented; the verify section lists the export command.
- Hosted setup guide: a new section describing the command, the two credential environment variables, the output layout, and the fact that restore is not yet implemented.
- `.gitignore`: add `export/`.

## Out of scope

Restore, incremental export by version, exporting soft-deleted entries, Markdown rendering, a UI button, scheduling. Scheduling is a user choice layered on top: a cron or GitHub Action calling the script with the two environment variables.
