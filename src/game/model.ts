// The scoring model: plays a night hour by hour for a plan and a list of moves.
// It is the referee for balance (par scores per seed) and the preview the briefing
// and the move dialogs show ("−64 late parcels"). The 3D sim plays the same rules
// in detail; small differences are absorbed by clamping the shown score at 1000.
import { announced, HOURS, type Night } from './night';

export const NORTH_DOORS = 20;
export const ROBOT_DOORS = 20;
export const MAX_DOORS = 4;
/** One trailer: ten roll cages. A north door sends one before 02:00 and one before 06:00. */
export const TRAILER = 225;
/** Parcels a door can load per hour (faster than it fills on average, so backlog can clear). */
const LOAD_H = 80;
/** Robot fleet, parcels per hour. */
const ROBOT_H = 400;
/** Parcels a city's chutes hold before the rest spills into the store or recirculates. */
const CHUTE_BUF = 40;
const STORE = 800;
/** Each hour, this share of the recirculating parcels is lost for tonight (late). */
const RECIRC_LOSS = 0.2;
/** Inbound share per hour, 22–06. */
const PROFILE = [0.13, 0.16, 0.15, 0.17, 0.17, 0.11, 0.07, 0.04];
/** Truck departures: end of hour 3 (02:00) and hour 7 (06:00). */
const WINDOWS = [
  [0, 3],
  [4, 7],
] as const;
const FULL = 0.9;

export const POINTS = { onTime: 10, late: -30, fullTrailer: 150, hold: -100 };

/** What the player can do during the night (hour 0 = 22:00–23:00). */
export type Move =
  | { kind: 'swap'; hour: number; from: number; to: number } // a north door to another city (max 2)
  | { kind: 'go'; hour: number; city: number } // 00:00 or 04:00: a ≥90% full trailer leaves early, a short spare backs in (max 2)
  | { kind: 'hold'; city: number; window: 0 | 1 } // the city's trailers wait 10 min: +25 parcels, −100
  | { kind: 'forklift'; hour: number } // forklifts first to the robots' full boxes: +25 that hour (max 2)
  | { kind: 'release'; hour: number }; // free the store reserve now (it frees itself at 02:00)

export interface Plan {
  /** Per city: 0 = robots, 1–4 = north doors. */
  doors: number[];
  /** Share of the store kept free for the late inbound until it lands (or a release). */
  reserve: number;
}

export interface Result {
  raw: number;
  onTime: number;
  late: number;
  fullTrailers: number;
  moves: number;
  /** Per hour: parcels lost or stranded so far (for the HUD's "on course" line). */
  lateByHour: number[];
}

export const MAX_SWAPS = 1;
/** Forklift priority calls per night (the forklifts have their own round). */
export const MAX_FORKLIFT = 2;
/** Spare trailers in the yard: a 'go' needs one (it is staged at once). */
export const MAX_GO = 1;
/** The spare trailer after a go: a short one, a quarter of the room. */
const SPARE = 0.25;
/** Door swaps unlock at 00:00 (hour 2): the plan stands for the first two hours. */
export const SWAP_FROM = 4;

export function validPlan(p: Plan): boolean {
  const n = p.doors.reduce((a, b) => a + b, 0);
  const r = p.doors.filter((d) => d === 0).length;
  return n === NORTH_DOORS && r <= ROBOT_DOORS && p.doors.every((d) => Number.isInteger(d) && d >= 0 && d <= MAX_DOORS);
}

/**
 * Plays the night. `actual` false = the forecast only (the briefing's estimate):
 * no drift, the late inbound as announced, no unannounced events.
 */
