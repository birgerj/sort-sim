// Ten Shifts planner: the rules a plan must keep, as pure functions.
//
// These use only what the briefing shows (times, docks, the people limit, the fleet), so
// checking a plan gives nothing away about the score. The door assignment follows the score
// model's own (tools/balance/fixture.py, to_solver) step by step, so "no dock free" means the
// same thing here as there.
import { PRICES, RATES, type Block, type Level, type Plan, type PlanProblem } from '../../../shifts/contract';
import { firstParcel } from '../../../shifts/estimate';

/** The latest moment a block of this city may end. */
export function latestEnd(level: Level, city: number): number {
  return Math.min(level.shiftMinutes, level.cities[city]?.truck ?? level.shiftMinutes) + RATES.maxLateMinutes;
}

/** Every moment a block of this city may start or end on: the half hours, its first parcel and its truck time. */
export function allowedTimes(level: Level, city: number): number[] {
  const c = level.cities[city];
  const last = latestEnd(level, city);
  const set = new Set<number>();
  for (let t = 0; t <= last; t += RATES.stepMinutes) set.add(t);
  if (c) {
    set.add(firstParcel(c));
    set.add(c.truck);
  }
  return [...set].filter((t) => t >= 0 && t <= last).sort((a, b) => a - b);
}

export function onGrid(level: Level, b: Block): boolean {
  const c = level.cities[b.city];
  if (!c) return false;
  const ok = (t: number) => Number.isInteger(t) && t >= 0 && (t % RATES.stepMinutes === 0 || t === firstParcel(c) || t === c.truck);
  return ok(b.start) && ok(b.end);
}

export interface DoorUse {
  /** Index of the block in the plan. */
  block: number;
  city: number;
  door: number;
  start: number;
  end: number;
  /** The door served another city before: it stands idle from here until `start`. */
  switchFrom?: number;
}

export interface DoorPlan {
  uses: DoorUse[];
  /** Per block of the plan: how many of its docks found no door. */
  short: number[];
}

/**
 * Gives every dock of every block a door, exactly as the score model does: blocks by start, then
 * city; each needed dock takes the door that last served the same city if it is free, else the
 * door that has been free longest. A door that served another city is free 15 minutes later.
 * Where the model would reject the plan, the dock is counted in `short` and the rest goes on,
 * so the planner can still show what does fit.
 */
export function assignDoors(level: Level, blocks: readonly Block[]): DoorPlan {
  const order = blocks.map((b, i) => ({ b, i })).sort((x, y) => x.b.start - y.b.start || x.b.city - y.b.city || x.i - y.i);
  const doors: { free: number; city: number }[] = Array.from({ length: Math.max(0, level.docks) }, () => ({ free: -999, city: -1 }));
  const uses: DoorUse[] = [];
  const short = blocks.map(() => 0);
  for (const { b, i } of order) {
    for (let n = 0; n < b.docks; n++) {
      let pick = -1;
      let same = -1;
      doors.forEach((d, k) => {
        const from = d.city === b.city || d.city === -1 ? d.free : d.free + RATES.switchMinutes;
        if (from > b.start) return;
        if (d.city === b.city && same < 0) same = k;
        if (pick < 0 || d.free < doors[pick]!.free) pick = k;
      });
      const k = same >= 0 ? same : pick;
      if (k < 0) {
        short[i] = short[i]! + 1;
        continue;
      }
      const d = doors[k]!;
      const use: DoorUse = { block: i, city: b.city, door: k, start: b.start, end: b.end };
      if (d.city !== -1 && d.city !== b.city) use.switchFrom = Math.max(d.free, b.start - RATES.switchMinutes);
      uses.push(use);
      doors[k] = { free: b.end, city: b.city };
    }
  }
  return { uses, short };
}

/** A count that changes at certain moments: `value` holds from `from` to `to`. */
export interface Step {
  from: number;
  to: number;
  value: number;
}

function steps(events: [number, number][]): Step[] {
  const at = new Map<number, number>();
  for (const [t, d] of events) at.set(t, (at.get(t) ?? 0) + d);
  const times = [...at.keys()].sort((a, b) => a - b);
  const out: Step[] = [];
  let v = 0;
  for (let i = 0; i < times.length - 1; i++) {
    v += at.get(times[i]!)!;
    if (v !== 0) out.push({ from: times[i]!, to: times[i + 1]!, value: v });
  }
  return out;
}

/** People at work through the night: people per dock × docks of every open block. */
export function peopleSteps(plan: Plan): Step[] {
  const ev: [number, number][] = [];
  for (const b of plan.blocks) ev.push([b.start, b.people * b.docks], [b.end, -b.people * b.docks]);
  return steps(ev);
}

/** Docks open through the night (without the idle time of a switch). */
export function openDockSteps(plan: Plan): Step[] {
  const ev: [number, number][] = [];
  for (const b of plan.blocks) ev.push([b.start, b.docks], [b.end, -b.docks]);
  return steps(ev);
}

