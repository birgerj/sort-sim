// Where the game's scores come from. This file is the build for a plain web host: the plan is
// scored on the device. The build for the server swaps it for score.remote.ts (see
// vite.config.ts), so the score model never reaches the browser there.
import type { ScoreService } from './contract';
import { LocalScoreService } from './model/index';

export function createScore(): ScoreService {
  return new LocalScoreService();
}

/** True when scores are kept by a server (and a ranking exists). */
export const SERVER_SCORES = false;
