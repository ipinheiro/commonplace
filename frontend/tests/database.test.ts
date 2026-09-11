import { readFile } from 'node:fs/promises';
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
  }>('select api.save_entry($1, $2, $3, $4, $5, $6) as entry', [
    args.request ?? randomUUID(),
    args.id ?? randomUUID(),
    args.version ?? null,
    args.title ?? 'A thought',
    args.body ?? 'Something worth keeping.',
    args.kind ?? 'note',
  ]);
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
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${owner}'), ('${stranger}');
  `);
  await db.exec(
    await readFile(
      new URL('../../supabase/migrations/202609110001_entries.sql', import.meta.url),
      'utf8',
    ),
  );
});
beforeEach(async () => {
  await db.exec('reset role; truncate app.entries, app.mutations;');
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
