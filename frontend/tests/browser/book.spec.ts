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
    const body = route.request().postDataJSON() ?? {};
    if (path.endsWith('/rpc/list_entries'))
      return route.fulfill({
        json: {
          items: entries.filter((entry) =>
            entry.title.toLowerCase().includes(String(body.p_query ?? '').toLowerCase()),
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
  await expect(page.getByRole('heading', { name: 'A new thing to keep' })).toBeVisible();
  await expect(page.locator('strong')).toHaveText('worth');
  await page.getByRole('button', { name: 'Edit entry' }).click();
  await page.getByLabel(/Your entry/).fill('An updated thought.');
  await page.getByRole('button', { name: /Save entry/ }).click();
  await expect(page.getByText('An updated thought.', { exact: true })).toBeVisible();
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
