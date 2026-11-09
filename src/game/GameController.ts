// src/game/GameController.ts
// One night shift (22:00–06:00) as a scored minigame on top of the sort-sim.
// The controller owns rules, score and phase; the sim owns physics; the UI only
// reads state and calls issue(). Commands are quantised to the next beat, so
// the game stays beat-locked and a (seed + command log) replays exactly.

// Optional: the app only creates a GameController in game mode (?game=1 or the
// "Play a night" button). Without it the scene runs exactly as today, on the
// music's own beats.
//
// Time: in game mode the controller drives the beats instead of the music.
// speed 0 = frozen (camera, UI and commands still work; commands land on the
// first beat after unfreezing), 1 / 2 / 4 = faster. The composer follows
// bpm × speed, so the hall stays beat-locked; when frozen the music drops to a
// filtered pad.

export type Phase = 'briefing' | 'running' | 'paused' | 'debrief';
export type Speed = 0 | 1 | 2 | 4;

/** Everything the player can influence. */
export type Command =
  // Briefing only: north doors per north city (largest first, as NORTH_CITIES),
  // ≥ 1 and ≤ 4 each, 20 in total; a city's doors sit side by side west to east.
  // Replaces planDoors() for this night, so the dock signs show the player's plan.
  | { kind: 'doorPlan'; doors: number[] }
  | { kind: 'infeedRate'; lane: number; rate: number } // 0..1, throughput vs. overload
  | { kind: 'assignChute'; chute: number; route: string | null } // re-map chute to a route
  | { kind: 'dispatchTruck'; dock: number } // leave now (on time, maybe half empty)
  | { kind: 'moveWorker'; from: number; to: number } // limited crew between docks
  | { kind: 'storePolicy'; mode: 'hold' | 'release' | 'auto' } // high-bay buffer
  | { kind: 'clearJam'; chute: number }; // costs the worker a few beats

/** What the sim reports back each beat. */
export type SimEvent =
  | { kind: 'sorted'; route: string; express: boolean; correct: boolean }
  | { kind: 'recirculated'; loops: number }
  | { kind: 'noRead' }
  | { kind: 'jam'; chute: number }
  | { kind: 'cageFull'; dock: number }
  | { kind: 'surge'; lane: number; parcels: number } // late inbound truck
  | {
      kind: 'truckDeparted';
      dock: number;
      route: string;
      loaded: number;
      capacity: number;
      late: boolean;
      leftBehind: number; // parcels for this route still in the hall
    };

/** The seam to the existing sim (sorter loop, docks, robots, store). */
export interface SimPort {
  apply(cmd: Command): boolean; // false = rejected (e.g. worker busy)
  step(beat: number): SimEvent[]; // advance exactly one beat
  finish(): SimEvent[]; // 06:00: remaining trucks leave
}

export interface ShiftConfig {
  seed: number; // daily seed = same night for everyone
  bpm: number; // composer BPM (100)
  // 22:00–06:00 at HUB_MIN_PER_BEAT 0.25 = 1920 beats:
  // 19 min at 1×, ≈ 10 min at 2× (default), ≈ 5 min at 4×.
  beats: number;
  /** Tonight's volume per north city (NORTH_CITIES order). Not always ∝ population:
   *  the seed adds surges (a webshop sale) and dips, so the suggested plan isn't optimal. */
  forecast: number[];
  /** Raw points of this night's two anchors, computed offline per seed with the
   *  scenario model: standing plan without moves (→ 100) and the best run (→ 1000). */
  par: { passive: number; max: number };
  /** Tonight's starting plan = the hall as it stands (DOORS_PER_CITY, by population). */
  standing: number[];
}

export interface Score {
  points: number;
  sorted: number;
  missorts: number;
  recirculations: number;
  leftBehind: number;
  lateTrucks: number;
  combo: number;
  bestCombo: number;
}

