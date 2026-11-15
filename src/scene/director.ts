// Ten Shifts: the hall plays a shift of the planning game.
//
// The score model has already run: its `Timeline` is the truth. The director shows that shift
// in the hall with the plan's own parcels: each city's parcels come in as the level says (each
// with a band in its city's colour), ride the loop, go down the chute of an open dock of their
// city or to its robot stations, or into the buffer rack while there is no room for them, and
// are loaded by the people the plan put there. Where the hall cannot carry every parcel (the
// big levels) one parcel stands for a fixed few (`parcelFactor`).
//
// The numbers still come only from the timeline: nobody takes a parcel off a belt before the
// timeline has loaded it, the rack is as full as the timeline's buffer, trucks go when the
// timeline says. Where the hall is behind at the end of a block, the difference is put on
// board in one go; what the timeline left behind stays in sight.
//
// Time: the hall's own pace is a quarter of a minute per beat (0.4 minutes a second at the
// music's usual tempo). A faster shift runs the whole hall faster by a whole factor
// (`ShiftHooks.warp`), so everything still moves on beats; the shift clock is counted in the
// hall's beats, so the hall and the clock can never drift apart.
import * as THREE from 'three';

import { CITY_COLOURS, cityHex } from '../shifts/colours';
import type { Director, Level, Timeline } from '../shifts/contract';
import { CITIES, areas, split } from '../sim/postcodes';
import {
  arrivedAt,
  buildSchedule,
  doorAt,
  inHall,
  parcelFactor,
  peakPerMinute,
  robotsAt,
  sample,
  type DoorState,
  type ShiftSchedule,
  type Stint,
} from '../sim/shiftSchedule';
import type { ShiftHooks, Sorter } from './sorter';
import type { ScreenTone } from './trucks';

/** Shift minutes per real second: the hall's own pace, and the pace the game starts at. */
const OWN_SPEED = 0.4;
const DEFAULT_SPEED = 1.6;
/** Shift minutes per hall beat. */
const MIN_PER_BEAT = 0.25;
/** Parcels per minute for the music's tempo while a shift plays (main.ts reads `rate`): 96 beats a minute, so 0.4 shift minutes a second. */
const TEMPO_RATE = 121;
/** The shift starts at ten in the evening (the door screens show clock times). */
const START_MINUTES = 22 * 60;
/** Parcels in a full roll cage when every parcel is shown (ten cages are a trailer of 220). */
const CAGE = 22;
/** Parcels of the plan riding the loop with nowhere to go, above which the lanes hold theirs back. */
const LOOP_STOCK = 150;
/** Parcels of one city riding the loop with nowhere to go, above which no more of that city are let in. */
const CITY_STOCK = 14;
/** Parcels a robot station may have waiting on its table or on their way to it. */
const TABLE_AHEAD = 3;
/** Minutes ahead of the timeline that the rack starts giving parcels back. */
const RACK_AHEAD = 6;
/** Minutes of margin on top of the ride from the infeeds, in how far ahead of the timeline's loading a parcel is sent down a dock's chute. */
const SEND_AHEAD = 4;
/** Seconds between two camera cuts at least, seconds a cut is held, and the fastest pace that still cuts (hall beats per music beat). */
const CUT_GAP = 9;
const CUT_HOLD = 4.5;
const CUT_WARP = 4;
/** The closing shot in hall beats (the hall is at its own pace then, 1.6 beats a second): its length, when the night starts to fall and how long that takes, and when the camera goes to the party. */
const FINALE_BEATS = 8;
/** Hall beats the doors of the last trucks wait for the closing shot before they come down by themselves. */
const LAST_DOOR_BEATS = 10;
const NIGHT_FROM = 2;
const NIGHT_BEATS = 3;
const PARTY_AT = 4;

