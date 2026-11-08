/**
 * Sort robots on a floor grid, without any drawing: each robot drives its own
 * job — from a parking spot to a pickup station at the sorter, then to a
 * destination bin, then to a free parking spot — one cell per beat.
 *
 * Lanes are one-way (rows alternate east/west, columns north/south), as in a
 * real robot sorter, so robots never meet head-on. A robot waits when the next
 * cell is taken; after a few beats stuck it plans a detour around the others.
 */

export const FREE = 0;
export const BLOCK = 1;
/** Parking spot: entered only as a destination. */
export const PARK = 2;
/** Pickup cell at a station: entered only as a destination. */
export const PICK = 3;

export type Cell = [number, number];

export class Grid {
  readonly cells: Uint8Array;
  constructor(
    readonly ni: number,
    readonly nj: number,
  ) {
    this.cells = new Uint8Array(ni * nj);
  }

  id(i: number, j: number): number {
    return j * this.ni + i;
  }

  inside(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.ni && j < this.nj;
  }

  get(i: number, j: number): number {
    return this.cells[this.id(i, j)]!;
  }

  set(i: number, j: number, v: number): void {
    this.cells[this.id(i, j)] = v;
  }

  /** Cells reachable in one step. `strict` follows the one-way lanes. */
  private next(i: number, j: number, goal: number, strict: boolean): Cell[] {
    const out: Cell[] = [];
    const here = this.get(i, j);
    const special = here === PARK || here === PICK;
    const all: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const dirs: Cell[] = strict && !special ? [[j % 2 ? -1 : 1, 0], [0, i % 2 ? -1 : 1]] : all;
    const ok = (ni: number, nj: number) => {
      if (!this.inside(ni, nj)) return false;
      const c = this.get(ni, nj);
      if (c === BLOCK) return false;
      if ((c === PARK || c === PICK) && this.id(ni, nj) !== goal) return false;
      return true;
    };
    for (const [a, b] of dirs) if (ok(i + a, j + b)) out.push([i + a, j + b]);
    // The goal itself (a parking spot, pickup or bin access cell) may be entered from any side.
    if (strict && !special) {
      for (const [a, b] of all) {
        if (this.inside(i + a, j + b) && this.id(i + a, j + b) === goal && !out.some((c) => c[0] === i + a && c[1] === j + b)) out.push([i + a, j + b]);
      }
    }
    return out;
  }

  /** Shortest route (excluding the start), along the lanes if possible. */
  route(from: Cell, to: Cell, avoid?: Set<number>, strictOnly = false): Cell[] | null {
    const start = this.id(from[0], from[1]);
    const goal = this.id(to[0], to[1]);
    if (start === goal) return [];
    for (const strict of strictOnly ? [true] : [true, false]) {
      const prev = new Map<number, number>([[start, -1]]);
      const queue: Cell[] = [from];
      for (let h = 0; h < queue.length; h++) {
        const [i, j] = queue[h]!;
        if (this.id(i, j) === goal) {
          const path: Cell[] = [];
          for (let c = goal; c !== start; c = prev.get(c)!) path.unshift([c % this.ni, Math.floor(c / this.ni)]);
          return path;
        }
        for (const n of this.next(i, j, goal, strict)) {
          const nid = this.id(n[0], n[1]);
          if (prev.has(nid) || (avoid?.has(nid) && nid !== goal)) continue;
          prev.set(nid, this.id(i, j));
          queue.push(n);
        }
      }
    }
    return null;
  }
}

export type BotState = 'idle' | 'toPick' | 'loading' | 'toDrop' | 'dropping' | 'toPark';

export interface Bot {
  k: number;
  i: number;
  j: number;
  /** Cell it moved from on the current beat (equal to i/j when standing). */
  fi: number;
  fj: number;
  path: Cell[];
  state: BotState;
  park: number;
  station: number;
  bin: number;
  blocked: number;
  /** Beat at which the current load/drop started. */
  actAt: number;
}

export interface Bin {
  i: number;
  j: number;
  /** Free cells next to the bin a robot can unload from. */
  access: Cell[];
  /** Not a box but the drop into the manual sort table (off the grid, west of it). */
  manual?: boolean;
}

export type FleetEvent =
  | { t: 'load'; bot: number; station: number }
  | { t: 'loaded'; bot: number; bin: number }
  | { t: 'drop'; bot: number; bin: number }
  | { t: 'dropped'; bot: number; bin: number };

