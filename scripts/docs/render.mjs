// Renders the README visuals: docs/src/<name>.html -> docs/images/<name>.png.
// Each page draws into #frame; the PNG is that element at 2x.
//   npm run docs:visuals            (all)
//   npm run docs:visuals -- hero    (one)
import { chromium } from 'playwright-core';
import { readdirSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { launchOptions } from './browser.mjs';

const src = resolve('docs/src');
const only = process.argv.slice(2);
const pages = readdirSync(src).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5))
  .filter((n) => !only.length || only.includes(n));

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
for (const name of pages) {
  await page.goto(pathToFileURL(resolve(src, `${name}.html`)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.locator('#frame').screenshot({ path: `docs/images/${name}.png` });
  console.log(`docs/images/${name}.png`);
}
await browser.close();
