// The score model of Ten Shifts: plays one shift minute by minute and says what it earned.
// Pure and without randomness: the same level and plan always give the same answer. It imports
// nothing from the screens or the hall, because it moves to a server later.
//
// The definition is tools/balance/solve.py (sim, evaluate) with tools/balance/fixture.py
// (to_solver, run, trace). The order of the steps inside a minute, the order of the docks and
// lines, and every rounding below follow that reference, so the profit matches it to the cent.
import type { Level, Plan, Result, Timeline, TruckStatus } from '../contract';
import { assignDoors, firstParcel, linesFor, robotCities, type DoorBlock } from './doors';

/** What things cost and earn, in Sorty. */
const PRICE = {
  parcel: 1.5, // per parcel shipped
  onTime: 0.3, // extra per parcel when its truck is complete and on time
  latePerMinute: 0.03, // per parcel on the truck, per minute the truck leaves late
  leftBehind: 1.5, // per parcel not on its truck
  dockPerHour: 25,
  personPerHour: 30,
  robotPerShiftHour: 11,
  bufferPerParcel: 0.15, // per parcel that goes into the buffer
};

/** Parcels that can wait on a dock's roller belt. */
const BELT_ROOM = 40;
/** Parcels that can wait on a robot line's pickup table. */
const TABLE_ROOM = 20;
/** Parcels the buffer gives back per minute (150 an hour), shared by all docks and lines. */
const BUFFER_OUT_PER_MINUTE = 2.5;
/** Parcels per minute at a dock: one person picks and loads alone, two work as picker and loader. */
const ONE_PERSON_PER_MINUTE = 1.5;
const TWO_PEOPLE_PER_MINUTE = 170 / 60;
/** A trailer is full at this many parcels; swapping it keeps the dock idle for some minutes. */
const TRAILER = 220;
const TRAILER_SWAP_MINUTES = 10;
/** A robot loads 17 parcels an hour, so it takes 60/17 robots to move one parcel a minute; a line passes
 *  one a minute at most. (The reference model divides by the same number.) */
const ROBOTS_PER_PARCEL_MINUTE = 60 / 17;
const LINE_PER_MINUTE = 1;
/** The shift is played on for this long after its end, for trucks that leave late. */
const OVERTIME_MINUTES = 45;
/** A truck is planned to leave this long after its city's cut-off... */
const CLEARDOWN = 15;
/** ...and leaves this long after it at the latest, with whatever is loaded. */
const CLEARDOWN_MAX = 45;
/** A truck missing less than this counts as complete (the model works in fractions of parcels). */
const COMPLETE_WITHIN = 0.5;
const STEP = 5;

export interface ShiftOutcome {
  result: Result;
  timeline: Timeline;
  /** The profit before rounding to whole Sorty. */
  profit: number;
  /** The lines of the result before rounding. */
  amounts: Result['lines'];
  /** The fullest the buffer has been at the end of any minute. */
  bufferPeak: number;
}

/** Rounds to a whole number as the reference does: a value exactly halfway goes to the even side. */
export function roundHalfEven(x: number): number {
  const down = Math.floor(x);
  const rest = x - down;
  const n = rest < 0.5 ? down : rest > 0.5 ? down + 1 : down % 2 === 0 ? down : down + 1;
  return n + 0; // never minus zero
}

/** Rounds to one decimal as the reference does: by the number's exact value, halfway to the even side. */
export function roundTenth(x: number): number {
  // Only quarters (x.25, x.75) lie exactly halfway between two tenths in binary.
  const quarters = x * 4;
  if (Number.isInteger(quarters) && quarters % 2 !== 0) return roundHalfEven(x * 10) / 10 + 0;
  return Number(x.toFixed(1)) + 0;
}

/** Parcels arriving per minute for one city, over the shift and its overtime. */
function arrivalsPerMinute(level: Level, city: number, minutes: number): Float64Array {
  const perMinute = new Float64Array(minutes);
  for (const a of level.cities[city]!.arrivals) {
    for (let t = Math.max(0, a.from); t < Math.min(minutes, a.to); t++) perMinute[t] = perMinute[t]! + a.perMinute;
  }
  return perMinute;
}

