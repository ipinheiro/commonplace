// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { signOut, watchSession, type Viewer } from './data/auth';
import {
  deleteEntry,
  entryConnections,
  getEntry,
  listEntries,
  listEntryKinds,
  searchTitles,
} from './data/knowledge';
import { emptyConnections } from './domain/links';
import { DataError, type Entry } from './domain/entries';

vi.mock('./data/supabase', () => ({ isConfigured: true }));
vi.mock('./data/auth', () => ({ watchSession: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('./data/knowledge', () => ({
  listEntries: vi.fn(),
  listEntryKinds: vi.fn(),
  getEntry: vi.fn(),
  saveEntry: vi.fn(),
  deleteEntry: vi.fn(),
  entryConnections: vi.fn(),
  searchTitles: vi.fn(),
}));
let changeSession: (viewer: Viewer | null) => void;
const owner: Viewer = { id: 'owner', email: 'owner@example.test' };
beforeEach(() => {
  window.location.hash = 'personal';
  vi.clearAllMocks();
  vi.mocked(watchSession).mockImplementation((callback) => {
    changeSession = callback;
    callback(owner);
    return () => {};
  });
  vi.mocked(listEntries).mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(listEntryKinds).mockResolvedValue([]);
  vi.mocked(entryConnections).mockResolvedValue(emptyConnections);
  vi.mocked(searchTitles).mockResolvedValue([]);
  vi.mocked(signOut).mockResolvedValue();
});
afterEach(cleanup);

function openApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  return client;
}

it('renders space arrows as decorative vectors rather than emoji-capable text', async () => {
  window.location.hash = '';
  openApp();
  for (const name of ['Open Personal', 'Open Work']) {
    const link = await screen.findByRole('link', { name: new RegExp(name) });
    expect(link).not.toHaveTextContent('↗');
    const arrow = link.querySelector('svg');
    expect(arrow).toHaveAttribute('aria-hidden', 'true');
    expect(arrow).toHaveAttribute('focusable', 'false');
  }
});

it('switches entry date ordering and starts oldest-first from the first page', async () => {
  const user = userEvent.setup();
  openApp();
  const order = await screen.findByRole('combobox', { name: 'Sort by entry date' });
  expect(order).toHaveValue('newest');
  await user.selectOptions(order, 'oldest');
  await waitFor(() =>
    expect(listEntries).toHaveBeenLastCalledWith(
      '',
      null,
      expect.any(AbortSignal),
      null,
      'personal',
      'oldest',
    ),
  );
  await user.selectOptions(order, 'newest');
  expect(order).toHaveValue('newest');
});

it('preserves an in-memory draft across session expiry for the same owner', async () => {
  const user = userEvent.setup();
  const client = openApp();
  await user.click(await screen.findByRole('button', { name: /New entry/ }));
  await user.type(screen.getByLabelText('Title'), 'Unfinished private thought');
  act(() => changeSession(null));
  expect(screen.getByLabelText('Email')).toBeVisible();
  expect(
    client
      .getQueryCache()
      .getAll()
      .every((query) => query.state.data === undefined),
  ).toBe(true);
  act(() => changeSession(owner));
  expect(screen.getByLabelText('Title')).toHaveValue('Unfinished private thought');
});

it('discards the previous owner draft when another account signs in', async () => {
  const user = userEvent.setup();
  openApp();
  await user.click(await screen.findByRole('button', { name: /New entry/ }));
  await user.type(screen.getByLabelText('Title'), 'Private to the first owner');
  act(() => changeSession({ id: 'other', email: 'other@example.test' }));
  expect(screen.queryByDisplayValue('Private to the first owner')).not.toBeInTheDocument();
  expect(screen.getByText('other@example.test')).toBeVisible();
});

it('clears cached entry data and open drafts on explicit logout', async () => {
  const user = userEvent.setup();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const client = openApp();
  await screen.findByRole('button', { name: /New entry/ });
  client.setQueryData(['private-data'], { secret: 'must be cleared' });
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(screen.getByLabelText('Email')).toBeVisible());
  expect(client.getQueryData(['private-data'])).toBeUndefined();
});

const kept: Entry = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Kept for now',
  body: 'A thought worth revisiting.',
  kind: 'note',
  metadata: { space: 'personal' },
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  version: 1,
  deletedAt: null,
};

async function openKeptEntry() {
  const user = userEvent.setup();
  window.location.hash = `entry/${kept.id}`;
  vi.mocked(listEntries).mockResolvedValue({ items: [kept], nextCursor: null });
  vi.mocked(getEntry).mockResolvedValue(kept);
  const client = openApp();
  await screen.findByRole('heading', { level: 1, name: kept.title });
  return { user, client };
}

