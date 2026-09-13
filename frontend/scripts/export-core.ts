import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { cursorSchema, entrySchema, type Space } from '../src/domain/entries.ts';

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

  for (const space of spaces) {
    for await (const items of listPages(client, space)) {
      for (const item of items) {
        const entry = entrySchema.parse(item);
        await writeFile(join(entriesDir, entry.id + '.json'), JSON.stringify(item, null, 2) + '\n');
        summary.entries[space] += 1;
      }
    }
  }

  return summary;
}
