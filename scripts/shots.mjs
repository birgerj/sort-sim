// Screenshots of every department by day and by night, into shots/.
//
//   npm run build && npm run shots              all departments, day and night
//   npm run shots -- docks boxes                only these departments
//   SHOTS_TIME=night npm run shots -- docks     only night
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

mkdirSync('shots', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.error('page error:', e.message, e.stack?.split('\n')[1] ?? ''));
  const base = `http://localhost:${PORT}/`;
  await page.goto(`${base}?ui=0`);
  await page.waitForFunction(() => 'sortsim' in window);
  const depts = await page.evaluate(() => window.sortsim.scene.departments());
  for (const d of depts) {
    if (only.length && !only.includes(d.id)) continue;
    for (const time of times) {
      await page.goto(`${base}?ui=0&time=${time}&dept=${encodeURIComponent(d.id)}`);
      await page.waitForTimeout(WAIT_MS);
      const file = `shots/${d.id.replace(/\W+/g, '-')}-${time}.png`;
      await page.screenshot({ path: file });
      console.log(file);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
