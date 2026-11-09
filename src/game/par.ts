// Par for a night: the two anchors of the shown score. 100 = the hall as it stands
// and no moves; 1000 = the best plan the optimiser finds on the forecast, plus the
// best moves with hindsight. Computed once per seed (deterministic), so every
// player of a seed is scored on the same scale.
import { HOURS, type Night } from './night';
import { play, validPlan, MAX_DOORS, MAX_SWAPS, SWAP_FROM, type Move, type Plan } from './model';

export const RESERVES = [0, 0.2, 0.4, 0.6];
export const STANDING_RESERVE = 0.2;
export const MAX_MOVES = 10;

export const standingPlan = (night: Night): Plan => ({ doors: night.cities.map((c) => c.standing), reserve: STANDING_RESERVE });

/**
 * What a planner can expect from a plan: the forecast with the announced events,
 * averaged with the 'uncertain' cities running 15% over and 15% under.
 */
export const expected = (night: Night, p: Plan) =>
  (play(night, p, [], false).raw + play(night, p, [], false, { unsure: 0.15 }).raw + play(night, p, [], false, { unsure: -0.15 }).raw) / 3;

/** Hill climb on the briefing's knowledge: what a perfect planner can know before 22:00. */
export function bestPlan(night: Night): Plan {
  let best: Plan | null = null;
  let bestRaw = -Infinity;
  for (const reserve of RESERVES) {
    let p: Plan = { doors: night.cities.map((c) => c.standing), reserve };
    let cur = expected(night, p);
    for (let improved = true; improved; ) {
      improved = false;
      for (let i = 0; i < p.doors.length; i++) {
        if (p.doors[i] === 0) continue;
        for (let j = 0; j < p.doors.length; j++) {
          if (i === j || p.doors[j]! >= MAX_DOORS) continue;
          const d = p.doors.slice();
          d[i]!--;
          d[j]!++;
          const q = { doors: d, reserve };
          if (!validPlan(q)) continue;
          const s = expected(night, q);
          if (s > cur) {
            p = q;
            cur = s;
            improved = true;
          }
        }
      }
    }
    if (cur > bestRaw) {
      bestRaw = cur;
      best = p;
    }
  }
  return best!;
}

/** All moves worth trying for a plan. */
export function candidateMoves(night: Night, plan: Plan): Move[] {
  const out: Move[] = [];
  const n = night.cities.length;
  for (let h = SWAP_FROM; h < HOURS - 1; h++) {
    for (let f = 0; f < n; f++) {
      if (!plan.doors[f]) continue;
      for (let t = 0; t < n; t++) if (t !== f && plan.doors[t]) out.push({ kind: 'swap', hour: h, from: f, to: t });
    }
  }
  for (let i = 0; i < n; i++) {
    if (!plan.doors[i]) continue;
    for (const h of [2, 6]) out.push({ kind: 'go', hour: h, city: i });
    out.push({ kind: 'hold', city: i, window: 0 }, { kind: 'hold', city: i, window: 1 });
  }
  for (let h = 0; h < HOURS; h++) out.push({ kind: 'forklift', hour: h }, { kind: 'release', hour: h });
  return out;
}

const key = (m: Move) => JSON.stringify(m);

/** Best moves one by one, knowing how the night really runs (the 1000 anchor). */
export function bestMoves(night: Night, plan: Plan, budget = MAX_MOVES): Move[] {
  const cands = candidateMoves(night, plan);
  const moves: Move[] = [];
  const used = new Set<string>();
  for (let k = 0; k < budget; k++) {
    const base = play(night, plan, moves).raw;
    let best: Move | null = null;
    let bestRaw = base;
    const swaps = moves.filter((m) => m.kind === 'swap').length;
    for (const c of cands) {
      if (used.has(key(c)) || (c.kind === 'swap' && swaps >= MAX_SWAPS)) continue;
      const s = play(night, plan, [...moves, c]).raw;
      if (s > bestRaw) {
        bestRaw = s;
        best = c;
      }
    }
    if (!best) break;
    moves.push(best);
    used.add(key(best));
  }
  return moves;
}

export interface Par {
  passive: number;
  max: number;
  plan: Plan;
  moves: Move[];
}

export function par(night: Night): Par {
  const passive = play(night, standingPlan(night)).raw;
  const plan = bestPlan(night);
  const moves = bestMoves(night, plan);
  return { passive, max: Math.max(passive + 1, play(night, plan, moves).raw), plan, moves };
}

/** The score the player sees: 100 = standing, no moves; 1000 = par. Floor 0. */
export const shown = (raw: number, p: Pick<Par, 'passive' | 'max'>) =>
  Math.max(0, Math.min(1000, Math.round(100 + (900 * (raw - p.passive)) / (p.max - p.passive))));
