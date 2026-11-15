// Where the game's scores come from. This file is the build for a plain web host: the plan is
// scored on the device. The build for the server swaps it for score.remote.ts (see
// vite.config.ts), so the score model never reaches the browser there.
import type { Ranking, ScoreService } from './contract';
import { LocalScoreService } from './model/index';

export function createScore(): ScoreService {
  return new LocalScoreService();
}

/** The ranking, where scores are kept by a server; none in this build. */
export function createRanking(): Ranking | null {
  return null;
}
