# Agent access implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code and Codex can search, read, create and update entries in the book through a local MCP server that signs in as the owner.

**Architecture:** A stdio MCP server in `frontend/scripts`, built on the official TypeScript SDK, calls the existing `api` functions over the Supabase client. Tool logic lives in a core module against a two-method client interface so tests use a fake. A one-off `login` command stores the Supabase session in a user-only file; a storage adapter hands that file to the Supabase client so refreshes are written back. No database change.

**Tech Stack:** Node 24 running TypeScript directly (as `scripts/export.ts` does), `@modelcontextprotocol/sdk` 1.30.0, `@supabase/supabase-js`, Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-agent-access-design.md`

## Global constraints

- Branch: `feature/agent-access`, already created from `develop` (the spec is its first commit). Capitalised conventional commit messages, for example `feat(mcp): Add the session file`. No Claude attribution lines in commits (user rule). Never push.
- No migration. The server calls `list_entries`, `get_entry`, `save_entry`, `entry_connections` and `search_titles` exactly as they are.
- Scripts run under Node's type stripping: every relative import ends in `.ts`, `import type` for types, no enums, no parameter properties, no decorators (`erasableSyntaxOnly` is on in `frontend/tsconfig.json`).
- Stdout is the MCP channel. The server never writes to stdout except through the SDK; diagnostics go to `console.error`.
- Tool errors are returned as `{ content: [{ type: 'text', text }], isError: true }`. A tool handler never throws to the SDK and never exits the process.
- Messages, verbatim from the spec:
  - Not signed in: `Not signed in. Run \`bun run --cwd frontend mcp login\` in the commonplace repo, then try again.`
  - Stale version: `This entry changed since version N. Read it again and retry.` where N is the version the agent sent.
  - Not found: `Entry not found.`
  - Invalid: `Invalid entry details (CODE).` with the database code.
  - Anything else from the database: `Could not reach your book. Try again shortly.`
- Limits mirror the database: query ≤ 500, title 1..300, kind 1..64, body ≤ 1,000,000, tags ≤ 30 of 1..64, url ≤ 2048 and http/https, source ≤ 1000, limit 1..100 default 20, search_titles query 1..300 and always `p_limit: 8`.
- Session file: `$XDG_CONFIG_HOME/commonplace/session.json` or `~/.config/commonplace/session.json`; shape `{ "url": string, "session": object }`; mode `0600`, directory `0700`; written through `<path>.part` then renamed; read fresh on every access; a different `url` reads as no session.
- Frontend rules already in force: Prettier (`bun run --cwd frontend format:check`, fix with `format`), `bun run --cwd frontend test` runs Vitest (the script already includes `run`; do not pass `run` again), `bun run --cwd frontend typecheck`.
- Verify commands (from the repo root):

```sh
bun run --cwd frontend test
bun run --cwd frontend typecheck
bun run --cwd frontend format:check
bun run --cwd frontend build
```

## File structure

- Create `frontend/scripts/mcp-session.ts`: session file path and the storage adapter. Pure filesystem, no Supabase import.
- Create `frontend/tests/mcp-session.test.ts`.
- Create `frontend/scripts/mcp-core.ts`: `BookClient` interface, error mapping, input schemas, the five tool functions, `registerTools`.
- Create `frontend/tests/mcp.test.ts`: tool tests with a fake client, plus one in-process MCP wiring test.
- Create `frontend/scripts/terminal.ts`: `loadLocalEnv`, `ask`, `askHidden`, moved out of `export.ts` so login can reuse them.
- Modify `frontend/scripts/export.ts`: import those three from `./terminal.ts`.
- Create `frontend/scripts/mcp.ts`: `login`, `logout`, and the default `serve`.
- Modify `frontend/package.json`: `"mcp": "node scripts/mcp.ts"` and the SDK dependency.
- Modify `docs/hosted-setup.md`, `README.md`.

---

### Task 1: Session file and storage adapter

**Files:**
- Create: `frontend/scripts/mcp-session.ts`
- Create: `frontend/tests/mcp-session.test.ts`

**Interfaces:**
- Consumes: nothing from the project.
- Produces:
  - `sessionPath(env?: NodeJS.ProcessEnv): string`
  - `type SessionStorage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }` (the shape `@supabase/supabase-js` accepts as `auth.storage`; the key is ignored because the file holds one session).
  - `sessionFile(path: string, url: string): SessionStorage`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/mcp-session.test.ts`:

```ts
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionFile, sessionPath } from '../scripts/mcp-session.ts';

