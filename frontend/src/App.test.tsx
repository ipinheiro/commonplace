// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { signOut, watchSession, type Viewer } from './data/auth';
import { listEntries, listEntryKinds } from './data/knowledge';

vi.mock('./data/supabase', () => ({ isConfigured: true }));
vi.mock('./data/auth', () => ({ watchSession: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('./data/knowledge', () => ({
  listEntries: vi.fn(),
  listEntryKinds: vi.fn(),
  getEntry: vi.fn(),
  saveEntry: vi.fn(),
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
