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
  /** The player tapped a city: show its dock. */
  onFocus?(city: number): void;
  /** The player asked for the automatic camera back. */
  onAuto?(): void;
}) => { root: HTMLElement; setClock(minute: number): void; setTimeline(t: Timeline): void; done(): void; setAuto?(on: boolean): void };

/** Shift minutes per real second behind the speed buttons. */
/** 1× is the hall's own pace: one shift hour in two and a half minutes. */
export const SPEEDS = { pause: 0, x1: 0.4, x4: 1.6, x8: 3.2, x16: 6.4 } as const;
/** The speed a shift starts at (4×). */
export const DEFAULT_SPEED = SPEEDS.x4;
