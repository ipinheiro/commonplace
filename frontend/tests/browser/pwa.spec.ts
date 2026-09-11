import { chromium, expect, test } from '@playwright/test';

test('the browser accepts the install manifest and can decode every app icon', async ({
  baseURL,
}, testInfo) => {
  // Chrome disables installation in Playwright's default incognito context.
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    channel: 'chrome',
    baseURL,
  });
  try {
    const page = await context.newPage();
    await page.goto('/');
    const session = await page.context().newCDPSession(page);
    const result = await session.send('Page.getAppManifest');
    expect(result.errors).toEqual([]);
    const manifest = JSON.parse(result.data!);
    expect(manifest.name).toBe('Commonplace');
    expect(manifest.display).toBe('standalone');
    expect(new URL(manifest.start_url, result.url).origin).toBe(new URL(page.url()).origin);

    const icons = [
      ...manifest.icons.map((icon: { src: string; sizes: string }) => ({
        src: new URL(icon.src, result.url).href,
        size: Number(icon.sizes.split('x')[0]),
      })),
      { src: await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'), size: 180 },
    ];
    for (const icon of icons) {
      const dimensions = await page.evaluate(async (src) => {
        const image = new Image();
        image.src = src!;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      }, icon.src);
      expect(dimensions).toEqual({ width: icon.size, height: icon.size });
    }

    await expect
      .poll(async () => (await session.send('Page.getInstallabilityErrors')).installabilityErrors)
      .toEqual([]);
  } finally {
    await context.close();
  }
});
