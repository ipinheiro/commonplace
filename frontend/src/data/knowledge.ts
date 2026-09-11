import { z } from 'zod';
import {
  DataError,
  draftSchema,
  entrySchema,
  pageSchema,
  type Entry,
  type Space,
  type EntryCursor,
  type EntryPage,
  type SaveEntry,
} from '../domain/entries';
import { supabase } from './supabase';

function readResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new DataError(
      'unavailable',
      'Your book returned an unexpected response. Please try again.',
    );
  return result.data;
}

export function databaseError(code: string): DataError {
  if (code === 'PT409')
    return new DataError(
      'conflict',
      'This entry changed on another device. Your draft is still here.',
    );
  if (code === 'PT404') return new DataError('not-found', 'This entry is no longer available.');
  if (['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(code)) {
    return new DataError('auth', 'Your session has ended. Sign in again to save.');
  }
  if (['22023', '23514', '23502', '22P02'].includes(code)) {
    return new DataError('invalid', 'Some entry details are invalid. Check them and try again.');
  }
  return new DataError(
    'unavailable',
    'Could not reach your book. Your draft is still here; try again shortly.',
  );
}

async function rpc(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!supabase) throw new DataError('unavailable', 'The book is not connected yet.');
  try {
    const request = supabase.rpc(name, args);
    const { data, error } = await (signal ? request.abortSignal(signal) : request);
    if (error) throw databaseError(error.code);
    return data;
  } catch (error) {
    if (error instanceof DataError) throw error;
    throw databaseError('network');
  }
}

export async function listEntries(
  query: string,
  cursor: EntryCursor | null = null,
  signal?: AbortSignal,
  kind: string | null = null,
  space: Space = 'personal',
): Promise<EntryPage> {
  const result = await rpc(
    'list_entries',
    {
      p_query: query,
      p_space: space,
      p_kind: kind,
      p_before_created: cursor?.created_at ?? null,
      p_before_id: cursor?.id ?? null,
      ...(cursor?.entry_date ? { p_before_date: cursor.entry_date } : {}),
      p_limit: 30,
    },
    signal,
  );
  return readResponse(pageSchema, result);
}

export async function getEntry(id: string, signal?: AbortSignal): Promise<Entry> {
  return readResponse(
    entrySchema,
    await rpc('get_entry', { p_entry_id: z.uuid().parse(id) }, signal),
  );
}

export async function saveEntry(input: SaveEntry): Promise<Entry> {
  const draft = draftSchema.parse(input.draft);
  const result = await rpc('save_entry', {
    p_entry_id: z.uuid().parse(input.entryId),
    p_request_id: z.uuid().parse(input.requestId),
    p_expected_version: input.expectedVersion,
    p_title: draft.title,
    p_body_markdown: draft.body,
    p_kind: draft.kind,
    p_context: draft.context,
  });
  return readResponse(entrySchema, result);
}

// Discover types across every page, independently of the active search or filter.
export async function listEntryKinds(
  signal?: AbortSignal,
  space: Space = 'personal',
): Promise<string[]> {
  const kinds = new Set<string>();
  let cursor: EntryCursor | null = null;
  do {
    const page = await listEntries('', cursor, signal, null, space);
    for (const entry of page.items) kinds.add(entry.kind);
    cursor = page.nextCursor;
  } while (cursor && !signal?.aborted);
  return [...kinds].sort((a, b) => a.localeCompare(b));
}
