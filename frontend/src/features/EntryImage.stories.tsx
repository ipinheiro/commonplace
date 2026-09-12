import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, mocked } from 'storybook/test';
import { image } from '../../.storybook/fixtures';
import { imageUrl } from '../data/images';
import { DataError } from '../domain/entries';
import { EntryImage } from './EntryImage';

const meta = {
  title: 'Entries/Image',
  component: EntryImage,
  args: { image },
} satisfies Meta<typeof EntryImage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const Loading: Story = {
  beforeEach() {
    mocked(imageUrl).mockImplementation(() => new Promise<string>(() => {}));
  },
};
export const Failed: Story = {
  beforeEach() {
    mocked(imageUrl).mockRejectedValue(new DataError('unavailable', 'Could not load this image.'));
  },
};
export const RetrySucceeds: Story = {
  beforeEach() {
    mocked(imageUrl).mockRejectedValueOnce(
      new DataError('unavailable', 'Could not load this image.'),
    );
  },
  async play({ canvas, userEvent }) {
    await userEvent.click(await canvas.findByRole('button', { name: /Retry loading/ }));
    await expect(await canvas.findByRole('img', { name: image.name })).toBeVisible();
  },
};
