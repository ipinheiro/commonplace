import { access, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { cursorSchema, entryContext, entrySchema, type Space } from '../src/domain/entries.ts';

export type ExportClient = {
  listEntries(args: Record<string, unknown>): Promise<unknown>;
  downloadImage(path: string): Promise<Uint8Array>;
};

export type ExportSummary = {
  entries: Record<Space, number>;
  imagesDownloaded: number;
  imagesSkipped: number;
  removed: number;
  failures: { path: string; message: string }[];
};

const spaces: Space[] = ['personal', 'work'];
const pageSize = 100;

// Items are kept verbatim; the entry schema only checks the shape we rely on.
const rawPageSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
  next_cursor: cursorSchema.nullable(),
});

async function* listPages(client: ExportClient, space: Space) {
  let cursor: z.infer<typeof cursorSchema> | null = null;
  do {
    const page = rawPageSchema.parse(
      await client.listEntries({
        p_query: '',
        p_space: space,
        p_order: 'newest',
        p_kind: null,
        p_before_created: cursor?.created_at ?? null,
        p_before_id: cursor?.id ?? null,
        ...(cursor?.entry_date ? { p_before_date: cursor.entry_date } : {}),
        p_limit: pageSize,
      }),
    );
    yield page.items;
    cursor = page.next_cursor;
  } while (cursor);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadImages(
  client: ExportClient,
  outDir: string,
  paths: Iterable<string>,
  summary: ExportSummary,
): Promise<void> {
  for (const path of paths) {
    // Storage paths are three UUIDs, validated by imageSchema, so splitting on '/' is safe.
    const target = join(outDir, 'images', ...path.split('/'));
    if (await exists(target)) {
      summary.imagesSkipped += 1;
      continue;
    }
    try {
      const bytes = await client.downloadImage(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      summary.imagesDownloaded += 1;
    } catch (error) {
      summary.failures.push({
        path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function removeStaleEntries(entriesDir: string, seen: Set<string>): Promise<number> {
  let removed = 0;
  for (const file of await readdir(entriesDir)) {
    if (!file.endsWith('.json') || seen.has(file.slice(0, -'.json'.length))) continue;
    await rm(join(entriesDir, file));
    removed += 1;
  }
  return removed;
}

export async function exportBook(client: ExportClient, outDir: string): Promise<ExportSummary> {
  const entriesDir = join(outDir, 'entries');
  await mkdir(entriesDir, { recursive: true });
  const summary: ExportSummary = {
    entries: { personal: 0, work: 0 },
    imagesDownloaded: 0,
    imagesSkipped: 0,
    removed: 0,
    failures: [],
  };
  const seen = new Set<string>();
  const imagePaths = new Set<string>();

  for (const space of spaces) {
    for await (const items of listPages(client, space)) {
      for (const item of items) {
        const entry = entrySchema.parse(item);
        await writeFile(join(entriesDir, entry.id + '.json'), JSON.stringify(item, null, 2) + '\n');
        summary.entries[space] += 1;
        seen.add(entry.id);
        for (const image of entryContext(entry.metadata).images) imagePaths.add(image.path);
      }
    }
  }

  summary.removed = await removeStaleEntries(entriesDir, seen);
  await downloadImages(client, outDir, imagePaths, summary);

  const manifest = {
    format: 1,
    exported_at: new Date().toISOString(),
    entries: summary.entries.personal + summary.entries.work,
    images: summary.imagesDownloaded + summary.imagesSkipped,
  };
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  return summary;
}
