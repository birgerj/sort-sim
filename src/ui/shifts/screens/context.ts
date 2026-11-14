// What every screen gets from the router in index.ts.
import type { Level, Plan, Result } from '../../../shifts/contract';
import type { Attempt, Progress } from '../progress';

/** A finished shift as the result screen shows it. */
export interface Outcome {
  level: Level;
  plan: Plan;
  result: Result;
  /** The attempt before this one, to show what changed. */
  previous?: Attempt;
  /** 1 for the first shift run in this level. */
  attempt: number;
}

export type Route =
  | { name: 'intro'; from: 'start' | 'levels' }
  | { name: 'levels' }
  | { name: 'briefing'; id: number }
  | { name: 'planner'; id: number; problems?: string[] }
  | { name: 'result'; outcome: Outcome }
  | { name: 'end' };

export interface Ctx {
  levels: Level[];
  /** City names of the chosen country, asked afresh for every screen. */
  names: string[];
  progress: Progress;
  go(route: Route): void;
  /** Leave the game for the free simulation. */
  free(): void;
}

export function levelById(levels: Level[], id: number): Level | undefined {
  return levels.find((l) => l.id === id);
}
