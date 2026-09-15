import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import {
  getEntry,
  listKinds,
  loginHint,
  registerTools,
  saveEntry,
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

describe('get_entry', () => {
  const connections = {
    links: [{ id: idB, title: 'Winter scarf', kind: 'note' }],
    backlinks: [{ id: idB, title: 'Winter scarf', kind: 'note', entry_date: '2026-09-01' }],
    ghosts: ['Ghost'],
  };

  it('merges the entry with its connections', async () => {
    const image = { path: `${idA}/${idA}/${idB}`, name: 'scarf.jpg' };
    const { client, calls } = fakeClient({
      get_entry: ok(
        row(idA, {
          metadata: {
            space: 'work',
            date: '2020-01-02',
            tags: ['wool'],
            url: 'https://x.y',
            source: 'Book',
            images: [image],
          },
        }),
      ),
      entry_connections: ok(connections),
    });
    const result = await getEntry(client, { id: idA });
    expect(calls.map((c) => c.name)).toEqual(['get_entry', 'entry_connections']);
    expect(calls[1].args).toEqual({ p_entry_id: idA });
    expect(json(result)).toEqual({
      id: idA,
      title: 'Title aaaa',
      kind: 'note',
      body: 'Body',
      space: 'work',
      date: '2020-01-02',
      tags: ['wool'],
      url: 'https://x.y',
      source: 'Book',
      images: ['scarf.jpg'],
      version: 1,
      createdAt: '2026-09-13T10:00:00+00:00',
      updatedAt: '2026-09-13T10:00:00+00:00',
      links: connections.links,
      backlinks: [{ id: idB, title: 'Winter scarf', kind: 'note', entryDate: '2026-09-01' }],
      ghosts: ['Ghost'],
    });
  });

  it('reports a missing entry', async () => {
    const { client } = fakeClient({ get_entry: fail('PT404') });
    expect(text(await getEntry(client, { id: idA }))).toBe('Entry not found.');
  });

  it('rejects a malformed id before calling the book', async () => {
    const { client, calls } = fakeClient({});
    expect((await getEntry(client, { id: 'nope' })).isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('save_entry', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('creates an entry with a fresh id and request id and a full context', async () => {
    const { client, calls } = fakeClient({
      save_entry: (args) => ok(row(args.p_entry_id as string, { title: 'New', version: 1 })),
    });
    const result = await saveEntry(client, {
      title: 'New',
      body: 'Text',
      kind: 'note',
      tags: ['a'],
    });
    expect(calls).toHaveLength(1);
    const args = calls[0].args;
    expect(args.p_entry_id).toMatch(uuid);
    expect(args.p_request_id).toMatch(uuid);
    expect(args.p_request_id).not.toBe(args.p_entry_id);
    expect(args).toMatchObject({
      p_expected_version: null,
      p_title: 'New',
      p_body_markdown: 'Text',
      p_kind: 'note',
      p_context: { space: 'personal', date: '', tags: ['a'], url: '', source: '', images: [] },
    });
    expect(json(result)).toEqual({
      id: args.p_entry_id,
      title: 'New',
      kind: 'note',
      space: 'personal',
      version: 1,
    });
  });

  it('requires title, body and kind to create', async () => {
    const { client, calls } = fakeClient({});
    const result = await saveEntry(client, { title: 'New', body: 'Text' });
    expect(text(result)).toBe('A new entry needs a title, body and kind.');
    expect(calls).toHaveLength(0);
  });

  it('updates by reading first and keeping images and fields not given', async () => {
    const image = { path: `${idA}/${idA}/${idB}`, name: 'scarf.jpg' };
    const current = row(idA, {
      title: 'Old',
      kind: 'quote',
      version: 3,
      metadata: {
        space: 'work',
        date: '2020-01-02',
        tags: ['wool'],
        url: 'https://x.y',
        source: 'Book',
        images: [image],
      },
    });
    const { client, calls } = fakeClient({
      get_entry: ok(current),
      save_entry: (args) => ok({ ...current, body_markdown: args.p_body_markdown, version: 4 }),
    });
    const result = await saveEntry(client, { id: idA, version: 3, body: 'Newer text', tags: [] });
    expect(calls.map((c) => c.name)).toEqual(['get_entry', 'save_entry']);
    expect(calls[1].args).toMatchObject({
      p_entry_id: idA,
      p_expected_version: 3,
      p_title: 'Old',
      p_body_markdown: 'Newer text',
      p_kind: 'quote',
      p_context: {
        space: 'work',
        date: '2020-01-02',
        tags: [],
        url: 'https://x.y',
        source: 'Book',
        images: [image],
      },
    });
    expect(json(result)).toEqual({
      id: idA,
      title: 'Old',
      kind: 'quote',
      space: 'work',
      version: 4,
    });
  });

  it('requires id and version together', async () => {
    const { client, calls } = fakeClient({});
    expect(text(await saveEntry(client, { id: idA, body: 'x' }))).toBe(
      'Give both id and version to update an entry, or neither to create one.',
    );
    expect(text(await saveEntry(client, { version: 1, body: 'x' }))).toBe(
      'Give both id and version to update an entry, or neither to create one.',
    );
    expect(calls).toHaveLength(0);
  });

  it('reports a stale version with the version sent and does not retry', async () => {
    const { client, calls } = fakeClient({
      get_entry: ok(row(idA, { version: 5 })),
      save_entry: fail('PT409'),
    });
    const result = await saveEntry(client, { id: idA, version: 4, body: 'x' });
    expect(text(result)).toBe('This entry changed since version 4. Read it again and retry.');
    expect(calls.filter((c) => c.name === 'save_entry')).toHaveLength(1);
  });

  it('reports a create collision without mentioning an undefined version', async () => {
    const { client } = fakeClient({ save_entry: fail('PT409') });
    const result = await saveEntry(client, { title: 'T', body: 'B', kind: 'note' });
    expect(text(result)).not.toContain('undefined');
  });

  it('rejects a bad date, a non-http url and too many tags before calling the book', async () => {
    const { client, calls } = fakeClient({});
    const base = { title: 'T', body: 'B', kind: 'note' };
    expect((await saveEntry(client, { ...base, date: '2020-13-01' })).isError).toBe(true);
    expect((await saveEntry(client, { ...base, url: 'ftp://x' })).isError).toBe(true);
    expect(
      (await saveEntry(client, { ...base, tags: Array.from({ length: 31 }, (_, i) => 't' + i) }))
        .isError,
    ).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('server', () => {
  it('exposes the five tools and answers a call over MCP', async () => {
    const { client: book } = fakeClient({
      list_entries: ok({ items: [row(idA)], next_cursor: null }),
    });
    const server = new McpServer({ name: 'commonplace', version: '0.0.0' });
    registerTools(server, book);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'get_entry',
        'list_kinds',
        'save_entry',
        'search_entries',
        'search_titles',
      ]);
      expect(tools.find((t) => t.name === 'save_entry')?.description).toContain('[[');
      const result = await client.callTool({ name: 'search_entries', arguments: { limit: 5 } });
      expect(result.isError).toBeFalsy();
      const { entries } = JSON.parse((result.content as { text: string }[])[0].text);
      expect(entries[0].id).toBe(idA);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
