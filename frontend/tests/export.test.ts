import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportBook, type ExportClient } from '../scripts/export-core.ts';
import type { Space } from '../src/domain/entries.ts';

type Image = { path: string; name: string };
type Page = { items: Record<string, unknown>[]; next_cursor: Record<string, string> | null };

const owner = '11111111-1111-4111-8111-111111111111';

function entry(id: string, options: { space?: Space; images?: Image[] } = {}) {
  return {
    id,
    title: 'Title ' + id.slice(0, 4),
    body_markdown: 'Body',
    kind: 'note',
    metadata: { space: options.space ?? 'personal', images: options.images ?? [] },
    created_at: '2026-09-13T10:00:00+00:00',
    updated_at: '2026-09-13T10:00:00+00:00',
    version: 1,
    deleted_at: null,
    entry_date: '2026-09-13',
  };
}

function cursorFor(item: Record<string, unknown>) {
  return {
    entry_date: item.entry_date as string,
    created_at: item.created_at as string,
    id: item.id as string,
  };
}

function fakeClient(pages: Record<Space, Page[]>, images: Record<string, Uint8Array | Error> = {}) {
  const calls: Record<string, unknown>[] = [];
  const served: Record<Space, number> = { personal: 0, work: 0 };
  const client: ExportClient = {
    async listEntries(args) {
      calls.push(args);
      const space = args.p_space as Space;
      const page = pages[space][served[space]];
      if (!page) throw new Error('No more pages for ' + space);
      served[space] += 1;
      return page;
    },
    async downloadImage(path) {
      const image = images[path];
      if (image === undefined) throw new Error('Missing fixture for ' + path);
      if (image instanceof Error) throw image;
      return image;
    },
  };
  return { client, calls };
}

let outDir: string;
beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'commonplace-export-'));
});
afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe('entries', () => {
  it('walks every page of both spaces and passes each cursor back', async () => {
    const a = entry('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const b = entry('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const c = entry('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { space: 'work' });
    const { client, calls } = fakeClient({
      personal: [
        { items: [a], next_cursor: cursorFor(a) },
        { items: [b], next_cursor: null },
      ],
      work: [{ items: [c], next_cursor: null }],
    });

    const summary = await exportBook(client, outDir);

    expect(summary.entries).toEqual({ personal: 2, work: 1 });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      p_space: 'personal',
      p_limit: 100,
      p_query: '',
      p_kind: null,
      p_order: 'newest',
      p_before_created: null,
      p_before_id: null,
    });
    expect(calls[1]).toMatchObject({
      p_space: 'personal',
      p_before_created: a.created_at,
      p_before_id: a.id,
      p_before_date: a.entry_date,
    });
    expect(calls[2]).toMatchObject({ p_space: 'work', p_before_id: null });
  });

  it('writes each entry verbatim as pretty JSON named by its id', async () => {
    const a = entry('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const { client } = fakeClient({
      personal: [{ items: [a], next_cursor: null }],
      work: [{ items: [], next_cursor: null }],
    });

    await exportBook(client, outDir);

    const files = await readdir(join(outDir, 'entries'));
    expect(files).toEqual([a.id + '.json']);
    const written = await readFile(join(outDir, 'entries', a.id + '.json'), 'utf8');
    expect(JSON.parse(written)).toEqual(a);
    expect(written).toBe(JSON.stringify(a, null, 2) + '\n');
  });

  it('fails the whole run when a list call fails', async () => {
    const client: ExportClient = {
      async listEntries() {
        throw new Error('list_entries failed: 42501');
      },
      async downloadImage() {
        return new Uint8Array();
      },
    };

    await expect(exportBook(client, outDir)).rejects.toThrow('list_entries failed');
  });
});

