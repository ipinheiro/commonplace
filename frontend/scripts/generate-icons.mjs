import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Reuse the book artwork with an opaque background for platform icon masks.
const artwork = (await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8')).replace(
  'rx="14"',
  'rx="0"',
);
const output = new URL('../public/icons/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  for (const [name, size] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['apple-touch-icon.png', 180],
  ]) {
    const data = await page.evaluate(
      async ({ artwork, size }) => {
        const picture = new Image();
        picture.src = `data:image/svg+xml,${encodeURIComponent(artwork)}`;
        await picture.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(picture, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { artwork, size },
    );
    await writeFile(new URL(name, output), Buffer.from(data, 'base64'));
  }
} finally {
  await browser.close();
}
