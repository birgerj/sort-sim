// Ten Shifts: a played shift (a `Timeline` from the score model) turned into what the hall has
// to show, door by door and minute by minute. Pure: no drawing, no clock of its own.
//
// The timeline says how much of each city is on its trucks every 5 minutes, which door each
// block got, how many robots drive and when the trucks leave. From that this file works out,
// for every north door: when it opens and closes, whose name is on its signs, how many people
// stand there, how many parcels went through it (a city's parcels are shared out over its open
// doors by what their people can load), how hard it works against that, when its trailer is
// swapped for an empty one, and whether its truck leaves late or not full. What a city loads
// without an open door is the robots' work.
import type { Level, Timeline, TruckStatus } from '../shifts/contract';

/** Parcels in a trailer, and roll cages that stand for them in the hall. */
export const TRAILER_PARCELS = 220;
export const TRAILER_CAGES = 10;
/** Parcels one roll cage stands for. */
export const CAGE_PARCELS = TRAILER_PARCELS / TRAILER_CAGES;
/** Minutes a door needs to change city: its signs change in that time. */
export const SWITCH_MINUTES = 15;
/** Parcels an hour a dock loads with one person, and with two. */
const PER_HOUR: Record<1 | 2, number> = { 1: 90, 2: 170 };
/** Minutes before the end of a block that its last cages go in (the warning lamp flashes). */
export const CLEARDOWN_MINUTES = 5;

/** One block of the plan on its door. */
export interface Stint {
  city: number;
  door: number;
  start: number;
  end: number;
  people: 1 | 2;
  /**
   * From when the door shows this city (cages and signs put ready): the block's start, or up
   * to 15 minutes earlier when the door comes from a block for another city.
   */
  signFrom: number;
  /** The city's truck leaves when this stint ends (no block of the city ends later). */
  departs: boolean;
  /** How that truck leaves (null when this stint's trailer is not the one that counts). */
  status: TruckStatus | null;
  /** The city's truck time, when this stint runs past it: the amber lamp flashes from then. */
  lateFrom: number | null;
  /** Parcels through this door since the stint began, after each timeline step. */
  loaded: number[];
  /** How hard the door works in each step: 0…1 of what its people can load. */
  pressure: number[];
  /** What should have gone through this door: what did, plus its part of what was left behind. */
  planned: number;
}

/** A city (partly) loaded by the robots. */
export interface RobotCity {
  city: number;
  /** Parcels the robots loaded for it after each timeline step. */
  loaded: number[];
  /** Its truck leaves from a south door when no north door of the city is still open then. */
  departure: { at: number; status: TruckStatus; lateFrom: number | null } | null;
}

export type ShiftEvent =
  | { at: number; kind: 'ready' | 'open' | 'close' | 'late'; door: number; city: number }
  | { at: number; kind: 'swap'; door: number; city: number }
  | { at: number; kind: 'depart'; city: number; status: TruckStatus; doors: number[] };

export interface ShiftSchedule {
  /** Minutes the shift plays: the level's length, or longer when a truck leaves later. */
  end: number;
  stepMinutes: number;
  stints: Stint[];
  robotCities: RobotCity[];
  robotsActive: number[];
  /** The buffer after each step, as a share of the rack (0…1). */
  buffer: number[];
  /** Everything that happens at a door or to a truck, in order of time. */
  events: ShiftEvent[];
}