const url = 'https://prod.supabase.co';
const session = JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1 });

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'commonplace-mcp-'));
  path = join(dir, 'nested', 'session.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('sessionPath', () => {
  it('prefers XDG_CONFIG_HOME', () => {
    expect(sessionPath({ XDG_CONFIG_HOME: '/x' })).toBe('/x/commonplace/session.json');
  });

  it('falls back to ~/.config', () => {
    expect(sessionPath({})).toMatch(/\/\.config\/commonplace\/session\.json$/);
  });
});

describe('sessionFile', () => {
  it('reads nothing when the file is missing', async () => {
    expect(await sessionFile(path, url).getItem('k')).toBeNull();
  });

  it('writes an owner-only file tagged with the project URL and reads it back', async () => {
    const storage = sessionFile(path, url);
    await storage.setItem('k', session);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'nested'))).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ url, session: JSON.parse(session) });
    expect(await storage.getItem('k')).toBe(session);
  });

  it('treats a session for another project as no session', async () => {
    await sessionFile(path, url).setItem('k', session);
    expect(await sessionFile(path, 'https://dev.supabase.co').getItem('k')).toBeNull();
  });

  it('treats an unreadable file as no session', async () => {
    await sessionFile(path, url).setItem('k', session);
    await writeFile(path, 'not json');
    expect(await sessionFile(path, url).getItem('k')).toBeNull();
  });

  it('sees a change another process wrote', async () => {
    const storage = sessionFile(path, url);
    await storage.setItem('k', session);
    const rotated = JSON.stringify({ access_token: 'b', refresh_token: 'r2', expires_at: 2 });
    await sessionFile(path, url).setItem('k', rotated);
    expect(await storage.getItem('k')).toBe(rotated);
  });

  it('removes the file, and removing twice is fine', async () => {
    const storage = sessionFile(path, url);
    await storage.setItem('k', session);
    await storage.removeItem('k');
    await storage.removeItem('k');
    expect(await storage.getItem('k')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd frontend test tests/mcp-session.test.ts`
Expected: FAIL, cannot find module `../scripts/mcp-session.ts`.

- [ ] **Step 3: Write the implementation**

Create `frontend/scripts/mcp-session.ts`:

```ts
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type SessionStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function sessionPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'commonplace', 'session.json');
}

// One file holds one session, so the storage key supabase-js passes is ignored. The file
// is read on every access rather than cached: two servers running at once (Claude Code
// and Codex) then both see the latest refreshed token instead of one of them refreshing
// with a token the other has already rotated.
export function sessionFile(path: string, url: string): SessionStorage {
  return {
    async getItem() {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      let stored: unknown;
      try {
        stored = JSON.parse(text);
      } catch {
        return null;
      }
      if (typeof stored !== 'object' || stored === null) return null;
      const { url: storedUrl, session } = stored as { url?: unknown; session?: unknown };
      if (storedUrl !== url || session === undefined) return null;
      return JSON.stringify(session);
    },
    async setItem(_key, value) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const part = path + '.part';
      await writeFile(part, JSON.stringify({ url, session: JSON.parse(value) }) + '\n', {
        mode: 0o600,
      });
      await rename(part, path);
    },
    async removeItem() {
      await rm(path, { force: true });
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run --cwd frontend test tests/mcp-session.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Typecheck, format, commit**

Run: `bun run --cwd frontend typecheck && bun run --cwd frontend format && bun run --cwd frontend format:check`

```sh
git add frontend/scripts/mcp-session.ts frontend/tests/mcp-session.test.ts
git commit -m "feat(mcp): Add the session file storage adapter"
```

---

### Task 2: Core reads: search_entries, search_titles, list_kinds

**Files:**
- Modify: `frontend/package.json` (add the dependency)
- Create: `frontend/scripts/mcp-core.ts`
- Create: `frontend/tests/mcp.test.ts`

**Interfaces:**
- Consumes: `entrySchema`, `pageSchema`, `spaceSchema`, `entryContext`, `entryDate`, `type Entry`, `type EntryCursor` from `frontend/src/domain/entries.ts`; `linkTargetSchema`, `linksToText` from `frontend/src/domain/links.ts`.
- Produces (used by Tasks 3 and 4):
  - `type RpcResult = { data: unknown; error: { code: string } | null }`
  - `type BookClient = { signedIn(): Promise<boolean>; rpc(name: string, args: Record<string, unknown>): Promise<RpcResult> }`
  - `type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }`
  - `loginHint: string`
  - `messageFor(code: string): string`
  - `inputs` - an object of Zod raw shapes, one per tool name
  - `searchEntries(client, raw: unknown)`, `searchTitles(client, raw)`, `listKinds(client, raw)`, each returning `Promise<ToolResult>`
  - internal helpers `run(client, work)` and `call(client, schema, name, args)` that Task 3 reuses.

- [ ] **Step 1: Install the SDK**

Run: `bun add --cwd frontend @modelcontextprotocol/sdk@1.30.0`
Expected: `frontend/package.json` gains `"@modelcontextprotocol/sdk": "^1.30.0"` under `dependencies` and `bun.lock` changes. Nothing else in `package.json` moves.

- [ ] **Step 2: Write the failing tests**

Create `frontend/tests/mcp.test.ts`:

```ts
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
      entries: [{ id: idA, title: 'Title aaaa', kind: 'note', date: '2026-09-13', tags: [], excerpt: 'Body' }],
    });
  });

  it('passes query, kind, space and limit through', async () => {
    const { client, calls } = fakeClient({ list_entries: page([]) });
    await searchEntries(client, { query: 'scarf', kind: 'quote', space: 'work', limit: 100 });
    expect(calls[0].args).toMatchObject({ p_query: 'scarf', p_kind: 'quote', p_space: 'work', p_limit: 100 });
  });

  it('uses the entry date, link labels, and a 300 character excerpt', async () => {
    const body = 'See [[' + idB + '|Winter scarf]] and [[Ghost]] ' + 'x'.repeat(400);
    const { client } = fakeClient({
      list_entries: page([row(idA, { body_markdown: body, metadata: { date: '2020-01-02', tags: ['wool'] } })]),
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
    expect(text(await searchEntries(client, {}))).toBe('Could not reach your book. Try again shortly.');
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
    expect(calls).toEqual([{ name: 'search_titles', args: { p_query: 'win', p_space: 'work', p_limit: 8 } }]);
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
    expect(calls[0].args).toMatchObject({ p_space: 'work', p_query: '', p_limit: 100, p_before_id: null });
    expect(calls[1].args).toMatchObject({
      p_before_created: cursor.created_at,
      p_before_id: idA,
      p_before_date: '2026-09-13',
    });
    expect(json(result)).toEqual({ kinds: [{ kind: 'note', count: 1 }, { kind: 'quote', count: 2 }] });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun run --cwd frontend test tests/mcp.test.ts`
Expected: FAIL, cannot find module `../scripts/mcp-core.ts`.

- [ ] **Step 4: Write the implementation**

Create `frontend/scripts/mcp-core.ts`:

```ts
import { z } from 'zod';
import {
  entryContext,
  entryDate,
  entrySchema,
  pageSchema,
  spaceSchema,
  type Entry,
  type EntryCursor,
} from '../src/domain/entries.ts';
import { linkTargetSchema, linksToText } from '../src/domain/links.ts';

export type RpcResult = { data: unknown; error: { code: string } | null };
export type BookClient = {
  signedIn(): Promise<boolean>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
};
export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export const loginHint =
  'Not signed in. Run `bun run --cwd frontend mcp login` in the commonplace repo, then try again.';

export function messageFor(code: string): string {
  if (code === 'PT409') return 'This entry changed since you read it. Read it again and retry.';
  if (code === 'PT404') return 'Entry not found.';
  if (['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return loginHint;
  if (['22023', '23514', '23502', '22P02'].includes(code)) return `Invalid entry details (${code}).`;
  return 'Could not reach your book. Try again shortly.';
}

export class ToolError extends Error {
  code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const space = spaceSchema.default('personal');
export const inputs = {
  search_entries: {
    query: z.string().max(500).default(''),
    kind: z.string().trim().min(1).max(64).optional(),
    space,
    limit: z.number().int().min(1).max(100).default(20),
  },
  search_titles: { query: z.string().trim().min(1).max(300), space },
  list_kinds: { space },
};

export async function call<T>(
  client: BookClient,
  schema: z.ZodType<T>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new ToolError(messageFor(error.code), error.code);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ToolError('Your book returned an unexpected response.');
  return parsed.data;
}

// Every tool goes through here: the session check, JSON output, and the promise that a
// failure of any kind becomes a readable tool error instead of a dead server.
export async function run(client: BookClient, work: () => Promise<unknown>): Promise<ToolResult> {
  try {
    if (!(await client.signedIn())) throw new ToolError(loginHint);
    return { content: [{ type: 'text', text: JSON.stringify(await work(), null, 2) }] };
  } catch (error) {
    let message: string;
    if (error instanceof ToolError) {
      if (error.code) console.error('commonplace mcp: database code', error.code);
      message = error.message;
    } else if (error instanceof z.ZodError) {
      message = 'Invalid input. ' + z.prettifyError(error);
    } else {
      message = error instanceof Error ? error.message : String(error);
    }
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

function listArgs(input: { query: string; kind?: string; space: string; limit: number }, cursor: EntryCursor | null) {
  return {
    p_query: input.query,
    p_space: input.space,
    p_order: 'newest',
    p_kind: input.kind ?? null,
    p_before_created: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
    ...(cursor?.entry_date ? { p_before_date: cursor.entry_date } : {}),
    p_limit: input.limit,
  };
}

function summary(entry: Entry) {
  return {
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    date: entryDate(entry),
    tags: entryContext(entry.metadata).tags,
    excerpt: linksToText(entry.body).slice(0, 300),
  };
}

export function searchEntries(client: BookClient, raw: unknown): Promise<ToolResult> {
  return run(client, async () => {
    const input = z.object(inputs.search_entries).parse(raw);
    const page = await call(client, pageSchema, 'list_entries', listArgs(input, null));
    return { entries: page.items.map(summary) };
  });
}

export function searchTitles(client: BookClient, raw: unknown): Promise<ToolResult> {
  return run(client, async () => {
    const input = z.object(inputs.search_titles).parse(raw);
    const titles = await call(client, z.array(linkTargetSchema), 'search_titles', {
      p_query: input.query,
      p_space: input.space,
      p_limit: 8,
    });
    return { titles };
  });
}

export function listKinds(client: BookClient, raw: unknown): Promise<ToolResult> {
  return run(client, async () => {
    const input = z.object(inputs.list_kinds).parse(raw);
    const counts = new Map<string, number>();
    let cursor: EntryCursor | null = null;
    do {
      const page = await call(
        client,
        pageSchema,
        'list_entries',
        listArgs({ query: '', space: input.space, limit: 100 }, cursor),
      );
      for (const entry of page.items) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
      cursor = page.nextCursor;
    } while (cursor);
    const kinds = [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, count]) => ({ kind, count }));
    return { kinds };
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run --cwd frontend test tests/mcp.test.ts`
Expected: 10 passed. If `z.prettifyError` is reported missing, check the installed Zod (`bun pm ls --cwd frontend | grep zod`); it exists from Zod 4.0 on, which `package.json` already requires.

- [ ] **Step 6: Typecheck, format, commit**

Run: `bun run --cwd frontend typecheck && bun run --cwd frontend format && bun run --cwd frontend format:check`

```sh
git add frontend/package.json frontend/bun.lock frontend/scripts/mcp-core.ts frontend/tests/mcp.test.ts
git commit -m "feat(mcp): Add the read tools"
```

---

### Task 3: Core writes and reads of one entry: get_entry, save_entry

**Files:**
- Modify: `frontend/scripts/mcp-core.ts`
- Modify: `frontend/tests/mcp.test.ts`

**Interfaces:**
- Consumes: from Task 2, `call`, `run`, `ToolError`, `inputs`, `BookClient`, `ToolResult`; from the domain, `contextSchema`, `entrySpace`, `draftSchema`, `connectionsSchema`.
- Produces: `getEntry(client, raw)`, `saveEntry(client, raw)`; `inputs.get_entry`, `inputs.save_entry`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/mcp.test.ts` (extend the import from `../scripts/mcp-core.ts` with `getEntry` and `saveEntry`):

```ts
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
          metadata: { space: 'work', date: '2020-01-02', tags: ['wool'], url: 'https://x.y', source: 'Book', images: [image] },
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
    const result = await saveEntry(client, { title: 'New', body: 'Text', kind: 'note', tags: ['a'] });
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
    expect(json(result)).toEqual({ id: args.p_entry_id, title: 'New', kind: 'note', space: 'personal', version: 1 });
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
      metadata: { space: 'work', date: '2020-01-02', tags: ['wool'], url: 'https://x.y', source: 'Book', images: [image] },
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
      p_context: { space: 'work', date: '2020-01-02', tags: [], url: 'https://x.y', source: 'Book', images: [image] },
    });
    expect(json(result)).toEqual({ id: idA, title: 'Old', kind: 'quote', space: 'work', version: 4 });
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
    const { client, calls } = fakeClient({ get_entry: ok(row(idA, { version: 5 })), save_entry: fail('PT409') });
    const result = await saveEntry(client, { id: idA, version: 4, body: 'x' });
    expect(text(result)).toBe('This entry changed since version 4. Read it again and retry.');
    expect(calls.filter((c) => c.name === 'save_entry')).toHaveLength(1);
  });

  it('rejects a bad date, a non-http url and too many tags before calling the book', async () => {
    const { client, calls } = fakeClient({});
    const base = { title: 'T', body: 'B', kind: 'note' };
    expect((await saveEntry(client, { ...base, date: '2020-13-01' })).isError).toBe(true);
    expect((await saveEntry(client, { ...base, url: 'ftp://x' })).isError).toBe(true);
    expect((await saveEntry(client, { ...base, tags: Array.from({ length: 31 }, (_, i) => 't' + i) })).isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd frontend test tests/mcp.test.ts`
Expected: FAIL, `getEntry` and `saveEntry` are not exported.

- [ ] **Step 3: Write the implementation**

In `frontend/scripts/mcp-core.ts`, extend the domain imports with `contextSchema`, `draftSchema`, `entrySpace`, and the links import with `connectionsSchema`; add `import { randomUUID } from 'node:crypto';`. Add to `inputs`:

```ts
  get_entry: { id: z.uuid() },
  save_entry: {
    id: z.uuid().optional(),
    version: z.number().int().min(1).optional(),
    title: draftSchema.shape.title.optional(),
    body: draftSchema.shape.body.optional(),
    kind: draftSchema.shape.kind.optional(),
    space: spaceSchema.optional(),
    date: z.union([z.iso.date(), z.literal('')]).optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
    url: z.string().trim().max(2048).optional(),
    source: z.string().trim().max(1000).optional(),
  },
```

The context fields deliberately do not reuse `contextSchema.shape.*`: those carry defaults, and a default would turn "not given" into "set to empty", wiping a date or the tags on update. The merged context is validated by `contextSchema.parse` below, which applies the year and URL rules.

Append the two tools:

```ts
export function getEntry(client: BookClient, raw: unknown): Promise<ToolResult> {
  return run(client, async () => {
    const input = z.object(inputs.get_entry).parse(raw);
    const entry = await call(client, entrySchema, 'get_entry', { p_entry_id: input.id });
    const connections = await call(client, connectionsSchema, 'entry_connections', {
      p_entry_id: input.id,
    });
    const context = entryContext(entry.metadata);
    return {
      id: entry.id,
      title: entry.title,
      kind: entry.kind,
      body: entry.body,
      space: context.space,
      date: entryDate(entry),
      tags: context.tags,
      url: context.url,
      source: context.source,
      images: context.images.map((image) => image.name),
      version: entry.version,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...connections,
    };
  });
}

function given<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function saveEntry(client: BookClient, raw: unknown): Promise<ToolResult> {
  return run(client, async () => {
    const input = z.object(inputs.save_entry).parse(raw);
    if ((input.id === undefined) !== (input.version === undefined)) {
      throw new ToolError('Give both id and version to update an entry, or neither to create one.');
    }
    const fields = given({
      space: input.space,
      date: input.date,
      tags: input.tags,
      url: input.url,
      source: input.source,
    });
    let title: string, body: string, kind: string, context: unknown;
    if (input.id === undefined) {
      if (!input.title || input.body === undefined || !input.kind) {
        throw new ToolError('A new entry needs a title, body and kind.');
      }
      ({ title, body, kind } = input);
      context = contextSchema.parse({ ...fields, images: [] });
    } else {
      const current = await call(client, entrySchema, 'get_entry', { p_entry_id: input.id });
      title = input.title ?? current.title;
      body = input.body ?? current.body;
      kind = input.kind ?? current.kind;
      context = contextSchema.parse({ ...entryContext(current.metadata), ...fields });
    }
    const { data, error } = await client.rpc('save_entry', {
      p_request_id: randomUUID(),
      p_entry_id: input.id ?? randomUUID(),
      p_expected_version: input.version ?? null,
      p_title: title,
      p_body_markdown: body,
      p_kind: kind,
      p_context: context,
    });
    if (error?.code === 'PT409') {
      throw new ToolError(
        `This entry changed since version ${input.version}. Read it again and retry.`,
        error.code,
      );
    }
    if (error) throw new ToolError(messageFor(error.code), error.code);
    const saved = entrySchema.safeParse(data);
    if (!saved.success) throw new ToolError('Your book returned an unexpected response.');
    return {
      id: saved.data.id,
      title: saved.data.title,
      kind: saved.data.kind,
      space: entrySpace(saved.data),
      version: saved.data.version,
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run --cwd frontend test tests/mcp.test.ts`
Expected: 19 passed.

- [ ] **Step 5: Typecheck, format, commit**

Run: `bun run --cwd frontend typecheck && bun run --cwd frontend format && bun run --cwd frontend format:check`

```sh
git add frontend/scripts/mcp-core.ts frontend/tests/mcp.test.ts
git commit -m "feat(mcp): Add get_entry and save_entry"
```

---

### Task 4: Register the tools and serve them; login and logout

**Files:**
- Modify: `frontend/scripts/mcp-core.ts` (add `registerTools`)
- Modify: `frontend/tests/mcp.test.ts` (wiring test)
- Create: `frontend/scripts/terminal.ts`
- Modify: `frontend/scripts/export.ts` (import from `./terminal.ts`; delete the moved functions)
- Create: `frontend/scripts/mcp.ts`
- Modify: `frontend/package.json` (`"mcp": "node scripts/mcp.ts"` after `"export"`)

**Interfaces:**
- Consumes: everything from Tasks 1 to 3; `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`; `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`; in the test, `Client` from `@modelcontextprotocol/sdk/client/index.js` and `InMemoryTransport` from `@modelcontextprotocol/sdk/inMemory.js`.
- Produces: `registerTools(server: McpServer, client: BookClient): void`; the `mcp` package script with `login`, `logout` and default `serve`.

- [ ] **Step 1: Write the failing wiring test**

Append to `frontend/tests/mcp.test.ts` (add `registerTools` to the core import, and at the top: `import { Client } from '@modelcontextprotocol/sdk/client/index.js'; import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';`):

```ts
describe('server', () => {
  it('exposes the five tools and answers a call over MCP', async () => {
    const { client: book } = fakeClient({ list_entries: ok({ items: [row(idA)], next_cursor: null }) });
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --cwd frontend test tests/mcp.test.ts`
Expected: FAIL, `registerTools` is not exported.

- [ ] **Step 3: Add registerTools**

In `frontend/scripts/mcp-core.ts`, add `import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';` and append:

```ts
const linkHelp =
  'Bodies are Markdown. Link to another entry with [[Title]] (the entry with that title in the ' +
  'same space; it stays an unresolved link until such an entry exists, which is fine) or with ' +
  '[[id|Label]] when you know the id (preferred; use search_titles to find one). Links inside ' +
  'code are ignored.';

export function registerTools(server: McpServer, client: BookClient): void {
  server.registerTool(
    'search_entries',
    {
      title: 'Search entries',
      description:
        'Search the book by words in titles and bodies, newest first. With no query, lists the ' +
        'most recent entries. Returns at most `limit` (default 20, max 100) entries with an excerpt; ' +
        'refine the query rather than paging.',
      inputSchema: inputs.search_entries,
    },
    (args) => searchEntries(client, args),
  );
  server.registerTool(
    'get_entry',
    {
      title: 'Get entry',
      description:
        'Read one entry in full by id, with the entries it links to, the entries that link to it, ' +
        'and the titles of links that resolve to nothing yet. Image attachments are listed by name only.',
      inputSchema: inputs.get_entry,
    },
    (args) => getEntry(client, args),
  );
  server.registerTool(
    'search_titles',
    {
      title: 'Search titles',
      description:
        'Find up to 8 entries whose title contains the query, to get an id for a [[id|Label]] link ' +
        'or to confirm a title exists for a [[Title]] link.',
      inputSchema: inputs.search_titles,
    },
    (args) => searchTitles(client, args),
  );
  server.registerTool(
    'list_kinds',
    {
      title: 'List entry kinds',
      description: 'The entry kinds (types) in use in a space, with counts. File new entries under an existing kind when one fits.',
      inputSchema: inputs.list_kinds,
    },
    (args) => listKinds(client, args),
  );
  server.registerTool(
    'save_entry',
    {
      title: 'Save entry',
      description:
        'Create an entry (give title, body and kind; optionally space, date, tags, url, source) or ' +
        'update one (give id and the version from get_entry, plus only the fields to change; the ' +
        'rest, including images, are kept). A stale version fails without writing. ' +
        linkHelp,
      inputSchema: inputs.save_entry,
    },
    (args) => saveEntry(client, args),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run --cwd frontend test tests/mcp.test.ts`
Expected: 20 passed.

- [ ] **Step 5: Move the terminal helpers out of export.ts**

Create `frontend/scripts/terminal.ts` containing, unchanged, the `loadLocalEnv`, `ask` and `askHidden` functions currently in `frontend/scripts/export.ts` (lines 9 to 79 of that file at the time of writing, from the `// Mirrors check-connection.mjs` comment through the end of `askHidden`), each marked `export`. `loadLocalEnv` resolves `.env.local` with `new URL('../.env.local', import.meta.url)`, which still points at `frontend/.env.local` from the new file. Add the imports the moved code needs (`readFile` from `node:fs/promises`, `createInterface` from `node:readline/promises`).

In `frontend/scripts/export.ts`, delete the three functions and their now-unused imports (`readFile`, `createInterface`), and add `import { ask, askHidden, loadLocalEnv } from './terminal.ts';`.

Run: `bun run --cwd frontend test tests/export.test.ts && bun run --cwd frontend typecheck`
Expected: export tests unchanged and passing; no type errors.

- [ ] **Step 6: Write the server entry**

Create `frontend/scripts/mcp.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient } from '@supabase/supabase-js';
import { registerTools, type BookClient } from './mcp-core.ts';
import { sessionFile, sessionPath } from './mcp-session.ts';
import { ask, askHidden, loadLocalEnv } from './terminal.ts';

async function main(argv: string[]): Promise<number> {
  const command = argv[0] ?? 'serve';
  if (!['serve', 'login', 'logout'].includes(command) || argv.length > 1) {
    console.error('Usage: mcp [login | logout]   (no argument serves MCP over stdio)');
    return 1;
  }
  await loadLocalEnv();
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || key.includes('replace_me')) {
    console.error('Configure the project URL and publishable key in frontend/.env.local first.');
    return 1;
  }
  const path = sessionPath();
  const storage = sessionFile(path, url);
  const supabase = createClient(url, key, {
    db: { schema: 'api' },
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: command === 'serve',
      detectSessionInUrl: false,
    },
  });

  if (command === 'login') {
    const email = process.env.COMMONPLACE_EMAIL || (await ask('Email: '));
    const password = process.env.COMMONPLACE_PASSWORD || (await askHidden('Password: '));
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('Could not sign in. Check the email and password, then try again.');
      return 1;
    }
    console.log('Signed in. Session saved to', path);
    return 0;
  }

  if (command === 'logout') {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('The session could not be revoked remotely:', error.message);
    await storage.removeItem('');
    console.log('Signed out. Removed', path);
    return error ? 1 : 0;
  }

  const client: BookClient = {
    async signedIn() {
      const { data } = await supabase.auth.getSession();
      return data.session !== null;
    },
    async rpc(name, args) {
      const { data, error } = await supabase.rpc(name, args);
      return { data, error: error ? { code: error.code ?? 'unknown' } : null };
    },
  };
  const server = new McpServer({ name: 'commonplace', version: '0.1.0' });
  registerTools(server, client);
  // The token refresh timer would otherwise keep the process alive after the client goes away.
  process.stdin.once('end', () => process.exit(0));
  await server.connect(new StdioServerTransport());
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
```

`signOut()` uses the default global scope, so the refresh token is revoked at Supabase and supabase-js also calls the adapter's `removeItem`; the explicit `removeItem` after it covers the case where there was no session to revoke. Setting `process.exitCode` does not end the process: in `serve` it stays alive while stdin is open, which is what the client expects.

Add to `frontend/package.json` scripts, directly after `"export"`:

```json
    "mcp": "node scripts/mcp.ts",
```

- [ ] **Step 7: Smoke the entry by hand**

Run from the repo root:

```sh
bun run --cwd frontend mcp bogus; echo "exit $?"
```
Expected: the usage line on stderr and `exit 1`.

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | bun run --cwd frontend mcp
```
Expected: one JSON line on stdout containing `"serverInfo":{"name":"commonplace"` and the process exits when stdin closes. Do not run `login` here; that is the user's step in Task 5.

- [ ] **Step 8: Typecheck, format, full suite, commit**

Run: `bun run --cwd frontend typecheck && bun run --cwd frontend format && bun run --cwd frontend format:check && bun run --cwd frontend test`
Expected: all green, including the existing export, database and app tests.

```sh
git add frontend/scripts/mcp-core.ts frontend/scripts/mcp.ts frontend/scripts/terminal.ts frontend/scripts/export.ts frontend/tests/mcp.test.ts frontend/package.json
git commit -m "feat(mcp): Serve the book over stdio with login and logout"
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/hosted-setup.md` (intro line 3; new section 7 before `## Checks`)
- Modify: `README.md` (features list and current limits)

- [ ] **Step 1: Setup guide**

In `docs/hosted-setup.md` line 3, change `Tags, links, sources, attachments, offline capture and MCP are later milestones.` to `Offline capture and a remote agent server are later milestones.`

Insert before `## Checks`:

````markdown
## 7. Connect Claude Code and Codex

A local MCP server lets an agent session search, read, create and update entries in your book. It runs from this repo on your machine and signs in as you; nothing is hosted and nothing new is exposed on the internet. Agents cannot delete entries.

Sign in once per machine. The password is not echoed and is never written to disk; only the resulting session is saved, readable by your user alone, at `~/.config/commonplace/session.json` (or under `$XDG_CONFIG_HOME`).

```sh
bun run --cwd frontend mcp login
```

Then register the server with each client, using the absolute path to this repo:

```sh
claude mcp add -s user commonplace -- node /absolute/path/to/commonplace/frontend/scripts/mcp.ts
codex mcp add commonplace -- node /absolute/path/to/commonplace/frontend/scripts/mcp.ts
```

The script finds `frontend/.env.local` relative to itself, so no working directory is needed. Ask the agent to search your book; if it answers that it is not signed in, run the login command again. To sign out and revoke the saved session, run `bun run --cwd frontend mcp logout`; deleting the session file has the same effect on that machine.

The tools are `search_entries`, `get_entry`, `search_titles`, `list_kinds` and `save_entry`. Every read and write names a space, `personal` by default. Updates carry the version the agent read, so a stale edit fails instead of overwriting, exactly as in the app, and fields the agent does not mention, including images, are kept. Links are written in the body as `[[Title]]` or `[[id|Label]]` and behave as they do in the app.

To point a client at the Preview project instead, add the Preview project's URL and publishable key to the server's environment (`-e VITE_SUPABASE_URL=… -e VITE_SUPABASE_PUBLISHABLE_KEY=…` for Claude Code, `--env` for Codex) and run the login command with the same two variables set. The session file records which project it belongs to, so a production session is never used against the Preview project.
````

- [ ] **Step 2: README**

In `README.md`, add to the "What you can do" list, after the links bullet:

```markdown
- Let Claude Code or Codex search, read, create and update entries through the local MCP server; see [connecting agents](docs/hosted-setup.md#7-connect-claude-code-and-codex).
```

In "Current limits", change `Offline capture, general file attachments, import and agent access are not implemented.` to `Offline capture, general file attachments and import are not implemented. Agent access is local to machines with the repo; phone and claude.ai access would need a hosted server.`

- [ ] **Step 3: Commit**

```sh
git add docs/hosted-setup.md README.md
git commit -m "docs: Explain connecting Claude Code and Codex"
```

---

## After the plan: user steps

These are not tasks for an implementer; the controller hands them to the user once the branch is reviewed.

1. `bun run --cwd frontend mcp login` on this Mac.
2. `claude mcp add -s user commonplace -- node /Users/ines/Documents/repos/commonplace/frontend/scripts/mcp.ts`, then in a fresh Claude Code session ask it to search the book, create an entry that links to an existing title, and update that entry. Confirm in the app that the link resolves and any images survived the update.
3. Merge into `develop` with `--no-ff`, then into `main`, and push when asked. Nothing to deploy: the server is not part of the Vercel build.
4. Update the direction memory: agents shipped; semantic search is next.
