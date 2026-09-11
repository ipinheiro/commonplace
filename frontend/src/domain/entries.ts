import { z } from 'zod';

const timestamp = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp');
export const entrySchema = z
  .object({
    id: z.uuid(),
    title: z.string().min(1),
    body_markdown: z.string(),
    kind: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
    created_at: timestamp,
    updated_at: timestamp,
    version: z.number().int().positive(),
    deleted_at: timestamp.nullable(),
  })
  .transform((row) => ({
    id: row.id,
    title: row.title,
    body: row.body_markdown,
    kind: row.kind,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    deletedAt: row.deleted_at,
  }));

export type Entry = z.infer<typeof entrySchema>;
export const draftSchema = z.object({
  title: z.string().trim().min(1, 'Give this entry a title.').max(300),
  body: z.string().max(1_000_000),
  kind: z.string().trim().min(1, 'Choose an entry type.').max(64),
});
export type EntryDraft = z.infer<typeof draftSchema>;

export const cursorSchema = z.object({ created_at: timestamp, id: z.uuid() });
export type EntryCursor = z.infer<typeof cursorSchema>;
export const pageSchema = z
  .object({
    items: z.array(entrySchema),
    next_cursor: cursorSchema.nullable(),
  })
  .transform((page) => ({ items: page.items, nextCursor: page.next_cursor }));
export type EntryPage = z.infer<typeof pageSchema>;

export type SaveEntry = {
  entryId: string;
  requestId: string;
  expectedVersion: number | null;
  draft: EntryDraft;
};

export type DataErrorCode = 'auth' | 'conflict' | 'not-found' | 'invalid' | 'unavailable';
export class DataError extends Error {
  constructor(
    public readonly code: DataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DataError';
  }
}
