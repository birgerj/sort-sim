// Where the game's scores come from in the build for the server: the plan goes to the server,
// which scores it, keeps the best per player and answers after its own wait. Nothing of the
// score model is in this file or in anything it imports.
import type { Plan, PlanProblem, RankRow, Ranking, Result, ScoreService, Timeline } from './contract';
import { player, setPlayerName } from './player';

class RemoteScoreService implements ScoreService {
  async run(levelId: number, plan: Plan): Promise<{ result: Result; timeline: Timeline }> {
    let res: Response;
    try {
      res = await fetch('api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: levelId, plan, player: player() }) });
    } catch {
      throw new Error('The server cannot be reached. Check the connection and try again.');
    }
    const body = (await res.json().catch(() => null)) as { result?: Result; timeline?: Timeline; problems?: PlanProblem[]; error?: string } | null;
    // A plan that cannot be started comes back as its problems, as the local service gives them.
    if (res.status === 422 && body?.problems) throw body.problems;
    if (!res.ok || !body?.result || !body.timeline) throw new Error(body?.error ?? 'The server could not score this plan. Try again in a moment.');
    return { result: body.result, timeline: body.timeline };
  }
}

export function createScore(): ScoreService {
  return new RemoteScoreService();
}

async function ask<T>(path: string, post?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, post === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(post) });
  } catch {
    throw new Error('The server cannot be reached. Check the connection and try again.');
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? 'The server gave no answer. Try again in a moment.');
  return body;
}

export function createRanking(): Ranking | null {
  return {
    async totals() {
      const r = await ask<{ totals: (Omit<RankRow, 'score'> & { total: number })[]; rank: number }>(`api/ranking?key=${player().key}`);
      return { rows: r.totals.map((t) => ({ ...t, score: t.total })), rank: r.rank };
    },
    async level(levelId) {
      return (await ask<{ entries: RankRow[] }>(`api/ranking?level=${levelId}&key=${player().key}`)).entries;
    },
    name: () => player().name,
    async setName(name) {
      const kept = (await ask<{ name: string }>('api/name', { key: player().key, name, country: player().country })).name;
      setPlayerName(kept);
      return kept;
    },
  };
}
