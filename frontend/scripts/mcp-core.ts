import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  contextSchema,
  draftSchema,
  entryContext,
  entryDate,
  entrySchema,
  entrySpace,
  pageSchema,
  spaceSchema,
  type Entry,
  type EntryCursor,
  type EntryPage,
} from '../src/domain/entries.ts';
import { connectionsSchema, linkTargetSchema, linksToText } from '../src/domain/links.ts';

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
  if (['22023', '23514', '23502', '22P02'].includes(code))
    return `Invalid entry details (${code}).`;
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

function listArgs(
  input: { query: string; kind?: string; space: string; limit: number },
  cursor: EntryCursor | null,
) {
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
      const page: EntryPage = await call(
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
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
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
      description:
        'The entry kinds (types) in use in a space, with counts. File new entries under an existing kind when one fits.',
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
