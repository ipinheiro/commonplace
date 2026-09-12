import type { Entry, EntryImage } from '../src/domain/entries';

export const image: EntryImage = {
  path: '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333',
  name: 'Commonplace illustration',
};

export const entry: Entry = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'A place for unfinished thoughts',
  body: '## Notes from today\n\nKeep a **small collection** of things to return to.\n\n- A line from a book\n- An idea for later\n\n> Leave room for connections.\n\n[Source](https://example.com/notes)',
  kind: 'note',
  metadata: {
    space: 'personal',
    date: '2026-09-12',
    tags: ['writing', 'ideas', 'commonplace'],
    source: 'Reading notebook',
    url: 'https://example.com/notes',
    images: [image],
  },
  createdAt: '2026-09-12T09:00:00Z',
  updatedAt: '2026-09-12T09:00:00Z',
  version: 1,
  deletedAt: null,
};
