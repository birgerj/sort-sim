// Ten Shifts planner: every change the player can make to a plan, as pure functions.
// Each returns a new Plan; the one passed in is never changed. Times always land on a moment the
// rules allow (a half hour, the city's first parcel or its truck time), whether they come from a
// button or from dragging.
import { RATES, type Block, type Level, type Plan } from '../../../shifts/contract';
import { firstParcel } from '../../../shifts/estimate';
import { allowedTimes, latestEnd } from './rules';

const MIN = RATES.minBlockMinutes;

function withBlock(plan: Plan, i: number, b: Block): Plan {
  return { ...plan, blocks: plan.blocks.map((x, k) => (k === i ? b : { ...x })), robotCities: [...plan.robotCities] };
}

/** The allowed moment nearest to `t` within [lo, hi]; `t` clamped when none lies inside. */
export function snap(level: Level, city: number, t: number, lo = 0, hi = Infinity): number {
  let best = NaN;
  for (const a of allowedTimes(level, city)) {
    if (a < lo || a > hi) continue;
    if (Number.isNaN(best) || Math.abs(a - t) < Math.abs(best - t)) best = a;
  }
  return Number.isNaN(best) ? Math.max(lo, Math.min(hi, t)) : best;
}

/** First parcel to truck time, one person, one dock: what a tap on an unplanned city makes. */
export function starterBlock(level: Level, city: number): Block {
  const c = level.cities[city]!;
  let start = firstParcel(c);
  const end = c.truck;
  if (end - start < MIN) start = snap(level, city, end - MIN, 0, end - MIN);
  return { city, start, end, people: 1, docks: 1 };
}

/** Adds a block for the city and says where it is in the plan. A city that already has blocks
 *  gets one from the end of its last block to its truck time when there is an hour left, so the
 *  usual next step (another crew for the rest of the night) takes one tap. */
export function addBlock(level: Level, plan: Plan, city: number): { plan: Plan; index: number } {
  let b = starterBlock(level, city);
  const own = plan.blocks.filter((x) => x.city === city);
  if (own.length) {
    const lastEnd = Math.max(...own.map((x) => x.end));
    if (b.end - lastEnd >= MIN) b = { ...b, start: lastEnd };
  }
  return { plan: { ...plan, blocks: [...plan.blocks.map((x) => ({ ...x })), b], robotCities: [...plan.robotCities] }, index: plan.blocks.length };
}

export function removeBlock(plan: Plan, i: number): Plan {
  return { ...plan, blocks: plan.blocks.filter((_, k) => k !== i).map((x) => ({ ...x })), robotCities: [...plan.robotCities] };
}

/** Moves the start to `t` (snapped), never closer than an hour to the end. */
export function setStart(level: Level, plan: Plan, i: number, t: number): Plan {
  const b = plan.blocks[i];
  if (!b) return plan;
  return withBlock(plan, i, { ...b, start: snap(level, b.city, t, 0, b.end - MIN) });
}

/** Moves the end to `t` (snapped), at least an hour after the start and at most 30 minutes past the truck. */
export function setEnd(level: Level, plan: Plan, i: number, t: number): Plan {
  const b = plan.blocks[i];
  if (!b) return plan;
  return withBlock(plan, i, { ...b, end: snap(level, b.city, t, b.start + MIN, latestEnd(level, b.city)) });
}

function neighbour(level: Level, city: number, t: number, dir: -1 | 1, lo: number, hi: number): number {
  const times = allowedTimes(level, city).filter((a) => a >= lo && a <= hi);
  const next = dir > 0 ? times.find((a) => a > t) : [...times].reverse().find((a) => a < t);
  return next ?? t;
}

/** One step earlier or later for the start: the next allowed moment in that direction. */
export function stepStart(level: Level, plan: Plan, i: number, dir: -1 | 1): Plan {
  const b = plan.blocks[i];
  if (!b) return plan;
  return withBlock(plan, i, { ...b, start: neighbour(level, b.city, b.start, dir, 0, b.end - MIN) });
}

export function stepEnd(level: Level, plan: Plan, i: number, dir: -1 | 1): Plan {
  const b = plan.blocks[i];
  if (!b) return plan;
  return withBlock(plan, i, { ...b, end: neighbour(level, b.city, b.end, dir, b.start + MIN, latestEnd(level, b.city)) });
}

/** Whether a step in that direction would change anything (to grey out the button). */
export function canStep(level: Level, plan: Plan, i: number, edge: 'start' | 'end', dir: -1 | 1): boolean {
  const b = plan.blocks[i];
  if (!b) return false;
  const after = (edge === 'start' ? stepStart : stepEnd)(level, plan, i, dir).blocks[i]!;
  return after.start !== b.start || after.end !== b.end;
}

/** Slides the whole block so that it starts near `t`, keeping its length where the grid allows. */
export function moveBlock(level: Level, plan: Plan, i: number, t: number): Plan {
  const b = plan.blocks[i];
  if (!b) return plan;
  const length = b.end - b.start;
  const last = latestEnd(level, b.city);
  const start = snap(level, b.city, t, 0, last - Math.max(MIN, length));
  const end = snap(level, b.city, start + length, start + MIN, last);
  return withBlock(plan, i, { ...b, start, end });
}

export function setPeople(plan: Plan, i: number, people: 1 | 2): Plan {
  const b = plan.blocks[i];
  return b ? withBlock(plan, i, { ...b, people }) : plan;
}

export function setDocks(level: Level, plan: Plan, i: number, docks: number): Plan {
  const b = plan.blocks[i];
  return b ? withBlock(plan, i, { ...b, docks: Math.max(1, Math.min(Math.max(1, level.docks), Math.round(docks))) }) : plan;
}

/** Sends a city to the robots or takes it off them. Its dock blocks stay as they are. */
export function setRobotCity(level: Level, plan: Plan, city: number, on: boolean): Plan {
  const set = new Set(plan.robotCities);
  if (on && level.robotsMax > 0) set.add(city);
  else set.delete(city);
  return { ...plan, blocks: plan.blocks.map((x) => ({ ...x })), robotCities: [...set].sort((a, b) => a - b) };
}

export function setRobots(level: Level, plan: Plan, robots: number): Plan {
  return { ...plan, blocks: plan.blocks.map((x) => ({ ...x })), robotCities: [...plan.robotCities], robots: Math.max(0, Math.min(level.robotsMax, Math.round(robots))) };
}
