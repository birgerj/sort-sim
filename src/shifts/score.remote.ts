// Where the game's scores come from in the build for the server: the plan goes to the server,
// which scores it, keeps the best per player and answers after its own wait. Nothing of the
// score model is in this file or in anything it imports.
import type { Plan, PlanProblem, Result, ScoreService, Timeline } from './contract';
import { player } from './player';

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

export const SERVER_SCORES = true;
