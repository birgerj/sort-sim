// What the player has reached in Ten Shifts, kept in localStorage under one key.
// Storage may be missing or refuse to work (private windows, embedded pages): the
// game then simply remembers things for as long as the page is open.
import type { Block, Plan, Result } from '../../shifts/contract';

export const PROGRESS_KEY = 'sortsim.shifts';
export const LEVEL_COUNT = 10;

/** The part of a result that is kept to compare the next attempt with. */
export interface Attempt {
  profit: number;
  score: number;
  stars: 0 | 1 | 2 | 3;
  badge: boolean;
  lines: Result['lines'];
}

export interface LevelProgress {
  /** Best level score so far (this is what counts for the total). */
  best: number;
  /** Most stars so far. */
  stars: 0 | 1 | 2 | 3;
  /** The extra goal was met at least once. */
  badge: boolean;
  /** How many shifts were run in this level. */
  attempts: number;
  /** The plan the player last worked on (kept when leaving the planner too). */
  lastPlan?: Plan;
  /** The latest result: the next attempt is compared with it. */
  previous?: Attempt;
}

export interface ProgressData {
  introSeen: boolean;
  levels: Record<number, LevelProgress>;
}

/** The part of the Web Storage interface that is used; tests pass an object of their own. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Progress {
  introSeen(): boolean;
  markIntroSeen(): void;
  level(id: number): LevelProgress | undefined;
  /** Level 1 is always open; one star on a level opens the next. */
  unlocked(id: number): boolean;
  /** The level to play next: the first open one without a star (the last level when all have one). */
  nextLevel(): number;
  savePlan(id: number, plan: Plan): void;
  /** Stores a finished shift. Returns the attempt before it (if any) and this attempt's number. */
  record(id: number, plan: Plan, result: Result): { previous?: Attempt; attempt: number; newBest: boolean };
  /** The sum of the best score per level. */
  total(): number;
  starCount(): number;
  badgeCount(): number;
  /** Levels with at least one star. */
  doneCount(): number;
  data(): ProgressData;
  reset(): void;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const starsOf = (v: unknown): 0 | 1 | 2 | 3 => Math.max(0, Math.min(3, Math.round(num(v)))) as 0 | 1 | 2 | 3;

function cleanPlan(v: unknown): Plan | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const p = v as Partial<Plan>;
  if (!Array.isArray(p.blocks)) return undefined;
  const blocks: Block[] = [];
  for (const b of p.blocks as Partial<Block>[]) {
    if (!b || typeof b !== 'object') continue;
    const block: Block = { city: num(b.city, -1), start: num(b.start, NaN), end: num(b.end, NaN), people: b.people === 2 ? 2 : 1, docks: Math.max(1, Math.round(num(b.docks, 1))) };
    if (block.city < 0 || Number.isNaN(block.start) || Number.isNaN(block.end)) continue;
    blocks.push(block);
  }
  const robotCities = Array.isArray(p.robotCities) ? p.robotCities.filter((c): c is number => typeof c === 'number' && Number.isFinite(c)) : [];
  return { blocks, robotCities, robots: Math.max(0, Math.round(num(p.robots))) };
}

const LINE_KEYS = ['revenue', 'bonus', 'late', 'left', 'docks', 'people', 'robots', 'buffer'] as const;

function cleanAttempt(v: unknown): Attempt | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const a = v as Partial<Attempt>;
  if (typeof a.profit !== 'number' || !a.lines || typeof a.lines !== 'object') return undefined;
  const lines = {} as Result['lines'];
  for (const k of LINE_KEYS) lines[k] = num((a.lines as Record<string, unknown>)[k]);
  return { profit: num(a.profit), score: num(a.score), stars: starsOf(a.stars), badge: a.badge === true, lines };
}

/** Reads whatever was stored and keeps only what makes sense. */
function clean(raw: unknown): ProgressData {
  const out: ProgressData = { introSeen: false, levels: {} };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { introSeen?: unknown; levels?: unknown };
  out.introSeen = r.introSeen === true;
  if (r.levels && typeof r.levels === 'object') {
    for (const [key, v] of Object.entries(r.levels as Record<string, unknown>)) {
      const id = Number(key);
      if (!Number.isInteger(id) || id < 1 || id > LEVEL_COUNT || !v || typeof v !== 'object') continue;
      const l = v as Partial<LevelProgress>;
      const lp: LevelProgress = { best: Math.max(0, num(l.best)), stars: starsOf(l.stars), badge: l.badge === true, attempts: Math.max(0, Math.round(num(l.attempts))) };
      const plan = cleanPlan(l.lastPlan);
      if (plan) lp.lastPlan = plan;
      const prev = cleanAttempt(l.previous);
      if (prev) lp.previous = prev;
      out.levels[id] = lp;
    }
  }
  return out;
}

/** The browser's storage, or nothing when it is absent or blocked (reading the property can throw). */
function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Opens the player's progress. Pass a storage object (tests), `null` for none, or
 * nothing for the browser's localStorage.
 */
export function createProgress(storage: StorageLike | null | undefined = browserStorage()): Progress {
  let d: ProgressData = { introSeen: false, levels: {} };
  try {
    d = clean(JSON.parse(storage?.getItem(PROGRESS_KEY) ?? 'null'));
  } catch {
    /* unreadable or blocked: start empty */
  }

  const save = () => {
    try {
      storage?.setItem(PROGRESS_KEY, JSON.stringify(d));
    } catch {
      /* full or blocked: keep it in memory */
    }
  };
  const entry = (id: number): LevelProgress => (d.levels[id] ??= { best: 0, stars: 0, badge: false, attempts: 0 });
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const levels = () => Object.values(d.levels);

  const api: Progress = {
    introSeen: () => d.introSeen,
    markIntroSeen() {
      if (d.introSeen) return;
      d.introSeen = true;
      save();
    },
    level: (id) => d.levels[id],
    unlocked: (id) => id === 1 || (id > 1 && id <= LEVEL_COUNT && (d.levels[id - 1]?.stars ?? 0) >= 1),
    nextLevel() {
      for (let id = 1; id <= LEVEL_COUNT; id++) if ((d.levels[id]?.stars ?? 0) < 1) return id;
      return LEVEL_COUNT;
    },
    savePlan(id, plan) {
      entry(id).lastPlan = copy(plan);
      save();
    },
    record(id, plan, result) {
      const e = entry(id);
      const previous = e.previous;
      const newBest = e.attempts === 0 || result.score > e.best;
      e.attempts += 1;
      e.best = Math.max(e.best, Math.max(0, result.score));
      e.stars = Math.max(e.stars, starsOf(result.stars)) as 0 | 1 | 2 | 3;
      e.badge = e.badge || result.badge === true;
      e.lastPlan = copy(plan);
      e.previous = { profit: result.profit, score: result.score, stars: starsOf(result.stars), badge: result.badge === true, lines: { ...result.lines } };
      save();
      return { previous, attempt: e.attempts, newBest };
    },
    total: () => levels().reduce((s, l) => s + l.best, 0),
    starCount: () => levels().reduce((s, l) => s + l.stars, 0),
    badgeCount: () => levels().filter((l) => l.badge).length,
    doneCount: () => levels().filter((l) => l.stars >= 1).length,
    data: () => copy(d),
    reset() {
      d = { introSeen: false, levels: {} };
      save();
    },
  };
  return api;
}