/** A north door at one moment of the shift. */
export interface DoorState {
  /** The stint the door is on, is being made ready for, or (cages left behind) has just had. */
  stint: Stint | null;
  /** Door up, trailer behind it, loading. */
  open: boolean;
  /** City on its signs (−1: none, a bare door). */
  city: number;
  people: 0 | 1 | 2;
  /** Trailers already swapped away in this stint, and how full the one at the door looks (0…1). */
  swaps: number;
  trailerFill: number;
  /** Roll cages' worth of parcels through the door since the stint began. */
  cageUnits: number;
  /** 0…1 of what its people can load. */
  pressure: number;
  /** The warning lamp: the last minutes of a block, and a truck that is late. */
  lamp: boolean;
  late: boolean;
  /** After a truck left without everything: parcels still standing at the door (else 0). */
  leftBehind: number;
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** A series sampled every `step` minutes, read at any minute (straight lines between samples). */
export function sample(series: readonly number[], minute: number, step = 5): number {
  if (!series.length) return 0;
  const x = clamp(minute / step, 0, series.length - 1);
  const k = Math.floor(x);
  const a = series[k]!;
  const b = series[Math.min(series.length - 1, k + 1)]!;
  return a + (b - a) * (x - k);
}

/** Turn a timeline into the hall's schedule. */
export function buildSchedule(level: Level, timeline: Timeline): ShiftSchedule {
  const step = timeline.stepMinutes;
  const steps = Math.max(0, timeline.cityLoaded.length - 1);
  const cities = level.cities.length;
  const at = (k: number, i: number) => timeline.cityLoaded[clamp(k, 0, steps)]?.[i] ?? 0;

  const stints: Stint[] = timeline.blocks
    .map((b) => ({
      city: b.city,
      door: b.door,
      start: b.start,
      end: b.end,
      people: (b.people >= 2 ? 2 : 1) as 1 | 2,
      signFrom: b.start,
      departs: false,
      status: null as TruckStatus | null,
      lateFrom: null as number | null,
      loaded: Array.from({ length: steps + 1 }, () => 0),
      pressure: Array.from({ length: steps }, () => 0),
      planned: 0,
    }))
    .sort((a, b) => a.start - b.start || a.door - b.door);

  // A door that comes from another city shows the new one during the switch.
  for (const s of stints) {
    const before = stints.filter((x) => x.door === s.door && x !== s && x.end <= s.start).sort((a, b) => b.end - a.end)[0];
    if (before && before.city !== s.city) s.signFrom = Math.max(before.end, s.start - SWITCH_MINUTES);
  }

  // What a door can load in a step: the minutes it is open in it, times its people's pace.
  const cap = (s: Stint, k: number) => (Math.max(0, Math.min(s.end, (k + 1) * step) - Math.max(s.start, k * step)) * PER_HOUR[s.people]) / 60;
  // A city that loads while none of its doors is open is (also) a robot city.
  const robotLoaded: number[][] = Array.from({ length: cities }, () => Array.from({ length: steps + 1 }, () => 0));
  const isRobot: boolean[] = Array.from({ length: cities }, () => false);
  for (let i = 0; i < cities; i++) {
    const mine = stints.filter((s) => s.city === i);
    for (let k = 0; k < steps; k++) if (at(k + 1, i) - at(k, i) > 0.05 && mine.every((s) => cap(s, k) <= 0)) isRobot[i] = true;
  }
  for (let i = 0; i < cities; i++) {
    const mine = stints.filter((s) => s.city === i);
    for (let k = 0; k < steps; k++) {
      const delta = Math.max(0, at(k + 1, i) - at(k, i));
      const caps = mine.map((s) => cap(s, k));
      const room = caps.reduce((a, b) => a + b, 0);
      // The doors take what their people can load (all of it when the city has no robots: the
      // model's figures are the truth, a little over the pace or not); the robots take the rest.
      const toDoors = room <= 0 ? 0 : isRobot[i] ? Math.min(delta, room) : delta;
      mine.forEach((s, n) => {
        const part = room > 0 ? (toDoors * caps[n]!) / room : 0;
        s.loaded[k + 1] = s.loaded[k]! + part;
        s.pressure[k] = caps[n]! > 0 ? clamp(part / caps[n]!, 0, 1) : 0;
      });
      robotLoaded[i]![k + 1] = robotLoaded[i]![k]! + (delta - toDoors);
    }
  }

  // Trucks: a city's truck leaves when its last block ends (or from the robots' side).
  const robotCities: RobotCity[] = [];
  for (let i = 0; i < cities; i++) if (isRobot[i]) robotCities.push({ city: i, loaded: robotLoaded[i]!, departure: null });
  for (const d of timeline.departures) {
    const truck = level.cities[d.city]?.truck ?? d.at;
    const mine = stints.filter((s) => s.city === d.city);
    const last = mine.filter((s) => s.end >= d.at - 0.01);
    for (const s of last) {
      s.departs = true;
      s.status = d.status;
    }
    for (const s of mine) if (s.end > truck + 0.01 && d.status === 'late') s.lateFrom = Math.max(truck, s.start);
    const robots = robotCities.find((r) => r.city === d.city);
    if (robots && !last.length) robots.departure = { at: d.at, status: d.status, lateFrom: d.status === 'late' && d.at > truck ? truck : null };
  }
  // What was left behind stands at the doors whose truck was the city's last (shared by what they loaded).
  for (let i = 0; i < cities; i++) {
    const mine = stints.filter((s) => s.city === i);
    for (const s of mine) s.planned = s.loaded[steps]!;
    const left = Math.max(0, (level.cities[i]?.volume ?? 0) - at(steps, i));
    const last = mine.filter((s) => s.departs && s.status === 'incomplete');
    if (left < 0.5 || !last.length) continue;
    const sum = last.reduce((a, s) => a + s.loaded[steps]!, 0);
    for (const s of last) s.planned += sum > 0 ? (left * s.loaded[steps]!) / sum : left / last.length;
  }

  const end = Math.max(level.shiftMinutes, ...timeline.departures.map((d) => d.at), ...stints.map((s) => s.end));

  const events: ShiftEvent[] = [];
  for (const s of stints) {
    if (s.signFrom < s.start) events.push({ at: s.signFrom, kind: 'ready', door: s.door, city: s.city });
    events.push({ at: s.start, kind: 'open', door: s.door, city: s.city });
    events.push({ at: s.end, kind: 'close', door: s.door, city: s.city });
    if (s.lateFrom !== null) events.push({ at: s.lateFrom, kind: 'late', door: s.door, city: s.city });
    // A full trailer is swapped for an empty one (not after the very last parcel).
    for (let n = 1; n * TRAILER_PARCELS < s.planned - 0.5; n++) {
      const t = minuteOf(s.loaded, n * TRAILER_PARCELS, step);
      if (t !== null && t < s.end) events.push({ at: t, kind: 'swap', door: s.door, city: s.city });
    }
  }
  for (const d of timeline.departures) {
    events.push({ at: d.at, kind: 'depart', city: d.city, status: d.status, doors: stints.filter((s) => s.city === d.city && s.departs).map((s) => s.door).sort((a, b) => a - b) });
  }
  const order = { ready: 0, close: 1, depart: 2, open: 3, late: 4, swap: 5 };
  events.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);

