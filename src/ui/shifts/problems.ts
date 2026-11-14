// Why a plan was refused, in the player's words.
import type { Level, Plan, PlanProblem } from '../../shifts/contract';
import { RATES } from '../../shifts/contract';
import { cityName, clock } from './format';

const KINDS = new Set(['grid', 'tooShort', 'afterTruck', 'noDock', 'tooManyPeople', 'tooManyRobots', 'robotsOff']);

/** The problems inside whatever the score service rejected with: a list, or an error carrying one. */
export function problemsFrom(reason: unknown): PlanProblem[] {
  const list = Array.isArray(reason) ? reason : Array.isArray((reason as { problems?: unknown } | null)?.problems) ? (reason as { problems: unknown[] }).problems : [];
  return list.filter((p): p is PlanProblem => !!p && typeof p === 'object' && KINDS.has((p as { kind?: string }).kind ?? ''));
}

export function describeProblem(p: PlanProblem, level: Level, plan: Plan, names: string[]): string {
  const block = (i: number) => {
    const b = plan.blocks[i];
    return b ? `${cityName(names, b.city)} ${clock(b.start)}–${clock(b.end)}` : `Block ${i + 1}`;
  };
  switch (p.kind) {
    case 'grid':
      return `${block(p.block)}: a block starts and ends on the half hour, or exactly on the city's first parcel or its truck time.`;
    case 'tooShort':
      return `${block(p.block)}: a block lasts at least ${RATES.minBlockMinutes / 60 === 1 ? 'an hour' : `${RATES.minBlockMinutes} minutes`}.`;
    case 'afterTruck':
      return `${block(p.block)}: it ends more than ${RATES.maxLateMinutes} minutes after the truck time.`;
    case 'noDock':
      return `${block(p.block)}: no dock is free then. Tonight ${level.docks === 1 ? 'one dock is' : `${level.docks} docks are`} open, and a dock needs ${RATES.switchMinutes} minutes to switch city.`;
    case 'tooManyPeople':
      return `Too many people at work at ${clock(p.at)}${level.peopleCap != null ? `: tonight ${level.peopleCap} at most` : ''}.`;
    case 'tooManyRobots':
      return `More robots than there are tonight (${level.robotsMax}).`;
    case 'robotsOff':
      return 'Robots are out of use tonight.';
  }
}

/** The lines shown above the planner after a refused start. */
export function problemLines(reason: unknown, level: Level, plan: Plan, names: string[]): string[] {
  const found = problemsFrom(reason).map((p) => describeProblem(p, level, plan, names));
  return found.length ? [...new Set(found)] : ['The shift could not be started. Check the plan and try again.'];
}
