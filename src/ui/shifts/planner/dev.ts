// Trial page for the planner and the shift overlay, without the hall and without the other
// screens (planner-dev.html, not linked from the game).
//
//   planner-dev.html?level=10          the planner for a level, empty plan
//   planner-dev.html?level=10&fill=1   with a starter block for every city (robots for the small ones)
//   planner-dev.html?level=4&plan=fixture   the example plan of the fixture
//   planner-dev.html?hud=1             the shift overlay, played from the fixture's timeline (level 4)
//   planner-dev.html?hud=1&level=10    the overlay for another level, with a made-up timeline (layout only)
//   &at=150 stops the overlay's clock at that minute; &done=1 shows it after the shift
import fixtureText from '../../../../tests/fixtures/shifts/level4.json?raw';
import levelsText from '../../../shifts/levels.json?raw';
import type { Level, Plan, Timeline } from '../../../shifts/contract';
import { arrivedBy } from '../../../shifts/estimate';
import { addBlock, setRobotCity, setRobots } from './edit';
import { plannerView, shiftHud } from './index';

const LEVELS = JSON.parse(levelsText) as Level[];
const FIXTURE = JSON.parse(fixtureText) as { level: Level; plan: Plan; timeline: Timeline };
// Stand-in names; in the game they are the largest towns of the chosen country.
const NAMES = ['Amsterdam', 'Rotterdam', 'Den Haag', 'Utrecht', 'Eindhoven', 'Groningen', 'Tilburg', 'Almere', 'Breda', 'Nijmegen', 'Apeldoorn', 'Arnhem', 'Haarlem', 'Enschede', 'Amersfoort', 'Zaanstad'];

const q = new URLSearchParams(location.search);
const hud = q.get('hud') === '1';
const id = Math.max(1, Math.min(LEVELS.length, Number(q.get('level') ?? (hud ? 4 : 1)) || 1));
const level = LEVELS[id - 1]!;
const app = document.getElementById('app')!;

function filled(): Plan {
  let plan: Plan = { blocks: [], robotCities: [], robots: 0 };
  level.cities.forEach((c, i) => {
    if (level.robotsMax > 0 && c.volume < 800 && i % 2 === 1) plan = setRobotCity(level, plan, i, true);
    else plan = addBlock(level, plan, i).plan;
  });
  return setRobots(level, plan, Math.round(level.robotsMax * 0.6));
}

/** A timeline for layout trials only: every city loaded as its parcels come in, every truck on time. */
function madeUp(): Timeline {
  const steps = level.shiftMinutes / 5;
  return {
    stepMinutes: 5,
    cityLoaded: Array.from({ length: steps + 1 }, (_, k) => level.cities.map((c) => Math.round(arrivedBy(c, Math.max(0, k * 5 - 20)) * 0.95))),
    buffer: Array.from({ length: steps + 1 }, () => 0),
    blocks: [],
    robotsActive: Array.from({ length: steps + 1 }, () => 0),
    departures: level.cities.map((c, i) => ({ city: i, at: c.truck + (i % 5 === 3 ? 20 : 0), status: i % 5 === 3 ? ('late' as const) : i % 7 === 6 ? ('incomplete' as const) : ('onTime' as const) })),
  };
}

const plan: Plan = q.get('plan') === 'fixture' && id === 4 ? FIXTURE.plan : q.get('fill') === '1' ? filled() : { blocks: [], robotCities: [], robots: 0 };

if (hud) {
  app.classList.add('hall');
  const timeline = id === 4 ? FIXTURE.timeline : madeUp();
  const shown = id === 4 ? FIXTURE.plan : filled();
  let speed = 8;
  let minute = 0;
  let over = false;
  const view = shiftHud({ level, cityNames: NAMES, plan: shown, onSpeed: (s) => (speed = s), onSkip: () => (minute = level.shiftMinutes) });
  app.append(view.root);
  // The score service answers after a few seconds; until then the overlay says it is starting.
  const fixed = q.get('at');
  if (fixed !== null || q.get('done') === '1') {
    view.setTimeline(timeline);
    view.setClock(Number(fixed ?? level.shiftMinutes));
    if (q.get('done') === '1') view.done();
  } else {
    setTimeout(() => view.setTimeline(timeline), 2000);
    let before = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - before) / 1000);
      before = now;
      if (!over && now > 2000) {
        minute = Math.min(level.shiftMinutes, minute + dt * speed);
        view.setClock(minute);
        if (minute >= level.shiftMinutes) {
          over = true;
          view.done();
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
} else {
  const log = (what: string, p: Plan) => console.log(what, JSON.stringify(p));
  app.append(plannerView({ level, cityNames: NAMES, plan, onChange: (p) => log('change', p), onStart: (p) => { log('start', p); alert('Start shift'); }, onBack: () => console.log('back to the briefing') }));
}
