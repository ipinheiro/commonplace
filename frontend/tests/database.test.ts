import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const owner = '11111111-1111-4111-8111-111111111111';
const stranger = '22222222-2222-4222-8222-222222222222';
let db: PGlite;

async function asUser(id: string) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: id }),
  ]);
}

async function save(
  args: {
    id?: string;
    request?: string;
    version?: number | null;
    title?: string;
    body?: string;
    kind?: string;
    context?: object;
  } = {},
) {
  const result = await db.query<{
    entry: {
      id: string;
      title: string;
      version: number;
      created_at: string;
      updated_at: string;
      metadata: object;
    };
  }>(
    args.context
      ? 'select api.save_entry($1, $2, $3, $4, $5, $6, $7) as entry'
      : 'select api.save_entry($1, $2, $3, $4, $5, $6) as entry',
    [
      args.request ?? randomUUID(),
      args.id ?? randomUUID(),
      args.version ?? null,
      args.title ?? 'A thought',
      args.body ?? 'Something worth keeping.',
      args.kind ?? 'note',
      ...(args.context ? [args.context] : []),
    ],
  );
  return result.rows[0].entry;
}

beforeAll(async () => {
  db = new PGlite();
  // Only Supabase's auth infrastructure is supplied by the fixture. The complete
  // application migration runs unchanged against a real PostgreSQL engine.
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
    $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key, bucket_id text references storage.buckets(id), name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select string_to_array(name, '/');
    $$;
    grant usage on schema storage to authenticated;
    grant select, insert, update on storage.objects to authenticated;
    grant execute on function storage.foldername(text) to authenticated;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${owner}'), ('${stranger}');
  `);
  const migrations = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(file, migrations), 'utf8'));
  }
});
beforeEach(async () => {
  await db.exec('reset role; truncate app.entries, app.mutations, storage.objects;');
  await asUser(owner);
});
afterAll(async () => {
  await db.close();
});

describe('private entry operations', () => {
  it('creates and reads entries with server timestamps and stable identity', async () => {
    const entry = await save();
    expect(entry.version).toBe(1);
    expect(Date.parse(entry.created_at)).toBeGreaterThan(0);
    const result = await db.query<{ entry: object }>('select api.get_entry($1) as entry', [
      entry.id,
    ]);
    expect(result.rows[0].entry).toEqual(entry);
    expect(entry).not.toHaveProperty('owner_id');
  });

  it('denies anonymous reads and writes', async () => {
    const entry = await save();
    await db.exec('reset role; set role anon');
    await expect(db.query('select api.get_entry($1)', [entry.id])).rejects.toMatchObject({
      code: '42501',
    });
    await expect(save()).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select * from app.entries')).rejects.toMatchObject({ code: '42501' });
  });

  it('isolates content and mutation receipts between users', async () => {
    const entry = await save();
    await asUser(stranger);
    expect((await db.query('select * from app.entries')).rows).toEqual([]);
    expect((await db.query('select * from app.mutations')).rows).toEqual([]);
    await expect(db.query('select api.get_entry($1)', [entry.id])).rejects.toMatchObject({
      code: 'PT404',
    });
    await expect(save({ id: entry.id, version: 1, title: 'Steal' })).rejects.toMatchObject({
      code: 'PT404',
    });
    expect(
      (await db.query<{ page: { items: object[] } }>('select api.list_entries() as page')).rows[0]
        .page.items,
    ).toEqual([]);
    await asUser(owner);
    expect(
      (
        await db.query<{ entry: { title: string } }>('select api.get_entry($1) as entry', [
          entry.id,
        ])
      ).rows[0].entry.title,
    ).toBe('A thought');
  });

  it('replays a create retry without creating another entry', async () => {
    const args = { id: randomUUID(), request: randomUUID() };
    const first = await save(args);
    expect(await save(args)).toEqual(first);
    expect((await db.query('select id from app.entries')).rows).toHaveLength(1);
  });

  it('rejects reusing a request identity with changed input', async () => {
    const args = { id: randomUUID(), request: randomUUID(), title: 'Original' };
    await save(args);
    await expect(save({ ...args, title: 'Changed' })).rejects.toMatchObject({ code: 'PT409' });
  });

  it('rejects duplicate entry IDs without overwriting content', async () => {
    const entry = await save();
    await expect(save({ id: entry.id, title: 'Duplicate' })).rejects.toMatchObject({
      code: 'PT409',
    });
  });

  it('allows exactly one update based on an old revision', async () => {
    const entry = await save();
    const updated = await save({ id: entry.id, version: 1, title: 'From the laptop' });
    expect(updated.version).toBe(2);
    expect(updated.created_at).toBe(entry.created_at);
    await expect(save({ id: entry.id, version: 1, title: 'From the phone' })).rejects.toMatchObject(
      { code: 'PT409' },
    );
  });

  it('replays an update without incrementing version again', async () => {
    const entry = await save();
    const args = { id: entry.id, request: randomUUID(), version: 1, title: 'Revised' };
    expect(await save(args)).toEqual(await save(args));
    expect(
      (await db.query<{ version: number }>('select version from app.entries')).rows[0].version,
    ).toBe(2);
  });

  it('rolls failed writes and their receipts back together', async () => {
    const request = randomUUID();
    await expect(save({ request, title: ' ' })).rejects.toMatchObject({ code: '22023' });
    expect((await db.query('select * from app.mutations')).rows).toEqual([]);
    expect((await db.query('select * from app.entries')).rows).toEqual([]);
    expect((await save({ request, title: 'Recovered' })).title).toBe('Recovered');
  });

  it('preserves metadata on ordinary edits', async () => {
    const entry = await save();
    await db.query('update app.entries set metadata=$1 where id=$2', [
      { source: 'A book', custom: [1, 2] },
      entry.id,
    ]);
    const updated = await save({ id: entry.id, version: 2 });
    expect(updated.metadata).toEqual({ source: 'A book', custom: [1, 2] });
  });

  it('filters text and custom types without treating user input as SQL', async () => {
    await save({
      title: 'Memórias de Lisboa',
      body: 'A cidade junto ao rio.',
      kind: 'travel-journal',
    });
    await save({ title: 'Garden', body: 'A quiet afternoon.' });
    const result = await db.query<{ page: { items: { title: string }[] } }>(
      'select api.list_entries($1, $2) as page',
      ['Lisboa', 'travel-journal'],
    );
    expect(result.rows[0].page.items.map((entry) => entry.title)).toEqual(['Memórias de Lisboa']);
    await expect(
      db.query('select api.list_entries($1)', ["'; drop table app.entries; --"]),
    ).resolves.toBeDefined();
  });

  it('paginates without skipping or repeating entries', async () => {
    for (let index = 0; index < 4; index++) await save({ title: `Note ${index}` });
    type Page = { items: { id: string }[]; next_cursor: { created_at: string; id: string } | null };
    const first = (await db.query<{ page: Page }>('select api.list_entries(p_limit => 2) as page'))
      .rows[0].page;
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();
    const second = (
      await db.query<{ page: Page }>(
        'select api.list_entries(p_before_created => $1, p_before_id => $2, p_limit => 2) as page',
        [first.next_cursor!.created_at, first.next_cursor!.id],
      )
    ).rows[0].page;
    expect(second.next_cursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((entry) => entry.id)).size).toBe(4);
  });
});

describe('entry context and private images', () => {
  const context = {
    tags: ['reading', 'ideas'],
    url: 'https://example.com/article',
    source: 'A book, p. 42',
    images: [],
  };
  it('saves and clears context, preserves other metadata, and checks retries and revisions', async () => {
    const args = { id: randomUUID(), request: randomUUID(), context };
    const created = await save(args);
    expect(created.metadata).toEqual(context);
    expect(await save(args)).toEqual(created);
    await expect(
      save({ ...args, context: { ...context, source: 'Different' } }),
    ).rejects.toMatchObject({ code: 'PT409' });
    await db.query('update app.entries set metadata=metadata || \'{"custom":true}\' where id=$1', [
      created.id,
    ]);
    const cleared = await save({
      id: created.id,
      version: 2,
      context: { tags: [], url: '', source: '', images: [] },
    });
    expect(cleared.metadata).toEqual({ custom: true, tags: [], url: '', source: '', images: [] });
    await expect(save({ id: created.id, version: 2, context })).rejects.toMatchObject({
      code: 'PT409',
    });
    const legacy = await save({ id: created.id, version: 3 });
    expect(legacy.metadata).toEqual(cleared.metadata);
  });
  it('rejects malformed context and image references belonging to another owner or entry', async () => {
    for (const invalid of [
      { ...context, tags: [null] },
      { ...context, url: 'javascript:alert(1)' },
      { ...context, images: [null] },
      {
        ...context,
        images: [{ name: 'photo.png', path: stranger + '/' + randomUUID() + '/' + randomUUID() }],
      },
    ]) {
      await expect(save({ context: invalid })).rejects.toMatchObject({ code: '22023' });
    }
    const id = randomUUID();
    const image = { name: 'photo.png', path: owner + '/' + id + '/' + randomUUID() };
    expect((await save({ id, context: { ...context, images: [image] } })).metadata).toEqual({
      ...context,
      images: [image],
    });
  });
  it('restricts image reads and uploads to the owner folder', async () => {
    const id = randomUUID();
    await db.query('insert into storage.objects values ($1, $2, $3)', [
      id,
      'entry-images',
      owner + '/entry/image',
    ]);
    await asUser(stranger);
    expect((await db.query('select * from storage.objects')).rows).toEqual([]);
    await expect(
      db.query('insert into storage.objects values ($1, $2, $3)', [
        randomUUID(),
        'entry-images',
        owner + '/entry/other',
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await db.query('update storage.objects set name=$1 where id=$2', [
      stranger + '/entry/stolen',
      id,
    ]);
    await asUser(owner);
    expect(
      (await db.query<{ name: string }>('select name from storage.objects')).rows[0].name,
    ).toBe(owner + '/entry/image');
  });
});

describe('original entry dates', () => {
  const context = { tags: [], url: '', source: '', images: [] };
  it('keeps original dates separate from timestamps and preserves them for older clients', async () => {
    const created = await save({ context: { ...context, date: '2012-02-29' } });
    expect(created.metadata).toHaveProperty('date', '2012-02-29');
    const revised = await save({
      id: created.id,
      version: 1,
      context: { ...context, date: '2005-12-31' },
    });
    expect(revised.created_at).toBe(created.created_at);
    expect(revised.version).toBe(2);
    const legacy = await save({ id: created.id, version: 2, context });
    expect(legacy.metadata).toHaveProperty('date', '2005-12-31');
    const cleared = await save({ id: created.id, version: 3, context: { ...context, date: '' } });
    expect(cleared.metadata).toHaveProperty('date', '');
  });
  it('rejects impossible dates before writing an entry or receipt', async () => {
    for (const date of ['2023-02-29', '2020-13-01', '0000-01-01', 'yesterday', null]) {
      await expect(save({ context: { ...context, date } })).rejects.toMatchObject({
        code: '22023',
      });
    }
    expect((await db.query('select * from app.entries')).rows).toEqual([]);
    expect((await db.query('select * from app.mutations')).rows).toEqual([]);
  });
  it('sorts and paginates by original date, including search, type filters and equal dates', async () => {
    const newer = await save({
      title: 'Imported newer',
      kind: 'memory',
      context: { ...context, date: '2019-05-10' },
    });
    const oldest = await save({
      title: 'Imported oldest',
      kind: 'memory',
      context: { ...context, date: '2001-01-01' },
    });
    const sameDay = await save({
      title: 'Imported same day',
      kind: 'memory',
      context: { ...context, date: '2019-05-10' },
    });
    await save({
      title: 'Imported excluded',
      kind: 'quote',
      context: { ...context, date: '2020-01-01' },
    });
    type Page = {
      items: { id: string }[];
      next_cursor: { created_at: string; id: string; entry_date: string } | null;
    };
    const first = (
      await db.query<{ page: Page }>(
        "select api.list_entries(p_query => 'Imported', p_kind => 'memory', p_limit => 1) as page",
      )
    ).rows[0].page;
    expect(first.items.map((entry) => entry.id)).toEqual([sameDay.id]);
    const cursor = first.next_cursor!;
    expect(cursor.entry_date).toBe('2019-05-10');
    const second = (
      await db.query<{ page: Page }>(
        "select api.list_entries(p_query => 'Imported', p_kind => 'memory', p_before_created => $1, p_before_id => $2, p_before_date => $3) as page",
        [cursor.created_at, cursor.id, cursor.entry_date],
      )
    ).rows[0].page;
    expect(second.items.map((entry) => entry.id)).toEqual([newer.id, oldest.id]);
    expect(second.next_cursor).toBeNull();
  });
});

it('separates spaces through search, pagination, moves and older saves', async () => {
  const personal = await save({ title: 'Shared keyword personal' });
  const context = { tags: [], url: '', source: '', images: [], space: 'work' };
  const work = await save({ title: 'Shared keyword work', kind: 'meeting', context });
  await save({ title: 'Shared keyword another work', context });
  const list = async (
    space: string,
    cursor?: { created_at: string; id: string; entry_date: string },
  ) => {
    const result = await db.query<{
      page: {
        items: { id: string }[];
        next_cursor: { created_at: string; id: string; entry_date: string };
      };
    }>(
      'select api.list_entries(p_query => $1, p_space => $2, p_limit => 1, p_before_created => $3, p_before_id => $4, p_before_date => $5) as page',
      [
        'keyword',
        space,
        cursor?.created_at ?? null,
        cursor?.id ?? null,
        cursor?.entry_date ?? null,
      ],
    );
    return result.rows[0].page;
  };
  expect((await list('personal')).items.map((e) => e.id)).toEqual([personal.id]);
  const first = await list('work');
  const second = await list('work', first.next_cursor);
  expect(new Set([...first.items, ...second.items].map((e) => e.id)).size).toBe(2);
  expect([...first.items, ...second.items].map((e) => e.id)).not.toContain(personal.id);
  const olderSave = await save({ id: work.id, version: 1, title: 'Shared keyword updated' });
  expect(olderSave.metadata).toMatchObject({ space: 'work' });
  const request = randomUUID();
  const move = { id: personal.id, version: 1, request, title: personal.title, context };
  expect((await save(move)).version).toBe(2);
  expect((await save(move)).version).toBe(2);
  expect((await list('personal')).items).toEqual([]);
  await expect(save({ ...move, context: { ...context, space: 'personal' } })).rejects.toMatchObject(
    { code: 'PT409' },
  );
  await expect(save({ context: { ...context, space: 'team' } })).rejects.toMatchObject({
    code: '22023',
  });
  await expect(list('team')).rejects.toMatchObject({ code: '22023' });
  await asUser(stranger);
  expect((await list('work')).items).toEqual([]);
});