export type GameEvent =
  | { kind: 'phase'; phase: Phase }
  | { kind: 'speed'; speed: Speed }
  | { kind: 'points'; delta: number; reason: SimEvent['kind'] }
  | { kind: 'alert'; event: SimEvent }; // jams, full cages, surges → UI toast

const POINTS = {
  sorted: 10,
  express: 40,
  missort: -50,
  recirculated: -2, // per extra loop
  noRead: -5,
  leftBehind: -30, // per parcel
  late: -200,
  fullTruck: 150, // ≥ 90 % loaded and on time
};

export class GameController {
  phase: Phase = 'briefing';
  beat = 0;
  readonly score: Score = {
    points: 0, sorted: 0, missorts: 0, recirculations: 0,
    leftBehind: 0, lateTrucks: 0, combo: 0, bestCombo: 0,
  };
  /** Replay / leaderboard check: seed + this log reproduces the score. */
  readonly log: { beat: number; cmd: Command }[] = [];
  private queue: Command[] = [];
  private listeners = new Set<(e: GameEvent) => void>();
  private _speed: Speed = 1;
  private lastSpeed: Exclude<Speed, 0> = 1;
  private beatAcc = 0; // fractional beats; the scene reads it for smooth motion

  get speed(): Speed { return this._speed; }
  /** Beat phase 0..1 for interpolating belts/trays between game beats. */
  get beatPhase(): number { return this.beatAcc; }
  /** Tempo the composer should play at (0 = frozen pad). */
  get musicBpm(): number { return this.cfg.bpm * this._speed; }

  setSpeed(s: Speed): void {
    if (s === this._speed) return;
    if (s !== 0) this.lastSpeed = s;
    this._speed = s;
    this.emit({ kind: 'speed', speed: s });
  }

  /** Space bar: freeze ⇄ last speed. */
  toggleFreeze(): void { this.setSpeed(this._speed === 0 ? this.lastSpeed : 0); }

  /** Call every animation frame with real seconds (clamped by the scene). */
  advance(dt: number): void {
    if (this.phase !== 'running' || this._speed === 0) return;
    this.beatAcc += (dt * this.cfg.bpm * this._speed) / 60;
    while (this.beatAcc >= 1 && this.phase === 'running') {
      this.beatAcc -= 1;
      this.onBeat();
    }
  }

  /** Real minutes left at the current speed (for the HUD). */
  get realMinutesLeft(): number {
    const s = this._speed || this.lastSpeed;
    return (this.cfg.beats - this.beat) / (this.cfg.bpm * s);
  }

  constructor(private sim: SimPort, readonly cfg: ShiftConfig) {}

