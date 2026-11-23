// Screenshots of the hall playing a shift of the planning game, without the game's screens:
// the director is created in the page, given a level and the timeline the score model makes
// for one of the tested plans (tests/fixtures/shifts/golden.json), and the clock is stopped at
// a few moments. The camera is the director's own (automatic direction), plus one look at a
// city (`focusCity`) and the closing shot (`finale`).
//
//   node scripts/directorShots.mjs                  levels 1 and 10, desktop and phone size, by day
//   node scripts/directorShots.mjs 4 6              these levels
//   SHOTS_SIZE=phone node scripts/directorShots.mjs only the phone size (390 × 844); or desktop (1280 × 720)
//   SHOTS_TIME=night node scripts/directorShots.mjs by night
//   SHOTS_SPEED=6.4 node scripts/directorShots.mjs  shift minutes per second (default 1.6, the game's 4×)
//
// Runs the dev server (as `npx vite` does) so the page can import the scene's modules; renders
// with headless Chromium. Software GL draws about a frame a second, and the hall then steps
// several beats per frame: what moves looks coarser than for a player, and the hall falls
// further behind the timeline than it does at a real frame rate. Images go to shots/director/.
// It ends with checks: the shift ends once, a second `enter` and `skip` work, the automatic
// direction reports going off and on, and leaving gives the free simulation back.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = 5183;
const levels = process.argv.slice(2).map(Number).filter((n) => n >= 1 && n <= 10);
if (!levels.length) levels.push(1, 10);
const times = process.env.SHOTS_TIME ? [process.env.SHOTS_TIME] : ['day'];
const SIZES = { desktop: { width: 1280, height: 720 }, phone: { width: 390, height: 844 } };
const sizes = process.env.SHOTS_SIZE ? [process.env.SHOTS_SIZE] : ['desktop', 'phone'];
const SPEED = Number(process.env.SHOTS_SPEED ?? 1.6);
/** Where the clock is stopped, as shares of the shift. */
const STOPS = [0.12, 0.4, 0.7, 0.97];

