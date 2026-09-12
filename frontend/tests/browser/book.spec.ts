import { expect, test, type Page } from '@playwright/test';

type WireEntry = {
  id: string;
  title: string;
  body_markdown: string;
  kind: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: null;
};

async function fakeHostedApi(page: Page) {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'reader@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-09-11T12:00:00Z',
  };
  const entries: WireEntry[] = [
    {
      id: '33333333-3333-4333-8333-333333333333',
      title: 'A thought from the morning walk',
      body_markdown:
        'Ideas arrive when there is enough quiet to notice them. Take the long way home.',
      kind: 'note',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      title: 'A small reading ritual',
      body_markdown: 'Read a few pages slowly, then write down the one thing that stays.',
      kind: 'idea',
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Notes for the winter scarf',
      body_markdown:
        'Moss stitch, warm wool, a little patience. Keep the sample before starting again.',
      kind: 'pattern',
    },
  ].map((entry) => ({
    ...entry,
    metadata: {},
    version: 1,
    deleted_at: null,
    created_at: '2026-09-11T12:00:00Z',
    updated_at: '2026-09-11T12:00:00Z',
  }));
  await page.route('https://*.supabase.co/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/v1/token')) {
      return route.fulfill({
        json: {
          access_token: 'test-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'test-refresh',
          user,
        },
      });
    }
    if (path.endsWith('/auth/v1/user')) return route.fulfill({ json: user });
    if (path.endsWith('/auth/v1/logout')) return route.fulfill({ status: 204 });
    if (path.includes('/storage/v1/object/sign/') && route.request().method() === 'GET')
      return route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          'base64',
        ),
      });
    if (path.includes('/storage/v1/object/sign/'))
      return route.fulfill({
        json: { signedURL: '/object/sign/entry-images/test-image?token=test' },
      });
    if (path.includes('/storage/v1/object/') && route.request().method() === 'POST')
      return route.fulfill({ json: { Key: 'entry-images/test-image', Id: 'test-image' } });
    const body = route.request().postDataJSON() ?? {};
    if (path.endsWith('/rpc/list_entries'))
      return route.fulfill({
        json: {
          items: entries.filter(
            (entry) =>
              (entry.metadata.space ?? 'personal') === (body.p_space ?? 'personal') &&
              entry.title.toLowerCase().includes(String(body.p_query ?? '').toLowerCase()) &&
              (!body.p_kind || entry.kind === body.p_kind),
          ),
          next_cursor: null,
        },
      });
    if (path.endsWith('/rpc/get_entry'))
      return route.fulfill({ json: entries.find((entry) => entry.id === body.p_entry_id) });
    if (path.endsWith('/rpc/save_entry')) {
      let entry = entries.find((entry) => entry.id === body.p_entry_id);
      if (!entry) {
        entry = {
          id: body.p_entry_id,
          title: '',
          body_markdown: '',
          kind: 'note',
          metadata: {},
          version: 0,
          created_at: '2026-09-11T12:30:00Z',
          updated_at: '2026-09-11T12:30:00Z',
          deleted_at: null,
        };
        entries.unshift(entry);
      }
      Object.assign(entry, {
        title: body.p_title,
        body_markdown: body.p_body_markdown,
        kind: body.p_kind,
        version: entry.version + 1,
        metadata: { ...entry.metadata, ...(body.p_context ?? {}) },
      });
      return route.fulfill({ json: entry });
    }
    return route.fulfill({ status: 404, json: { message: 'Unexpected test request' } });
  });
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill('reader@example.test');
  await page.getByLabel('Password').fill('local-test-password');
  await page.getByRole('button', { name: 'Open your book' }).click();
  await page.getByRole('link', { name: /Open Personal/ }).click();
  await expect(page.getByRole('heading', { name: 'Your commonplace.' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'A thought from the morning walk' }),
  ).toBeVisible();
}

