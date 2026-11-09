// Destinations: the 40 largest towns or municipalities of the chosen country (see
// countries.ts), each with its postcode areas (a range a–b means every area number
// from a to b that exists there).
//
// The 20 largest each get a dock door on the north side, where parcels go into
// roll cages (five per door, each for a part of the city's postcodes). The next
// 20 get a door on the south side, fed by the robots' boxes (two per door).
// Parcels carry a postcode; the sorter sends them by it.
import { COUNTRY, pcDigits, type City } from './countries';

export type { City };

/** Largest first. */
export const CITIES: City[] = COUNTRY.cities;

/**
 * How many north doors each city gets, from its volume (post goes out in proportion to
 * inhabitants): every city served at the north side gets at least one door, and the
 * remaining doors go one by one to the city with the most post per door (the D'Hondt
 * rule). How many cities are served at the north side is chosen so the post per door is
 * as even as possible over all doors (the busiest door against the quietest). No city
 * gets more than four doors.
 * Returns the door count per city, largest city first.
 */
export function planDoors(pops: number[], doors: number, most = 4): number[] {
  let best: number[] = [];
  let bestScore = Infinity;
  for (let k = Math.max(1, Math.ceil(doors / most)); k <= Math.min(doors, pops.length); k++) {
    const n = pops.slice(0, k).map(() => 1);
    for (let left = doors - k; left > 0; left--) {
      // (No city gets more than `most` doors.)
      let i = -1;
      for (let j = 0; j < k; j++) if (n[j]! < most && (i < 0 || pops[j]! / n[j]! > pops[i]! / n[i]!)) i = j;
      n[i]!++;
    }
    const per = n.map((c, i) => pops[i]! / c);
    // (A little bonus for serving more cities at the docks, on a near tie.)
    const score = Math.max(...per) / Math.min(...per) - k * 0.002;
    if (score < bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/** Doors per north city as the hall is built (see planDoors), and the cities the hall serves. */
const STANDING = planDoors(CITIES.map((c) => c.pop), 20);
/** The night-shift game's cities, in its order: the north cities, then the next 20. */
export const GAME_CITIES = CITIES.slice(0, STANDING.length + 20);

/**
 * A night-shift game re-signs the doors to the player's plan (?game=…&plan=4.3.3.2.0…:
 * per game city 0 = robots, 1–4 north doors). Invalid or absent: the hall as built.
 */
function gamePlan(): number[] | null {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '');
    if (!q.get('game')) return null;
    const p = (q.get('plan') ?? '').split('.').map(Number);
    const ok =
      p.length === GAME_CITIES.length &&
      p.every((n) => Number.isInteger(n) && n >= 0 && n <= 4) &&
      p.reduce((a, b) => a + b, 0) === 20 &&
      p.filter((n) => n === 0).length <= 20;
    return ok ? p : null;
  } catch {
    return null;
  }
}
const PLAN = gamePlan();

/** Doors per north city, west to east. */
export const DOORS_PER_CITY = PLAN ? PLAN.filter((n) => n > 0) : STANDING;
/** Cities at the north doors (roll cages) and at the south doors (robot boxes, 20 doors). */
export const NORTH_CITIES = PLAN ? GAME_CITIES.filter((_, i) => PLAN[i]! > 0) : CITIES.slice(0, STANDING.length);
export const SOUTH_CITIES = PLAN
  ? // The robot cities, and the country's next towns on any doors left over.
    [...GAME_CITIES.filter((_, i) => PLAN[i] === 0), ...CITIES.slice(GAME_CITIES.length)].slice(0, 20)
  : CITIES.slice(STANDING.length, STANDING.length + 20);
/** The city (index in NORTH_CITIES) of each north door, west to east: a city's doors side by side. */
export const DOCK_CITY: number[] = DOORS_PER_CITY.flatMap((n, i) => Array.from({ length: n }, () => i));

/** All area numbers of a city, low to high. */
export function areas(c: City, step = COUNTRY.step): number[] {
  const out: number[] = [];
  for (const [a, b] of c.pc) for (let n = a; n <= b; n++) if (n % step === 0 || a === b) out.push(n);
  return out;
}

/** Split a city's postcodes into `parts` consecutive ranges (for cages or boxes). */
export function split(c: City, parts: number): [number, number][] {
  const all = areas(c);
  const out: [number, number][] = [];
  for (let k = 0; k < parts; k++) {
    const a = all[Math.floor((k * all.length) / parts)]!;
    const b = all[Math.floor(((k + 1) * all.length) / parts) - 1]!;
    out.push([a, b]);
  }
  return out;
}

/** "1011–1029" (with leading zeros where the country writes them: "06000–06300"). */
export const rangeText = ([a, b]: [number, number]) => (a === b ? pcDigits(a) : `${pcDigits(a)}–${pcDigits(b)}`);

/** Which of the ranges holds postcode pc (−1 if none). */
export const rangeOf = (ranges: [number, number][], pc: number) => ranges.findIndex(([a, b]) => pc >= a && pc <= b);

/**
 * A random destination: a share `south` to the cities the robots serve, the
 * rest to the north cities (roll cages). Cities get post in proportion to their inhabitants.
 */
export function randomPostcode(rnd: () => number = Math.random, south = 0.3): { pc: number; city: number; north: boolean } {
  const north = rnd() >= south;
  const list = north ? NORTH_CITIES : SOUTH_CITIES;
  // By inhabitants: a city twice as big gets twice the post.
  const w = list.map((c) => c.pop);
  let x = rnd() * w.reduce((a, b) => a + b, 0);
  let i = 0;
  while (i < w.length - 1 && (x -= w[i]!) > 0) i++;
  const all = areas(list[i]!);
  return { pc: all[Math.floor(rnd() * all.length)]!, city: i, north };
}