export class Fleet {
  readonly bots: Bot[] = [];
  private occ = new Map<number, number>();
  private leaving: (number | undefined)[] = [];
  private stationBot: (number | null)[];
  private parkBot: (number | null)[];
  private turn = 0;
  /** Bins robots may be sent to (a full bin waits for a forklift). */
  isOpen: (bin: number) => boolean = () => true;
  /**
   * Where robot k must take what it just loaded: a bin, null for any open box,
   * or −1 to wait at the station (its box is full or away).
   */
  choose: (bot: number) => number | null = () => null;

  constructor(
    readonly grid: Grid,
    readonly parks: Cell[],
    readonly stations: Cell[],
    readonly bins: Bin[],
    count: number,
    private rnd: () => number = Math.random,
  ) {
    for (const [i, j] of parks) grid.set(i, j, PARK);
    for (const [i, j] of stations) grid.set(i, j, PICK);
    for (const b of bins) if (grid.inside(b.i, b.j)) grid.set(b.i, b.j, BLOCK);
    this.stationBot = stations.map(() => null);
    this.parkBot = parks.map(() => null);
    for (let k = 0; k < Math.min(count, parks.length); k++) {
      const [i, j] = parks[k]!;
      this.parkBot[k] = k;
      this.occ.set(grid.id(i, j), k);
      this.bots.push({ k, i, j, fi: i, fj: j, path: [], state: 'idle', park: k, station: -1, bin: -1, blocked: 0, actAt: 0 });
    }
  }

