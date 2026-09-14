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
export const imageSchema = z.object({
  path: z.string().regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/),
  name: z.string().min(1).max(255),
});
export type EntryImage = z.infer<typeof imageSchema>;
export const spaceSchema = z.enum(['personal', 'work']);
export type Space = z.infer<typeof spaceSchema>;
export function entrySpace(entry: Entry): Space {
  return spaceSchema.catch('personal').parse(entry.metadata.space);
}

export const contextSchema = z.object({
  space: spaceSchema.default('personal'),
  date: z
    .union([z.iso.date(), z.literal('')])
    .refine((date) => !date.startsWith('0000'), 'Choose a year from 0001 to 9999.')
    .default(''),
  tags: z.array(z.string().trim().min(1).max(64)).max(30).default([]),
  url: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => {
      if (!value) return true;
      try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, 'Use a complete URL starting with https:// or http://.')
    .default(''),
  source: z.string().trim().max(1000).default(''),
  images: z.array(imageSchema).max(10).default([]),
});
export type EntryContext = z.infer<typeof contextSchema>;
export function entryDate(entry: Entry): string {
  return entryContext(entry.metadata).date || new Date(entry.createdAt).toISOString().slice(0, 10);
}
export function entryContext(metadata: Record<string, unknown>): EntryContext {
  return {
    space: spaceSchema.catch('personal').parse(metadata.space),
    date: contextSchema.shape.date.catch('').parse(metadata.date),
    tags: contextSchema.shape.tags.catch([]).parse(metadata.tags),
    url: contextSchema.shape.url.catch('').parse(metadata.url),
    source: contextSchema.shape.source.catch('').parse(metadata.source),
    images: contextSchema.shape.images.catch([]).parse(metadata.images),
  };
}

export const draftSchema = z.object({
  title: z.string().trim().min(1, 'Give this entry a title.').max(300),
  body: z.string().max(1_000_000),
  kind: z.string().trim().min(1, 'Choose an entry type.').max(64),
  context: contextSchema,
});
export type EntryDraft = z.infer<typeof draftSchema>;

export const cursorSchema = z.object({
  created_at: timestamp,
  id: z.uuid(),
  entry_date: z.iso.date().optional(),
});
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
  readonly code: DataErrorCode;
  constructor(code: DataErrorCode, message: string) {
    super(message);
    this.name = 'DataError';
    this.code = code;
  }
}