it('deletes an entry only after a second press and returns to the book', async () => {
  const { user, client } = await openKeptEntry();
  vi.mocked(deleteEntry).mockResolvedValue();
  await user.click(screen.getByRole('button', { name: 'Delete entry' }));
  expect(deleteEntry).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('button', { name: 'Delete for good?' })).not.toBeInTheDocument();
  vi.mocked(listEntries).mockResolvedValue({ items: [], nextCursor: null });
  await user.click(screen.getByRole('button', { name: 'Delete entry' }));
  await user.click(screen.getByRole('button', { name: 'Delete for good?' }));
  await waitFor(() => expect(deleteEntry).toHaveBeenCalledWith(kept.id));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Entry deleted.'));
  expect(window.location.hash).toBe('#personal');
  expect(screen.queryByRole('heading', { level: 1, name: kept.title })).not.toBeInTheDocument();
  expect(client.getQueryData(['entry', owner.id, kept.id])).toBeUndefined();
});

it('treats an already deleted entry as deleted', async () => {
  const { user } = await openKeptEntry();
  vi.mocked(deleteEntry).mockRejectedValue(new DataError('not-found', 'Gone already.'));
  await user.click(screen.getByRole('button', { name: 'Delete entry' }));
  await user.click(screen.getByRole('button', { name: 'Delete for good?' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Entry deleted.'));
  expect(window.location.hash).toBe('#personal');
});

it('keeps the entry and shows the error when delete fails', async () => {
  const { user } = await openKeptEntry();
  vi.mocked(deleteEntry).mockRejectedValue(
    new DataError('unavailable', 'Could not reach your book.'),
  );
  await user.click(screen.getByRole('button', { name: 'Delete entry' }));
  await user.click(screen.getByRole('button', { name: 'Delete for good?' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach your book.'),
  );
  expect(screen.getByRole('heading', { level: 1, name: kept.title })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Delete for good?' })).toBeVisible();
  expect(window.location.hash).toBe(`#entry/${kept.id}`);
});

const scarf: Entry = {
  ...kept,
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Winter scarf',
  body: 'Moss stitch, warm wool.',
  kind: 'pattern',
};

it('renders resolved links as entry links and ghosts as buttons', async () => {
  vi.mocked(entryConnections).mockResolvedValue({
    links: [{ id: scarf.id, title: scarf.title, kind: scarf.kind }],
    backlinks: [],
    ghosts: ['Moss stitch'],
  });
  const kept2 = { ...kept, body: `Read [[${scarf.id}|old name]] and [[Moss stitch]].` };
  vi.mocked(getEntry).mockResolvedValue(kept2);
  vi.mocked(listEntries).mockResolvedValue({ items: [kept2], nextCursor: null });
  window.location.hash = `entry/${kept.id}`;
  openApp();
  const link = await screen.findByRole('link', { name: 'Winter scarf' });
  expect(link).toHaveAttribute('href', `#entry/${scarf.id}`);
  const ghost = screen.getByRole('button', { name: 'Moss stitch' });
  expect(ghost).toHaveClass('ghost-link');
});

it('opens the capture editor with the ghost title filled in', async () => {
  const user = userEvent.setup();
  const kept2 = { ...kept, body: 'Try [[Moss stitch]].' };
  vi.mocked(getEntry).mockResolvedValue(kept2);
  vi.mocked(listEntries).mockResolvedValue({ items: [kept2], nextCursor: null });
  window.location.hash = `entry/${kept.id}`;
  openApp();
  await user.click(await screen.findByRole('button', { name: 'Moss stitch' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByLabelText('Title')).toHaveValue('Moss stitch');
});

it('lists backlinks only when there are some', async () => {
  const { client } = await openKeptEntry();
  expect(screen.queryByRole('heading', { name: 'Linked from' })).not.toBeInTheDocument();
  vi.mocked(entryConnections).mockResolvedValue({
    links: [],
    backlinks: [{ id: scarf.id, title: scarf.title, kind: scarf.kind, entryDate: '2026-09-01' }],
    ghosts: [],
  });
  await client.invalidateQueries({ queryKey: ['connections', owner.id] });
  await screen.findByRole('heading', { name: 'Linked from' });
  expect(screen.getByRole('link', { name: /Winter scarf/ })).toHaveAttribute(
    'href',
    `#entry/${scarf.id}`,
  );
});