export function play(night: Night, plan: Plan, moves: Move[] = [], actual = true, what?: { unsure: number }): Result {
  const C = night.cities;
  const n = C.length;
  const doors = plan.doors.map((d) => Array<number>(HOURS).fill(d));
  // Inbound per city per hour.
  const inb = C.map((c) =>
    PROFILE.map((p, h) => {
      let v = c.forecast * p;
      if (!actual && what && c.unsure && h >= 2) v *= 1 + what.unsure; // a planner's what-if
      if (actual && c.drift && h >= c.driftFrom) {
        const rest = PROFILE.slice(c.driftFrom).reduce((a, b) => a + b, 0);
        v *= 1 + c.drift / rest; // the whole night's drift lands after it shows
      }
      return v;
    }),
  );
  const fsum = C.reduce((a, c) => a + c.forecast, 0);
  let robotH = Array<number>(HOURS).fill(ROBOT_H);
  const doorFactor = C.map(() => Array<number>(HOURS).fill(1)); // share of the hour a door can load
  let lateIn = 0;
  for (const e of night.events) {
    if (e.kind === 'lateInbound') lateIn = actual ? e.actual : e.forecast;
    if (!actual && !announced(e)) continue;
    if (e.kind === 'robotsDown') for (let h = e.hour; h < Math.min(HOURS, e.hour + e.hours); h++) robotH[h] = robotH[h]! * (1 - e.share);
    if (e.kind === 'lateTrailer') doorFactor[e.city]![e.hour] = 0;
    if (e.kind === 'earlyCutoff') doorFactor[e.city]![7] = 0.5;
  }
  robotH = robotH.slice();

  // Moves that change the plan or capacities.
  let swaps = 0;
  let forklifts = 0;
  let gos = 0;
  let releaseAt = 4;
  let holdCost = 0;
  const hold = new Set<string>();
  const goAt = new Map<string, number>(); // `${city}/${window}` → hour
  for (const m of moves) {
    // Between north cities only (robots ⇄ doors is the planner's call), and the door
    // is dead for two hours: cleardown, new signs, empty cages wheeled in.
    if (m.kind === 'swap' && swaps < MAX_SWAPS && m.hour >= SWAP_FROM && doors[m.from]![m.hour]! > 0 && plan.doors[m.to]! > 0) {
      swaps++;
      for (let h = m.hour; h < HOURS; h++) doors[m.from]![h]!--;
      // The moved door runs with a borrowed crew and a half trailer: half a door.
      for (let h = m.hour + 2; h < HOURS; h++) doors[m.to]![h]! += 0.5;
    }
    if (m.kind === 'forklift' && forklifts < MAX_FORKLIFT) {
      forklifts++;
      robotH[m.hour] = robotH[m.hour]! + 15;
    }
    if (m.kind === 'release') releaseAt = Math.min(releaseAt, m.hour);
    if (m.kind === 'hold' && !hold.has(`${m.city}/${m.window}`)) {
      hold.add(`${m.city}/${m.window}`);
      holdCost += -POINTS.hold;
    }
    // Only in the last hour before a departure (00:00–01:00 is too early to know).
    if (m.kind === 'go' && gos < MAX_GO && (m.hour === 2 || m.hour === 6)) {
      gos++;
      goAt.set(`${m.city}/${m.hour < 4 ? 0 : 1}`, m.hour);
    }
  }

  const chute = Array<number>(n).fill(0); // waiting at the city's chutes
  const loaded = Array<number>(n).fill(0); // in the current trailer(s)
  const short = Array<boolean>(n).fill(false); // a go swapped in a short spare
  let store = 0;
  let recirc = 0;
  let robotQ = 0;
  let late = 0;
  let full = 0;
  const lateByHour: number[] = [];
  const storeOf = Array<number>(n).fill(0);

  for (let h = 0; h < HOURS; h++) {
    const w = h < 4 ? 0 : 1;
    // Arrivals (the late inbound lands at 02:00, spread like the forecast).
    const arr = inb.map((x, i) => x[h]! + (h === 4 ? (lateIn * C[i]!.forecast) / fsum : 0));
    const lateNow = h === 4 ? lateIn : 0;
    const reserveFree = h >= releaseAt ? 0 : plan.reserve * STORE;
    // The late inbound wants the store first: what does not fit floods the chutes.
    if (lateNow) {
      const room = STORE - store;
      const into = Math.min(lateNow, room);
      store += into;
      for (let i = 0; i < n; i++) storeOf[i]! += (into * C[i]!.forecast) / fsum;
      for (let i = 0; i < n; i++) arr[i] = arr[i]! - (lateNow * C[i]!.forecast) / fsum + ((lateNow - into) * C[i]!.forecast) / fsum;
    }
    let robotIn = 0;
    for (let i = 0; i < n; i++) {
      const d = doors[i]![h]!;
      if (d === 0) {
        robotIn += arr[i]!;
        continue;
      }
      // A go: a full trailer leaves before its time and a spare one is staged at once.
      const g = goAt.get(`${i}/${w}`);
      // The hour after a go, the spare trailer is still being backed in: half speed.
      const cap = d * LOAD_H * doorFactor[i]![h]! * (g !== undefined && g === h - 1 ? 0.5 : 1);
      const tcap = d * TRAILER * (short[i] ? SPARE : 1);
      const room = tcap + (hold.has(`${i}/${w}`) ? 25 : 0) - loaded[i]!;
      // Load: chute first, then from the store (released), then new arrivals.
      let want = chute[i]! + arr[i]!;
      const fromStore = h >= releaseAt || h >= 4 ? Math.min(storeOf[i]!, Math.max(0, Math.min(cap, room) - want)) : 0;
      const take = Math.min(cap, room, want + fromStore);
      loaded[i]! += take;
      storeOf[i]! -= Math.min(fromStore, take);
      store -= Math.min(fromStore, take);
      want = Math.max(0, want - (take - Math.min(fromStore, take)));
      // What stays: up to the chute buffer, the rest to the store, else around the loop.
      const keep = Math.min(want, CHUTE_BUF * d);
      chute[i] = keep;
      const spill = want - keep;
      const free = Math.max(0, STORE - store - reserveFree);
      const toStore = Math.min(spill, free);
      store += toStore;
      storeOf[i]! += toStore;
      recirc += spill - toStore;
      // A go this hour: the trailer leaves now if it is full enough.
      if (g === h && !short[i] && loaded[i]! >= FULL * tcap) {
        full += d;
        // The spare in the yard is a short trailer (five cages): half the room.
        loaded[i] = 0;
        short[i] = true;
      }
    }
    // Robots.
    robotQ += robotIn;
    robotQ -= Math.min(robotQ, robotH[h]!);
    const rspill = Math.max(0, robotQ - 300); // stations and boxes hold ~300
    if (rspill > 0) {
      const free = Math.max(0, STORE - store - reserveFree);
      const toStore = Math.min(rspill, free);
      store += toStore;
      recirc += rspill - toStore;
      robotQ -= rspill;
    }
    // Free fleet time takes parcels back out of the store.
    const spareBots = Math.max(0, robotH[h]! - robotIn);
    if (h >= 4 || h >= releaseAt) {
      const back = Math.min(spareBots * 0.5, Math.max(0, store - storeOf.slice(0, n).reduce((a, b) => a + b, 0)));
      store -= back;
    }
    // Recirculation: some is lost every hour, the rest tries again (counts as chute next hour).
    const lost = recirc * RECIRC_LOSS;
    late += lost;
    recirc -= lost;
    // Departures.
    if (h === WINDOWS[w]![1]) {
      for (let i = 0; i < n; i++) {
        const d = doors[i]![h]!;
        if (d === 0) continue;
        if (loaded[i]! >= FULL * d * TRAILER * (short[i] ? SPARE : 1)) full += short[i] ? d * SPARE : d;
        loaded[i] = 0;
        short[i] = false;
      }
    }
    lateByHour.push(late);
  }
  // 06:00: whatever is still in the hall misses its truck.
  late += recirc + store + robotQ + chute.reduce((a, b) => a + b, 0);
  lateByHour[HOURS - 1] = late;
  const total = C.reduce((a, c) => a + c.forecast * (1 + (actual ? c.drift : 0)), 0) + lateIn;
  late = Math.min(late, total);
  const on = total - late;
  const raw = Math.round(on * POINTS.onTime + late * POINTS.late + full * POINTS.fullTrailer - holdCost);
  return { raw, onTime: on / total, late: Math.round(late), fullTrailers: full, moves: moves.length, lateByHour };
}