/** Docks taken through the night: open, switching city, or asked for without a door to give. */
export function busyDockSteps(plan: Plan, doors: DoorPlan): Step[] {
  const ev: [number, number][] = [];
  for (const u of doors.uses) ev.push([u.switchFrom ?? u.start, 1], [u.end, -1]);
  plan.blocks.forEach((b, i) => {
    if (doors.short[i]) ev.push([b.start, doors.short[i]!], [b.end, -doors.short[i]!]);
  });
  return steps(ev);
}

export const peak = (s: readonly Step[]): number => s.reduce((m, x) => Math.max(m, x.value), 0);

/** Everything that keeps this plan from being started. An empty list means it may start. */
export function checkPlan(level: Level, plan: Plan): PlanProblem[] {
  const out: PlanProblem[] = [];
  plan.blocks.forEach((b, i) => {
    if (!onGrid(level, b)) out.push({ kind: 'grid', block: i });
    if (b.end - b.start < RATES.minBlockMinutes) out.push({ kind: 'tooShort', block: i });
    if (level.cities[b.city] && b.end > latestEnd(level, b.city)) out.push({ kind: 'afterTruck', block: i });
  });
  const doors = assignDoors(level, plan.blocks);
  doors.short.forEach((n, i) => {
    if (n > 0) out.push({ kind: 'noDock', block: i });
  });
  if (level.peopleCap !== undefined) {
    let last = -1;
    for (const s of peopleSteps(plan)) {
      // One problem per stretch over the limit, however often the head count changes inside it.
      if (s.value > level.peopleCap && s.from !== last) out.push({ kind: 'tooManyPeople', at: s.from });
      last = s.value > level.peopleCap ? s.to : -1;
    }
  }
  // (Cities switched to robots without a fleet are no fault: the score model accepts them too.)
  if (level.robotsMax <= 0) {
    if (plan.robots > 0) out.push({ kind: 'robotsOff' });
  } else if (plan.robots > level.robotsMax) out.push({ kind: 'tooManyRobots' });
  return out;
}

/** Cities that get neither a dock nor a working robot line: their parcels stay behind. */
export function unservedCities(level: Level, plan: Plan): number[] {
  const out: number[] = [];
  level.cities.forEach((_, c) => {
    const dock = plan.blocks.some((b) => b.city === c);
    const robot = level.robotsMax > 0 && plan.robots > 0 && plan.robotCities.includes(c);
    if (!dock && !robot) out.push(c);
  });
  return out;
}

export interface Costs {
  docks: number;
  people: number;
  robots: number;
  total: number;
}

export function blockCost(level: Level, b: Block, until = Infinity): { docks: number; people: number } {
  const hours = Math.max(0, Math.min(b.end, until) - b.start) / 60;
  return { docks: PRICES.dockPerHour * b.docks * hours, people: PRICES.personPerHour * level.wageFactor * b.people * b.docks * hours };
}

/**
 * The costs that follow from the plan alone. With `until`, only what has been spent by that
 * minute of the shift (the running shift shows this).
 */
export function fixedCosts(level: Level, plan: Plan, until = Infinity): Costs {
  let docks = 0;
  let people = 0;
  for (const b of plan.blocks) {
    const c = blockCost(level, b, until);
    docks += c.docks;
    people += c.people;
  }
  const part = Math.min(1, Math.max(0, until / level.shiftMinutes));
  const robots = (PRICES.robotPerShiftHour * (level.shiftMinutes / 60) * plan.robots) * part;
  return { docks, people, robots, total: docks + people + robots };
}

/** Every parcel shipped and every truck on time: nobody can earn more than this. */
export function mostToEarn(level: Level): number {
  let v = 0;
  for (const c of level.cities) v += c.volume;
  return v * (PRICES.parcel + PRICES.onTime);
}

/** How the plan stands against the level's extra goal, where the plan alone decides it. */
export function goalStanding(level: Level, plan: Plan): { ok: boolean; text: string } | null {
  const people: Record<string, number> = { lean: 1, lean3: 3, lean12: 12 };
  const id = level.badge.id;
  if (id in people) {
    const p = peak(peopleSteps(plan));
    return { ok: p <= people[id]!, text: `Your plan peaks at ${p} ${p === 1 ? 'person' : 'people'}.` };
  }
  if (id === 'oneDock') {
    const p = peak(openDockSteps(plan));
    return { ok: p <= 2, text: `Your plan peaks at ${p} ${p === 1 ? 'dock' : 'docks'}.` };
  }
  if (id === 'smallFleet') return { ok: plan.robots <= 6, text: `Your fleet is ${plan.robots} ${plan.robots === 1 ? 'robot' : 'robots'}.` };
  if (id === 'noDockSmall') {
    let big = 0;
    level.cities.forEach((c, i) => {
      if (c.volume > level.cities[big]!.volume) big = i;
    });
    const others = new Set(plan.blocks.filter((b) => b.city !== big).map((b) => b.city)).size;
    return { ok: others === 0, text: others === 0 ? 'No other city has a dock.' : `${others} other ${others === 1 ? 'city has' : 'cities have'} a dock.` };
  }
  return null;
}
