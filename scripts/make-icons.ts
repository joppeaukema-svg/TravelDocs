// Renders the app icon SVG to the PNG sizes the manifest and iOS need.
// Usage: npm run icons  (set PW_CHROMIUM_EXECUTABLE to use a preinstalled Chromium)
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const mark = `
  <circle cx="256" cy="256" r="150" fill="none" stroke="#F4F1EA" stroke-width="22"/>
  <circle cx="256" cy="256" r="116" fill="none" stroke="#F4F1EA" stroke-width="5" stroke-dasharray="3 13" stroke-linecap="round"/>
  <path d="M176 304 C 222 196, 292 336, 338 214" fill="none" stroke="#5CC8BA" stroke-width="22" stroke-linecap="round"/>
  <circle cx="176" cy="304" r="21" fill="#F4F1EA"/>
  <circle cx="338" cy="214" r="21" fill="#5CC8BA"/>`;

const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#16213A"/>${mark}</svg>`;
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#16213A"/>${mark}</svg>`;

const outputs: { file: string; svg: string; size: number }[] = [
  { file: 'public/icons/icon-192.png', svg: rounded, size: 192 },
  { file: 'public/icons/icon-512.png', svg: rounded, size: 512 },
  { file: 'public/icons/icon-maskable-512.png', svg: fullBleed, size: 512 },
  // iOS rounds the corners itself and dislikes transparency.
  { file: 'public/apple-touch-icon.png', svg: fullBleed, size: 180 },
];

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/favicon.svg', rounded.trim() + '\n');

const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
for (const { file, svg, size } of outputs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  writeFileSync(file, await page.screenshot({ omitBackground: true }));
  await page.close();
}
await browser.close();
console.log(`Wrote ${outputs.length} icons and public/favicon.svg`);
