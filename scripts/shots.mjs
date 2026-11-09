// Screenshots of every department by day and by night, into shots/.
//
//   npm run build && npm run shots              all departments, day and night
//   npm run shots -- docks boxes                only these departments
//   SHOTS_TIME=night npm run shots -- docks     only night
//   SHOTS_LOOK=real npm run shots               the realistic day look
//   SHOTS_QUALITY=high npm run shots            at another render quality
//
// Serves dist/ with `vite preview`, renders with headless Chromium (software
// GL works, just slowly) and waits a few seconds per shot so the hall fills.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4179;
const WAIT_MS = Number(process.env.SHOTS_WAIT ?? 7000);
const only = process.argv.slice(2);
const times = process.env.SHOTS_TIME ? [process.env.SHOTS_TIME] : ['day', 'night'];
const look = process.env.SHOTS_LOOK ? `&look=${process.env.SHOTS_LOOK}` : '';
const quality = process.env.SHOTS_QUALITY ? `&quality=${process.env.SHOTS_QUALITY}` : '';

mkdirSync('shots', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.error('page error:', e.message, e.stack?.split('\n')[1] ?? ''));
  page.on('console', (m) => { if (m.type() === 'error') console.error(m.text().slice(0, 400)); });
  const base = `http://localhost:${PORT}/`;
  await page.goto(`${base}?ui=0`);
  await page.waitForFunction(() => 'sortsim' in window);
  const depts = await page.evaluate(() => window.sortsim.scene.departments());
  for (const d of depts) {
    if (only.length && !only.includes(d.id)) continue;
    for (const time of times) {
      await page.goto(`${base}?ui=0&time=${time}${look}${quality}&dept=${encodeURIComponent(d.id)}`);
      // (The loading screen stays up until the hall has been drawn once.)
      await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 180000 });
      await page.waitForTimeout(WAIT_MS);
      const file = `shots/${d.id.replace(/\W+/g, '-')}-${time}${look ? '-' + process.env.SHOTS_LOOK : ''}.png`;
      await page.screenshot({ path: file });
      console.log(file);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
