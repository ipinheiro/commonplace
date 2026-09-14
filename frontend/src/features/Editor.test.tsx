// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataError, type Entry } from '../domain/entries';
import { getEntry, saveEntry, searchTitles } from '../data/knowledge';
import { Editor } from './Editor';

vi.mock('../data/knowledge', () => ({
  saveEntry: vi.fn(),
  getEntry: vi.fn(),
  searchTitles: vi.fn(),
}));
const entry: Entry = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Original thought',
  body: 'Words to keep',
  kind: 'note',
  metadata: { custom: 'preserved' },
  createdAt: '2026-09-11T12:00:00Z',
  updatedAt: '2026-09-11T12:00:00Z',
  version: 1,
  deletedAt: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchTitles).mockResolvedValue([]);
});
afterEach(cleanup);

it('lets the user reauthenticate without discarding a rejected save', async () => {
  const user = userEvent.setup();
  vi.mocked(saveEntry).mockRejectedValue(new DataError('auth', 'Sign in again to save.'));
  const reauthenticate = vi.fn();
  render(
    <Editor entry={entry} onSaved={vi.fn()} onClose={vi.fn()} onReauthenticate={reauthenticate} />,
  );
  await user.type(screen.getByLabelText('Title'), ' with new details');
  await user.click(screen.getByRole('button', { name: /Save entry/ }));
  await user.click(await screen.findByRole('button', { name: 'Sign in again' }));
  expect(reauthenticate).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Title')).toHaveValue('Original thought with new details');
});

it('preserves the draft and retries the identical uncertain create request', async () => {
  const user = userEvent.setup();
  vi.mocked(saveEntry)
    .mockRejectedValueOnce(new DataError('unavailable', 'Connection interrupted'))
    .mockResolvedValueOnce(entry);
  const onSaved = vi.fn();
  render(<Editor entry={null} onSaved={onSaved} onClose={vi.fn()} />);
  await user.type(screen.getByLabelText('Title'), 'Words for tomorrow');
  await user.type(screen.getByLabelText(/Your entry/), 'A draft I do not want to lose.');
  await user.click(screen.getByRole('button', { name: /Save entry/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
  expect(screen.getByLabelText('Title')).toHaveValue('Words for tomorrow');
  expect(screen.getByLabelText(/Your entry/)).toHaveValue('A draft I do not want to lose.');
  expect(screen.getByLabelText('Title')).toBeDisabled();
  await user.click(screen.getByRole('button', { name: /Retry save/ }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(entry));
  expect(vi.mocked(saveEntry).mock.calls[0][0]).toEqual(vi.mocked(saveEntry).mock.calls[1][0]);
});

it('keeps a conflicting draft until the user reviews the newer version', async () => {
  const user = userEvent.setup();
  vi.mocked(saveEntry)
    .mockRejectedValueOnce(new DataError('conflict', 'Changed elsewhere'))
    .mockResolvedValueOnce({ ...entry, version: 3, body: 'My changes' });
  vi.mocked(getEntry).mockResolvedValue({ ...entry, version: 2, body: 'Changes from my phone' });
  render(<Editor entry={entry} onSaved={vi.fn()} onClose={vi.fn()} />);
  await user.clear(screen.getByLabelText(/Your entry/));
  await user.type(screen.getByLabelText(/Your entry/), 'My changes');
  await user.click(screen.getByRole('button', { name: /Save entry/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Changed elsewhere');
  expect(screen.getByLabelText(/Your entry/)).toHaveValue('My changes');
  expect(screen.getByRole('button', { name: /Save entry/ })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: /Compare with/ }));
  expect(await screen.findByText('Changes from my phone')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Keep my draft/ }));
  await user.click(screen.getByRole('button', { name: /Save entry/ }));
  await waitFor(() => expect(saveEntry).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveEntry).mock.calls[1][0].expectedVersion).toBe(2);
  expect(vi.mocked(saveEntry).mock.calls[1][0].draft.body).toBe('My changes');
});

it('allows correcting rejected input without recycling the previous request', async () => {
  const user = userEvent.setup();
  vi.mocked(saveEntry)
    .mockRejectedValueOnce(new DataError('invalid', 'Please revise the input'))
    .mockResolvedValueOnce(entry);
  render(<Editor entry={entry} onSaved={vi.fn()} onClose={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /Save entry/ }));
  await screen.findByRole('alert');
  await user.type(screen.getByLabelText('Title'), ' revised');
  await user.click(screen.getByRole('button', { name: /Save entry/ }));
  await waitFor(() => expect(saveEntry).toHaveBeenCalledTimes(2));
  const [first, second] = vi.mocked(saveEntry).mock.calls;
  expect(second[0].requestId).not.toBe(first[0].requestId);
  expect(second[0].draft.title).toBe('Original thought revised');
});

const scarf = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Winter scarf',
  kind: 'pattern',
};

it('offers entries after [[ and inserts the chosen one as an ID link', async () => {
  const user = userEvent.setup();
  vi.mocked(searchTitles).mockResolvedValue([scarf]);
  render(<Editor entry={null} onSaved={vi.fn()} onClose={vi.fn()} />);
  const body = screen.getByLabelText(/Your entry/);
  await user.type(body, 'See [[[[win');
  const option = await screen.findByRole('option', { name: /Winter scarf/ });
  await waitFor(() =>
    expect(searchTitles).toHaveBeenLastCalledWith('win', 'personal', expect.anything()),
  );
  expect(option).toHaveAttribute('aria-selected', 'true');
  await user.keyboard('{Enter}');
  expect(body).toHaveValue(`See [[${scarf.id}|Winter scarf]]`);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('closes the picker on Escape without closing the editor, and on ]]', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  vi.mocked(searchTitles).mockResolvedValue([scarf]);
  render(<Editor entry={null} onSaved={vi.fn()} onClose={onClose} />);
  const body = screen.getByLabelText(/Your entry/);
  await user.type(body, '[[[[wi');
  await screen.findByRole('listbox');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  await user.type(body, 'nter]]');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(body).toHaveValue('[[winter]]');
});

it('searches the space chosen in the editor', async () => {
  const user = userEvent.setup();
  render(<Editor entry={null} initialSpace="work" onSaved={vi.fn()} onClose={vi.fn()} />);
  await user.type(screen.getByLabelText(/Your entry/), '[[[[plan');
  await waitFor(() =>
    expect(searchTitles).toHaveBeenLastCalledWith('plan', 'work', expect.anything()),
  );
});
