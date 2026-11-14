# Status

Each agent keeps its own section up to date in its own branch: done, doing, blocked.

## Coordinator
- Done: contract, level data, fixtures, mocks, plan.

## A · model
- Done: `src/shifts/levels.ts` (`LEVELS`, typed from `levels.json`; the JSON import needs no config change),
  `src/shifts/model/` (`simulate`, `checkPlan`, door assignment, `LocalScoreService`), `tests/shiftsModel.test.ts`.
- The model gives the reference profit for all 21 plans of `golden.json` within 0.01, with the same trucks and
  lines (one line differs by 1, see Requests), and the result and timeline of `level4.json`. Checked by hand,
  not committed: 300 random startable plans scored by `fixture.run` on the arrivals of `levels.json` give the
  same profit to the last bit, the same result and the same timeline.
- For the screens: `new LocalScoreService({ delayMs })` (default 5000). A plan that cannot start rejects at
  once with the `PlanProblem[]` of `checkPlan` (an array, not an Error); an unknown level rejects with an Error.
  `simulate(level, plan)` also returns the unrounded `profit`, the unrounded lines (`amounts`) and `bufferPeak`.
- Choices where the reference says nothing:
  - `Result.badge` is worked out by the model (the fixture always writes `false`); the level 4 example earns it.
  - `checkPlan` reports a block with an unknown city, a number of people other than 1 or 2, fewer than 1 dock
    or a start before 0 as `grid`; an unknown robot city as `robotsOff`; a negative or fractional fleet as
    `tooManyRobots`. `tooManyPeople` is reported once, at the first minute over the limit.
  - A robot city named twice counts once (the reference would open its lines twice).
  - Badges count people and docks per minute a block is open (the 15 minutes to switch city do not count);
    `halfBuffer` looks at every minute, not only the 5-minute samples; `noDockSmall` takes the first city
    with the largest volume.
- Not done: nothing open on my side.


## B · balance

## C1 · screens
- Done: `mountShifts` in `src/ui/shifts/index.ts` (overlay + router), Start, How to play (4 steps), Levels, Briefing,
  Result, End score, progress in `sortsim.shifts` (`progress.ts`, tested with an injected storage), the seam types in
  `planner-seam.ts`, stand-ins for planner and shift panel (`standins.ts`, loaded only when no `views` are passed),
  `style.css` with the tokens documented at its top, the work page `shifts-dev.html` (`npx vite`, then
  `/shifts-dev.html`, `?done=N`, `?reject=1`, `?clear=1`). Looked at in Chromium at 1280×800, 390×844 and 844×390.
- How it runs a shift: every start calls `director.enter(level, names)`, then `score.run`, then `setSpeed` + `play`.
  `director.exit()` is called once, when the player leaves the game (Free simulation, or `close()`), not between
  attempts. The result is stored as soon as the score service answers. Skip before the answer shows the result when it comes.
- While a shift plays the root has class `sh-root--live`: transparent, no pointer events except on the HUD's root
  (inside `.sh-live`, which fills the screen).
- Left out on purpose (not in the brief, in the mocks): country and sound buttons, leaderboard, share, the card
  "What made the difference", short badge names (a done tile shows a pill "Badge").
- Not done: nothing tried in a real hall or with the real model; only Chromium was used.

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

- A · model → B · balance: `levels.json` holds arrival rates to six decimals, the reference computes with the
  unrounded ones. Profit still matches within 0.01, but an amount that lies on a half can round the other way:
  golden level 5 `sensible` has `left` 52 in the fixture (52.4999…) and 53 from the levels file (52.50005).
  Writing `perMinute` unrounded in `level_json` (and `volume` likewise) would make every line match exactly;
  the test now allows a difference of 1 only where the unrounded amount is within 0.001 of a half.
- A · model → B · balance: the `sensible` plans of levels 7 to 10 in `golden.json` start blocks on a quarter
  of an hour (for example 225), which `checkPlan` refuses as `grid`, and level 4 `safe` names a robot city in
  a level without robots (`robotsOff`). The model scores them all the same; if golden plans should be
  startable in the game, the search needs the same grid.
- A · model → coordinator: `fixture.run` always writes `badge: false`; `level4.json` should say `true`
  (score 906, never more than 3 people). The test leaves the badge out of that comparison until then.
- A · model → coordinator: is rejecting with a plain `PlanProblem[]` what the screens expect? Say so if an
  Error carrying the list is wanted instead.
- C1 → coordinator: `mountShifts` returns `{ root, open(), close() }` and takes `levels` and optional `views`
  (as the brief says; PLAN.md still shows the older shape). Append `root` to the body; it starts hidden. Its
  z-index is 200. While a shift plays the free simulation's own controls show through under the HUD: hide them in `main.ts`.
- C1 → coordinator: `shifts-dev.html` is served by the dev server only; it is not in the build inputs of `vite.config.ts` (fine as it is).
- C1 → D (hall): `enter()` is called again for every new attempt without an `exit()` in between; please make it safe to repeat.
- C1 → A (model): a refused plan should reject `run()` with a `PlanProblem[]` (or an object with `problems: PlanProblem[]`);
  anything else is shown as a general "could not be started".
- C1 → C2 (planner): `PlannerView` has no way to receive problems, so after a refused start they are listed in a
  banner above your view. Your HUD root is placed in a full-screen box without pointer events; the root itself takes clicks,
  so keep it to the size of its panels if the hall must stay draggable. Tokens and shared classes: top of `src/ui/shifts/style.css`.
- C1 → B (balance): the briefing explains `setForYou` labels "Unloading", "Robots are off", "Doors"; any other label shows without explanation.

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
