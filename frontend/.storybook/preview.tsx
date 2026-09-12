import type { Preview } from '@storybook/react-vite';
import { withThemeByDataAttribute } from '@storybook/addon-themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, type ReactNode } from 'react';
import { mocked, sb } from 'storybook/test';
import { MINIMAL_VIEWPORTS } from 'storybook/viewport';
import { getEntry, saveEntry } from '../src/data/knowledge';
import { imageUrl, uploadImage } from '../src/data/images';
import { entry, image } from './fixtures';
import '@fontsource-variable/archivo/standard.css';
import '../src/styles.css';

sb.mock(import('../src/data/knowledge.ts'));
// Preserve the supported image types; replace both data functions below.
sb.mock(import('../src/data/images.ts'), { spy: true });

function StoryQueries({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const preview: Preview = {
  parameters: {
    layout: 'padded',
    backgrounds: { disable: true },
    viewport: { options: MINIMAL_VIEWPORTS },
  },
  decorators: [
    withThemeByDataAttribute({
      themes: { light: 'light', dark: 'dark' },
      defaultTheme: 'light',
      attributeName: 'data-theme',
    }),
    (Story, context) => (
      <StoryQueries key={context.id}>
        <Story />
      </StoryQueries>
    ),
  ],
  beforeEach() {
    mocked(imageUrl).mockReset().mockResolvedValue('/illustrations/witchy-commonplace.png');
    mocked(uploadImage).mockImplementation(async (_entryId, _imageId, file) => ({
      ...image,
      name: file.name,
    }));
    mocked(getEntry).mockResolvedValue({ ...entry, version: 2 });
    mocked(saveEntry).mockImplementation(async ({ entryId, draft, expectedVersion }) => ({
      ...entry,
      id: entryId,
      title: draft.title,
      body: draft.body,
      kind: draft.kind,
      metadata: draft.context,
      version: (expectedVersion ?? 0) + 1,
    }));
  },
};

export default preview;
