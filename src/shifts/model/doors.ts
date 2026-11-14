// What a plan means before any parcel moves: which door each dock of a block gets, how many robot
// lines a city opens, and when its first parcel arrives. The plan checks and the shift itself both
// read a plan through this file, so they can never disagree about doors.
// The definition is to_solver() and lines_for() in tools/balance/fixture.py.
import type { Level, Plan } from '../contract';

/** Minutes a door stands idle when it changes to another city. */
export const SWITCH_MINUTES = 15;

/** One dock of a planned block, on the door the hall gives it. `block` is its index in plan.blocks. */
export interface DoorBlock {
  city: number;
  door: number;
  start: number;
  end: number;
  people: number;
  block: number;
}

/** The minute a city's first parcel arrives (0 when it gets none). */
export function firstParcel(level: Level, city: number): number {
  let first = Infinity;
  for (const a of level.cities[city]?.arrivals ?? []) if (a.perMinute > 0 && a.to > a.from) first = Math.min(first, a.from);
  return Number.isFinite(first) ? first : 0;
}

/** Robot lines a city opens: enough for its busiest minute (a line passes one parcel a minute), at most 4. */
export function linesFor(level: Level, city: number): number {
  let busiest = 0;
  for (const a of level.cities[city]?.arrivals ?? []) if (a.to > a.from) busiest = Math.max(busiest, a.perMinute);
  return Math.max(1, Math.min(4, Math.ceil(busiest - 1e-9)));
}

/** The plan's robot cities, each once, in the order given. */
export function robotCities(plan: Plan): number[] {
  return [...new Set(plan.robotCities)];
}

/**
 * Hands out doors. Blocks are taken by start (then city, then their order in the plan); each dock
 * of a block takes the door that last served the same city if it is free, else the door that has
 * been free longest. A door that served another city is free 15 minutes after that block ended.
 * `unplaced` lists the blocks (plan indices) that found no door for one of their docks.
 */
export function assignDoors(level: Level, plan: Plan): { placed: DoorBlock[]; unplaced: number[] } {
  const order = plan.blocks.map((b, block) => ({ b, block }));
  order.sort((x, y) => x.b.start - y.b.start || x.b.city - y.b.city || x.block - y.block);
  const freeFrom: number[] = new Array<number>(level.docks).fill(-999);
  const lastCity: number[] = new Array<number>(level.docks).fill(-1);
  const placed: DoorBlock[] = [];
  const unplaced: number[] = [];
  for (const { b, block } of order) {
    for (let n = 0; n < b.docks; n++) {
      let pick = -1;
      let same = false;
      for (let k = 0; k < level.docks; k++) {
        const last = lastCity[k]!;
        const free = freeFrom[k]!;
        const known = last === b.city || last === -1;
        if ((known ? free : free + SWITCH_MINUTES) > b.start) continue;
        if (last === b.city) {
          // The first free door that already has this city's cages wins outright.
          if (!same) pick = k;
          same = true;
        } else if (!same && (pick < 0 || free < freeFrom[pick]!)) {
          pick = k;
        }
      }
      if (pick < 0) {
        unplaced.push(block);
        break;
      }
      freeFrom[pick] = b.end;
      lastCity[pick] = b.city;
      placed.push({ city: b.city, door: pick, start: b.start, end: b.end, people: b.people, block });
    }
  }
  return { placed, unplaced };
}
