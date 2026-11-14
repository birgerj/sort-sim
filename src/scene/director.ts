// Ten Shifts: the hall plays a shift of the planning game.
//
// The score model has already run: its `Timeline` is the truth. The director shows that shift
// in the hall, squeezed into half a minute or so: which doors are up, for which city and with
// how many people, how full the cages and trailers are, how many robots drive, how full the
// buffer rack stands and when the trucks leave. Nothing here counts parcels to find a result;
// one parcel in sight stands for many.
//
// How it stays honest and on the beat: the shift clock runs in real time (minutes per second),
// but the hall only changes on whole beats, each time to the state the schedule gives for the
// minute the clock shows (`doorAt` and friends in sim/shiftSchedule.ts). So a faster clock
// means bigger steps per beat, never a move between beats; and a jump (skip) is just one big step.
import type { Director, Level, Timeline } from '../shifts/contract';
import { CITIES, areas, split } from '../sim/postcodes';
import { TRAILER_CAGES, bufferAt, buildSchedule, doorAt, robotRate, robotsAt, type DoorState, type ShiftSchedule } from '../sim/shiftSchedule';
import * as THREE from 'three';

import type { ShiftHooks, Sorter } from './sorter';
import type { ScreenTone } from './trucks';

/** Shift minutes per real second unless the screens say otherwise. */
const DEFAULT_SPEED = 1.6;
/** The shift starts at ten in the evening (the door screens show clock times). */
const START_MINUTES = 22 * 60;
/** From this share of what its people can load, a dock's belt is kept full (it is backed up). */
const BACKED_UP = 0.85;
/**
 * Parcels per beat sent to a dock: about what its picker takes off the belt (busy, the belt
 * stays short), or clearly more (the belt fills to the chute and its lamp flashes red).
 */
const FEED_BUSY = 0.32;
const FEED_FULL = 1;
/** Parcels per beat to a robot station that is in use, and stations a city gets at least per 60 parcels an hour. */
const FEED_STATION = 0.34;
const LINE_PER_HOUR = 60;