test('sign in, browse, capture, read and edit on desktop', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1360, height: 980 });
  await fakeHostedApi(page);
  await login(page);
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.getByRole('button', { name: /New entry/ }).click();
  await page.getByLabel('Title').fill('A new thing to keep');
  await page.getByLabel(/Your entry/).fill('This is **worth** remembering.');
  await page.getByRole('button', { name: /Save entry/ }).click();
  await expect(
    page
      .getByRole('region', { name: 'Entry reader' })
      .getByRole('heading', { name: 'A new thing to keep' }),
  ).toBeVisible();
  await expect(page.locator('strong')).toHaveText('worth');
  await page.getByRole('button', { name: 'Edit entry' }).click();
  await page.getByLabel(/Your entry/).fill('An updated thought.');
  await page.getByRole('button', { name: /Save entry/ }).click();
  await expect(
    page
      .getByRole('region', { name: 'Entry reader' })
      .getByText('An updated thought.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: /Back to your book/ }).click();
  await page.getByRole('textbox', { name: 'Search your book' }).fill('winter');
  await expect(page.getByRole('heading', { name: 'Notes for the winter scarf' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'A thought from the morning walk' }),
  ).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('phone layout and capture stay within the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeHostedApi(page);
  await login(page);
  await page.screenshot({ path: testInfo.outputPath('phone.png'), fullPage: true });
  await page.getByRole('button', { name: /New entry/ }).click();
  await page.getByLabel('Title').fill('From my phone');
  await page.getByLabel(/Your entry/).fill('A passing thought.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('phone-capture.png'), fullPage: true });
  await page.getByRole('button', { name: /Save entry/ }).click();
  await expect(page.getByRole('heading', { name: 'From my phone' })).toBeVisible();
});

test('theme persists and browsing preserves the search', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1360, height: 980 });
  await page.emulateMedia({ colorScheme: 'light' });
  await fakeHostedApi(page);
  await page.goto('/');
  await page.screenshot({ path: testInfo.outputPath('sign-in.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to light' })).toBeVisible();
  await login(page);
  await page.getByRole('textbox', { name: 'Search your book' }).fill('winter');
  await page.getByRole('link', { name: /Notes for the winter scarf/ }).click();
  await expect(
    page
      .getByRole('region', { name: 'Entry reader' })
      .getByRole('heading', { name: 'Notes for the winter scarf' }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search your book' })).toHaveValue('winter');
  await page.screenshot({ path: testInfo.outputPath('dark-reader.png'), fullPage: true });
  await page.getByRole('link', { name: /Back to your book/ }).click();
  await expect(page.getByRole('textbox', { name: 'Search your book' })).toHaveValue('winter');
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(
    page.getByRole('heading', { name: 'A thought from the morning walk' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /New entry/ }).click();
  await page.getByLabel('Title').fill('Preview a thought');
  await page.getByLabel(/Your entry/).fill('A **formatted** thought.');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByLabel('Entry preview').locator('strong')).toHaveText('formatted');
  await page.getByRole('button', { name: 'Continue writing' }).click();
  await expect(page.getByLabel(/Your entry/)).toHaveValue('A **formatted** thought.');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Entry reader' })
      .getByRole('heading', { name: 'Preview a thought' }),
  ).toBeVisible();
});

