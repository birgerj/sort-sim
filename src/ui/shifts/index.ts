// Ten Shifts: the game's screens as one full-screen overlay over the hall, with a
// small router between them. The score model is reached only through the score
// service and the hall only through the director; the levels come in from outside.
import type { Director, Level, Plan, ScoreService } from '../../shifts/contract';
import { h } from './dom';
import { DEFAULT_SPEED, type PlannerView, type ShiftHud } from './planner-seam';
import { problemLines } from './problems';
import { createProgress, type Progress } from './progress';
import { briefingScreen } from './screens/briefing';
import { levelById, type Ctx, type Outcome, type Route } from './screens/context';
import { endScreen } from './screens/end';
import { introScreen } from './screens/intro';
import { levelsScreen } from './screens/levels';
import { resultScreen } from './screens/result';
import { startScreen } from './screens/start';
import './style.css';

export type { PlannerView, ShiftHud } from './planner-seam';
export { SPEEDS, DEFAULT_SPEED } from './planner-seam';

export interface ShiftsDeps {
  score: ScoreService;
  director: Director;
  levels: Level[];
  cityNames(): string[];
  /** The player chose the free simulation (the overlay has closed itself). */
  onFree(): void;
  /** The planner and the running-shift panel; small stand-ins when absent. */
  views?: { planner: PlannerView; shiftHud: ShiftHud };
  /** Where progress is kept; the browser's own storage when absent. */
  progress?: Progress;
}

const EMPTY_PLAN: Plan = { blocks: [], robotCities: [], robots: 0 };

export function mountShifts(deps: ShiftsDeps): { root: HTMLElement; open(): void; close(): void } {
  const progress = deps.progress ?? createProgress();
  const root = h('div', { class: 'sh-root', attrs: { hidden: true, role: 'region', 'aria-label': 'Ten Shifts' } });

  /** The hall has been taken over for the game and must be given back. */
  let inHall = false;
  /** Counts shifts started and screens left: an answer for an older one is dropped. */
  let run = 0;

  type Views = NonNullable<ShiftsDeps['views']>;
  let views: Views | undefined = deps.views;
  const loadViews = async (): Promise<Views> => {
    if (!views) {
      const m = await import('./standins');
      views = { planner: m.stubPlanner, shiftHud: m.stubHud };
    }
    return views;
  };

  const ctx = (): Ctx => ({ levels: deps.levels, names: deps.cityNames(), progress, go, free });

  function show(el: HTMLElement, live = false): void {
    // While a shift plays, the overlay lets the hall show through and only its panel takes clicks.
    root.classList.toggle('sh-root--live', live);
    root.replaceChildren(el);
    root.scrollTop = 0;
    el.querySelector<HTMLElement>('h1[tabindex="-1"]')?.focus({ preventScroll: true });
  }

  function go(route: Route): void {
    run++;
    switch (route.name) {
      case 'start':
        return show(startScreen(ctx()));
      case 'intro':
        return show(introScreen(ctx(), route.from));
      case 'levels':
        return show(levelsScreen(ctx()));
      case 'briefing':
        return show(progress.unlocked(route.id) ? briefingScreen(ctx(), route.id) : levelsScreen(ctx()));
      case 'planner':
        return void planner(route.id, route.problems);
      case 'result':
        return show(resultScreen(ctx(), route.outcome));
      case 'end':
        return show(endScreen(ctx()));
    }
  }

  async function planner(id: number, problems?: string[]): Promise<void> {
    const level = levelById(deps.levels, id);
    if (!level) return go({ name: 'levels' });
    const mine = run;
    const v = await loadViews();
    if (mine !== run) return;
    const names = deps.cityNames();
    const view = v.planner({
      level,
      cityNames: names,
      plan: structuredClone(progress.level(id)?.lastPlan ?? EMPTY_PLAN),
      onChange: (p) => progress.savePlan(id, p),
      onStart: (p) => void startShift(level, structuredClone(p)),
      onBack: () => go({ name: 'briefing', id }),
    });
    const host = h('div', { class: 'sh-planner-host' });
    if (problems?.length) {
      host.append(h('div', { class: 'sh-problems', attrs: { role: 'alert' } }, h('b', { text: 'This plan cannot start yet.' }), h('ul', null, ...problems.map((t) => h('li', { text: t })))));
    }
    host.append(view);
    show(host);
  }

  async function startShift(level: Level, plan: Plan): Promise<void> {
    const mine = ++run;
    const names = deps.cityNames();
    progress.savePlan(level.id, plan);
    const v = await loadViews();
    if (mine !== run) return;

    let speed: number = DEFAULT_SPEED;
    let playing = false;
    let skip = false;
    let outcome: Outcome | undefined;
    let shown = false;
    const finish = () => {
      if (shown || mine !== run || !outcome) return;
      shown = true;
      go({ name: 'result', outcome });
    };

    const hud = v.shiftHud({
      level,
      cityNames: names,
      plan,
      onSpeed(minutesPerSecond) {
        speed = minutesPerSecond;
        if (playing) deps.director.setSpeed(speed);
      },
      onSkip() {
        // Before the answer is in there is nothing to skip to: the result follows as soon as it comes.
        skip = true;
        if (playing) deps.director.skip();
        finish();
      },
    });
    show(h('div', { class: 'sh-live' }, hud.root), true);

    // The hall opens the shift (doors, people walking in) while the score is worked out.
    inHall = true;
    deps.director.enter(level, names);
    try {
      const { result, timeline } = await deps.score.run(level.id, plan);
      if (mine !== run) return;
      // Stored as soon as it is known, so closing the page during the shift loses nothing.
      outcome = { level, plan, result, ...progress.record(level.id, plan, result) };
      if (skip) return finish();
      hud.setTimeline(timeline);
      playing = true;
      deps.director.setSpeed(speed);
      deps.director.play(
        timeline,
        (minute) => {
          if (mine === run) hud.setClock(minute);
        },
        () => {
          if (mine !== run) return;
          hud.done();
          finish();
        },
      );
    } catch (reason) {
      if (mine !== run) return;
      go({ name: 'planner', id: level.id, problems: problemLines(reason, level, plan, names) });
    }
  }

  /** Gives the hall back to the free simulation, if the game had taken it. */
  function leaveHall(): void {
    if (!inHall) return;
    inHall = false;
    deps.director.exit();
  }

  function close(): void {
    run++;
    leaveHall();
    root.hidden = true;
    root.classList.remove('sh-root--live');
    root.replaceChildren();
  }

  function free(): void {
    close();
    deps.onFree();
  }

  return {
    root,
    open() {
      root.hidden = false;
      go({ name: 'start' });
    },
    close,
  };
}
