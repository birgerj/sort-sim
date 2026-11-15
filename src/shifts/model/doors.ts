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
 * Hands out doors. Blocks are taken by start, then city, people, docks and end (the end last, so
 * that cutting a block in two never changes its turn). Blocks that start together for the same
 * city are placed in two rounds. First every dock that can goes on with a door where a block of
 * this city with the same crew ends this very minute: that is the same work carried on (same
 * trailer, same belt). Then the docks still without a door take, in this order of preference: a
 * door where this city ends this minute, a free door that last served this city, the door that has
 * been free longest. A door that served another city is free 15 minutes after that block ended.
 * `unplaced` lists the blocks (plan indices) that found no door for one of their docks.
 */
export function assignDoors(level: Level, plan: Plan): { placed: DoorBlock[]; unplaced: number[] } {
  // Equal blocks (same city, start, end and crew) are one block with their docks added up: two
  // blocks side by side and one block with two docks are the same plan. `block` is the first of them.
  const order: { b: Plan['blocks'][number]; block: number }[] = [];
  plan.blocks.forEach((b, block) => {
    const twin = order.find((o) => o.b.city === b.city && o.b.start === b.start && o.b.end === b.end && o.b.people === b.people);
    if (twin) twin.b = { ...twin.b, docks: twin.b.docks + b.docks };
    else order.push({ b: { ...b }, block });
  });
  order.sort((x, y) => x.b.start - y.b.start || x.b.city - y.b.city || x.b.people - y.b.people || x.b.docks - y.b.docks || x.b.end - y.b.end || x.block - y.block);
  const freeFrom: number[] = new Array<number>(level.docks).fill(-999);
  const lastCity: number[] = new Array<number>(level.docks).fill(-1);
  const lastPeople: number[] = new Array<number>(level.docks).fill(0);
  const placed: DoorBlock[] = [];
  const unplaced: number[] = [];
  const take = (k: number, b: Plan['blocks'][number], block: number): void => {
    freeFrom[k] = b.end;
    lastCity[k] = b.city;
    lastPeople[k] = b.people;
    placed.push({ city: b.city, door: k, start: b.start, end: b.end, people: b.people, block });
  };
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j < order.length && order[j]!.b.start === order[i]!.b.start && order[j]!.b.city === order[i]!.b.city) j++;
    const group = order.slice(i, j);
    i = j;
    // Round 1: carry on where the same crew for this city stops this minute.
    const need: number[] = [];
    for (const { b, block } of group) {
      let n = b.docks;
      for (let k = 0; k < level.docks && n > 0; k++) {
        if (lastCity[k] === b.city && freeFrom[k] === b.start && lastPeople[k] === b.people) {
          take(k, b, block);
          n--;
        }
      }
      need.push(n);
    }
    // Round 2: the rest.
    group.forEach(({ b, block }, g) => {
      for (let n = need[g]!; n > 0; n--) {
        let pick = -1;
        let rank = 0; // 3 this city ends here now, 2 this city's door, 1 any free door
        for (let k = 0; k < level.docks; k++) {
          const last = lastCity[k]!;
          const free = freeFrom[k]!;
          const known = last === b.city || last === -1;
          if ((known ? free : free + SWITCH_MINUTES) > b.start) continue;
          const r = last === b.city ? (free === b.start ? 3 : 2) : 1;
          if (r > rank || (r === 1 && rank === 1 && free < freeFrom[pick]!)) {
            pick = k;
            rank = r;
          }
        }
        if (pick < 0) {
          unplaced.push(block);
          break;
        }
        take(pick, b, block);
      }
    });
  }
  return { placed, unplaced };
}
