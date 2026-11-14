// The seam between the screens and the planner: two views that the planner's
// builder supplies and the screens place. Until they are passed to mountShifts
// (deps.views), small stand-ins from standins.ts take their place.
import type { Level, Plan, Timeline } from '../../shifts/contract';

/** The planner for one level. It owns the whole screen below the game root: it
 *  reports every change (so the plan is remembered), asks to start the shift
 *  and asks to go back to the briefing. */
export type PlannerView = (o: {
  level: Level;
  cityNames: string[];
  plan: Plan;
  onChange(p: Plan): void;
  onStart(p: Plan): void;
  onBack(): void;
}) => HTMLElement;

/** What lies over the hall while the shift plays. It is made when the player
 *  starts the shift; the timeline follows a few seconds later (the score
 *  service takes its time), so until setTimeline it shows the shift starting. */
export type ShiftHud = (o: {
  level: Level;
  cityNames: string[];
  plan: Plan;
  onSpeed(minutesPerSecond: number): void;
  onSkip(): void;
}) => { root: HTMLElement; setClock(minute: number): void; setTimeline(t: Timeline): void; done(): void };

/** Shift minutes per real second behind the speed buttons. */
export const SPEEDS = { pause: 0, x1: 2, x4: 8, x16: 32 } as const;
/** The speed a shift starts at (4×). */
export const DEFAULT_SPEED = SPEEDS.x4;
