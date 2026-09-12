import type { Meta, StoryObj } from '@storybook/react-vite';
import { entry } from '../../.storybook/fixtures';
import { EntryContextDetails } from './EntryContextDetails';

const meta = {
  title: 'Entries/Context details',
  component: EntryContextDetails,
  args: { metadata: entry.metadata, showDate: true },
} satisfies Meta<typeof EntryContextDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Complete: Story = {};
export const Empty: Story = { args: { metadata: {} } };
export const TagsOnly: Story = {
  args: { metadata: { tags: ['writing', 'ideas', 'books', 'work', 'recipes', 'memories'] } },
};
export const LongContent: Story = {
  args: {
    metadata: {
      tags: ['a longer label about collecting and connecting thoughts', 'reading notes'],
      source:
        'A collection of notes, quotations, and observations gathered over several months of reading and revisiting the same questions.',
      url: 'https://example.com/notebooks/reading-and-writing/collecting-thoughts-and-making-connections',
    },
  },
};