const hhmm = (minute: number) => {
  const m = Math.round(START_MINUTES + minute);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** What the director last did at a north door (to act on changes only). */
interface DoorRun {
  open: boolean;
  swaps: number;
  stint: Stint | null;
  state: DoorState | null;
  /** The belt was seen backed up in this block already (one camera cut per block). */
  seenFull: boolean;
  /** The camera has been to this block's cleardown. */
  seenClear: boolean;
  /** Parcels sent down this door's chute in this block. */
  sent: number;
}

type Shot = { eye: THREE.Vector3; look: THREE.Vector3; name: string; free?: boolean };

/** Fixed places the player can look from during a shift: stops of the free simulation, and the buffer rack (null). */
const VIEWS: { id: string; name: string; stop: string | null }[] = [
  { id: 'docks', name: 'Docks', stop: 'docks' },
  { id: 'robots', name: 'Robots', stop: 'pickup stations' },
  { id: 'buffer', name: 'Buffer', stop: null },
  { id: 'sorter', name: 'Sorter', stop: 'loop' },
  { id: 'inbound', name: 'Inbound', stop: 'inbound' },
  { id: 'top', name: 'From above', stop: 'top down' },
];

export function createDirector(scene: Sorter): Director {
  let active = false;
  let level: Level | null = null;
  let names: string[] = [];
  let schedule: ShiftSchedule | null = null;
  let timeline: Timeline | null = null;
  let factor = 1;
  let minute = 0;
  let speed = DEFAULT_SPEED;
  let playing = false;
  let skipped = false;
  let onClock: (minute: number) => void = () => {};
  let onDone: () => void = () => {};
  let bt = 0;
  let doors: DoorRun[] = [];
  /** Per city: parcels brought into the hall so far, and parcels of it in the buffer rack. */
  let out: number[] = [];
  let stored: number[] = [];
  /** Parcels in the buffer rack (hall parcels), all cities. */
  let racked = 0;
  /** Per robot city of the schedule: parcels sent to its stations so far, and whose turn it is among them. */
  let sentRobots: number[] = [];
  let stationTurn = 0;
  /** Robot cities whose truck has left from the south side. */
  let gone = new Set<number>();
  let robotsWere = -1;
  let rackWas = 0;
  const waiting: number[] = [];
  /** Which postcode the next parcel for a city gets (round its areas). */
  const pcTurn = new Map<number, number>();
  const pcCache = new Map<number, number[]>();
  /** The free simulation's settings, put back by `exit`. */
  let saved: { rate: number; belt: number; faults: boolean; buffer: number; south: Map<number, [string, string]>; camera: object } | null = null;

  // Camera.
  let auto = true;
  let autoCb: (on: boolean) => void = () => {};
  /** The shot the director last asked for, and until when (real seconds) a cut is held; when the last cut was. */
  let shotName = '';
  let cutUntil = 0;
  let lastCut = -1e9;
  let pendingCut: Shot | null = null;
  let overviewKey = '';
  let wasOutside = false;
  /** Doors of the last trucks, still up for the closing shot, and the beat by which they come down anyway. */
  let lastDoors: { d: number; until: number }[] = [];
  /** The closing shot has been played. */
  let closed = false;
  /** The closing shot being played: the hall beat it began on, whether the party follows, where, and whom to tell when it is over. */
  let closing: { from: number; party: boolean; cx: number; done: () => void } | null = null;
  const now = () => performance.now() / 1000;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

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
  /** The robot stations (chutes) of robot city `n`: side by side from the west end, where the robots park. */
  const stationsOf = (n: number): number[] => {
    const s = schedule!;
    const all = scene.shiftChutes().stations;
    const per = Math.max(1, Math.min(4, Math.floor(all.length / Math.max(1, s.robotCities.length))));
    return Array.from({ length: per }, (_, k) => all[all.length - 1 - ((n * per + k) % all.length)]!);
  };
  /** Is robot city `n`'s line open at `t` (from its first parcel until its cut-off, or until the robots have loaded their last for it)? */
  const lineOpen = (n: number, t: number): boolean => {
    const s = schedule!;
    const rc = s.robotCities[n]!;
    const last = rc.loaded[rc.loaded.length - 1] ?? 0;
    return t < rc.cutoff && arrivedAt(level!, rc.city, t + 1) > 0 && sample(rc.loaded, t, s.stepMinutes) < last - 1e-6;
  };
  /** Has city `c` a dock or robot line taking parcels at `t`? */
  const hasEnd = (c: number, t: number): boolean => doors.some((r) => r.open && r.state?.city === c && !(r.state.clearing && r.stint && !r.stint.derived)) || schedule!.robotCities.some((rc, n) => rc.city === c && lineOpen(n, t));

  const hooks: ShiftHooks = {
    inflow: 0,
    warp: 1,
    night: 0,
    colours: CITY_COLOURS.map((c) => new THREE.Color(c)),
    doorOpen: (door) => doors[door]?.open === true,
    frame(_dt, beat) {
      const before = bt;
      bt = beat;
      watchCamera();
      if (lastDoors.length && (closing ? beat - closing.from >= 1 : lastDoors.some((x) => beat >= x.until))) {
        // The last doors come down: a beat into the closing shot, or without one after a while.
        const { trucks } = scene.shiftParts();
        for (const x of lastDoors) trucks.want(x.d, false);
        lastDoors = [];
      }
      if (closing) {
        const t = beat - closing.from;
        if (closing.party) hooks.night = Math.min(1, Math.max(0, (t - NIGHT_FROM) / NIGHT_BEATS));
        if (closing.party && t >= PARTY_AT && shotName !== 'Party') go({ eye: v(closing.cx - 9, 3.4, 5.5), look: v(closing.cx + 6, 1.3, -3.5), name: 'Party' }, true);
        if (t >= FINALE_BEATS) {
          const { done } = closing;
          closing = null;
          closed = true;
          done();
        }
      }
      // (Paused, no beat comes: a cut still ends, back to the overview.)
      if (hooks.warp === 0 && cutUntil && now() >= cutUntil) direct();
      if (!playing || !schedule) return;
      minute = Math.min(schedule.end, minute + Math.max(0, beat - before) * MIN_PER_BEAT);
      onClock(minute);
      if (minute >= schedule.end) finish(false);
    },
    beat(b) {
      bt = Math.max(bt, b);
      if (!schedule) return;
      show(false);
      if (playing) {
        flow();
        events();
      }
      direct();
    },
    /** The city whose next parcel is most overdue on the loop (see `flow`). */
    next() {
      if (!playing || !schedule || !level) return -1;
      if (scene.shiftWaiting(waiting) >= LOOP_STOCK) return -1;
      return due(0);
    },
    took(city) {
      out[city] = (out[city] ?? 0) + 1;
    },
    route(city) {
      if (!playing || !schedule) return null;
      const chutes = scene.shiftChutes().doors;
      for (const [d, r] of doors.entries()) {
        const chute = chutes[d];
        if (!r.open || r.state?.city !== city || chute === undefined || r.sent >= mayHave(d, chute)) continue;
        return { chute, pc: postcode(city) };
      }
      return null;
    },
    sent(chute, n = 1) {
      const r = doors[scene.shiftChutes().doors.indexOf(chute)];
      if (r) r.sent = Math.max(0, r.sent + n);
    },
  };

  /**
   * The city with the most parcels that should be on the loop by now and are not (−1: none).
   * A parcel is let onto the loop as early as it takes to ride to where it is going, so it is
   * at its dock when the level says it comes in; `late` minutes later it counts as overdue.
   */
  function due(late: number): number {
    const lv = level!;
    let best = -1;
    let most = 0;
    for (let i = 0; i < lv.cities.length; i++) {
      // (A city with enough riding the loop already waits upstream: its parcels must not keep the others' out.)
      if ((waiting[i] ?? 0) >= CITY_STOCK && !hasDock(i)) continue;
      // A city with an open dock comes in only as fast as that dock may be sent parcels: what
      // must wait, waits in the lanes, not on the loop (a lap is over twenty minutes). Unless
      // the rack still has to fill: those parcels come in for it.
      if (rackShort <= 0 && !mayCome(i)) continue;
      const lead = scene.shiftLead(chuteFor(i)) * MIN_PER_BEAT;
      const n = inHall(arrivedAt(lv, i, minute + lead - late), factor) - (out[i] ?? 0);
      if (n > most) {
        most = n;
        best = i;
      }
    }
    return best;
  }

  /** Where city `i`'s parcels go now or next: the chute of its dock, a robot station, or (−1) the store. */
  function chuteFor(i: number): number {
    const s = schedule!;
    const chutes = scene.shiftChutes().doors;
    const st = s.stints.filter((x) => x.city === i && (x.derived ? x.end : x.cutoff) > minute).sort((a, b) => a.start - b.start)[0];
    if (st && st.start <= minute + 30) return chutes[st.door] ?? -1;
    const n = s.robotCities.findIndex((rc) => rc.city === i);
    return n >= 0 ? (stationsOf(n)[0] ?? -1) : -1;
  }

  /** Bring the doors, people, signs and trucks to the schedule's state for the minute the clock shows. */
  function show(jump: boolean): void {
    const s = schedule;
    if (!s || !level) return;
    const { docks, trucks, fleet, floor, northDoors } = scene.shiftParts();
    const chutes = scene.shiftChutes().doors;
    for (let d = 0; d < northDoors; d++) {
      const st = doorAt(s, d, minute);
      const r = doors[d]!;
      const name = st.city >= 0 ? cityName(st.city) : '';
      const chute = chutes[d];
      // A block ends: the last of it goes on board, the door comes down.
      if (r.open && (!st.open || st.stint !== r.stint)) {
        const was = r.stint!;
        const again = s.stints.some((x) => x.door === d && x.start >= was.blockEnd && x !== was);
        const { short, cleared } = docks.closeOut(d, !again);
        // Loaded by the timeline but not at the dock yet: those on the chute or the belt, then
        // those still riding the loop, are on board too; any that never came in will not come.
        let missing = short;
        const back = chute !== undefined ? scene.shiftClear(chute, again || missing > 0) : 0;
        const extra = Math.max(0, back - missing);
        missing = Math.max(0, missing - back);
        if (missing > 0) missing -= scene.shiftDrop(was.city, missing);
        // (More taken off the chute and belt than were loaded: they come round again.)
        out[was.city] = Math.max(0, (out[was.city] ?? 0) - cleared - extra + missing);
        r.open = false;
        // (The doors of the very last trucks stay up a moment longer: the closing shot shows them come down.)
        if (!jump && minute >= s.end) lastDoors.push({ d, until: bt + LAST_DOOR_BEATS });
        else trucks.want(d, false);
      }
      const fresh = st.open && !r.open;
      if (fresh) {
        r.open = true;
        r.swaps = st.swaps;
        r.seenFull = false;
        r.seenClear = false;
        r.sent = 0;
        trucks.want(d, true);
      }
      r.stint = st.open ? st.stint : null;
      r.state = st;
      if (st.open && st.swaps !== r.swaps) {
        r.swaps = st.swaps;
        if (!jump) trucks.swap(d);
      }
      if (jump) trucks.settle(d, bt);
      trucks.warn(d, st.lamp);
      const city = st.city >= 0 ? CITIES[st.city] : undefined;
      docks.directDock(d, {
        cages: st.open,
        people: st.people,
        name,
        colour: cityHex(st.city),
        // (The cards carry the city's own postcodes when the country has that town.)
        ranges: city && city.name === name ? split(city, 6) : null,
        allow: st.open && st.stint ? inHall(sample(st.stint.loaded, minute, s.stepMinutes), factor) : 0,
        clearing: st.clearing,
        fresh,
      });
      const [main, sub, tone] = screenText(s, d, st, name);
      trucks.say(d, main, sub, tone);
      scene.shiftSign(d, main, st.open ? 'loading' : 'closed');
    }
    fleet.limit = robotsAt(s, minute);
    s.robotCities.forEach((rc, n) => {
      const dep = rc.departure;
      // From its cut-off the boxes it filled go to the trucks (a forklift comes for each, full or not).
      if (minute >= rc.cutoff && minute < (dep?.at ?? rc.cutoff + 15) && Math.floor(bt) % 8 === 0) {
        const xs = stationsOf(n).map((c) => floor.stations[scene.shiftChutes().stations.indexOf(c)]?.x ?? 0);
        floor.shipBins(Math.min(...xs) - 5, Math.max(...xs) + 5);
      }
      if (!dep) return;
      const k = southDoor(n);
      const left = minute >= dep.at;
      // (The lamp at its south door: through the cleardown, and while it is late.)
      trucks.warn(k, !left && minute >= rc.cutoff);
      if (left && !gone.has(n)) {
        gone.add(n);
        trucks.cleardown([k], bt);
      }
    });
  }

  /** The screen above a north door: number and city, and what is going on there. */
  function screenText(s: ShiftSchedule, d: number, st: DoorState, name: string): [string, string, ScreenTone] {
    const no = String(d + 1);
    if (st.open && st.stint) {
      const goes = st.stint.departs ? `truck leaves ${hhmm(st.stint.end)}` : `door closes ${hhmm(st.stint.end)}`;
      if (st.late) return [`${no} · ${name}`, `LATE · ${goes}`, 'bad'];
      if (st.clearing) return [`${no} · ${name}`, `CLEARDOWN · ${goes}`, 'warn'];
      return [`${no} · ${name}`, `loading · ${st.people === 2 ? '2 people' : '1 person'} · cut-off ${hhmm(st.stint.cutoff)}`, 'ok'];
    }
    // Only a door with an open block shows a city. Any other is dark: closed, with at most when
    // it opens next or what its last truck left standing.
    void s;
    if (st.leftBehind > 0) return [no, `${st.leftBehind} parcels left behind`, 'bad'];
    if (st.city >= 0 && st.stint) return [no, `closed · opens ${hhmm(st.stint.start)}`, 'off'];
    return [no, 'closed', 'off'];
  }

  const hasDock = (i: number) => doors.some((r) => r.open && r.state?.city === i);
  /** Parcels the rack should hold by the timeline and neither holds nor has riding the loop towards it. */
  let rackShort = 0;
  /** May another parcel of city `i` come onto the loop: has it no open dock (robots, rack, a dock about to open), or one that can still be sent parcels? */
  function mayCome(i: number): boolean {
    const chutes = scene.shiftChutes().doors;
    let docks = 0;
    let room = 0;
    doors.forEach((r, d) => {
      if (!r.open || r.state?.city !== i || chutes[d] === undefined) return;
      docks++;
      room += mayHave(d, chutes[d]!) - r.sent;
    });
    return !docks || room > scene.shiftComing(i);
  }

  /** Parcels door `d` may have been sent in its block by now (see `flow`). */
  function mayHave(d: number, chute: number): number {
    const st = doors[d]?.state;
    if (!st?.open || !st.stint || !schedule) return 0;
    // Past the cut-off nothing more goes down the chute. (A timeline without cleardowns still
    // loads in its last 15 minutes: what it loads then is sent, so it can be seen going in.)
    if (st.clearing && !st.stint.derived) return doors[d]!.sent;
    const all = inHall(st.stint.loaded[st.stint.loaded.length - 1] ?? 0, factor);
    if (st.clearing) return all;
    // (Just before a cut-off: everything this door will still load is on its way to the belt by then.)
    if (!st.stint.derived && minute + scene.shiftLead(chute) * MIN_PER_BEAT + SEND_AHEAD >= st.stint.cutoff) return all;
    return inHall(sample(st.stint.loaded, minute + scene.shiftLead(chute) * MIN_PER_BEAT + SEND_AHEAD, schedule.stepMinutes), factor);
  }

  /**
   * One beat of the plan's parcels: those that are due and that no lane brought are set on
   * the loop; those riding it go down the chute of an open dock of their city or to its
   * robot stations while there is room; and the buffer rack takes or gives what the timeline
   * says it holds.
   */
  function flow(): void {
    const s = schedule!;
    const lv = level!;
    const tl = timeline!;
    const { doors: dockChutes } = scene.shiftChutes();
    const total = scene.shiftWaiting(waiting);
    // In: the lanes let the plan's parcels onto the loop (`next`); what is overdue by more
    // than a minute (no lane had one ready) is set on a tray at the infeeds.
    for (let n = 0; n < 2 && total < LOOP_STOCK; n++) {
      const c = due(1);
      if (c < 0 || !scene.shiftPlace(c)) break;
      out[c] = (out[c] ?? 0) + 1;
    }
    // To the docks.
    doors.forEach((r, d) => {
      const st = r.state;
      const chute = dockChutes[d];
      if (!r.open || !st || !st.stint || chute === undefined) return;
      // Only what the timeline has loaded here, as far ahead as a parcel is let onto the loop
      // before it is due (its ride from the infeeds, see `due`) and a little more: one that
      // comes in on time goes straight down, and is not sent round the loop again. So the crew
      // never has to stand beside a parcel it may not take yet; what must wait, waits on the
      // loop or in the rack.
      const may = mayHave(d, chute);
      for (let n = 0; n < 2 && r.sent < may && (waiting[st.city] ?? 0) > 0; n++) {
        if (!scene.shiftSend(chute, st.city, postcode(st.city))) break;
        r.sent++;
        waiting[st.city]!--;
      }
    });
    // To the robots: as many as the timeline has them load a little ahead of now (their
    // tables hold a few), spread over the city's stations.
    s.robotCities.forEach((rc, n) => {
      if (!lineOpen(n, minute)) return;
      const may = inHall(sample(rc.loaded, minute + 3, s.stepMinutes), factor) + TABLE_AHEAD;
      const mine = stationsOf(n);
      for (let k = 0; k < mine.length && (sentRobots[n] ?? 0) < may && (waiting[rc.city] ?? 0) > 0; k++) {
        const chute = mine[(stationTurn + k) % mine.length]!;
        if (scene.shiftTable(chute) >= TABLE_AHEAD || !scene.shiftSend(chute, rc.city, postcode(rc.city))) continue;
        sentRobots[n] = (sentRobots[n] ?? 0) + 1;
        waiting[rc.city]!--;
      }
    });
    stationTurn++;
    // The buffer rack: as many parcels as the timeline's buffer holds now.
    // (Out a little early: a parcel from the rack rides most of the loop to a dock at the west end.)
    const held = sample(tl.buffer, minute, s.stepMinutes);
    const want = inHall(Math.min(held, sample(tl.buffer, minute + RACK_AHEAD, s.stepMinutes)), factor);
    rackShort = want - racked - total;
    for (let n = 0; n < 3 && racked < want; n++) {
      const c = scene.shiftStore((city) => !hasEnd(city, minute));
      if (c < 0) break;
      racked++;
      stored[c] = (stored[c] ?? 0) + 1;
    }
    for (let n = 0; n < 2 && racked > want; n++) {
      // Out again: for a city that can load now, the earliest truck first; else whichever leaves first.
      const have = lv.cities.map((_, i) => i).filter((i) => (stored[i] ?? 0) > 0);
      if (!have.length) {
        racked = want;
        break;
      }
      const byTruck = (a: number, b: number) => lv.cities[a]!.truck - lv.cities[b]!.truck;
      const c = have.filter((i) => hasEnd(i, minute)).sort(byTruck)[0] ?? have.sort(byTruck)[0]!;
      if (!scene.shiftRetrieve(c)) break;
      stored[c]!--;
      racked--;
    }
    rack(24);
    // The lanes stay stocked (the unloaders work until their lane is full, as always).
    hooks.inflow = 1.5;
  }

  /** The rack drawn as full as the buffer is (against the level's size), in the colours of what is in it. */
  function rack(most: number): void {
    const lv = level!;
    let turn = 0;
    const have = lv.cities.map((_, i) => i).filter((i) => (stored[i] ?? 0) > 0);
    scene.shiftBuffer((racked * factor) / Math.max(1, lv.bufferCap), most, () => (have.length ? have[turn++ % have.length]! : -1));
  }

  function finish(jump: boolean): void {
    if (!schedule || !playing) return;
    playing = false;
    minute = schedule.end;
    hooks.inflow = 0;
    hooks.warp = 1;
    if (jump) {
      // Skipped: straight to the end of the night, nothing left to watch.
      skipped = true;
      scene.shiftReset(true);
    }
    show(jump);
    onClock(minute);
    const done = onDone;
    onDone = () => {};
    done();
  }

  /** Every north door bare and down, the rack empty, no robot out: the start of a shift. */
  function bare(jump: boolean): void {
    const { docks, trucks, fleet, floor, northDoors } = scene.shiftParts();
    docks.setDirected(true, Math.max(2, Math.round(CAGE / factor)));
    doors = Array.from({ length: northDoors }, () => ({ open: false, swaps: 0, stint: null, state: null, seenFull: false, seenClear: false, sent: 0 }));
    out = [];
    stored = [];
    racked = 0;
    rackShort = 0;
    sentRobots = [];
    gone = new Set();
    robotsWere = -1;
    rackWas = 0;
    pcTurn.clear();
    for (let d = 0; d < northDoors; d++) {
      trucks.want(d, false);
      trucks.warn(d, false);
      trucks.say(d, String(d + 1), 'closed', 'off');
      if (jump) trucks.settle(d, bt);
      scene.shiftSign(d, String(d + 1), 'closed');
    }
    scene.shiftReset(true);
    fleet.limit = 0;
    fleet.retask = true;
    if (!floor.near) floor.shiftBoards(true);
    floor.near = true;
    scene.shiftBuffer(0, Infinity);
    hooks.inflow = 0;
    hooks.warp = 1;
    hooks.night = 0;
    closed = false;
    lastDoors = [];
    closing = null;
  }

  // ---------- camera ----------

  /** A calm view of the docks that are open (all of the plan's when none is yet), from inside the loop. */
  function overview(): Shot {
    const { trucks, northDoors } = scene.shiftParts();
    const xs: number[] = [];
    doors.forEach((r, d) => {
      if (d < northDoors && (r.open || (r.state?.city ?? -1) >= 0)) xs.push(trucks.docks[d]!.x);
    });
    if (!xs.length && schedule) for (const st of schedule.stints) if (trucks.docks[st.door]) xs.push(trucks.docks[st.door]!.x);
    if (!xs.length) xs.push(trucks.docks[0]!.x, trucks.docks[Math.min(Math.max(1, (level?.docks ?? 4) - 1), northDoors - 1)]!.x);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const cx = (x0 + x1) / 2;
    // Far enough back to have them all in the picture (a phone held upright sees a narrow strip).
    const half = (x1 - x0) / 2 + 7;
    const tan = Math.tan((30 * Math.PI) / 180) * Math.max(0.4, scene.shiftAspect());
    const dist = Math.max(17, Math.min(120, half / tan));
    // A few docks: from inside the loop, under the roof. Many: from high above (the roof is left out up there),
    // so the loop does not stand in front of them.
    if (dist <= 30) return { eye: v(cx, 5 + dist * 0.42, -31 + dist * 0.9), look: v(cx, 1.2, -33), name: 'Docks' };
    // (Steeper the further up: on a narrow screen the docks stay in the middle of the picture.)
    return { eye: v(cx, dist * 0.88, -30 + dist * 0.38), look: v(cx, 0, -30), name: 'Docks', free: true };
  }

  const doorShot = (d: number, name: string): Shot => {
    const x = scene.shiftParts().trucks.docks[d]!.x;
    return { eye: v(x + 6, 4.6, -19.5), look: v(x + 1, 1.3, -34), name };
  };
  const rackShot = (): Shot => {
    const [x, z] = scene.shiftParts().lift;
    return { eye: v(x - 15, 6.5, z), look: v(x + 2, 4.6, z), name: 'Buffer rack' };
  };
  const robotShot = (n: number): Shot => {
    const { floor } = scene.shiftParts();
    const all = scene.shiftChutes().stations;
    const mine = schedule && n >= 0 ? stationsOf(n) : [];
    const k = mine.length ? all.indexOf(mine[Math.floor(mine.length / 2)]!) : all.length - 2;
    const st = floor.stations[Math.max(0, k)] ?? floor.stations[0]!;
    return { eye: v(st.x - 9, 7.5, st.z + 17), look: v(st.x + 1, 0.6, st.z + 5), name: 'Robots' };
  };

  function go(shot: Shot, cut: boolean): void {
    // (Between a place above the roof or in the yard and one in the hall there is no flight: it would go through the roof or a wall.)
    const outside = shot.free === true;
    const through = shotName === '' ? outside : outside !== wasOutside;
    wasOutside = outside;
    shotName = shot.name;
    scene.shiftView(shot.eye, shot.look, shot.name, cut || through, outside);
  }

  function setAuto(on: boolean): void {
    if (auto === on) return;
    auto = on;
    pendingCut = null;
    cutUntil = 0;
    autoCb(on);
  }

  /** Every frame: has the player taken the camera (walking, flying, following something)? */
  function watchCamera(): void {
    if (!active || !shotName) return;
    if (scene.cameraMode() !== 'visit' || scene.visiting() !== 'spot') {
      shotName = '';
      setAuto(false);
    }
  }

  /** An event worth a look: the next beat cuts to it, if the last cut is long enough ago and the pace allows. */
  function cutTo(shot: Shot): void {
    if (!auto || !playing || hooks.warp > CUT_WARP || hooks.warp <= 0) return;
    if (pendingCut || cutUntil || now() - lastCut < CUT_GAP) return;
    pendingCut = shot;
  }

  /** Every beat: the automatic direction. The overview follows the open docks; cuts come and go on the beat. */
  function direct(): void {
    // (After the closing shot the camera stays where it is, on the party or the last dock, until the next attempt.)
    if (!active || !auto || closing || closed) return;
    const t = now();
    if (pendingCut) {
      go(pendingCut, true);
      pendingCut = null;
      lastCut = t;
      cutUntil = t + CUT_HOLD;
      return;
    }
    if (cutUntil) {
      if (t < cutUntil) return;
      cutUntil = 0;
      overviewKey = '';
    }
    // The overview moves (a flight; a cut when coming back from an event) when another dock opens or closes.
    const o = overview();
    const key = `${o.eye.x.toFixed(1)}|${o.eye.z.toFixed(1)}`;
    if (key !== overviewKey || shotName !== o.name) {
      const cut = overviewKey === '' && shotName !== '' && shotName !== o.name;
      overviewKey = key;
      go(o, cut);
    }
  }

  /** What the automatic direction cuts to, from this beat's state against the last one's. */
  function events(): void {
    const s = schedule!;
    const { docks } = scene.shiftParts();
    doors.forEach((r, d) => {
      const st = r.state;
      if (!st) return;
      // A truck about to leave, a dock being made ready for another city, a belt backed up.
      // (The last cage of the cleardown going in, then the door coming down.)
      if (r.open && r.stint?.departs && st.clearing && !r.seenClear && (docks.cagesLeft(d) <= 1 || minute >= r.stint.end - 2) && minute < r.stint.end) {
        r.seenClear = true;
        cutTo(doorShot(d, `${cityName(st.city)}: the truck leaves`));
      }
      else if (!r.open && st.city >= 0 && st.stint && minute < st.stint.start && st.stint.signFrom < st.stint.start && minute - st.stint.signFrom < 2) cutTo(doorShot(d, `Door ${d + 1}: now for ${cityName(st.city)}`));
      else if (r.open && !r.seenFull && docks.directCount(d).waiting >= 9) {
        r.seenFull = true;
        cutTo(doorShot(d, `${cityName(st.city)}: the belt is backing up`));
      }
    });
    const share = (racked * factor) / Math.max(1, level!.bufferCap);
    if ((rackWas < 0.5 && share >= 0.5) || (rackWas < 0.95 && share >= 0.95)) cutTo(rackShot());
    rackWas = share;
    const robots = robotsAt(s, minute);
    if (robotsWere >= 0 && (robots === 0) !== (robotsWere === 0)) cutTo(robotShot(-1));
    robotsWere = robots;
  }

  // ---------- looking around by hand ----------

  /**
   * A drag on the hall turns the camera round what it is looking at, a drag with two fingers
   * (or the right button, or Shift) moves it over the floor, a pinch or the wheel zooms. The
   * first move ends the automatic direction (until Auto is asked for again).
   */
  const touches = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  let moved = 0;
  const byHand = (): boolean => {
    if (!active || closing) return false;
    if (auto || shotName !== 'Free look') {
      // (From wherever the camera is now: the director's shot, or a place the player went to.)
      if (scene.cameraMode() !== 'visit' || scene.visiting() !== 'spot') return false;
      shotName = 'Free look';
      closed = false;
      setAuto(false);
    }
    return true;
  };
  const onDown = (e: PointerEvent) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    pinch = 0;
  };
  const onMove = (e: PointerEvent) => {
    const was = touches.get(e.pointerId);
    if (!was) return;
    const dx = e.clientX - was.x;
    const dy = e.clientY - was.y;
    was.x = e.clientX;
    was.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    // (A tap is not a drag.)
    if (moved < 6 || !byHand()) return;
    const h = Math.max(200, scene.canvas.clientHeight);
    if (touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch > 0 && d > 0) scene.shiftLook({ zoom: pinch / d, pan: [(-dx * 20) / h, (dy * 20) / h] });
      pinch = d;
    } else if (e.buttons === 2 || e.shiftKey) scene.shiftLook({ pan: [(-dx * 40) / h, (dy * 40) / h] });
    else scene.shiftLook({ orbit: [(dx * 3) / h, (dy * 2) / h] });
  };
  const onUp = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    pinch = 0;
  };
  const onWheel = (e: WheelEvent) => {
    if (!byHand()) return;
    e.preventDefault();
    scene.shiftLook({ zoom: Math.exp(Math.max(-1, Math.min(1, e.deltaY / 300))) });
  };
  const noMenu = (e: Event) => e.preventDefault();
  function listen(on: boolean): void {
    const c = scene.canvas;
    touches.clear();
    const f = on ? c.addEventListener.bind(c) : c.removeEventListener.bind(c);
    f('pointerdown', onDown as EventListener);
    f('pointermove', onMove as EventListener);
    f('pointerup', onUp as EventListener);
    f('pointercancel', onUp as EventListener);
    f('pointerleave', onUp as EventListener);
    f('contextmenu', noMenu);
    if (on) c.addEventListener('wheel', onWheel, { passive: false });
    else c.removeEventListener('wheel', onWheel);
  }

  /** The south doors' own names back on their screens. */
  function restoreSouth(): void {
    const { trucks } = scene.shiftParts();
    for (const [k, [city, pc]] of saved?.south ?? []) {
      trucks.label(k, city, pc, false);
      trucks.warn(k, false);
    }
    saved?.south.clear();
  }

  return {
    enter(lv, cityNames) {
      level = lv;
      names = cityNames.slice();
      factor = parcelFactor(lv);
      pcCache.clear();
      const p = scene.shiftParts();
      bt = p.beat;
      if (!active) {
        active = true;
        const use = scene.storeUse();
        saved = { rate: scene.rate, belt: scene.beltSpeed(), faults: scene.faults.enabled, buffer: use.storeUsed / Math.max(1, use.storeSlots), south: new Map(), camera: scene.shiftCamera() };
        scene.shift = hooks;
        listen(true);
        scene.setFaults(false);
        for (let d = 0; d < p.northDoors; d++) p.trucks.direct(d, true, bt);
        p.trucks.freeze(true);
        p.breaks.hold = true;
        // (No random batches: `set` with nothing ends the running one and keeps new ones away.)
        p.batches.set(null, scene.hubTime());
      }
      restoreSouth();
      schedule = null;
      timeline = null;
      playing = false;
      skipped = false;
      minute = 0;
      bare(false);
      // The music at the hall's own tempo, and the loop fast enough for what the level brings in.
      scene.rate = TEMPO_RATE;
      // (Never at its slowest: a parcel that has to go round once more would be away for three quarters of an hour.)
      scene.setBeltSpeed(2);
      // Automatic direction, on the overview.
      auto = true;
      shotName = '';
      overviewKey = '';
      cutUntil = 0;
      pendingCut = null;
      direct();
      autoCb(true);
    },

    play(tl: Timeline, clock, done) {
      if (!active || !level) return;
      // (Again from the start: a second attempt, or the same shift once more.)
      restoreSouth();
      if (schedule) bare(true);
      timeline = tl;
      schedule = buildSchedule(level, tl);
      const { trucks } = scene.shiftParts();
      schedule.robotCities.forEach((rc, n) => {
        if (!rc.departure) return;
        const k = southDoor(n);
        const d = trucks.docks[k];
        if (!d) return;
        saved?.south.set(k, [d.city, d.pc]);
        trucks.label(k, cityName(rc.city), `robots · truck ${hhmm(level!.cities[rc.city]?.truck ?? rc.departure.at)}`);
      });
      minute = 0;
      skipped = false;
      onClock = clock;
      onDone = done;
      playing = true;
      hooks.warp = speed >= OWN_SPEED ? Math.max(1, Math.round(speed / OWN_SPEED)) : 0;
      show(false);
      // The parcels that would be on their way round the loop already, had the hall been
      // running: set where they would be now, so the first of each city is at its dock (or
      // its robot station) when the level says it comes in.
      for (let i = 0; i < level.cities.length; i++) {
        const chute = chuteFor(i);
        const lead = scene.shiftLead(chute) * MIN_PER_BEAT;
        const n = inHall(arrivedAt(level, i, lead), factor);
        const ride = scene.shiftLoopBeats(chute);
        for (let k = 0; k < n; k++) {
          // (No more than its dock may be sent by now: the rest waits in the lanes.)
          if (hasDock(i) && !mayCome(i)) break;
          // (Evenly along the way they have come; none further than the infeeds.)
          if (!scene.shiftPlace(i, { chute, beats: Math.min(ride, (ride * (k + 0.5)) / n) })) break;
          out[i] = (out[i] ?? 0) + 1;
        }
      }
      onClock(0);
    },

    setSpeed(minutesPerSecond) {
      speed = Math.max(0, Number.isFinite(minutesPerSecond) ? minutesPerSecond : DEFAULT_SPEED);
      // (Whole factors of the hall's own pace keep every music beat a hall beat.)
      if (playing) hooks.warp = speed >= OWN_SPEED ? Math.max(1, Math.round(speed / OWN_SPEED)) : 0;
    },

    skip() {
      finish(true);
    },

    exit() {
      if (!active) return;
      active = false;
      playing = false;
      schedule = null;
      timeline = null;
      onDone = () => {};
      onClock = () => {};
      closing = null;
      const p = scene.shiftParts();
      bt = p.beat;
      restoreSouth();
      listen(false);
      scene.shiftReset(false);
      scene.shift = null;
      p.docks.setDirected(false);
      for (let d = 0; d < p.northDoors; d++) p.trucks.direct(d, false, bt);
      p.trucks.freeze(false);
      p.breaks.hold = false;
      p.batches.set(null, scene.hubTime(), true);
      p.fleet.limit = Infinity;
      p.fleet.retask = false;
      p.floor.near = false;
      p.floor.shiftBoards(false);
      if (saved) {
        scene.rate = saved.rate;
        scene.setBeltSpeed(saved.belt);
        scene.setFaults(saved.faults);
        scene.shiftCameraBack(saved.camera);
      }
      // The rack as full as it was (its cartons come back out by themselves, as always).
      scene.shiftBuffer(saved?.buffer ?? 0, Infinity);
      saved = null;
      speed = DEFAULT_SPEED;
      shotName = '';
    },

    focusCity(city) {
      if (!active || !schedule) return;
      // Show where this city is being handled NOW, never a door that is busy with another city:
      // its open dock; else its robots; else its next or last door when that door is free; else
      // the buffer rack, where its parcels wait for a dock.
      const mine = schedule.stints.filter((x) => x.city === city);
      const openNow = (x: { signFrom: number; end: number }) => minute >= x.signFrom && minute < x.end;
      const open = mine.find(openNow);
      const n = schedule.robotCities.findIndex((rc) => rc.city === city);
      const next = mine.filter((x) => x.start > minute).sort((a, b) => a.start - b.start)[0];
      const last = [...mine].sort((a, b) => b.end - a.end)[0];
      const other = next ?? last;
      const taken = other ? schedule.stints.some((x) => x.door === other.door && x.city !== city && openNow(x)) : false;
      const shot = open
        ? doorShot(open.door, cityName(city))
        : n >= 0
          ? { ...robotShot(n), name: `${cityName(city)}: robots` }
          : other && !taken
            ? doorShot(other.door, next ? `${cityName(city)}: door ${other.door + 1}, not open yet` : `${cityName(city)}: door ${other.door + 1}, truck gone`)
            : next
              ? { ...rackShot(), name: `${cityName(city)}: waiting in the buffer` }
              : null;
      if (!shot) return;
      setAuto(false);
      go(shot, false);
    },

    views() {
      return VIEWS.filter((w) => w.stop === null || scene.shiftStop(w.stop) !== null).map(({ id, name }) => ({ id, name }));
    },

    view(id) {
      if (!active) return;
      const w = VIEWS.find((x) => x.id === id);
      if (!w) return;
      const stop = w.stop === null ? null : scene.shiftStop(w.stop);
      const shot: Shot | null = w.stop === null ? rackShot() : stop ? { eye: stop.eye, look: stop.look, name: w.name, free: stop.free || undefined } : null;
      if (!shot) return;
      setAuto(false);
      go(shot, false);
    },

    setAutoCamera(on) {
      if (!active) return;
      if (!on) return setAuto(false);
      closed = false;
      auto = false;
      shotName = '';
      overviewKey = '';
      setAuto(true);
      direct();
    },

    onAutoCamera(cb) {
      autoCb = cb;
    },

    finale(stars, done) {
      // (Not after a skip, and never twice.)
      if (!active || !schedule || skipped || playing || closing) return done();
      // All inside the hall: the last dock, its last cages in the trailer and the door coming
      // down; after a perfect night the lights go and the camera stands on the floor inside
      // the loop, among the people, looking at the party. Timed on the hall's beats (see `frame`).
      const last = [...schedule.events].reverse().find((e) => e.kind === 'depart' && e.doors.length > 0);
      const d = last && last.kind === 'depart' ? last.doors[last.doors.length - 1]! : -1;
      const dock = d >= 0 ? scene.shiftParts().trucks.docks[d] : undefined;
      const cx = dock ? dock.x : overview().look.x;
      if (dock) go({ eye: v(dock.x + 2.5, 2.4, -25.5), look: v(dock.x, 2.1, -41), name: `${cityName(last!.city)}: the last truck` }, true);
      else go({ eye: v(cx + 6, 4.6, -19.5), look: v(cx + 1, 1.3, -34), name: 'Docks' }, true);
      closing = { from: bt, party: stars >= 3, cx, done };
    },
  };
}
