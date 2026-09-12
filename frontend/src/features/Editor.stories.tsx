import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, mocked } from 'storybook/test';
import { entry } from '../../.storybook/fixtures';
import { saveEntry } from '../data/knowledge';
import { DataError } from '../domain/entries';
import { Editor } from './Editor';

const meta = {
  title: 'Entries/Editor',
  component: Editor,
  parameters: { layout: 'fullscreen' },
  args: {
    entry: null,
    onSaved: fn(),
    onClose: fn(),
    onReauthenticate: fn(),
  },
} satisfies Meta<typeof Editor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewEntry: Story = {};
export const Populated: Story = { args: { entry } };
export const WorkEntry: Story = { args: { initialSpace: 'work' } };
export const MarkdownPreview: Story = {
  args: { entry },
  async play({ canvas, userEvent }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Preview' }));
    await expect(canvas.getByRole('heading', { name: 'Notes from today' })).toBeVisible();
  },
};
export const Saving: Story = {
  args: { entry },
  beforeEach() {
    mocked(saveEntry).mockImplementation(() => new Promise(() => {}));
  },
  async play({ canvas, userEvent }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Save entry' }));
    await expect(canvas.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  },
};
export const SaveError: Story = {
  args: { entry },
  beforeEach() {
    mocked(saveEntry).mockRejectedValue(
      new DataError('unavailable', 'The save could not be confirmed. Retry to check it safely.'),
    );
  },
  async play({ canvas, userEvent }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Save entry' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The save could not be confirmed.',
    );
  },
};
export const SaveConflict: Story = {
  args: { entry },
  beforeEach() {
    mocked(saveEntry).mockRejectedValue(
      new DataError('conflict', 'This entry changed in another session.'),
    );
  },
  async play({ canvas, userEvent }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Save entry' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'This entry changed in another session.',
    );
  },
};