test('entry type tabs filter search and include newly created types', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1360, height: 980 });
  await fakeHostedApi(page);
  await login(page);
  const tabs = page.getByRole('navigation', { name: 'Entry types' });
  await tabs.getByRole('button', { name: 'Idea', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A small reading ritual' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'A thought from the morning walk' }),
  ).not.toBeVisible();
  await page.getByRole('textbox', { name: 'Search your book' }).fill('winter');
  await expect(page.getByRole('heading', { name: 'No matching entries.' })).toBeVisible();
  await tabs.getByRole('button', { name: 'Pattern', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notes for the winter scarf' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('button', { name: /New entry/ }).click();
  await page.getByLabel('Title').fill('First recipe');
  await page.getByLabel('Entry type', { exact: true }).fill('recipe');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(tabs.getByRole('button', { name: 'Recipe', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await tabs.getByRole('button', { name: 'All entries', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A thought from the morning walk' }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('type-tabs.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await tabs.getByRole('button', { name: 'Recipe', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'First recipe' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('editor panel contains the save footer when the form exceeds the window height', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 600 });
  await fakeHostedApi(page);
  await login(page);
  await page.getByRole('button', { name: /New entry/ }).click();
  const save = page.getByRole('button', { name: 'Save entry' });
  await save.scrollIntoViewIfNeeded();
  const panel = await page.getByRole('dialog').boundingBox();
  const footer = await page.locator('.editor-footer').boundingBox();
  expect(panel).not.toBeNull();
  expect(footer).not.toBeNull();
  expect(panel!.y + panel!.height).toBeGreaterThanOrEqual(footer!.y + footer!.height);
});

test('tags, URL, source and image attachments survive reopening and editing', async ({ page }) => {
  await fakeHostedApi(page);
  await login(page);
  await page.getByRole('button', { name: /New entry/ }).click();
  await page.getByLabel('Title').fill('A passage with context');
  await page.getByLabel('Tags', { exact: true }).fill('reading');
  await page.getByRole('button', { name: 'Add tag', exact: true }).click();
  await page.getByLabel('Tags', { exact: true }).fill('inspiration');
  await page.getByLabel('URL', { exact: true }).fill('https://example.com/book');
  await page.getByLabel('Source', { exact: true }).fill('An author, A book, p. 42');
  await page.getByLabel('Add images', { exact: true }).setInputFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByRole('dialog').getByRole('img', { name: 'sample.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Save entry' }).click();
  const reader = page.getByRole('region', { name: 'Entry reader' });
  await expect(reader.getByRole('img', { name: 'sample.png' })).toBeVisible();
  await expect
    .poll(() =>
      reader
        .getByRole('img', { name: 'sample.png' })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(reader.getByText('reading', { exact: true })).toBeVisible();
  await expect(reader.getByText('inspiration', { exact: true })).toBeVisible();
  await expect(reader.getByText('An author, A book, p. 42')).toBeVisible();
  await expect(reader.getByRole('link', { name: /https:\/\/example.com\/book/ })).toHaveAttribute(
    'href',
    'https://example.com/book',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Edit entry' }).click();
  await expect(page.getByLabel('Source', { exact: true })).toHaveValue('An author, A book, p. 42');
  await expect(page.getByLabel('URL', { exact: true })).toHaveValue('https://example.com/book');
  await page.getByRole('button', { name: 'Remove tag reading' }).click();
  await page.getByRole('button', { name: 'Remove image sample.png' }).click();
  await page.getByLabel('Source', { exact: true }).fill('');
  await page.getByLabel('URL', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(reader.getByText('reading', { exact: true })).not.toBeVisible();
  await expect(reader.getByText('inspiration', { exact: true })).toBeVisible();
  await expect(reader.getByText('An author, A book, p. 42')).not.toBeVisible();
  await expect(reader.getByText('sample.png')).not.toBeVisible();
});

test('quick capture preselects existing and newly created entry types', async ({ page }) => {
  await fakeHostedApi(page);
  await login(page);
  const shortcuts = page.getByRole('navigation', { name: 'Create an entry by type' });
  await shortcuts.getByRole('button', { name: 'New idea', exact: true }).click();
  await expect(page.getByLabel('Entry type', { exact: true })).toHaveValue('idea');
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(dialogs).toEqual([]);
  await shortcuts.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByLabel('Entry type', { exact: true }).fill('memory');
  await page.getByLabel('Title').fill('A day to remember');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await shortcuts.getByRole('button', { name: 'New memory', exact: true }).click();
  await expect(page.getByLabel('Entry type', { exact: true })).toHaveValue('memory');
  await expect(page.getByLabel('Title')).toHaveValue('');
  await page.getByRole('button', { name: 'Close editor' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await shortcuts.getByRole('button', { name: 'New memory', exact: true }).click();
  await expect(page.getByLabel('Entry type', { exact: true })).toHaveValue('memory');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test.describe('backdated entries', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('preserves the calendar date through saving, reloading and editing', async ({ page }) => {
    await fakeHostedApi(page);
    await login(page);
    await page.getByRole('button', { name: /New entry/ }).click();
    await page.getByLabel('Title').fill('From my iPhone notes');
    await page.getByLabel('Entry date · Optional', { exact: true }).fill('2012-02-29');
    await page.getByRole('button', { name: 'Save entry' }).click();
    const reader = page.getByRole('region', { name: 'Entry reader' });
    await expect(reader.locator('time')).toHaveAttribute('datetime', '2012-02-29');
    await expect(reader.locator('time')).toContainText('29');
    await page.reload();
    await page.getByRole('button', { name: 'Edit entry' }).click();
    await expect(page.getByLabel('Entry date · Optional', { exact: true })).toHaveValue(
      '2012-02-29',
    );
    await page.getByLabel('Entry date · Optional', { exact: true }).fill('2005-12-31');
    await page.getByRole('button', { name: 'Save entry' }).click();
    await expect(reader.locator('time')).toHaveAttribute('datetime', '2005-12-31');
    await expect(reader.locator('time')).toContainText('31');
    await page.getByRole('button', { name: 'Edit entry' }).click();
    await page.getByLabel('Entry date · Optional', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Save entry' }).click();
    await expect(reader.locator('time')).toHaveAttribute('datetime', '2026-09-11');
  });
});

test('welcome, work capture and moving an entry between private spaces', async ({
  page,
}, testInfo) => {
  await fakeHostedApi(page);
  await login(page);
  await page.getByRole('link', { name: 'c. commonplace', exact: true }).click();
  await expect(page.getByRole('heading', { name: /A little room/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('welcome.png'), fullPage: true });
  await page.getByRole('link', { name: /Open Work/ }).click();
  await expect(page.getByRole('heading', { name: 'Your work commonplace.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A thought from the morning walk' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: /New entry/ }).click();
  await expect(page.getByLabel('Space', { exact: true })).toHaveValue('work');
  await page.getByLabel('Title', { exact: true }).fill('Planning the next project');
  await page.getByLabel('Entry type', { exact: true }).fill('meeting');
  await page.getByRole('button', { name: /Save entry/ }).click();
  await expect(page.getByRole('button', { name: 'Edit entry' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your work commonplace.' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit entry' }).click();
  await page.getByLabel('Space', { exact: true }).selectOption('personal');
  await page.getByRole('button', { name: /Save entry/ }).click();
  await expect(page.getByRole('heading', { name: 'Your commonplace.' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Your spaces' })
    .getByRole('link', { name: 'Work', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Planning the next project' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New meeting', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('work.png'), fullPage: true });
});

for (const width of [390, 820, 1100]) {
  test(`space switcher stays usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await fakeHostedApi(page);
    await login(page);
    const spaces = page.getByRole('navigation', { name: 'Your spaces' });
    await expect(spaces).toBeVisible();
    await spaces.getByRole('link', { name: 'Work', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your work commonplace.' })).toBeVisible();
    await expect(spaces.getByRole('link', { name: 'Work', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: testInfo.outputPath('space-switcher.png'), fullPage: true });
    await spaces.getByRole('link', { name: 'Personal', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your commonplace.' })).toBeVisible();
  });
}

test('Back during editing preserves the draft and navigates after closing', async ({ page }) => {
  await fakeHostedApi(page);
  await login(page);
  const spaces = page.getByRole('navigation', { name: 'Your spaces' });
  await spaces.getByRole('link', { name: 'Work', exact: true }).click();
  await page.getByRole('button', { name: /New entry/ }).click();
  await page.getByLabel('Title', { exact: true }).fill('Unfinished work thought');
  await page.goBack();
  await expect(page).toHaveURL(/#personal$/);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Unfinished work thought');
  await expect(page.getByLabel('Space', { exact: true })).toHaveValue('work');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Unfinished work thought');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(page.getByRole('heading', { name: 'Your commonplace.' })).toBeVisible();
  await spaces.getByRole('link', { name: 'Work', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your work commonplace.' })).toBeVisible();
  await spaces.getByRole('link', { name: 'Personal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your commonplace.' })).toBeVisible();
});

test('saving after Back keeps the draft in its original space', async ({ page }) => {
  await fakeHostedApi(page);
  await login(page);
  const spaces = page.getByRole('navigation', { name: 'Your spaces' });
  await spaces.getByRole('link', { name: 'Work', exact: true }).click();
  await page.getByRole('button', { name: /New entry/ }).click();
  await page.getByLabel('Title', { exact: true }).fill('Saved work thought');
  await page.goBack();
  await expect(page).toHaveURL(/#personal$/);
  await page.getByRole('button', { name: /Save entry/ }).click();
  await expect(page.getByRole('heading', { name: 'Your work commonplace.' })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Entry reader' })
      .getByRole('heading', { name: 'Saved work thought' }),
  ).toBeVisible();
  await spaces.getByRole('link', { name: 'Personal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved work thought' })).toHaveCount(0);
});
