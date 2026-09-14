import { z } from 'zod';
import {
  entryContext,
  entryDate,
  pageSchema,
  spaceSchema,
  type Entry,
  type EntryCursor,
  type EntryPage,
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