describe('images', () => {
  const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const imageId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const otherId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const path = owner + '/' + entryId + '/' + imageId;
  const otherPath = owner + '/' + entryId + '/' + otherId;

  it('downloads every referenced image to a path mirroring storage', async () => {
    const a = entry(entryId, { images: [{ path, name: 'photo.png' }] });
    const bytes = new Uint8Array([1, 2, 3]);
    const { client } = fakeClient(
      {
        personal: [{ items: [a], next_cursor: null }],
        work: [{ items: [], next_cursor: null }],
      },
      { [path]: bytes },
    );

    const summary = await exportBook(client, outDir);

    expect(summary.imagesDownloaded).toBe(1);
    expect(summary.imagesSkipped).toBe(0);
    const written = await readFile(join(outDir, 'images', owner, entryId, imageId));
    expect(new Uint8Array(written)).toEqual(bytes);
  });

  it('skips images already on disk and reports failed downloads without stopping', async () => {
    const a = entry(entryId, {
      images: [
        { path, name: 'kept.png' },
        { path: otherPath, name: 'broken.png' },
      ],
    });
    const { client } = fakeClient(
      {
        personal: [{ items: [a], next_cursor: null }],
        work: [{ items: [], next_cursor: null }],
      },
      { [path]: new Uint8Array([9]), [otherPath]: new Error('Object not found') },
    );
    await mkdir(join(outDir, 'images', owner, entryId), { recursive: true });
    await writeFile(join(outDir, 'images', owner, entryId, imageId), new Uint8Array([9]));

    const summary = await exportBook(client, outDir);

    expect(summary.imagesSkipped).toBe(1);
    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.failures).toEqual([{ path: otherPath, message: 'Object not found' }]);
    expect(await readdir(join(outDir, 'entries'))).toEqual([entryId + '.json']);
  });
});

describe('mirroring', () => {
  it('removes entry files absent from this run and leaves images alone', async () => {
    const a = entry('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const { client } = fakeClient({
      personal: [{ items: [a], next_cursor: null }],
      work: [{ items: [], next_cursor: null }],
    });
    const staleId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await mkdir(join(outDir, 'entries'), { recursive: true });
    await writeFile(join(outDir, 'entries', staleId + '.json'), '{}\n');
    await mkdir(join(outDir, 'images', owner, staleId), { recursive: true });
    await writeFile(join(outDir, 'images', owner, staleId, 'orphan'), new Uint8Array([1]));

    const summary = await exportBook(client, outDir);

    expect(summary.removed).toBe(1);
    expect(await readdir(join(outDir, 'entries'))).toEqual([a.id + '.json']);
    expect(await readdir(join(outDir, 'images', owner, staleId))).toEqual(['orphan']);
  });

  it('writes a manifest with counts and a timestamp', async () => {
    const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const path = owner + '/' + entryId + '/dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const a = entry(entryId, { images: [{ path, name: 'photo.png' }] });
    const b = entry('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { space: 'work' });
    const { client } = fakeClient(
      {
        personal: [{ items: [a], next_cursor: null }],
        work: [{ items: [b], next_cursor: null }],
      },
      { [path]: new Uint8Array([1]) },
    );
    const before = Date.now();

    await exportBook(client, outDir);

    const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ format: 1, entries: 2, images: 1 });
    expect(Date.parse(manifest.exported_at)).toBeGreaterThanOrEqual(before - 1000);
  });

  it('does not remove stale files or write a manifest when listing fails midway', async () => {
    const a = entry('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    let call = 0;
    const client: ExportClient = {
      async listEntries() {
        call += 1;
        if (call === 1) return { items: [a], next_cursor: null };
        throw new Error('list_entries failed: network');
      },
      async downloadImage() {
        return new Uint8Array();
      },
    };
    const staleId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await mkdir(join(outDir, 'entries'), { recursive: true });
    await writeFile(join(outDir, 'entries', staleId + '.json'), '{}\n');

    await expect(exportBook(client, outDir)).rejects.toThrow('list_entries failed');

    expect((await readdir(join(outDir, 'entries'))).sort()).toEqual(
      [a.id + '.json', staleId + '.json'].sort(),
    );
    expect(await readdir(outDir)).not.toContain('manifest.json');
  });
});
