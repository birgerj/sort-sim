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

/** Cities at the north doors (roll cages) and at the south doors (robot boxes). */
export const NORTH_CITIES = CITIES.slice(0, 20);
export const SOUTH_CITIES = CITIES.slice(20, 40);

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
