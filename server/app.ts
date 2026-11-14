// The server's answers, apart from the web server around them, so they can be tested. A plan
// comes in, is checked and scored by the model, the best per player is kept, and the answer
// goes out after a wait: the wait is what stops someone trying thousands of plans.
import type { Plan, PlanProblem, Result, Timeline } from '../src/shifts/contract';
import { LEVELS, checkPlan, simulate } from '../src/shifts/model/index';
import { cleanName } from '../src/shifts/player';
import type { Store } from './store';

export interface Reply {
  status: number;
  body: unknown;
  /** Milliseconds to hold the answer back. */
  wait?: number;
}

export interface Options {
  /** How long a scored plan's answer is held back. */
  waitMs: number;
  /** At most this many plans at once from one address, and from one player. */
  atOnce: number;
  now(): number;
}

const KEY = /^[0-9a-f]{32}$/;

/** Is this a plan the model can take? Shape only; checkPlan judges the rest. */
function asPlan(v: unknown): Plan | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (!Array.isArray(p.blocks) || !Array.isArray(p.robotCities) || !Number.isInteger(p.robots)) return null;
  if (p.blocks.length > 400 || p.robotCities.length > 64 || (p.robots as number) < 0 || (p.robots as number) > 1000) return null;
  const blocks = [];
  for (const b of p.blocks as Record<string, unknown>[]) {
    if (!b || typeof b !== 'object') return null;
    const { city, start, end, people, docks } = b;
    if (![city, start, end, docks].every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 10000)) return null;
    if (people !== 1 && people !== 2) return null;
    blocks.push({ city: city as number, start: start as number, end: end as number, people: people as 1 | 2, docks: docks as number });
  }
  if (!(p.robotCities as unknown[]).every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 64)) return null;
  return { blocks, robotCities: p.robotCities as number[], robots: p.robots as number };
}

export class App {
  private readonly busy = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly o: Options,
  ) {}

  private take(who: string): boolean {
    const n = this.busy.get(who) ?? 0;
    if (n >= this.o.atOnce) return false;
    this.busy.set(who, n + 1);
    return true;
  }

  /** Call when a held-back answer has gone out. */
  release(who: string[]): void {
    for (const w of who) {
      const n = (this.busy.get(w) ?? 1) - 1;
      if (n <= 0) this.busy.delete(w);
      else this.busy.set(w, n);
    }
  }

  /** Scores a plan. `held` names what to release once the answer is sent. */
  run(input: unknown, address: string): Reply & { held: string[] } {
    const q = (input ?? {}) as { level?: unknown; plan?: unknown; player?: { key?: unknown; name?: unknown; country?: unknown } };
    const level = LEVELS.find((l) => l.id === q.level);
    const key = typeof q.player?.key === 'string' && KEY.test(q.player.key) ? q.player.key : null;
    const plan = asPlan(q.plan);
    if (!level || !key || !plan) return { status: 400, body: { error: 'This is not a plan for a level of the game.' }, held: [] };
    const problems: PlanProblem[] = checkPlan(level, plan);
    if (problems.length) return { status: 422, body: { problems }, held: [] };

    const held = [`a:${address}`, `p:${key}`];
    if (!this.take(held[0]!)) return { status: 429, body: { error: 'Too many plans at once from here. Wait for the last one to finish.' }, held: [] };
    if (!this.take(held[1]!)) {
      this.release([held[0]!]);
      return { status: 429, body: { error: 'Your last plan is still being scored.' }, held: [] };
    }
    const now = this.o.now();
    const name = cleanName(typeof q.player?.name === 'string' ? q.player.name : '');
    const country = typeof q.player?.country === 'string' ? q.player.country.replace(/[^a-z]/gi, '').slice(0, 3).toLowerCase() : '';
    const { result, timeline } = simulate(level, plan) as { result: Result; timeline: Timeline };
    this.store.seen(key, name, country, now);
    this.store.record(key, level.id, result, JSON.stringify(plan), now);
    return { status: 200, body: { result, timeline }, wait: this.o.waitMs, held };
  }

  /** The ranking: one level, or the totals; with the asking player's own place when a key is given. */
  ranking(level: number | null, key: string | null): Reply {
    if (level != null && !LEVELS.some((l) => l.id === level)) return { status: 400, body: { error: 'There is no such level.' } };
    const k = key && KEY.test(key) ? key : null;
    return { status: 200, body: level == null ? { totals: this.store.totals(50), rank: k ? this.store.rank(k) : 0 } : { level, entries: this.store.level(level, 50) } };
  }

  mine(key: string | null): Reply {
    if (!key || !KEY.test(key)) return { status: 400, body: { error: 'No player.' } };
    return { status: 200, body: { best: this.store.mine(key), rank: this.store.rank(key) } };
  }
}