  /**
   * One beat. `waiting(s)` says whether station s has a parcel ready;
   * `dropBeat` is true on beats where robots may unload (the snare beats).
   */
  step(beat: number, waiting: (s: number) => boolean, dropBeat: boolean): FleetEvent[] {
    const ev: FleetEvent[] = [];
    const g = this.grid;
    // Cells left on the previous beat are free now.
    this.leaving.forEach((c, k) => {
      if (c !== undefined && this.occ.get(c) === k) this.occ.delete(c);
    });
    this.leaving = [];
    // Finish loads and drops started on the previous beat.
    for (const b of this.bots) {
      b.fi = b.i;
      b.fj = b.j;
      const want = b.state === 'loading' && beat - b.actAt >= 1 ? this.choose(b.k) : null;
      if (b.state === 'loading' && beat - b.actAt >= 1 && want === -1) {
        // Waits at the station with the parcel until its box is back.
      } else if (b.state === 'loading' && beat - b.actAt >= 1) {
        this.stationBot[b.station] = null;
        b.station = -1;
        const boxes = this.bins.map((_, n) => n).filter((n) => !this.bins[n]!.manual);
        const open = boxes.filter((n) => this.isOpen(n));
        const pool = open.length ? open : boxes;
        b.bin = want ?? pool[Math.floor(this.rnd() * pool.length)]!;
        const bin = this.bins[b.bin]!;
        const to = bin.access[Math.floor(this.rnd() * bin.access.length)]!;
        b.state = 'toDrop';
        this.plan(b, to);
        ev.push({ t: 'loaded', bot: b.k, bin: b.bin });
      } else if (b.state === 'dropping' && beat - b.actAt >= 1) {
        ev.push({ t: 'dropped', bot: b.k, bin: b.bin });
        b.bin = -1;
        const p = this.freePark(b);
        b.park = p;
        this.parkBot[p] = b.k;
        b.state = 'toPark';
        this.plan(b, this.parks[p]!);
      } else if (b.state === 'toPark' && !b.path.length) b.state = 'idle';
    }
    // Send the nearest idle robot to each station with a parcel waiting.
    this.stations.forEach((st, s) => {
      if (this.stationBot[s] !== null || !waiting(s)) return;
      let best: Bot | undefined;
      let bd = Infinity;
      for (const b of this.bots) {
        if (b.state !== 'idle') continue;
        const d = Math.abs(b.i - st[0]) + Math.abs(b.j - st[1]);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (!best) return;
      this.stationBot[s] = best.k;
      this.parkBot[best.park] = null;
      best.park = -1;
      best.station = s;
      best.state = 'toPick';
      this.plan(best, st);
    });
    // Move: one cell per beat if the next one is free; otherwise wait, and detour when stuck.
    const n = this.bots.length;
    this.turn = (this.turn + 1) % Math.max(1, n);
    for (let o = 0; o < n; o++) {
      const b = this.bots[(o + this.turn) % n]!;
      if (b.state === 'loading' || b.state === 'dropping') continue;
      if (b.path.length) {
        const [ni, nj] = b.path[0]!;
        const id = g.id(ni, nj);
        const who = this.occ.get(id);
        if (who !== undefined && who !== b.k) {
          if (++b.blocked > 3) {
            const goal = b.path[b.path.length - 1]!;
            // Detours keep to the one-way lanes, so they never lead head-on into another robot.
            const detour = g.route([b.i, b.j], goal, new Set(this.occ.keys()), true);
            if (detour) b.path = detour;
            b.blocked = 0;
          }
          continue;
        }
        this.occ.set(id, b.k);
        this.leaving[b.k] = g.id(b.i, b.j);
        b.path.shift();
        b.i = ni;
        b.j = nj;
        b.blocked = 0;
        continue;
      }
      if (b.state === 'toPick' && waiting(b.station)) {
        b.state = 'loading';
        b.actAt = beat;
        ev.push({ t: 'load', bot: b.k, station: b.station });
      } else if (b.state === 'toDrop' && dropBeat) {
        b.state = 'dropping';
        b.actAt = beat;
        ev.push({ t: 'drop', bot: b.k, bin: b.bin });
      }
    }
    return ev;
  }

  private plan(b: Bot, to: Cell): void {
    b.path = this.grid.route([b.i, b.j], to) ?? [];
    b.blocked = 0;
  }

  /** A free parking spot near the robot, with some randomness so they spread out. */
  private freePark(b: Bot): number {
    let best = -1;
    let bd = Infinity;
    this.parks.forEach(([i, j], p) => {
      if (this.parkBot[p] !== null) return;
      const d = Math.abs(i - b.i) + Math.abs(j - b.j) + this.rnd() * 6;
      if (d < bd) {
        bd = d;
        best = p;
      }
    });
    return best;
  }

  /** Is a robot on its way to, or unloading into, this bin? */
  binBusy(bin: number): boolean {
    return this.bots.some((b) => b.bin === bin);
  }

  /** Is cell (i, j) taken by more than one robot? (For tests.) */
  occupancy(): Map<number, number> {
    return this.occ;
  }
}

/** The robot floor in the hall, south of the loop. */
export const FLOOR = { x0: -40, z0: 18.8, cs: 1.5, ni: 96, nj: 7 };
/** Columns at the west end that are the parking area (columns 0 and 1 are its aisles). */
export const PARK_COLS = 13;

/**
 * Grid, parking spots and bins of the robot floor. Stations are the pickup
 * cells at row 0 (where the station chutes end); the bins (boxes on pallets)
 * stand in the last row, along the forklift aisle by the south wall, so a
 * forklift can take a full box to a truck and bring an empty one.
 */
export function sorterFloor(stationColumns: number[]): { grid: Grid; parks: Cell[]; stations: Cell[]; bins: Bin[] } {
  const grid = new Grid(FLOOR.ni, FLOOR.nj);
  const parks: Cell[] = [];
  // The parking area at the west end: rows of spots, each beside a lane (rows 1 and 5 run west
  // into the area, row 4 east out of it; columns 0 (south) and 1 (north) join them), four deep.
  for (let i = 2; i < PARK_COLS; i++) for (const j of [0, 2, 3, 6]) parks.push([i, j]);
  const stations: Cell[] = stationColumns.map((i) => [i, 0]);
  const bins: Bin[] = [];
  const j = FLOOR.nj - 1;
  for (let i = PARK_COLS + 2; i <= FLOOR.ni - 3; i += 2) bins.push({ i, j, access: [] });
  for (const b of bins) grid.set(b.i, b.j, BLOCK);
  for (const b of bins) b.access = ([[b.i, b.j - 1]] as Cell[]).filter(([i, jj]) => grid.inside(i, jj) && grid.get(i, jj) === FREE);
  // Last: the drop to the manual sort table, just off the east end of row 2 (an eastbound lane;
  // robots leave it up the last column, northbound).
  bins.push({ i: FLOOR.ni, j: 2, access: [[FLOOR.ni - 1, 2]], manual: true });
  return { grid, parks, stations, bins };
}