  return {
    end,
    stepMinutes: step,
    stints,
    robotCities,
    robotsActive: timeline.robotsActive.slice(),
    buffer: timeline.buffer.map((b) => clamp(b / Math.max(1, level.bufferCap), 0, 1)),
    events,
  };
}

/** The minute a rising series first reaches `value` (null: never). */
function minuteOf(series: readonly number[], value: number, step: number): number | null {
  for (let k = 0; k + 1 < series.length; k++) {
    const a = series[k]!;
    const b = series[k + 1]!;
    if (b >= value && b > a) return (k + clamp((value - a) / (b - a), 0, 1)) * step;
  }
  return null;
}

const BARE: DoorState = { stint: null, open: false, city: -1, people: 0, swaps: 0, trailerFill: 0, cageUnits: 0, pressure: 0, lamp: false, late: false, leftBehind: 0 };

/** North door `door` at `minute`. */
export function doorAt(s: ShiftSchedule, door: number, minute: number): DoorState {
  const mine = s.stints.filter((x) => x.door === door);
  // On a block, or being made ready for the next one.
  const now = mine.find((x) => minute >= x.signFrom && minute < x.end);
  if (!now) {
    // Between blocks or after the last: bare, unless the last truck left parcels standing.
    const past = mine.filter((x) => x.end <= minute).sort((a, b) => b.end - a.end)[0];
    const left = past && past.status === 'incomplete' ? Math.round(past.planned - past.loaded[past.loaded.length - 1]!) : 0;
    if (!past || left <= 0) return BARE;
    return { ...BARE, stint: past, city: past.city, leftBehind: left, cageUnits: left / CAGE_PARCELS };
  }
  if (minute < now.start) return { ...BARE, stint: now, city: now.city };
  const loaded = sample(now.loaded, minute, s.stepMinutes);
  // The trailer at the door: the last one of the stint may be planned for less than a full load.
  const trailers = Math.max(1, Math.ceil((now.planned - 0.5) / TRAILER_PARCELS));
  const swaps = Math.min(trailers - 1, Math.floor(loaded / TRAILER_PARCELS));
  const due = Math.max(1, Math.min(TRAILER_PARCELS, now.planned - swaps * TRAILER_PARCELS));
  const k = clamp(Math.floor(minute / s.stepMinutes), 0, Math.max(0, now.pressure.length - 1));
  const late = now.lateFrom !== null && minute >= now.lateFrom;
  return {
    stint: now,
    open: true,
    city: now.city,
    people: now.people,
    swaps,
    trailerFill: clamp((loaded - swaps * TRAILER_PARCELS) / due, 0, 1),
    cageUnits: loaded / CAGE_PARCELS,
    pressure: now.pressure[k] ?? 0,
    lamp: late || minute >= now.end - CLEARDOWN_MINUTES,
    late,
    leftBehind: 0,
  };
}

