/** Reusa a arte do APK inteira, sobre branco; não cria outra identidade. */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('APK/assets/logo-siga-app.png', root)).toString('base64');
const assets = [
  { name: 'icon-192.png', size: 192, width: 0.88 },
  { name: 'icon-512.png', size: 512, width: 0.88 },
  // O retângulo inteiro fica dentro do círculo seguro de raio 40%.
  { name: 'icon-maskable-512.png', size: 512, width: 0.72 },
  { name: 'apple-touch-icon.png', size: 180, width: 0.88 },
];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PWA_CHROMIUM_PATH ? { executablePath: process.env.PWA_CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  const images = await page.evaluate(async ({ source, assets }) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + source;
    await image.decode();
    return assets.map(({ name, size, width }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const w = size * width, h = w * image.naturalHeight / image.naturalWidth;
      ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
      return { name, base64: canvas.toDataURL('image/png').split(',')[1] };
    });
  }, { source, assets });
  const directory = new URL('public/icons/', root);
  mkdirSync(directory, { recursive: true });
  for (const { name, base64 } of images) {
    const path = new URL(name, directory);
    writeFileSync(path, Buffer.from(base64, 'base64'));
    console.log(fileURLToPath(path));
  }
} finally {
  await browser.close();
}
