// Ten Shifts: the planner's rough look ahead, from public numbers only.
//
// Everything here uses what the briefing shows: the arrivals per city, the truck times, the
// loading rates and the plan itself. It is a plain "what comes in minus what the crew could load"
// sum per minute. It leaves out trailer swaps, the room on the dock belts, the pace at which the
// buffer gives parcels back and a dock's idle time when it switches city, so it is a guess and
// not the score. It must never import the score model.
import { RATES, type City, type Level, type Plan } from './contract';

/** When the first parcel of a city comes in. */
export function firstParcel(city: City): number {
  let t = Infinity;
  for (const a of city.arrivals) t = Math.min(t, a.from);
  return Number.isFinite(t) ? t : 0;
}

/** Parcels per minute for a city during the minute that starts at `minute`. */
export function arrivalRate(city: City, minute: number): number {
  let r = 0;
  for (const a of city.arrivals) if (a.from <= minute && minute < a.to) r += a.perMinute;
  return r;
}

/** All parcels of a city that have come in by `minute`. */
export function arrivedBy(city: City, minute: number): number {
  let n = 0;
  for (const a of city.arrivals) n += Math.max(0, Math.min(minute, a.to) - a.from) * a.perMinute;
  return n;
}

/** Robot lines a city gets: enough for its busiest minute at 60 an hour each, at most 4. */
export function robotLines(city: City): number {
  let peak = 0;
  for (const a of city.arrivals) peak = Math.max(peak, a.perMinute);
  return Math.max(1, Math.min(4, Math.ceil(peak - 1e-9)));
}

/** What one dock loads in an hour with this many people. */
export function dockRate(people: number): number {
  return people >= 2 ? RATES.twoPeople : RATES.onePerson;
}

export interface NominalFlow {
  /** waiting[m]: parcels in the hall that nobody has loaded yet, m minutes into the shift. */
  waiting: number[];
  /** Per block of the plan, in plan order. */
  blocks: {
    /** What its crew can load from start to end. */
    capacity: number;
    /** What it loads when work is shared out evenly between a city's open docks. */
    loaded: number;
    /** Parcels of its city still waiting at the moment the block ends. */
    waitingAtEnd: number;
  }[];
  /** Per city: parcels not loaded by the end of the night at these nominal rates. */
  left: number[];
}

/**
 * Walks through the night minute by minute. Parcels of a city wait until one of its open docks
 * or the robots take them. Docks go first; the robots share the fleet between their cities by
 * what waits there, never more than 60 an hour per line.
 */
export function nominalFlow(level: Level, plan: Plan): NominalFlow {
  const minutes = level.shiftMinutes + RATES.maxLateMinutes;
  const n = level.cities.length;
  const wait = new Array<number>(n).fill(0);
  const waiting = [0];
  const blocks = plan.blocks.map((b) => ({ capacity: (Math.max(0, b.end - b.start) / 60) * dockRate(b.people) * b.docks, loaded: 0, waitingAtEnd: 0 }));
  const robotCities = plan.robots > 0 && level.robotsMax > 0 ? plan.robotCities.filter((c) => c >= 0 && c < n) : [];
  const lines = level.cities.map(robotLines);
  const firsts = level.cities.map(firstParcel);
  const outage = level.robotOutage;

  for (let m = 0; m < minutes; m++) {
    for (let c = 0; c < n; c++) wait[c] = wait[c]! + arrivalRate(level.cities[c]!, m);

    // Docks: a city's open blocks share its waiting parcels in proportion to their crews.
    const open = new Array<number>(n).fill(0);
    plan.blocks.forEach((b, i) => {
      if (b.start <= m && m < b.end && b.city >= 0 && b.city < n) open[b.city] = open[b.city]! + blocks[i]!.capacity / Math.max(1, b.end - b.start);
    });
    const share = open.map((cap, c) => (cap > 0 ? Math.min(1, wait[c]! / cap) : 0));
    plan.blocks.forEach((b, i) => {
      if (b.start <= m && m < b.end && b.city >= 0 && b.city < n) {
        const took = (blocks[i]!.capacity / Math.max(1, b.end - b.start)) * share[b.city]!;
        blocks[i]!.loaded += took;
        wait[b.city] = Math.max(0, wait[b.city]! - took);
      }
    });

    // Robots: lines are open from a city's first parcel to its truck time.
    if (robotCities.length && !(outage && outage[0] <= m && m < outage[1])) {
      const at = robotCities.filter((c) => firsts[c]! <= m && m < level.cities[c]!.truck && wait[c]! > 0);
      let total = 0;
      for (const c of at) total += wait[c]!;
      const fleet = (plan.robots * RATES.robot) / 60;
      for (const c of at) {
        const took = Math.min(wait[c]!, lines[c]!, (fleet * wait[c]!) / total);
        wait[c] = wait[c]! - took;
      }
    }

    plan.blocks.forEach((b, i) => {
      if (b.end === m + 1 && b.city >= 0 && b.city < n) blocks[i]!.waitingAtEnd = wait[b.city]!;
    });
    let sum = 0;
    for (const w of wait) sum += w;
    waiting.push(sum);
  }
  return { waiting, blocks, left: wait.slice() };
}

/**
 * The rough buffer guess per hour of the shift: 0 = (almost) empty, under 5% of its places;
 * 1 = some, under half; 2 = a lot. It takes the fullest moment of each hour.
 */
export function roughBuffer(level: Level, plan: Plan): (0 | 1 | 2)[] {
  const { waiting } = nominalFlow(level, plan);
  const hours = Math.ceil(level.shiftMinutes / 60);
  const out: (0 | 1 | 2)[] = [];
  for (let h = 0; h < hours; h++) {
    let peak = 0;
    for (let m = h * 60 + 1; m <= Math.min((h + 1) * 60, level.shiftMinutes); m++) peak = Math.max(peak, waiting[m] ?? 0);
    const part = peak / Math.max(1, level.bufferCap);
    out.push(part < 0.05 ? 0 : part < 0.5 ? 1 : 2);
  }
  return out;
}
