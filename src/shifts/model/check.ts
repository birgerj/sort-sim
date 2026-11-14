// Can this plan be started? Uses only what the briefing shows, so checking gives nothing away.
import type { Level, Plan, PlanProblem } from '../contract';
import { assignDoors, firstParcel, robotCities } from './doors';

/** Blocks start and end on the half hour... */
export const STEP_MINUTES = 30;
/** ...last at least an hour... */
export const MIN_BLOCK_MINUTES = 60;
/** ...and end at most this long after the city's truck time. */
export const MAX_LATE_MINUTES = 30;

const whole = (x: number): boolean => Number.isInteger(x);

/**
 * Everything that keeps a plan from starting; an empty list means it can run.
 * A block that names no city of this level, or has a number of people or docks that does not
 * exist, is reported as off the grid.
 */
export function checkPlan(level: Level, plan: Plan): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const lastMinute = level.shiftMinutes + MAX_LATE_MINUTES;
  const sound: boolean[] = [];

  plan.blocks.forEach((b, block) => {
    const city = whole(b.city) ? level.cities[b.city] : undefined;
    if (!city || !whole(b.start) || !whole(b.end) || (b.people !== 1 && b.people !== 2) || !whole(b.docks) || b.docks < 1) {
      problems.push({ kind: 'grid', block });
      sound.push(false);
      return;
    }
    // Two moments are allowed off the half hour: starting with the first parcel, ending with the truck.
    const startOk = b.start >= 0 && (b.start % STEP_MINUTES === 0 || b.start === firstParcel(level, b.city));
    const endOk = b.end % STEP_MINUTES === 0 || b.end === city.truck;
    if (!startOk || !endOk) problems.push({ kind: 'grid', block });
    if (b.end - b.start < MIN_BLOCK_MINUTES) problems.push({ kind: 'tooShort', block });
    if (b.end > Math.min(lastMinute, city.truck + MAX_LATE_MINUTES)) problems.push({ kind: 'afterTruck', block });
    sound.push(b.start < b.end);
  });

  // Doors and people are counted over the blocks that at least have a city and a length.
  const usable: Plan = { ...plan, blocks: plan.blocks.filter((_, i) => sound[i]) };
  const planIndex = plan.blocks.map((_, i) => i).filter((i) => sound[i]);
  for (const i of assignDoors(level, usable).unplaced) problems.push({ kind: 'noDock', block: planIndex[i]! });

  if (level.peopleCap !== undefined) {
    // People leaving at a minute are counted out before those starting at that minute come in.
    const changes: [number, number][] = [];
    for (const b of usable.blocks) changes.push([b.start, b.people * b.docks], [b.end, -b.people * b.docks]);
    changes.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let atWork = 0;
    for (const [at, change] of changes) {
      atWork += change;
      if (atWork > level.peopleCap) {
        problems.push({ kind: 'tooManyPeople', at });
        break;
      }
    }
  }

  if (!whole(plan.robots) || plan.robots < 0 || plan.robots > level.robotsMax) problems.push({ kind: 'tooManyRobots' });
  const cities = robotCities(plan);
  if (cities.length > 0 && (level.robotsMax <= 0 || cities.some((c) => !whole(c) || !level.cities[c]))) problems.push({ kind: 'robotsOff' });

  return problems;
}
