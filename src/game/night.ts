// One night from a seed: tonight's forecast per city (what the planner sees in the
// briefing), how the night really runs (drift, known only once it shows), and the
// events on the timeline. Everything comes from the seed, so a seed is a night.
import { Rng } from '../sim/rng';
import { planDoors } from '../sim/postcodes';
import { formatSeed, rngSeed, type NightSeed } from './seed';

/** Parcels in a whole night (the hall's size does not change with the country). */
export const NIGHT_PARCELS = 10_300;
/** Share of the post that goes to the north (roll cages) when the hall stands as built. */
const NORTH_SHARE = 0.7;
export const HOURS = 8; // 22:00 → 06:00

export interface NightCity {
  name: string;
  /** Tonight's forecast (parcels), with the briefing's tag when it differs from usual. */
  forecast: number;
  tag: string;
  /** How the night really runs against the forecast (e.g. +0.25), and from which hour it shows. */
  drift: number;
  driftFrom: number;
  /** Doors in the hall as it stands (0 = robots), from inhabitants: planDoors. */
  standing: number;
  /** Marked 'uncertain' in the briefing: it may drift either way (or not at all). */
  unsure: boolean;
}

export type NightEvent =
  // Announced in the briefing (on the timeline from the start):
  | { kind: 'lateInbound'; hour: number; forecast: number; actual: number }
  | { kind: 'robotsDown'; hour: number; hours: number; share: number } // planned robot maintenance
  | { kind: 'earlyCutoff'; hour: number; city: number } // a carrier leaves at 05:30
  | { kind: 'batch'; hour: number; city: number; minutes: number; share: number } // a sender's batch for one city
  // Only shown when they happen:
  | { kind: 'drift'; hour: number; city: number; delta: number }
  | { kind: 'lateTrailer'; hour: number; city: number };

/** Events the planner sees in the briefing. */
export const announced = (e: NightEvent) => e.kind === 'lateInbound' || e.kind === 'robotsDown' || e.kind === 'earlyCutoff' || e.kind === 'batch';

export interface Night {
  seed: string;
  countryId: string;
  cities: NightCity[];
  events: NightEvent[];
}

const TAGS_UP = ['sale', 'event', 'campaign', 'flowers', 'market'];
const TAGS_DOWN = ['holiday', 'quiet', 'strike at sender'];

export function makeNight(s: NightSeed): Night {
  const rng = new Rng(rngSeed(s));
  const r = (a: number, b: number) => a + rng.next() * (b - a);
  const ri = (a: number, b: number) => Math.floor(r(a, b + 1));

  const all = s.country.cities;
  const doors = planDoors(all.map((c) => c.pop), 20);
  const north = all.slice(0, doors.length);
  const south = all.slice(doors.length, doors.length + 20);
  const popN = north.reduce((a, c) => a + c.pop, 0);
  const popS = south.reduce((a, c) => a + c.pop, 0);
  const cities: NightCity[] = [
    ...north.map((c, i) => ({ name: c.name, base: (NIGHT_PARCELS * NORTH_SHARE * c.pop) / popN, standing: doors[i]! })),
    ...south.map((c) => ({ name: c.name, base: (NIGHT_PARCELS * (1 - NORTH_SHARE) * c.pop) / popS, standing: 0 })),
  ].map((c) => ({ name: c.name, forecast: Math.round(c.base), tag: '', drift: 0, driftFrom: 0, standing: c.standing, unsure: false }));

  // Forecast twists (known in the briefing): two or three up, one or two down.
  const pickCity = (from = 0, to = cities.length - 1, not: Set<number> = new Set()) => {
    let i: number;
    do i = ri(from, to);
    while (not.has(i));
    not.add(i);
    return i;
  };
  const used = new Set<number>();
  for (let k = ri(2, 3); k > 0; k--) {
    const i = pickCity(0, cities.length - 1, used);
    const up = r(0.6, 2.0);
    cities[i]!.forecast = Math.round(cities[i]!.forecast * (1 + up));
    cities[i]!.tag = `+${Math.round(up * 100)}% ${rng.pick(TAGS_UP)}`;
  }
  for (let k = ri(1, 2); k > 0; k--) {
    const i = pickCity(0, cities.length - 1, used);
    const down = r(0.2, 0.4);
    cities[i]!.forecast = Math.round(cities[i]!.forecast * (1 - down));
    cities[i]!.tag = `−${Math.round(down * 100)}% ${rng.pick(TAGS_DOWN)}`;
  }

  const events: NightEvent[] = [];
  const lateF = ri(250, 400);
  events.push({ kind: 'lateInbound', hour: 4, forecast: lateF, actual: Math.round(lateF * r(0.8, 1.5)) });

  // Drift (not in the forecast): three cities, shown between 23:00 and 02:00.
  const drifted = new Set<number>();
  for (let k = 0; k < 3; k++) {
    const i = pickCity(0, cities.length - 1, drifted);
    const delta = (rng.chance(0.65) ? 1 : -1) * r(0.06, 0.15);
    const hour = ri(1, 4);
    cities[i]!.drift = delta;
    cities[i]!.driftFrom = hour;
    events.push({ kind: 'drift', hour, city: i, delta });
    // Two of the three are flagged 'uncertain' in the briefing (direction unknown).
    if (k < 2) cities[i]!.unsure = true;
  }
  // …and one city that is flagged but holds to its forecast.
  cities[pickCity(0, cities.length - 1, drifted)]!.unsure = true;
  // The cities with extra volume tonight get it largely as one batch (announced).
  cities.forEach((c, i) => {
    if (c.tag.startsWith('+')) events.push({ kind: 'batch', hour: ri(1, 5), city: i, minutes: 30, share: r(0.3, 0.45) });
  });
  if (rng.chance(0.7)) events.push({ kind: 'robotsDown', hour: ri(3, 5), hours: 2, share: r(0.1, 0.2) });
  if (rng.chance(0.6)) events.push({ kind: 'lateTrailer', hour: ri(4, 6), city: ri(0, north.length - 1) });
  if (rng.chance(0.5)) events.push({ kind: 'earlyCutoff', hour: 6, city: ri(0, north.length - 1) });
  events.sort((a, b) => a.hour - b.hour);

  return { seed: formatSeed(s), countryId: s.country.id, cities, events };
}
