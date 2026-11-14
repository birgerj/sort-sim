# Status

Each agent keeps its own section up to date in its own branch: done, doing, blocked.

## Coordinator
- Done: contract, level data, fixtures, mocks, plan.

## A · model

## B · balance

## C1 · screens

## C2 · planner
- Done: `plannerView` and `shiftHud` exported from `src/ui/shifts/planner/index.ts` with the signatures of the brief
  (options object; `onBack` is the Briefing button). Files: `view.ts` (planner), `hud.ts` (overlay), `rules.ts`
  (grid, length, truck + 30, doors as `to_solver`, people limit, fleet, fixed costs, extra-goal standing), `edit.ts`
  (every change as a pure function), `dom.ts`, `planner.css` (`shp-` classes, `--sh-*` variables with fallbacks),
  `src/shifts/estimate.ts` (`roughBuffer`, `nominalFlow`), trial page `planner-dev.html` + `dev.ts`.
- Tests: `tests/shiftsEstimate.test.ts`, `tests/shiftsPlanEdit.test.ts` (25 tests: doors equal to the fixture's
  timeline, fixed costs equal to the fixture's and the golden plans' result lines, every edit stays within the rules).
- Looked at in a browser (system browser, 1280×800 and 390×844) for levels 1, 3, 4, 9, 10 and the overlay; a
  walk-through with buttons, keyboard and mouse drag ran clean. Screenshots are not committed.
- For C1, placing the views: the planner fills its parent (`height: 100%`; give the parent a height); the overlay is
  `position: absolute; inset: 0` with `pointer-events: none` outside its panels (give the parent `position: relative`).
  The phone layout starts at a viewport of 760px or less. `plannerView` keeps its own copy of the plan and reports
  every change through `onChange`; make a new view to show another plan. `shiftHud.done()` shows the end state and
  switches the speed buttons off.
- Choices made: rows and cards are in truck-time order. A city on robots with a fleet of 0 counts as not served
  (asked about at Start). The overlay's money is as the brief says: earned per departed truck, fixed costs up to the
  clock; no late fees, left-behind fees or buffer costs (those come with the result). The per-block bar and the
  "N too many" hint come from `nominalFlow` (arrivals against nominal crew and robot rates, nothing from the model).
- Not done: the trial page is not part of `npm run build` (see Requests); no browser test in the repository (E owns those).

## D · hall

## E · test

## Requests
(agent · what you need from whom)
- C2 · coordinator: `vite.config.ts` lists `mock-people.html` as a build input; `planner-dev.html` is not listed, so it
  only opens with `npx vite` (`/planner-dev.html?level=10&fill=1`, `?hud=1`). Add it as an input if it should be in the build.
- C2 · A and coordinator: the planner treats times off the grid as a problem (`grid`), as the contract says. The
  fixture's "sensible" plans for levels 7–10 start blocks 15 minutes after another truck (off the grid) and
  `solve.valid` accepts them. If `checkPlan` of the model also reports `grid`, such plans cannot be started; please
  confirm that is intended.
- C2 · A: the fixture's "safe" plan for level 4 has a robot city in a level without robots and is accepted by the
  model. The planner therefore reports `robotsOff` only when the fleet is above 0 in such a level.
- C2 · coordinator: `docs/game/PLAN.md` still shows `plannerView(level, plan, onChange, onStart)`; the built one takes
  the options object of the brief.
- C2 · everyone: the download of the headless browser is blocked here; screenshots worked with the system browser
  already on the machine (pass its path as `executablePath` at launch), with the screenshot package installed outside the repository.