interface Line {
  city: number;
  start: number;
  end: number;
}

/** Sorted by the city's truck time, keeping the given order among equals: earliest truck is served first. */
function byTruck<T extends { city: number }>(level: Level, items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((x, y) => level.cities[x.item.city]!.truck - level.cities[y.item.city]!.truck || x.i - y.i)
    .map((x) => x.item);
}

/** Docks in the order they are served: earliest truck first, then city, door and start. Nothing in
 *  it changes when a block is cut in two. */
function docksInOrder(level: Level, placed: DoorBlock[]): DoorBlock[] {
  return [...placed].sort((x, y) => level.cities[x.city]!.truck - level.cities[y.city]!.truck || x.city - y.city || x.door - y.door || x.start - y.start);
}

/**
 * A run is one door serving one city, block after block (gaps allowed). The belt, the trailer and
 * its swap belong to the run, not to the block, so cutting a block in two changes nothing.
 * `run[b]` is the run of block b; `handsBack[b]` is false when the run's next block starts the
 * minute b ends: then the belt's parcels simply stay where they are.
 */
function runsOf(blocks: DoorBlock[]): { run: number[]; handsBack: boolean[] } {
  const run = new Array<number>(blocks.length).fill(0);
  const handsBack = new Array<boolean>(blocks.length).fill(true);
  const byDoor = new Map<number, number[]>();
  blocks.forEach((b, j) => byDoor.set(b.door, [...(byDoor.get(b.door) ?? []), j]));
  let count = 0;
  for (const door of [...byDoor.keys()].sort((a, b) => a - b)) {
    const js = byDoor.get(door)!.sort((a, b) => blocks[a]!.start - blocks[b]!.start);
    js.forEach((j, a) => {
      const before = a > 0 ? js[a - 1]! : -1;
      if (before >= 0 && blocks[before]!.city === blocks[j]!.city) {
        run[j] = run[before]!;
        if (blocks[before]!.end === blocks[j]!.start) handsBack[before] = false;
      } else {
        run[j] = count++;
      }
    });
  }
  return { run, handsBack };
}

/** How many people and docks a plan has at work at the same moment, at most. */
export function planPeaks(plan: Plan): { people: number; docks: number } {
  const peak = (weight: (i: number) => number): number => {
    const changes: [number, number][] = [];
    plan.blocks.forEach((b, i) => changes.push([b.start, weight(i)], [b.end, -weight(i)]));
    changes.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let now = 0;
    let most = 0;
    for (const [, change] of changes) most = Math.max(most, (now += change));
    return most;
  };
  return { people: peak((i) => plan.blocks[i]!.people * plan.blocks[i]!.docks), docks: peak((i) => plan.blocks[i]!.docks) };
}

/** The level's extra goal, apart from the score it also needs. */
function badgeGoal(level: Level, plan: Plan, statuses: TruckStatus[], bufferPeak: number): boolean {
  const peaks = planPeaks(plan);
  switch (level.badge.id) {
    case 'lean':
      return peaks.people <= 1;
    case 'lean3':
      return peaks.people <= 3;
    case 'lean12':
      return peaks.people <= 12;
    case 'oneDock':
      return peaks.docks <= 2;
    case 'noDockSmall': {
      // The first city with the largest volume is "the biggest".
      let biggest = 0;
      level.cities.forEach((c, i) => {
        if (c.volume > level.cities[biggest]!.volume) biggest = i;
      });
      return plan.blocks.every((b) => b.city === biggest);
    }
    case 'smallFleet':
      return plan.robots <= 6;
    case 'halfBuffer':
      return bufferPeak <= level.bufferCap / 2;
    case 'allOnTime':
      return statuses.every((s) => s === 'onTime');
    default: {
      // onTime9: at least nine trucks complete and on time (levels where not everything fits).
      const atLeast = /^onTime(\d+)$/.exec(level.badge.id);
      if (atLeast !== null) return statuses.filter((s) => s === 'onTime').length >= Number(atLeast[1]);
      // fleet3: at most three robots.
      const fleet = /^fleet(\d+)$/.exec(level.badge.id);
      if (fleet !== null) return plan.robots <= Number(fleet[1]);
      // lean16: never more than sixteen people at work.
      const lean = /^lean(\d+)$/.exec(level.badge.id);
      return lean !== null && peaks.people <= Number(lean[1]);
    }
  }
}