const hhmm = (minute: number) => {
  const m = Math.round(START_MINUTES + minute);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** What the director last did at a north door (to act on changes only). */
interface DoorRun {
  open: boolean;
  swaps: number;
  /** Cage frames standing in the trailer now. */
  frames: number;
  /** Beat until which the trailer keeps its full look (it is pulling away for an empty one). */
  swapUntil: number;
  /** Parcels owed to its belt (a fraction builds up beat by beat). */
  owed: number;
  state: DoorState | null;
}

export function createDirector(scene: Sorter): Director {
  let active = false;
  let level: Level | null = null;
  let names: string[] = [];
  let schedule: ShiftSchedule | null = null;
  let minute = 0;
  let speed = DEFAULT_SPEED;
  let playing = false;
  let onClock: (minute: number) => void = () => {};
  let onDone: () => void = () => {};
  let bt = 0;
  let doors: DoorRun[] = [];
  /** Parcels owed to each robot station. */
  let stationOwed: number[] = [];
  /** Robot cities whose truck has left from the south side. */
  let gone = new Set<number>();
  /** Which postcode the next parcel for a city gets (round its areas). */
  const pcTurn = new Map<number, number>();
  const pcCache = new Map<number, number[]>();
  /** The free simulation's settings, put back by `exit`. */
  let saved: { rate: number; belt: number; faults: boolean; buffer: number; south: Map<number, [string, string]> } | null = null;
  const v = new THREE.Vector3();

  const cityName = (i: number) => names[i] ?? CITIES[i]?.name ?? `City ${i + 1}`;
  /** A postcode in city `i` (the i-th largest town of the country, as the level's cities are named). */
  const postcode = (i: number): number => {
    let all = pcCache.get(i);
    if (!all) {
      const c = CITIES[i];
      all = c ? areas(c) : [i];
      if (!all.length) all = [i];
      pcCache.set(i, all);
    }
    const n = pcTurn.get(i) ?? 0;
    // (A stride that is not a divisor of most counts: the cages take turns.)
    pcTurn.set(i, n + 7);
    return all[n % all.length]!;
  };
  /** The south door (index among all the trucks' doors) where robot city `n` of the schedule leaves. */
  const southDoor = (n: number) => {
    const p = scene.shiftParts();
    return p.northDoors + ((2 + 3 * n) % Math.max(1, p.southDoors));
  };

  const hooks: ShiftHooks = {
    inflow: 0,
    doorOpen: (door) => doors[door]?.open === true,
    frame(dt, beat) {
      bt = beat;
      if (!playing || !schedule || speed <= 0) return;
      minute = Math.min(schedule.end, minute + dt * speed);
      onClock(minute);
      if (minute >= schedule.end) finish(false);
    },
    beat(b) {
      bt = Math.max(bt, b);
      if (!schedule) return;
      show(false);
      if (playing && speed > 0) flow();
      else hooks.inflow = 0;
    },
  };

  /** Bring the hall to the schedule's state for the minute the clock shows. `jump`: at once, nothing rolls or drives. */
  function show(jump: boolean): void {
    const s = schedule;
    if (!s || !level) return;
    const { docks, trucks, fleet, northDoors } = scene.shiftParts();
    const chutes = scene.shiftChutes().doors;
    for (let d = 0; d < northDoors; d++) {
      const st = doorAt(s, d, minute);
      const r = doors[d]!;
      r.state = st;
      const name = st.city >= 0 ? cityName(st.city) : '';
      // Door and trailer.
      if (st.open !== r.open) {
        r.open = st.open;
        trucks.want(d, st.open);
        if (st.open) r.swaps = st.swaps;
        else if (chutes[d] !== undefined) scene.shiftClear(chutes[d]!);
        r.owed = 0;
      }
      if (st.open && st.swaps !== r.swaps) {
        // A full trailer goes, an empty one comes: it keeps its full look while it pulls away.
        r.swaps = st.swaps;
        if (!jump) {
          trucks.swap(d, bt);
          trucks.showLoad(d, TRAILER_CAGES);
          r.swapUntil = bt + 1;
        }
        r.frames = 0;
        docks.directTrailer(d, []);
      }
      if (jump) {
        trucks.settle(d, bt);
        r.swapUntil = 0;
      }
      if (st.open && bt >= r.swapUntil) {
        const n = Math.round(st.trailerFill * TRAILER_CAGES);
        trucks.showLoad(d, n);
        if (n !== r.frames) {
          r.frames = n;
          docks.directTrailer(d, Array.from({ length: n }, (_, k) => trucks.slotAt(d, k, v).clone()));
        }
      } else if (!st.open && r.frames && !trucks.atDoor(d)) {
        // The door is down: the cages in the trailer are out of sight and gone with it.
        r.frames = 0;
        docks.directTrailer(d, []);
      }
      trucks.warn(d, st.lamp);
      // Cages, people and cards.
      const city = st.city >= 0 ? CITIES[st.city] : undefined;
      docks.directDock(d, {
        cages: st.city >= 0,
        people: st.people,
        name,
        // (The cards carry the city's own postcodes when the country has that town.)
        ranges: city && city.name === name ? split(city, 6) : null,
        units: st.cageUnits,
        left: st.leftBehind > 0,
      });
      // The screen above the door and the display on the chute's pillar.
      const [main, sub, tone] = screenText(s, d, st, name);
      trucks.say(d, main, sub, tone);
      scene.shiftSign(d, main, st.open ? 'loading' : st.city >= 0 && !st.leftBehind ? 'getting ready' : 'closed');
    }
    // Robots, the buffer rack, and the robot cities' trucks at the south doors.
    fleet.limit = robotsAt(s, minute);
    scene.shiftBuffer(bufferAt(s, minute), jump ? Infinity : 24);
    s.robotCities.forEach((rc, n) => {
      const dep = rc.departure;
      if (!dep) return;
      const k = southDoor(n);
      const left = minute >= dep.at;
      trucks.warn(k, !left && dep.lateFrom !== null && minute >= dep.lateFrom);
      if (left && !gone.has(n)) {
        gone.add(n);
        // (After a jump the truck still leaves, a little later: it is not one of the director's doors.)
        trucks.cleardown([k], bt);
      }
    });
  }

  /** The screen above a north door: number and city, and what is going on there. */
  function screenText(s: ShiftSchedule, d: number, st: DoorState, name: string): [string, string, ScreenTone] {
    const no = String(d + 1);
    if (st.leftBehind > 0) return [`${no} · ${name}`, `${st.leftBehind} parcels left behind`, 'bad'];
    if (st.open && st.stint) {
      const truck = `truck ${hhmm(level!.cities[st.city]?.truck ?? st.stint.end)}`;
      if (st.late) return [`${no} · ${name}`, `LATE · ${truck}`, 'bad'];
      if (st.lamp) return [`${no} · ${name}`, `LAST CAGES · ${truck}`, 'warn'];
      return [`${no} · ${name}`, `loading · ${st.people === 2 ? '2 people' : '1 person'} · ${truck}`, 'ok'];
    }
    if (st.city >= 0) return [`${no} · ${name}`, `getting ready · opens ${hhmm(st.stint!.start)}`, 'ok'];
    // Down: how the last truck from here left, until the door is used again.
    const past = s.stints.filter((x) => x.door === d && x.end <= minute && x.status).sort((a, b) => b.end - a.end)[0];
    if (past) {
      const text = past.status === 'late' ? `truck left late · ${hhmm(past.end)}` : `truck left on time · ${hhmm(past.end)}`;
      return [`${no} · ${cityName(past.city)}`, text, past.status === 'late' ? 'bad' : 'off'];
    }
    return [no, 'closed', 'off'];
  }

  /**
   * One beat of parcels: every loading dock and every robot station in use gets its share of
   * the parcels riding the loop, and the inbound docks bring in what keeps the loop stocked.
   */
  function flow(): void {
    const s = schedule!;
    const { doors: dockChutes, stations } = scene.shiftChutes();
    let wanted = 0;
    /** Parcels per beat all the open ends take together. */
    let perBeat = 0;
    doors.forEach((r, d) => {
      const st = r.state;
      const chute = dockChutes[d];
      if (!st?.open || chute === undefined) return;
      const full = st.pressure >= BACKED_UP;
      const feed = full ? FEED_FULL : FEED_BUSY * (0.4 + 0.6 * st.pressure);
      r.owed = Math.min(3, r.owed + feed);
      perBeat += feed;
      wanted += full ? 14 : 6;
      while (r.owed >= 1 && scene.shiftSend(chute, postcode(st.city))) r.owed--;
    });
    // Robot cities: each gets a few stations side by side (more when it loads more), as long as its line is open.
    const fleet = robotsAt(s, minute);
    const loading = s.robotCities.filter((_, n) => robotRate(s, n, minute) > 0.5).length;
    s.robotCities.forEach((rc, n) => {
      const rate = robotRate(s, n, minute);
      if (rate <= 0.5 || !stations.length) return;
      // (And enough stations between them to keep the whole fleet of the plan on the move: a
      // station sends a robot off every few beats.)
      const share = Math.ceil(fleet / 1.5 / loading);
      const lines = Math.max(1, Math.min(Math.floor(stations.length / loading), Math.max(Math.ceil(rate / LINE_PER_HOUR), share)));
      for (let k = 0; k < lines; k++) {
        // (From the west end, where the robots park: the stations nearest to them first.)
        const i = stations.length - 1 - ((n * Math.floor(stations.length / loading) + k) % stations.length);
        stationOwed[i] = Math.min(2, (stationOwed[i] ?? 0) + FEED_STATION);
        wanted += fleet > 0 ? 5 : 1;
        perBeat += fleet > 0 ? FEED_STATION : 0;
        if (stationOwed[i]! >= 1 && scene.shiftSend(stations[i]!, postcode(rc.city))) stationOwed[i]!--;
      }
    });
    // Keep the loop stocked for what is open (an almost empty hall when little is).
    const target = wanted ? Math.min(160, 24 + wanted) : 0;
    // The loop runs as fast as it must to carry that past the chutes (two trays pass per beat
    // at its slowest), and never at its slowest: the far doors would wait too long.
    scene.setBeltSpeed(perBeat > 3 ? 4 : 2);
    const stock = scene.shiftStock();
    // (The lanes bring a little, for the look of it; most is set straight onto the loop.)
    hooks.inflow = stock < target ? 0.4 : 0;
    if (stock < target) scene.shiftStockUp(target - stock);
    // The music follows how busy the hall is (main.ts reads `rate`).
    scene.rate = Math.min(700, 280 + 2.5 * wanted + 4 * fleet);
  }

  function finish(jump: boolean): void {
    if (!schedule || !playing) return;
    playing = false;
    minute = schedule.end;
    hooks.inflow = 0;
    show(jump);
    onClock(minute);
    const done = onDone;
    onDone = () => {};
    done();
  }

  /** Every north door bare and down, the rack empty, no robot out: the start of a shift. */
  function bare(jump: boolean): void {
    const { docks, trucks, fleet, northDoors } = scene.shiftParts();
    docks.setDirected(true);
    doors = Array.from({ length: northDoors }, () => ({ open: false, swaps: 0, frames: 0, swapUntil: 0, owed: 0, state: null }));
    stationOwed = [];
    gone = new Set();
    pcTurn.clear();
    for (let d = 0; d < northDoors; d++) {
      trucks.want(d, false);
      trucks.warn(d, false);
      trucks.say(d, String(d + 1), 'closed', 'off');
      trucks.showLoad(d, 0);
      if (jump) trucks.settle(d, bt);
      scene.shiftSign(d, String(d + 1), 'closed');
    }
    for (const k of scene.shiftChutes().doors) scene.shiftClear(k);
    fleet.limit = 0;
    scene.shiftBuffer(0, Infinity);
    hooks.inflow = 0;
  }

  return {
    enter(lv, cityNames) {
      level = lv;
      names = cityNames.slice();
      pcCache.clear();
      const p = scene.shiftParts();
      bt = p.beat;
      if (!active) {
        active = true;
        const use = scene.storeUse();
        saved = { rate: scene.rate, belt: scene.beltSpeed(), faults: scene.faults.enabled, buffer: use.storeUsed / Math.max(1, use.storeSlots), south: new Map() };
        scene.shift = hooks;
        scene.setFaults(false);
        scene.shiftReset(true);
        for (let d = 0; d < p.northDoors; d++) p.trucks.direct(d, true, bt);
        p.trucks.freeze(true);
        p.breaks.hold = true;
        // (No random batches: `set` with nothing ends the running one and keeps new ones away.)
        p.batches.set(null, scene.hubTime());
      }
      schedule = null;
      playing = false;
      minute = 0;
      bare(false);
    },

    play(timeline: Timeline, clock, done) {
      if (!active || !level) return;
      // (Again from the start: a second attempt, or the same shift once more.)
      restoreSouth();
      bare(schedule !== null);
      schedule = buildSchedule(level, timeline);
      const { trucks } = scene.shiftParts();
      schedule.robotCities.forEach((rc, n) => {
        if (!rc.departure) return;
        const k = southDoor(n);
        const d = trucks.docks[k];
        if (!d) return;
        saved?.south.set(k, [d.city, d.pc]);
        trucks.label(k, cityName(rc.city), `robots · truck ${hhmm(level!.cities[rc.city]?.truck ?? rc.departure.at)}`);
      });
      // A loop with something on it all the way round, so the first doors do not wait for the infeeds.
      const short = 40 - scene.shiftStock();
      if (short > 0) scene.shiftStockUp(short, true);
      minute = 0;
      onClock = clock;
      onDone = done;
      playing = true;
      show(false);
      onClock(0);
    },

    setSpeed(minutesPerSecond) {
      speed = Math.max(0, Number.isFinite(minutesPerSecond) ? minutesPerSecond : DEFAULT_SPEED);
    },

    skip() {
      finish(true);
    },

    exit() {
      if (!active) return;
      active = false;
      playing = false;
      schedule = null;
      onDone = () => {};
      onClock = () => {};
      const p = scene.shiftParts();
      bt = p.beat;
      restoreSouth();
      scene.shift = null;
      p.docks.setDirected(false);
      for (let d = 0; d < p.northDoors; d++) p.trucks.direct(d, false, bt);
      p.trucks.freeze(false);
      p.breaks.hold = false;
      p.batches.set(null, scene.hubTime(), true);
      p.fleet.limit = Infinity;
      if (saved) {
        scene.rate = saved.rate;
        scene.setBeltSpeed(saved.belt);
        scene.setFaults(saved.faults);
      }
      scene.shiftReset(false);
      // The rack as full as it was (its cartons come back out by themselves, as always).
      scene.shiftBuffer(saved?.buffer ?? 0, Infinity);
      saved = null;
      speed = DEFAULT_SPEED;
    },
  };

  /** The south doors' own names back on their screens. */
  function restoreSouth(): void {
    const { trucks } = scene.shiftParts();
    for (const [k, [city, pc]] of saved?.south ?? []) {
      trucks.label(k, city, pc);
      trucks.warn(k, false);
    }
    saved?.south.clear();
  }
}
