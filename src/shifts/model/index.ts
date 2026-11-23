// The score model's front door. The screens use only LocalScoreService, LEVELS and checkPlan.
import type { Plan, PlanProblem, Result, ScoreService, Timeline } from '../contract';
import { LEVELS } from '../levels';
import { checkPlan } from './check';
import { simulate } from './simulate';

export { LEVELS } from '../levels';
export { checkPlan } from './check';
export { simulate, type ShiftOutcome } from './simulate';

/**
 * Scores a plan on this device. It answers after a delay, as the server will later, so nothing
 * in the screens can come to depend on an instant answer.
 * A plan that cannot be started is refused at once: the promise rejects with the PlanProblem[]
 * that checkPlan gives. An unknown level rejects with an Error.
 */
export class LocalScoreService implements ScoreService {
  private readonly delayMs: number;

  constructor(options: { delayMs?: number } = {}) {
    this.delayMs = options.delayMs ?? 5000;
  }

  run(levelId: number, plan: Plan): Promise<{ result: Result; timeline: Timeline }> {
    return new Promise((resolve, reject) => {
      const level = LEVELS.find((l) => l.id === levelId);
      if (!level) {
        reject(new Error(`There is no level ${levelId}.`));
        return;
      }
      const problems: PlanProblem[] = checkPlan(level, plan);
      if (problems.length > 0) {
        reject(problems);
        return;
      }
      const { result, timeline } = simulate(level, plan);
      setTimeout(() => resolve({ result, timeline }), this.delayMs);
    });
  }
}