/**
 * Plays the shift. The plan must be startable (see checkPlan); a plan whose blocks do not fit the
 * docks cannot be played and throws.
 */
export function simulate(level: Level, given: Plan): ShiftOutcome {
  // The same plan must score the same however its blocks are listed: put them in one fixed order.
  const plan: Plan = {
    blocks: [...given.blocks].sort((a, b) => a.city - b.city || a.start - b.start || a.people - b.people || a.docks - b.docks || a.end - b.end),
    robotCities: [...new Set(given.robotCities)].sort((a, b) => a - b),
    robots: given.robots,
  };
  const { placed, unplaced } = assignDoors(level, plan);
  if (unplaced.length > 0) throw new Error('This plan needs more docks than the level has.');

  const cities = level.cities;
  const n = cities.length;
  const minutes = level.shiftMinutes + OVERTIME_MINUTES;
  const fleet = plan.robots;
  const [outFrom, outTo] = level.robotOutage ?? [0, 0];

  // A robot city's lines are open from its first parcel to its cut-off (its truck time).
  const openLines: Line[] = [];
  for (const city of robotCities(plan)) {
    const line = { city, start: firstParcel(level, city), end: cities[city]!.truck };
    for (let k = linesFor(level, city); k > 0; k--) openLines.push(line);
  }
  const blocks: DoorBlock[] = docksInOrder(level, placed);
  const { run, handsBack } = runsOf(blocks);
  // A block that ends at its city's cut-off keeps its belt: the door goes into cleardown.
  const clears = blocks.map((b) => b.end === cities[b.city]!.truck);
  clears.forEach((c, b) => {
    if (c) handsBack[b] = false;
  });
  const doorDone = new Array<number>(blocks.length).fill(-1); // the minute a door in cleardown found its belt empty
  const lines: Line[] = byTruck(level, openLines);
  const nb = blocks.length;
  const nl = lines.length;

  const arrivals: Float64Array[] = [];
  for (let i = 0; i < n; i++) arrivals.push(arrivalsPerMinute(level, i, minutes));

  const upstream = new Float64Array(n); // arrived this minute (or handed back the minute before), looking for a place
  const stored = new Float64Array(n); // in the buffer, per city
  const loaded = new Float64Array(n); // on the trucks
  const belt = new Float64Array(nb); // waiting on the belt, per run
  const inTrailer = new Float64Array(nb); // in the trailer now, per run
  const swapUntil = new Float64Array(nb); // the trailer is being swapped until this minute, per run
  let refused = 0; // found the buffer full: missed for the night
  const lineDone = new Array<number>(nl).fill(-1); // the minute a line found its table empty after the cut-off
  const table = new Float64Array(nl); // waiting on each line's table
  const taken = new Float64Array(nl); // carried off each line this minute
  let bufferFee = 0; // parcels that went into the buffer
  let inBuffer = 0;
  let bufferPeak = 0;

  const cityLoaded: number[][] = [];
  const bufferSeries: number[] = [];
  const robotsActive: number[] = [];
  const sample = (t: number): void => {
    cityLoaded.push(Array.from(loaded, roundTenth));
    bufferSeries.push(roundTenth(inBuffer));
    robotsActive.push(outFrom <= t && t < outTo ? 0 : fleet);
  };
  sample(0);

  for (let t = 0; t < minutes; t++) {
    // 1. Parcels arrive, until their city's cut-off. At the cut-off sorting for a city stops: what is
    //    in the buffer for it is left behind and its places come free; what would still arrive is too.
    for (let i = 0; i < n; i++) {
      const cutOff = cities[i]!.truck;
      if (t === cutOff) {
        inBuffer -= stored[i]!;
        stored[i] = 0;
      }
      if (t < cutOff) upstream[i] = upstream[i]! + arrivals[i]![t]!;
    }
    //    A door or line in cleardown is done the minute its belt or table is found empty.
    for (let b = 0; b < nb; b++) {
      if (clears[b] && doorDone[b]! < 0 && t >= blocks[b]!.end && belt[run[b]!]! <= 1e-9) doorDone[b] = t;
    }
    for (let l = 0; l < nl; l++) {
      if (lineDone[l]! < 0 && t >= lines[l]!.end && table[l]! <= 1e-9) lineDone[l] = t;
    }

    // 2. They go straight onto the belts and tables that are open for their city.
    for (let b = 0; b < nb; b++) {
      const blk = blocks[b]!;
      if (blk.start <= t && t < blk.end) {
        const r = run[b]!;
        const x = Math.min(BELT_ROOM - belt[r]!, upstream[blk.city]!);
        if (x > 0) {
          belt[r] = belt[r]! + x;
          upstream[blk.city] = upstream[blk.city]! - x;
        }
      }
    }
    for (let l = 0; l < nl; l++) {
      const line = lines[l]!;
      if (line.start <= t && t < line.end) {
        const x = Math.min(TABLE_ROOM - table[l]!, upstream[line.city]!);
        if (x > 0) {
          table[l] = table[l]! + x;
          upstream[line.city] = upstream[line.city]! - x;
        }
      }
    }

    // 3. What found no room goes into the buffer, until that is full. Full is full: the rest is
    //    refused, missed for the night (it counts as left behind for its city and never comes back).
    //    That goes for a belt's parcels handed back the minute before, too.
    for (let i = 0; i < n; i++) {
      if (upstream[i]! > 1e-9) {
        const x = Math.min(upstream[i]!, level.bufferCap - inBuffer);
        if (x > 0) {
          stored[i] = stored[i]! + x;
          inBuffer += x;
          upstream[i] = upstream[i]! - x;
          bufferFee += x;
        }
        refused += upstream[i]!;
        upstream[i] = 0;
      }
    }

    // 4. The buffer gives parcels back, earliest truck first, docks before robot lines.
    let budget = BUFFER_OUT_PER_MINUTE;
    for (let b = 0; b < nb && budget > 0; b++) {
      const blk = blocks[b]!;
      if (blk.start <= t && t < blk.end) {
        const r = run[b]!;
        const x = Math.min(BELT_ROOM - belt[r]!, stored[blk.city]!, budget);
        if (x > 0) {
          belt[r] = belt[r]! + x;
          stored[blk.city] = stored[blk.city]! - x;
          inBuffer -= x;
          budget -= x;
        }
      }
    }
    for (let l = 0; l < nl && budget > 0; l++) {
      const line = lines[l]!;
      if (line.start <= t && t < line.end) {
        const x = Math.min(TABLE_ROOM - table[l]!, stored[line.city]!, budget);
        if (x > 0) {
          table[l] = table[l]! + x;
          stored[line.city] = stored[line.city]! - x;
          inBuffer -= x;
          budget -= x;
        }
      }
    }

    // 5. The docks load, unless a trailer is being swapped: during their block, and in cleardown
    //    (after a block that ends at the cut-off) until the belt is empty, 45 minutes at most.
    for (let b = 0; b < nb; b++) {
      const blk = blocks[b]!;
      if ((blk.start <= t && t < blk.end) || (clears[b] && blk.end <= t && t < blk.end + CLEARDOWN_MAX)) {
        const r = run[b]!;
        if (t < swapUntil[r]!) continue;
        const x = Math.min(belt[r]!, blk.people === 1 ? ONE_PERSON_PER_MINUTE : TWO_PEOPLE_PER_MINUTE);
        belt[r] = belt[r]! - x;
        loaded[blk.city] = loaded[blk.city]! + x;
        inTrailer[r] = inTrailer[r]! + x;
        if (inTrailer[r]! >= TRAILER) {
          inTrailer[r] = inTrailer[r]! - TRAILER;
          swapUntil[r] = t + 1 + TRAILER_SWAP_MINUTES; // the next ten minutes, whoever stands at the door
        }
      }
    }

    // 6. The robots load: the fleet is shared by the open lines (and those in cleardown, up to 45
    //    minutes after their cut-off) in proportion to what waits there,
    //    and what a line cannot use goes to the lines that still have parcels.
    if (!(outFrom <= t && t < outTo) && fleet > 0) {
      const capacity = fleet / ROBOTS_PER_PARCEL_MINUTE;
      let waiting = 0;
      for (let l = 0; l < nl; l++) {
        const line = lines[l]!;
        taken[l] = 0;
        if (line.start <= t && t < line.end + CLEARDOWN_MAX) waiting += table[l]!;
      }
      if (waiting > 0) {
        let spare = capacity;
        for (let l = 0; l < nl; l++) {
          const line = lines[l]!;
          if (line.start <= t && t < line.end + CLEARDOWN_MAX) {
            const x = Math.min(table[l]!, (capacity * table[l]!) / waiting, LINE_PER_MINUTE);
            table[l] = table[l]! - x;
            loaded[line.city] = loaded[line.city]! + x;
            taken[l] = x;
            spare -= x;
          }
        }
        if (spare > 1e-9) {
          for (let l = 0; l < nl; l++) {
            const line = lines[l]!;
            if (line.start <= t && t < line.end + CLEARDOWN_MAX) {
              const x = Math.min(table[l]!, spare, LINE_PER_MINUTE - taken[l]!);
              if (x > 0) {
                table[l] = table[l]! - x;
                loaded[line.city] = loaded[line.city]! + x;
                spare -= x;
              }
            }
          }
        }
      }
    }

    // 7. A block that ends before its city's cut-off hands back what still waits there, unless the
    //    same door goes on for the same city the next minute. What is handed back looks for a place
    //    the next minute like a parcel that has just arrived. (A line always ends at the cut-off and
    //    keeps its table for the cleardown.)
    for (let b = 0; b < nb; b++) {
      const blk = blocks[b]!;
      if (t === blk.end - 1 && handsBack[b]) {
        upstream[blk.city] = upstream[blk.city]! + belt[run[b]!]!;
        belt[run[b]!] = 0;
      }
    }

    if (inBuffer > bufferPeak) bufferPeak = inBuffer;
    if ((t + 1) % STEP === 0) sample(t + 1);
  }

  // A city's truck leaves when its last door or line in cleardown is done: never before its cut-off
  // + 15 (then it is on time), and at cut-off + 45 at the latest, with what it has.
  const leaves: number[] = cities.map((c) => c.truck + CLEARDOWN);
  const doneAt = new Map<DoorBlock, number>(); // doors in cleardown: when done, at least cut-off + 15
  blocks.forEach((blk, b) => {
    if (!clears[b]) return;
    const done = Math.max(doorDone[b]! < 0 ? blk.end + CLEARDOWN_MAX : doorDone[b]!, blk.end + CLEARDOWN);
    doneAt.set(blk, done);
    leaves[blk.city] = Math.max(leaves[blk.city]!, done);
  });
  lines.forEach((line, l) => {
    leaves[line.city] = Math.max(leaves[line.city]!, lineDone[l]! < 0 ? line.end + CLEARDOWN_MAX : lineDone[l]!);
  });

  // Money, on the unrounded figures.
  let revenue = 0;
  let bonus = 0;
  let late = 0;
  let left = 0;
  cities.forEach((c, i) => {
    let shipped = Math.min(c.volume, loaded[i]!);
    let missing = c.volume - shipped;
    if (missing < COMPLETE_WITHIN) {
      shipped = c.volume;
      missing = 0;
    }
    const minutesLate = leaves[i]! - (c.truck + CLEARDOWN);
    revenue += shipped * PRICE.parcel;
    if (missing === 0 && minutesLate === 0) bonus += shipped * PRICE.onTime;
    late += minutesLate * PRICE.latePerMinute * shipped;
    left += missing * PRICE.leftBehind;
  });
  let dockCost = 0;
  let peopleCost = 0;
  for (const b of placed) {
    dockCost += ((b.end - b.start) / 60) * PRICE.dockPerHour;
    peopleCost += ((b.end - b.start) / 60) * b.people * PRICE.personPerHour * level.wageFactor;
  }
  // A door in cleardown pays its dock and crew until it is done, at least 15 minutes.
  const cleardowns: NonNullable<Timeline['cleardowns']> = [];
  for (const b of placed) {
    const done = doneAt.get(b);
    if (done === undefined) continue;
    dockCost += ((done - b.end) / 60) * PRICE.dockPerHour;
    peopleCost += ((done - b.end) / 60) * b.people * PRICE.personPerHour * level.wageFactor;
    cleardowns.push({ city: b.city, door: b.door, from: b.end, to: done });
  }
  const robotCost = (fleet * PRICE.robotPerShiftHour * level.shiftMinutes) / 60;
  const bufferCost = bufferFee * PRICE.bufferPerParcel;
  const profit = revenue + bonus - late - left - dockCost - peopleCost - robotCost - bufferCost;
  const amounts: Result['lines'] = { revenue, bonus, late, left, docks: dockCost, people: peopleCost, robots: robotCost, buffer: bufferCost };

  // The trucks as the result shows them, from the figures at the last sample.
  const final = cityLoaded[cityLoaded.length - 1]!;
  const trucks: Result['trucks'] = [];
  const departures: Timeline['departures'] = [];
  cities.forEach((c, i) => {
    const onTruck = Math.min(c.volume, final[i]!);
    const planned = c.truck + CLEARDOWN;
    const status: TruckStatus = c.volume - onTruck >= COMPLETE_WITHIN ? 'incomplete' : leaves[i]! > planned ? 'late' : 'onTime';
    trucks.push({ city: i, loaded: roundHalfEven(onTruck), planned, left: leaves[i]!, status });
    departures.push({ city: i, at: leaves[i]!, status });
  });

  // Stretches in which the buffer was full, on the 5-minute samples.
  const cap = level.bufferCap;
  const fullRanges: [number, number][] = [];
  let fullSince: number | undefined;
  bufferSeries.forEach((x, k) => {
    const full = x >= cap - COMPLETE_WITHIN;
    if (full && fullSince === undefined) fullSince = k * STEP;
    if (!full && fullSince !== undefined) {
      fullRanges.push([fullSince, k * STEP]);
      fullSince = undefined;
    }
  });
  if (fullSince !== undefined) fullRanges.push([fullSince, (bufferSeries.length - 1) * STEP]);

  const wholeProfit = roundHalfEven(profit);
  const score = Math.max(0, roundHalfEven((1000 * wholeProfit) / level.par));
  const stars = score >= 900 ? 3 : score >= 750 ? 2 : score >= 500 ? 1 : 0;
  const result: Result = {
    profit: wholeProfit,
    score,
    stars,
    badge: score >= 500 && badgeGoal(level, plan, trucks.map((x) => x.status), bufferPeak),
    lines: {
      revenue: roundHalfEven(amounts.revenue),
      bonus: roundHalfEven(amounts.bonus),
      late: roundHalfEven(amounts.late),
      left: roundHalfEven(amounts.left),
      docks: roundHalfEven(amounts.docks),
      people: roundHalfEven(amounts.people),
      robots: roundHalfEven(amounts.robots),
      buffer: roundHalfEven(amounts.buffer),
    },
    trucks,
    buffer: { series: bufferSeries, cap, fullRanges, refused: roundHalfEven(refused) },
  };
  const timeline: Timeline = {
    stepMinutes: 5,
    cityLoaded,
    buffer: [...bufferSeries],
    blocks: placed.map((b) => ({ city: b.city, door: b.door, start: b.start, end: b.end, people: b.people })),
    robotsActive,
    departures,
    cleardowns,
  };
  return { result, timeline, profit, amounts, bufferPeak };
}
