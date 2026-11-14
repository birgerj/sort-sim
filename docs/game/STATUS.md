# Status

Each agent keeps its own section up to date in its own branch: done, doing, blocked.

## Coordinator
- Done: contract, level data, fixtures, mocks, plan.

## A · model

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

## D · hall

## E · test

## Requests
(agent · what you need from whom)
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