  on(fn: (e: GameEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The player's door plan (defaults to the standing one). */
  doorPlan: number[] = [];

  start(): void {
    if (this.phase !== 'briefing') return;
    if (!this.doorPlan.length) this.doorPlan = this.cfg.standing.slice();
    const cmd: Command = { kind: 'doorPlan', doors: this.doorPlan };
    this.sim.apply(cmd);
    this.log.push({ beat: 0, cmd });
    this.setPhase('running');
  }
  pause(): void { if (this.phase === 'running') this.setPhase('paused'); }
  resume(): void { if (this.phase === 'paused') this.setPhase('running'); }

  /** UI entry point. Applied on the next beat (also allowed while frozen). */
  issue(cmd: Command): boolean {
    if (cmd.kind === 'doorPlan') {
      if (this.phase !== 'briefing' || !validPlan(cmd.doors, this.cfg.forecast.length)) return false;
      this.doorPlan = cmd.doors.slice();
      return true;
    }
    if (this.phase !== 'running') return false;
    this.queue.push(cmd);
    return true;
  }

  /** One game beat. Driven by advance(); not by the music in game mode. */
  private onBeat(): void {
    if (this.phase !== 'running') return;
    for (const cmd of this.queue.splice(0)) {
      if (this.sim.apply(cmd)) this.log.push({ beat: this.beat, cmd });
    }
    for (const e of this.sim.step(this.beat)) this.tally(e);
    this.beat++;
    if (this.beat >= this.cfg.beats) {
      for (const e of this.sim.finish()) this.tally(e);
      this.setPhase('debrief');
    }
  }

  /** In-game clock, 22:00 → 06:00. */
  get clock(): string {
    const min = 22 * 60 + Math.floor((this.beat / this.cfg.beats) * 8 * 60);
    const h = Math.floor(min / 60) % 24, m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** The score the player sees: 100 = standing plan and no moves, 1000 = the night's max. */
  get displayScore(): number {
    const { passive, max } = this.cfg.par;
    return Math.max(0, Math.min(1000, Math.round(100 + (900 * (this.score.points - passive)) / (max - passive))));
  }

  /** Combo multiplier: clean streaks pay, capped at ×3. */
  get multiplier(): number {
    return Math.min(3, 1 + Math.floor(this.score.combo / 25) * 0.5);
  }

  /** Share of parcels that made their truck. */
  get sla(): number {
    const total = this.score.sorted + this.score.leftBehind;
    return total ? (this.score.sorted - this.score.missorts) / total : 1;
  }

  get grade(): 'S' | 'A' | 'B' | 'C' | 'D' {
    const s = this.sla;
    return s >= 0.99 ? 'S' : s >= 0.97 ? 'A' : s >= 0.93 ? 'B' : s >= 0.85 ? 'C' : 'D';
  }

  private tally(e: SimEvent): void {
    const sc = this.score;
    let delta = 0;
    switch (e.kind) {
      case 'sorted':
        sc.sorted++;
        if (e.correct) {
          sc.combo++;
          sc.bestCombo = Math.max(sc.bestCombo, sc.combo);
          delta = (e.express ? POINTS.express : POINTS.sorted) * this.multiplier;
        } else {
          sc.missorts++;
          sc.combo = 0;
          delta = POINTS.missort;
        }
        break;
      case 'recirculated':
        sc.recirculations++;
        delta = POINTS.recirculated * e.loops;
        break;
      case 'noRead':
        delta = POINTS.noRead;
        break;
      case 'jam':
      case 'cageFull':
      case 'surge':
        if (e.kind === 'jam') sc.combo = 0;
        this.emit({ kind: 'alert', event: e });
        break;
      case 'truckDeparted':
        sc.leftBehind += e.leftBehind;
        delta = e.leftBehind * POINTS.leftBehind;
        if (e.late) { sc.lateTrucks++; delta += POINTS.late; }
        else if (e.loaded >= 0.9 * e.capacity) delta += POINTS.fullTruck;
        break;
    }
    if (delta) {
      delta = Math.round(delta);
      sc.points += delta;
      this.emit({ kind: 'points', delta, reason: e.kind });
    }
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.emit({ kind: 'phase', phase: p });
  }

  private emit(e: GameEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}

/** Total north doors and limits per city (as postcodes.planDoors). */
export const NORTH_DOORS = 20;
export const MAX_DOORS = 4;

export function validPlan(doors: number[], cities: number): boolean {
  return doors.length === cities
    && doors.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_DOORS)
    && doors.reduce((a, b) => a + b, 0) === NORTH_DOORS;
}

/** "Auto" in the briefing: D'Hondt on tonight's forecast (a hint; costs no points). */
export function suggestPlan(volume: number[]): number[] {
  const n = volume.map(() => 1);
  for (let left = NORTH_DOORS - n.length; left > 0; left--) {
    let i = -1;
    for (let j = 0; j < n.length; j++) {
      if (n[j]! < MAX_DOORS && (i < 0 || volume[j]! / n[j]! > volume[i]! / n[i]!)) i = j;
    }
    n[i]!++;
  }
  return n;
}

/** Parcels per door per city, for the briefing's load bars. */
export const perDoor = (volume: number[], doors: number[]) => volume.map((v, i) => v / doors[i]!);
