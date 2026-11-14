// Screenshots of the hall playing a shift of the planning game, without the game's screens:
// the director is created in the page and fed a timeline, and the clock is stopped at a few
// moments to look at the docks, the robot floor and the buffer rack, by day and by night.
//
//   node scripts/directorShots.mjs                 the fixture (level 4) and a made-up busy shift
//   node scripts/directorShots.mjs level4          only the fixture
//   node scripts/directorShots.mjs busy            only the made-up shift (robots, late, incomplete, full buffer)
//   SHOTS_TIME=night node scripts/directorShots.mjs
//   SHOTS_LOOK=real node scripts/directorShots.mjs
//   SHOTS_SPEED=32 node scripts/directorShots.mjs  shift minutes per second (default 8). Software GL
//                                                  draws a few frames a second and the page counts at
//                                                  most 0.1 s per frame, so 8 there is far slower than
//                                                  for a player: about 32 gives a player's minutes per beat.
//
// Runs the dev server (as `npx vite` does) so the page can import the scene's modules; renders with
// headless Chromium (software GL: slow, the shift clock simply runs slower). Images go to
// shots/director/. It ends with a check that leaving the game gives the free simulation back.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = 5183;
const only = process.argv.slice(2);
const times = process.env.SHOTS_TIME ? [process.env.SHOTS_TIME] : ['day', 'night'];
const look = process.env.SHOTS_LOOK ? `&look=${process.env.SHOTS_LOOK}` : '';
const SPEED = Number(process.env.SHOTS_SPEED ?? 8);

/**
 * A made-up shift that shows what the fixture does not: six doors of which two share a city,
 * a robot city and a city with a door and robots, a truck that leaves late, one that leaves
 * incomplete, a trailer swap, a robot outage and a buffer that fills right up.
 */
function busyShift() {
  const steps = 48; // 240 minutes
  const ks = Array.from({ length: steps + 1 }, (_, k) => k);
  const ramp = (k, from, to, total) => Math.max(0, Math.min(total, ((k * 5 - from) / (to - from)) * total));
  const level = {
    id: 0,
    name: 'Made up for the screenshots',
    shiftMinutes: 240,
    cities: [
      { volume: 600, truck: 180, arrivals: [] },
      { volume: 300, truck: 150, arrivals: [] },
      { volume: 260, truck: 200, arrivals: [] },
      { volume: 200, truck: 240, arrivals: [] },
      { volume: 240, truck: 240, arrivals: [] },
    ],
    docks: 6,
    robotsMax: 14,
    bufferCap: 400,
    wageFactor: 1,
    notes: { fresh: '', setForYou: [] },
    par: 1,
    badge: { id: 'none', text: '' },
  };
  const timeline = {
    stepMinutes: 5,
    // City 0: two doors, flat out, 600 parcels. City 1: one person, leaves incomplete (190 of 300).
    // City 2: late (until 225). City 3: robots only (its truck leaves from a south door). City 4: a door from 120 and robots all night.
    cityLoaded: ks.map((k) => [ramp(k, 0, 180, 600), ramp(k, 20, 150, 190), ramp(k, 60, 225, 260), ramp(k, 10, 230, 200), ramp(k, 10, 120, 80) + ramp(k, 120, 240, 160)]),
    buffer: ks.map((k) => Math.round(400 * Math.max(0, Math.sin((Math.min(k, 40) / 40) * Math.PI)) ** 0.6)),
    blocks: [
      { city: 0, door: 0, start: 0, end: 180, people: 2 },
      { city: 0, door: 1, start: 0, end: 180, people: 2 },
      { city: 1, door: 3, start: 20, end: 150, people: 1 },
      { city: 2, door: 4, start: 60, end: 225, people: 1 },
      { city: 4, door: 5, start: 120, end: 240, people: 1 },
    ],
    // The fleet stands still from 100 to 130.
    robotsActive: ks.map((k) => (k * 5 < 10 ? 0 : k * 5 >= 100 && k * 5 < 130 ? 0 : 12)),
    departures: [
      { city: 0, at: 180, status: 'onTime' },
      { city: 1, at: 150, status: 'incomplete' },
      { city: 2, at: 225, status: 'late' },
      { city: 3, at: 240, status: 'onTime' },
      { city: 4, at: 240, status: 'onTime' },
    ],
  };
  return { level, timeline };
}

/** Which moments to stop at, and what to look at then. */
const SCENARIOS = {
  level4: { stops: [[25, ['docks']], [80, ['docks', 'wide']], [112, ['docks']], [150, ['docks', 'store']], [215, ['docks', 'wide']], [240, ['docks']]] },
  busy: {
    make: busyShift,
    stops: [[45, ['docks', 'wide', 'robots']], [110, ['wide', 'robots', 'store']], [160, ['wide', 'door4']], [205, ['door4', 'robots', 'south']], [240, ['wide', 'south']]],
  },
};