mkdirSync('shots/director', { recursive: true });
// (Its own cache folder, so it does not get in the way of a dev server that is already running.)
const server = await createServer({ server: { port: PORT, strictPort: true }, cacheDir: '.vite/director', logLevel: 'error' });
await server.listen();

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
const fail = (text) => {
  failed = true;
  console.error(text);
};
try {
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: SIZES[size] ?? SIZES.desktop });
    page.on('pageerror', (e) => fail(`page error: ${e.message} ${e.stack?.split('\n')[1] ?? ''}`));
    page.on('console', (m) => {
      if (m.type() === 'error') console.error(m.text().slice(0, 400));
    });
    for (const lv of levels) {
      for (const time of times) {
        const tag = `level${lv}-${size}-${time}`;
        await page.goto(`http://localhost:${PORT}/?ui=0&country=nl&time=${time}&dept=docks`);
        await page.waitForFunction(() => 'sortsim' in window && !document.getElementById('loading'), null, { timeout: 300000 });
        await page.waitForTimeout(3000);
        const shot = async (label) => {
          const file = `shots/director/${tag}-${label}.png`;
          await page.screenshot({ path: file });
          console.log(file);
        };
        const before = await page.evaluate(() => {
          const { scene } = window.sortsim;
          return { rate: scene.rate, belt: scene.beltSpeed(), faults: scene.faults.enabled, free: scene.shift === null, camera: scene.cameraMode() };
        });
        // Into the game: the hall bare, the camera on the overview.
        const info = await page.evaluate(async (lv) => {
          const { createDirector } = await import('/src/scene/director.ts');
          const { CITIES } = await import('/src/sim/postcodes.ts');
          const { LEVELS } = await import('/src/shifts/model/index.ts');
          const { simulate } = await import('/src/shifts/model/simulate.ts');
          const { parcelFactor } = await import('/src/sim/shiftSchedule.ts');
          const golden = (await import('/tests/fixtures/shifts/golden.json')).default.filter((g) => g.level === lv);
          const level = LEVELS[lv - 1];
          const plan = golden[golden.length - 1].plan;
          const { scene } = window.sortsim;
          const director = createDirector(scene);
          const run = { director, level, minute: 0, done: 0, stopAt: Infinity, auto: [], names: CITIES.map((c) => c.name) };
          window.shiftRun = run;
          director.onAutoCamera((on) => run.auto.push(on));
          director.enter(level, run.names);
          // (Straight from the model: some of the tested plans are ones the planner would not let through.)
          const { result, timeline } = simulate(level, plan);
          run.timeline = timeline;
          run.result = result;
          const end = Math.max(level.shiftMinutes, ...timeline.departures.map((d) => d.at));
          return { end, factor: parcelFactor(level), stars: result.stars, plan: golden[golden.length - 1].name };
        }, lv);
        console.log(`${tag}: plan "${info.plan}", ${info.stars} stars, one parcel stands for ${info.factor}, ${info.end} minutes`);
        await page.waitForTimeout(8000);
        await shot('000-entered');
        await page.evaluate((speed) => {
          const run = window.shiftRun;
          run.director.setSpeed(speed);
          run.director.play(
            run.timeline,
            (m) => {
              run.minute = m;
              // (Stop the clock at the moment asked for: the hall stands still with it.)
              if (m >= run.stopAt) run.director.setSpeed(0);
            },
            () => run.done++,
          );
        }, SPEED);
        for (const [n, share] of STOPS.entries()) {
          const minute = Math.round(info.end * share);
          await page.evaluate(([m, speed]) => {
            window.shiftRun.stopAt = m;
            window.shiftRun.director.setSpeed(speed);
          }, [minute, SPEED]);
          await page.waitForFunction((m) => window.shiftRun.minute >= m, minute, { timeout: 1500000, polling: 500 });
          await page.waitForTimeout(2500);
          await shot(`${String(minute).padStart(3, '0')}-auto`);
          if (n === 1) {
            // A look at the first city, then back to the automatic direction.
            await page.evaluate(() => window.shiftRun.director.focusCity(0));
            await page.waitForTimeout(6000);
            await shot(`${String(minute).padStart(3, '0')}-city`);
            const off = await page.evaluate(() => window.shiftRun.auto.slice());
            if (off[off.length - 1] !== false) fail(`${tag}: focusCity did not report the automatic direction off (${JSON.stringify(off)})`);
            await page.evaluate(() => window.shiftRun.director.setAutoCamera(true));
            const on = await page.evaluate(() => window.shiftRun.auto.slice());
            if (on[on.length - 1] !== true) fail(`${tag}: setAutoCamera(true) did not report on (${JSON.stringify(on)})`);
          }
        }
        // To the end, and the closing shot (a party after three stars).
        await page.evaluate((speed) => {
          window.shiftRun.stopAt = Infinity;
          window.shiftRun.director.setSpeed(speed);
        }, SPEED);
        await page.waitForFunction(() => window.shiftRun.done > 0, null, { timeout: 1500000, polling: 500 });
        await page.evaluate(() => {
          const run = window.shiftRun;
          run.finaleAt = performance.now();
          run.director.finale(run.result.stars, () => (run.finaleTook = performance.now() - run.finaleAt));
        });
        await page.waitForTimeout(1500);
        await shot('998-finale-truck');
        await page.waitForFunction(() => window.shiftRun.finaleTook !== undefined, null, { timeout: 60000 });
        await shot('999-finale-end');
        const end = await page.evaluate(() => ({ done: window.shiftRun.done, took: window.shiftRun.finaleTook }));
        if (end.done !== 1) fail(`${tag}: onDone was called ${end.done} times, expected once`);
        if (end.took > 6000) fail(`${tag}: the closing shot took ${Math.round(end.took)} ms`);
        // A second attempt without leaving in between, skipped at once and after a moment: the
        // shift ends once each time, a second skip adds nothing, and no closing shot after a skip.
        for (const wait of [0, 1500]) {
          await page.evaluate(() => {
            const run = window.shiftRun;
            run.done = 0;
            run.director.enter(run.level, run.names);
            run.director.setSpeed(1.6);
            run.director.play(run.timeline, (m) => (run.minute = m), () => run.done++);
          });
          if (wait) await page.waitForTimeout(wait);
          const n = await page.evaluate(() => {
            const run = window.shiftRun;
            run.director.skip();
            run.director.skip();
            let finale = 0;
            run.director.finale(3, () => finale++);
            return [run.done, finale];
          });
          await page.waitForTimeout(1000);
          const later = await page.evaluate(() => window.shiftRun.done);
          if (n[0] !== 1 || later !== 1) fail(`${tag}: skip after ${wait} ms called onDone ${n[0]} then ${later} times, expected once`);
          if (n[1] !== 1) fail(`${tag}: after a skip the closing shot must end at once (done called ${n[1]} times)`);
        }
        // Back to the free simulation: it must be what it was.
        await page.evaluate(() => window.shiftRun.director.exit());
        await page.waitForTimeout(6000);
        await shot('zzz-left');
        const after = await page.evaluate(() => {
          const { scene } = window.sortsim;
          return { rate: scene.rate, belt: scene.beltSpeed(), faults: scene.faults.enabled, free: scene.shift === null, camera: scene.cameraMode() };
        });
        if (JSON.stringify(after) !== JSON.stringify(before)) fail(`${tag}: after leaving ${JSON.stringify(after)}, before ${JSON.stringify(before)}`);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);
