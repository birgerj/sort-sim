// A night being played: seed, plan, moves and the game clock. It lives in the URL
// (?game=NL-7KQ2M0&plan=…&reserve=0.4, so the hall is built with the player's door
// signs) and in sessionStorage (moves and clock, so a reload carries on).
import { makeNight, HOURS, type Night } from './night';
import { play, validPlan, MAX_SWAPS, MAX_GO, MAX_FORKLIFT, type Move, type Plan, type Result } from './model';
import { par, shown, standingPlan, type Par } from './par';
import { formatSeed, parseSeed, type NightSeed } from './seed';

/** Real seconds per game hour at 1×: a night is 20 min at 1×, 10 at 2×, 5 at 4×. */
export const SECONDS_PER_HOUR = 150;
export type Speed = 0 | 1 | 2 | 4;
const KEY = 'sortsim.game';

interface Saved {
  seed: string;
  clock: number;
  moves: Move[];
  speed: Speed;
}

export class Session {
  readonly night: Night;
  readonly par: Par;
  /** Hours since 22:00 (0 … 8). */
  clock = 0;
  speed: Speed = 2;
  moves: Move[] = [];
  private lastSpeed: Exclude<Speed, 0> = 2;

  constructor(
    readonly seed: NightSeed,
    readonly plan: Plan,
  ) {
    this.night = makeNight(seed);
    this.par = par(this.night);
  }

  get code(): string {
    return formatSeed(this.seed);
  }

  get over(): boolean {
    return this.clock >= HOURS;
  }

  /** The hour a move made now counts for. */
  get hour(): number {
    return Math.min(HOURS - 1, Math.floor(this.clock));
  }

  /** "01:12" */
  get time(): string {
    const m = Math.floor(22 * 60 + this.clock * 60);
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  setSpeed(s: Speed): void {
    if (s) this.lastSpeed = s;
    this.speed = s;
    this.save();
  }

  toggleFreeze(): void {
    this.setSpeed(this.speed ? 0 : this.lastSpeed);
  }

  /** Real seconds since the last frame. */
  advance(dt: number): void {
    if (!this.speed || this.over) return;
    this.clock = Math.min(HOURS, this.clock + (dt * this.speed) / SECONDS_PER_HOUR);
  }

  /** The night as it ends (all events), for the debrief. */
  final(): Result {
    return play(this.night, this.plan, this.moves);
  }

  /** What the player can know now: the night so far, the forecast after. */
  projected(extra: Move[] = []): Result {
    return play(this.night, this.plan, [...this.moves, ...extra], true, undefined, this.hour);
  }

  /** 100 = hall as built and no moves, 1000 = par. */
  score(r: Result): number {
    return shown(r.raw, this.par);
  }

  left(kind: Move['kind']): number {
    const used = this.moves.filter((m) => m.kind === kind).length;
    return kind === 'swap' ? MAX_SWAPS - used : kind === 'go' ? MAX_GO - used : kind === 'forklift' ? MAX_FORKLIFT - used : Infinity;
  }

  add(m: Move): void {
    this.moves.push(m);
    this.save();
  }

  save(): void {
    try {
      const s: Saved = { seed: this.code, clock: this.clock, moves: this.moves, speed: this.speed };
      sessionStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* private mode: the night just will not survive a reload */
    }
  }

  /** The URL that builds the hall for this plan and starts the night. */
  static url(seed: NightSeed, plan: Plan): string {
    const q = new URLSearchParams(location.search);
    q.set('game', formatSeed(seed));
    q.set('country', seed.country.id);
    q.set('plan', plan.doors.join('.'));
    q.set('reserve', String(plan.reserve));
    return `${location.pathname}?${q}`;
  }

  /** The night in the URL, if any (with the moves and clock of a reload). */
  static fromUrl(): Session | null {
    const q = new URLSearchParams(location.search);
    const seed = parseSeed(q.get('game') ?? '');
    if (!seed) return null;
    const night = makeNight(seed);
    const doors = (q.get('plan') ?? '').split('.').map(Number);
    const plan: Plan = doors.length === night.cities.length ? { doors, reserve: Number(q.get('reserve') ?? 0.2) } : standingPlan(night);
    if (!validPlan(plan)) return null;
    const s = new Session(seed, plan);
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Saved | null;
      if (saved && saved.seed === s.code) {
        s.clock = saved.clock;
        s.moves = saved.moves;
        s.speed = saved.speed;
      }
    } catch {
      /* none */
    }
    s.save();
    return s;
  }

  /** Back to the free-running hall. */
  static exitUrl(): string {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* none */
    }
    const q = new URLSearchParams(location.search);
    for (const k of ['game', 'plan', 'reserve']) q.delete(k);
    const s = q.toString();
    return s ? `${location.pathname}?${s}` : location.pathname;
  }

  static clearSaved(): void {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* none */
    }
  }
}