mkdirSync('shots/director', { recursive: true });
// (Its own cache folder, so it does not get in the way of a dev server that is already running.)
const server = await createServer({ server: { port: PORT, strictPort: true }, cacheDir: '.vite/director', logLevel: 'error' });
await server.listen();

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => {
    failed = true;
    console.error('page error:', e.message, e.stack?.split('\n')[1] ?? '');
  });
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(m.text().slice(0, 400));
  });
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    if (only.length && !only.includes(name)) continue;
    for (const time of times) {
      await page.goto(`http://localhost:${PORT}/?ui=0&country=nl&time=${time}${look}&dept=docks`);
      await page.waitForFunction(() => 'sortsim' in window && !document.getElementById('loading'), null, { timeout: 300000 });
      await page.waitForTimeout(4000);
      const shot = async (label) => {
        const file = `shots/director/${name}-${time}${look ? '-' + process.env.SHOTS_LOOK : ''}-${label}.png`;
        await page.screenshot({ path: file });
        console.log(file);
      };
      // Camera places: by a door of the plan, the north wall from further back, the robot floor, the rack, the south doors.
      const view = (id) =>
        page.evaluate((id) => {
          const { scene } = window.sortsim;
          const v = (x, y, z) => scene.camera.position.clone().set(x, y, z);
          const x0 = scene.trucks.docks[0].x;
          const dx = (n) => scene.trucks.docks[n].x;
          if (id === 'docks') scene.goSpot(v(x0 + 5, 4.2, -21), v(x0 + 2, 1.2, -33), 'docks');
          else if (id === 'wide') scene.goSpot(v(x0 + 15, 9, -6), v(x0 + 15, 1, -38), 'wide');
          else if (id === 'door4') scene.goSpot(v(dx(4) - 3, 4.2, -21), v(dx(4) - 3, 1.4, -36), 'door4');
          else if (id === 'robots') scene.goSpot(v(-46, 9, 31), v(-22, 0.5, 22), 'robots');
          else if (id === 'south') scene.goSpot(v(dx(22) - 5, 5, 23), v(dx(22), 2.5, 34), 'south');
          else scene.goSpot(v(scene.carriage.position.x - 14, 6, 0), v(scene.carriage.position.x + 2, 5, 0), 'store');
        }, id);
      const before = await page.evaluate(() => {
        const { scene } = window.sortsim;
        return { rate: scene.rate, faults: scene.faults.enabled, shift: scene.shift === null };
      });
      // Into the game: the hall bare.
      await page.evaluate(
        async ({ made }) => {
          const { createDirector } = await import('/src/scene/director.ts');
          const { CITIES } = await import('/src/sim/postcodes.ts');
          const fixture = made ?? (await import('/tests/fixtures/shifts/level4.json')).default;
          const { scene } = window.sortsim;
          const director = createDirector(scene);
          const run = { director, fixture, minute: 0, done: 0, stopAt: Infinity, names: CITIES.map((c) => c.name) };
          window.shiftRun = run;
          director.enter(fixture.level, run.names);
        },
        { made: sc.make ? sc.make() : null },
      );
      await view('wide');
      await page.waitForTimeout(9000);
      await shot('000-entered-wide');
      await page.evaluate(() => {
        const run = window.shiftRun;
        run.director.play(
          run.fixture.timeline,
          (m) => {
            run.minute = m;
            // (Stop the clock at the moment asked for; the hall goes on working.)
            if (m >= run.stopAt) run.director.setSpeed(0);
          },
          () => run.done++,
        );
      });
      for (const [minute, views] of sc.stops) {
        await page.evaluate(([m, speed]) => {
          window.shiftRun.stopAt = m;
          window.shiftRun.director.setSpeed(speed);
        }, [minute, SPEED]);
        await page.waitForFunction((m) => window.shiftRun.minute >= m, minute, { timeout: 600000, polling: 250 });
        for (const id of views) {
          await view(id);
          await page.waitForTimeout(2500);
          await shot(`${String(minute).padStart(3, '0')}-${id}`);
        }
      }
      const done = await page.evaluate(() => window.shiftRun.done);
      if (done !== 1) {
        failed = true;
        console.error(`${name} ${time}: onDone was called ${done} times, expected once`);
      }
      // A second attempt without leaving in between (enter again), skipped at once and skipped
      // after a moment: the shift ends exactly once each time, and skipping twice adds nothing.
      for (const wait of [0, 1500]) {
        await page.evaluate(() => {
          const run = window.shiftRun;
          run.done = 0;
          run.director.enter(run.fixture.level, run.names);
          run.director.setSpeed(8);
          run.director.play(run.fixture.timeline, (m) => (run.minute = m), () => run.done++);
        });
        if (wait) await page.waitForTimeout(wait);
        const n = await page.evaluate(() => {
          const run = window.shiftRun;
          run.director.skip();
          run.director.skip();
          return run.done;
        });
        await page.waitForTimeout(1500);
        const later = await page.evaluate(() => window.shiftRun.done);
        if (n !== 1 || later !== 1) {
          failed = true;
          console.error(`${name} ${time}: skip after ${wait} ms called onDone ${n} then ${later} times, expected once`);
        }
      }
      await view('wide');
      await page.waitForTimeout(2500);
      await shot('998-skipped-wide');
      // Back to the free simulation: it must be what it was.
      await page.evaluate(() => window.shiftRun.director.exit());
      await view('docks');
      await page.waitForTimeout(9000);
      await shot('999-left-docks');
      const after = await page.evaluate(() => {
        const { scene } = window.sortsim;
        return { rate: scene.rate, faults: scene.faults.enabled, shift: scene.shift === null };
      });
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        failed = true;
        console.error(`${name} ${time}: after leaving`, after, 'before', before);
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);
