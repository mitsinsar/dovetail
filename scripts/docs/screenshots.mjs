// Drives the running app with the demo rook and saves the README screenshots
// (docs/images/screenshots/*.png) and the demo GIF (docs/images/demo.gif).
//
//   npm run dev                      # in another terminal
//   npm run docs:screenshots         # BASE_URL defaults to http://localhost:5173
//
// Needs Google Chrome (or CHROME_PATH) and ffmpeg on PATH for the GIF.
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { launchOptions } from './browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173/';
const STL = resolve('demo/rook.stl');
const OUT = resolve('docs/images/screenshots');
if (!existsSync(STL)) execFileSync('npx', ['tsx', 'scripts/make-demo.ts', STL], { stdio: 'inherit' });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(launchOptions());

// ---------- helpers ----------
const helpers = (page) => ({
  setRange: (label, v) => page.evaluate(([label, v]) => {
    const el = [...document.querySelectorAll('label.slider')]
      .find((l) => l.querySelector('span')?.textContent?.startsWith(label)).querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [label, v]),
  idle: () => page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 120000 }),
  split: () => page.waitForSelector('button:has-text("Plates ·")', { timeout: 120000 }),
  scrollPanel: (top) => page.evaluate((t) => { document.querySelector('.panel').scrollTop = t; }, top),
  zoom: async (dy, x, y) => {
    await page.mouse.move(x, y);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, dy / 6); await page.waitForTimeout(60); }
  },
  parkMouse: () => page.mouse.move(page.viewportSize().width - 10, page.viewportSize().height - 10),
});

// ---------- stills ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const h = helpers(page);
  const shot = async (name, wait = 1200) => {
    await page.waitForTimeout(wait);
    const tmp = join(OUT, `${name}.raw.png`);
    await page.screenshot({ path: tmp });
    // 2x capture scaled to 1920 wide: crisp on retina, small enough for git
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', tmp, '-vf', 'scale=1920:-1:flags=lanczos', join(OUT, `${name}.png`)]);
    rmSync(tmp);
    console.log(`screenshots/${name}.png`);
  };

  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await shot('01-start', 800);
  await page.setInputFiles('input[type=file]', STL);
  await page.waitForSelector('.meta');
  await shot('02-loaded', 1500);

  await page.click('button:has-text("Auto-split")');
  await h.split();
  await h.setRange('Explode', 32);
  await shot('03-auto-split', 1500);

  await page.click('button:has-text("Plates ·")');
  await h.scrollPanel(10000);
  await shot('04-plates', 1500);

  await page.click('button:has-text("Assembly")');
  await page.click('.seg.four button:has-text("Dovetail")');
  await h.idle();
  await h.setRange('Explode', 60);
  await h.scrollPanel(500);
  await h.zoom(-500, 930, 560);
  await shot('05-dovetails', 1800);
  await h.zoom(500, 930, 560);
  await h.parkMouse();

  await page.click('button:has-text("Clear")');
  await page.click('button:has-text("+ Plane")');
  await h.setRange('Position', 330);
  await h.setRange('Tilt X', 18);
  await h.scrollPanel(300);
  await shot('06-manual-plane', 1500);
  await page.click('.actions button.primary:has-text("Cut")');
  await page.waitForSelector('ul.parts', { timeout: 120000 });
  await h.idle();
  await h.setRange('Explode', 50);
  await shot('07-manual-cut', 1500);

  await page.selectOption('select.select >> nth=0', 'bambu-a1mini');
  await page.waitForTimeout(1500); // let the printer change repack settle first
  await page.click('button:has-text("Auto-split")');
  await h.split();
  await h.idle();
  await h.setRange('Explode', 40);
  await h.scrollPanel(0);
  await shot('08-small-printer', 1800);
  await h.parkMouse();
  await page.click('button:has-text("Plates ·")');
  await h.parkMouse();
  await h.scrollPanel(10000);
  await page.waitForTimeout(800);
  await h.zoom(320, 1100, 600);
  await h.parkMouse();
  await shot('09-small-printer-plates', 1800);
  await page.close();
}

// ---------- GIF: frames from the DevTools screencast, stitched by ffmpeg ----------
{
  const frameDir = mkdtempSync(join(tmpdir(), 'dovetail-gif-'));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const h = helpers(page);
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  let recording = false;
  cdp.on('Page.screencastFrame', async (f) => {
    if (recording) {
      const file = `f${String(frames.length).padStart(5, '0')}.png`;
      writeFileSync(join(frameDir, file), Buffer.from(f.data, 'base64'));
      frames.push({ file, t: f.metadata.timestamp });
    }
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });

  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await page.waitForTimeout(600);
  recording = true;
  await page.setInputFiles('input[type=file]', STL);
  await page.waitForSelector('.meta'); await page.waitForTimeout(1400);
  await page.hover('button:has-text("Auto-split")'); await page.waitForTimeout(400);
  await page.click('button:has-text("Auto-split")');
  await h.split(); await page.waitForTimeout(500);
  for (let e = 15; e <= 55; e += 2) { await h.setRange('Explode', e); await page.waitForTimeout(45); }
  await page.waitForTimeout(900);
  await page.mouse.move(850, 450); await page.mouse.down();
  for (let i = 0; i < 30; i++) { await page.mouse.move(850 + i * 8, 450); await page.waitForTimeout(30); }
  await page.mouse.up(); await h.parkMouse(); await page.waitForTimeout(500);
  for (const t of ['Dovetail', 'Dowel', 'Peg']) {
    await page.click(`.seg.four button:has-text("${t}")`); await h.idle(); await page.waitForTimeout(t === 'Peg' ? 900 : 1300);
  }
  await h.scrollPanel(10000); await page.waitForTimeout(400);
  await page.click('button:has-text("Plates ·")'); await h.parkMouse();
  await page.waitForTimeout(2200);
  recording = false;
  await cdp.send('Page.stopScreencast');
  await ctx.close();

  const list = frames.map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1]?.t ?? f.t + 1.5) - f.t).toFixed(3)}`);
  writeFileSync(join(frameDir, 'list.txt'), `${list.join('\n')}\nfile '${frames.at(-1).file}'\n`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(frameDir, 'list.txt'),
    '-vf', 'fps=15,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=160:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop', '0', resolve('docs/images/demo.gif')]);
  rmSync(frameDir, { recursive: true, force: true });
  console.log('demo.gif');
}

await browser.close();
console.log("done");