/** Robots driving at `minute` (whole robots; the timeline's step holds until the next). */
export function robotsAt(s: ShiftSchedule, minute: number): number {
  const k = clamp(Math.floor(minute / s.stepMinutes), 0, Math.max(0, s.robotsActive.length - 1));
  return Math.max(0, Math.round(s.robotsActive[k] ?? 0));
}

/** Parcels an hour the robots load for robot city `n` (index in `robotCities`) at `minute`. */
export function robotRate(s: ShiftSchedule, n: number, minute: number): number {
  const r = s.robotCities[n];
  if (!r) return 0;
  const k = clamp(Math.floor(minute / s.stepMinutes), 0, Math.max(0, r.loaded.length - 2));
  return (((r.loaded[k + 1] ?? 0) - (r.loaded[k] ?? 0)) * 60) / s.stepMinutes;
}

/** How full the buffer rack is at `minute` (0…1). */
export function bufferAt(s: ShiftSchedule, minute: number): number {
  return sample(s.buffer, minute, s.stepMinutes);
}

/** Highest door number in use, plus one. */
export function doorsUsed(s: ShiftSchedule): number {
  return s.stints.reduce((a, x) => Math.max(a, x.door + 1), 0);
}

// ---------- the plan's parcels in the hall ----------

/** The cities' colours, as on the game's cards (sixteen, then they repeat). */
export const CITY_COLOURS = [0x2b7f70, 0xa4623a, 0x5b4fa8, 0x8a6f14, 0x2f62a8, 0xa23d68, 0x4c7d2a, 0x7a6042, 0x1f7892, 0x8a3f97, 0xa04040, 0x6b7422, 0x3c53a6, 0x2a7a55, 0x5a6170, 0x9a5a1c];

/** Parcels of city `city` that have come in by `minute` (all of them once its arrivals are over). */
export function arrivedAt(level: Level, city: number, minute: number): number {
  const c = level.cities[city];
  if (!c) return 0;
  let n = 0;
  for (const a of c.arrivals) n += Math.max(0, Math.min(minute, a.to) - a.from) * a.perMinute;
  return Math.min(c.volume, n);
}

/** The most parcels a minute the level brings in (all cities together). */
export function peakPerMinute(level: Level): number {
  let peak = 0;
  for (let t = 0; t < level.shiftMinutes; t += 5) {
    let n = 0;
    for (const c of level.cities) for (const a of c.arrivals) if (a.from <= t && t < a.to) n += a.perMinute;
    peak = Math.max(peak, n);
  }
  return peak;
}

/** Parcels a beat the loop can take in and still carry them all to their chutes (at twice its slowest speed). */
export const LOOP_PER_BEAT = 3.05;
const FACTORS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20];

/**
 * How many of the plan's parcels one parcel in the hall stands for: 1 where the hall can
 * carry them all (a minute is four beats, and the loop takes about three parcels a beat),
 * else the smallest of a fixed few that fits. The same for every city of the level.
 */
export function parcelFactor(level: Level): number {
  const perBeat = peakPerMinute(level) / 4;
  return FACTORS.find((f) => perBeat / f <= LOOP_PER_BEAT) ?? FACTORS[FACTORS.length - 1]!;
}

/** Parcels in the hall that stand for `n` of the plan's (whole parcels; counts that only grow stay in step). */
export function inHall(n: number, factor: number): number {
  return Math.round(n / factor + 1e-6);
}
