import { describe, expect, it } from 'vitest';
import {
  listKinds,
  loginHint,
  searchEntries,
  searchTitles,
  type BookClient,
  type RpcResult,
} from '../scripts/mcp-core.ts';

type Call = { name: string; args: Record<string, unknown> };
type Answer = RpcResult | ((args: Record<string, unknown>) => RpcResult);

export function fakeClient(answers: Record<string, Answer | Answer[]>, signedIn = true) {
  const calls: Call[] = [];
  const client: BookClient = {
    async signedIn() {
      return signedIn;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      const answer = answers[name];
      const next = Array.isArray(answer) ? answer.shift() : answer;
      if (!next) throw new Error('No fixture for ' + name);
      return typeof next === 'function' ? next(args) : next;
    },
  };
  return { client, calls };
}

export const ok = (data: unknown): RpcResult => ({ data, error: null });
export const fail = (code: string): RpcResult => ({ data: null, error: { code } });
export const text = (result: { content: { text: string }[] }) => result.content[0].text;
export const json = (result: { content: { text: string }[] }) => JSON.parse(text(result));

export function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: 'Title ' + id.slice(0, 4),
    body_markdown: 'Body',
    kind: 'note',
    metadata: { space: 'personal', tags: [], url: '', source: '', images: [], date: '' },
    created_at: '2026-09-13T10:00:00+00:00',
    updated_at: '2026-09-13T10:00:00+00:00',
    version: 1,
    deleted_at: null,
    ...overrides,
  };
}

export const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const page = (items: unknown[], next: unknown = null) => ok({ items, next_cursor: next });

describe('search_entries', () => {
  it('lists newest entries in a space with the defaults', async () => {
    const { client, calls } = fakeClient({ list_entries: page([row(idA)]) });
    const result = await searchEntries(client, {});
    expect(result.isError).toBeUndefined();
    expect(calls).toEqual([
      {
        name: 'list_entries',
        args: {
          p_query: '',
          p_space: 'personal',
          p_order: 'newest',
          p_kind: null,
          p_before_created: null,
          p_before_id: null,
          p_limit: 20,
        },
      },
    ]);
    expect(json(result)).toEqual({
      entries: [
        {
          id: idA,
          title: 'Title aaaa',
          kind: 'note',
          date: '2026-09-13',
          tags: [],
          excerpt: 'Body',
        },
      ],
    });
  });

  it('passes query, kind, space and limit through', async () => {
    const { client, calls } = fakeClient({ list_entries: page([]) });
    await searchEntries(client, { query: 'scarf', kind: 'quote', space: 'work', limit: 100 });
    expect(calls[0].args).toMatchObject({
      p_query: 'scarf',
      p_kind: 'quote',
      p_space: 'work',
      p_limit: 100,
    });
  });

  it('uses the entry date, link labels, and a 300 character excerpt', async () => {
    const body = 'See [[' + idB + '|Winter scarf]] and [[Ghost]] ' + 'x'.repeat(400);
    const { client } = fakeClient({
      list_entries: page([
        row(idA, { body_markdown: body, metadata: { date: '2020-01-02', tags: ['wool'] } }),
      ]),
    });
    const [entry] = json(await searchEntries(client, {})).entries;
    expect(entry.date).toBe('2020-01-02');
    expect(entry.tags).toEqual(['wool']);
    expect(entry.excerpt.startsWith('See Winter scarf and Ghost ')).toBe(true);
    expect(entry.excerpt).toHaveLength(300);
  });

  it('rejects a limit over 100 before calling the book', async () => {
    const { client, calls } = fakeClient({ list_entries: page([]) });
    const result = await searchEntries(client, { limit: 101 });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('answers with the login hint when there is no session', async () => {
    const { client, calls } = fakeClient({ list_entries: page([]) }, false);
    const result = await searchEntries(client, {});
    expect(result).toEqual({ content: [{ type: 'text', text: loginHint }], isError: true });
    expect(calls).toHaveLength(0);
  });

  it('maps an auth refusal to the login hint and other failures to a retry message', async () => {
    const { client } = fakeClient({ list_entries: [fail('42501'), fail('PGRST000')] });
    expect(text(await searchEntries(client, {}))).toBe(loginHint);
    expect(text(await searchEntries(client, {}))).toBe(
      'Could not reach your book. Try again shortly.',
    );
  });

  it('reports an unexpected payload without throwing', async () => {
    const { client } = fakeClient({ list_entries: ok({ items: 'nope' }) });
    const result = await searchEntries(client, {});
    expect(result.isError).toBe(true);
  });
});

describe('search_titles', () => {
  it('asks for eight titles in the space', async () => {
    const { client, calls } = fakeClient({
      search_titles: ok([{ id: idB, title: 'Winter scarf', kind: 'note' }]),
    });
    const result = await searchTitles(client, { query: 'win', space: 'work' });
    expect(calls).toEqual([
      { name: 'search_titles', args: { p_query: 'win', p_space: 'work', p_limit: 8 } },
    ]);
    expect(json(result)).toEqual({ titles: [{ id: idB, title: 'Winter scarf', kind: 'note' }] });
  });

  it('rejects an empty query', async () => {
    const { client, calls } = fakeClient({});
    expect((await searchTitles(client, { query: '  ' })).isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('list_kinds', () => {
  it('counts kinds across every page, sorted by kind', async () => {
    const cursor = { created_at: '2026-09-13T10:00:00+00:00', id: idA, entry_date: '2026-09-13' };
    const { client, calls } = fakeClient({
      list_entries: [
        page([row(idA, { kind: 'quote' }), row(idB, { kind: 'note' })], cursor),
        page([row(idB, { kind: 'quote' })]),
      ],
    });
    const result = await listKinds(client, { space: 'work' });
    expect(calls[0].args).toMatchObject({
      p_space: 'work',
      p_query: '',
      p_limit: 100,
      p_before_id: null,
    });
    expect(calls[1].args).toMatchObject({
      p_before_created: cursor.created_at,
      p_before_id: idA,
      p_before_date: '2026-09-13',
    });
    expect(json(result)).toEqual({
      kinds: [
        { kind: 'note', count: 1 },
        { kind: 'quote', count: 2 },
      ],
    });
  });
});
