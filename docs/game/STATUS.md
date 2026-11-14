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
- Done: search in the game's plan shape (`tools/balance/par.py`); par for all ten levels in `levels.json`
  and `fixture.py` (177, 628, 836, 669, 1688, 2537, 7637, 13699, 13743, 26233, rounded down); best plans in
  `tools/balance/best/`; left-behind price study and badge check in `tools/balance/REPORT.md`.
- Done for the coordinator: `levels.json` unrounded; golden plans startable in the game (level 4 `safe`,
  levels 7–10 `sensible` changed); `fixture.run` computes `badge` (level 4 example: true); `to_solver`
  scores a plan the same whatever order its blocks and robot cities are listed in.
- Fixture files changed against the first draft: `src/shifts/levels.json`, `tests/fixtures/shifts/golden.json`,
  `tests/fixtures/shifts/level4.json` (only `result.badge` and the unrounded level figures; par 669, score 906 as before).
- Not done: par for levels 9 and 10 was still rising when the runs were stopped; badges of levels 8 and 10
  look impossible, 2 and 3 trivial (replacements proposed, not searched).

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
Round 2 (speed, real parcels, camera). Round 1 (schedule, doors, signs, departures) stands, except where noted.

- Speed. The hall's own pace is a quarter of a shift minute per beat; the director sets the tempo to 96 beats a
  minute while a shift plays, so `setSpeed(0.4)` is exactly the free simulation's pace. Faster shifts run the
  whole hall in whole factors (4, 8, 16 hall beats per music beat: `ShiftHooks.warp`), so every music beat is
  still a hall beat; 0 freezes the hall. The shift clock is counted in hall beats, so clock and hall cannot
  drift. The night's lights and dancers stay on the music's beats (sixteen times as fast they would strobe).
- Measured, hall's own pace against the model:
  - Free simulation as it was: a picker takes 4 beats a parcel (60 an hour of hall time); a cage to the trailer
    and an empty one back is about 25 beats; a robot's round trip is about 100 beats (2 to 3 parcels an hour).
  - Directed pace now (measured in a played shift with more allowed than anyone can load): one person alone
    90 an hour (model 90); two people about 158 an hour before the last tuning of the cage runs (model 170;
    not measured again after it); a robot about 17 an hour (model 20), by calling robots again on their way
    back to parking and using the nearest box (`Fleet.retask`, `RobotFloor.near`; tested on the fleet alone).
  - What the hall is behind at the end of a block goes on board in one go (`Docks.closeOut`).
  - Frame time, software GL, 640 × 360, machine shared with four other agents: level 10 at 16× about 1.2 s a
    frame with about 1,250 parcels in the hall; level 1 at 4× and the made-up pace shift about 0.9 to 1.0 s. The
    shift's own work is a small part of a frame; nothing was thinned out. Not measured on a real graphics chip.
- Real parcels. Every parcel in the hall during a shift is one of the plan's (the free simulation's are taken
  off the loop, chutes, belts and tables on `enter`): it comes in as the level's arrivals say, early by the time
  it rides to where it is going, wears a band in its city's colour, goes down the chute of an open dock of its
  city or to its robot stations, or into the buffer rack as far as `timeline.buffer` says, and otherwise rides
  the loop (above 150 riding, the lanes hold theirs back). Pickers take nothing off a belt before
  `cityLoaded` has it loaded. The rack is drawn as full as the buffer against the level's size, in the colours
  of what is in it; a parcel goes in at the lift and comes out on the return belt. Parcels are small cartons
  during a shift (22 fit a roll cage, ten cages a trailer of 220).
  - One parcel stands for: levels 1 to 6: 1; level 7: 3; level 8: 8; level 9: 4; level 10: 8 (`parcelFactor`:
    the smallest of 1, 2, 3, 4, 5, 6, 8, 10… that keeps what comes in to about three parcels a beat, which the
    loop carries at twice its slowest speed; tested).
  - Trailer swaps are now the real truck cycle (door down, truck away, a new one in, door up: 18 beats).
- Camera. `focusCity`, `setAutoCamera`, `onAutoCamera`, `finale` are in. Automatic direction on `enter`: an
  overview of the plan's open docks (further back on a narrow screen), cuts on the beat to a truck about to
  leave, a dock made ready for another city, a belt backing up, the buffer half and nearly full, robots
  stopping or starting; a cut is held 4.5 s, at most one every 9 s, none at 8× and 16×. `finale`: the last
  truck from the yard, at three stars the night comes on; `done` after 4.6 s; after `skip` it ends at once.
  `exit` puts the camera back where and how it was.
- Checked at phone size (390 × 780, upright; software GL): level 1's overview is its one dock from inside the
  loop; level 10's looks down from above the roof on the open docks (11 of the 14 open at minute 20 fit; the
  rest are off the sides). `focusCity` reports the automatic direction off and `setAutoCamera(true)` on again; a
  change to walking by hand reports off; `finale` calls `done` once and turns the night on at three stars;
  after `skip` it ends at once with no night. A cut now also ends while the shift is paused.
- Robots and the model's pace: a round trip on the grid is 14 beats at one cell a beat (17 an hour); letting
  robots tip on every beat does not help (measured). Reaching 20 an hour needs the robot floor to run at double
  time during a shift (two cells a beat, with the parcels' ride and tip timing moved to that clock), about half
  a day's careful work; or the model's robot rate set to 17. Until then the hall's robots run behind and the
  timeline's counts are the truth.
- Round 3 (from the owner's play):
  - Cages by the door: the free simulation's staging ran whenever a full cage found no place in the trailer:
    during the trailer swap, and when the hall had ten cages in before the plan's swap (leftover part cages,
    and the cage size rounded in levels 7 to 10). Now no cage is staged in a shift: during a swap a full cage
    waits in its place and parcels go into the emptiest other cage; a directed trailer takes twenty cages.
  - People idle beside parcels: the pickers were held to the timeline. Now nobody is: the director sends down
    a dock's chute only what the timeline has loaded (as far ahead as a parcel comes in before it is due, plus
    four minutes), at once when the parcel comes onto the loop, so what lies on a belt is the crew's to take
    and what must wait rides the loop or goes to the rack. The loop always runs at twice its slowest speed in
    a shift. `Docks.idleAt` / `stagedAt` count beats stood beside a parcel and cages by the door; both stayed 0
    in the headless runs (levels 1 and 4). No unit test: the docks cannot be built without the WebGL scene.
  - Cage boards in a shift: the planned city's name on its colour, `cage n` small below; they follow the dock
    to its next city; the free simulation's postcode cards come back on `exit`. The projector over a dock belt
    shows the cage's number (not a postcode) and is left as it is.
  - Closing shot inside the hall: the last dock from the floor, then at three stars the night and a place on
    the floor inside the loop among the dancers; the camera stays there until the next attempt. The night is
    only laid over the player's look and goes at the next `enter` or `exit`; a change of look or quality during
    a shift was tried (Minimal to Day, low to normal) without errors.
- Rough: robots are about 15 % under the model's pace, and full boxes wait for the three forklifts, so robot
  cities fall behind in the hall (the counts on screen are the timeline's); people still appear at their
  place; the nested stacks of empty cages stay at every door; a belt's parcels are taken away (and come round
  again) when the door goes to another city; after `skip` the hall is simply empty.
- File-map lines for AGENTS.md:
  - `src/sim/shiftSchedule.ts` | Ten Shifts: a `Timeline` turned into what the hall shows (`buildSchedule`): per
    block a `Stint` (door, signs from, parcels per step shared over a city's open doors by their pace, truck
    status), robot cities, events; `doorAt`, `robotsAt`, `bufferAt`; and the plan's parcels: `arrivedAt`,
    `parcelFactor`, `inHall`, `CITY_COLOURS`. Pure, tested in `tests/shiftsDirector.test.ts`.
  - `src/scene/director.ts` | `createDirector(scene)`: plays a shift in the hall with the plan's parcels, and
    directs the camera. Uses the scene's shift hooks: `Sorter.shift` (`ShiftHooks`: `warp`, `next`/`took` for
    the lanes, `colours`, `night`; null = free simulation), `shiftReset`, `shiftPlace`, `shiftSend`,
    `shiftStore`, `shiftRetrieve`, `shiftDrop`, `shiftClear`, `shiftBuffer`, `shiftView`, `shiftCamera`;
    `Docks.setDirected` / `directDock` / `closeOut`; `Trucks.direct` / `want` / `swap` / `say` / `warn` /
    `freeze` / `label` / `settle`; `Fleet.limit` / `retask`; `RobotFloor.near`; `BreakCrew.hold`;
    `FaultCrew.recall`.
  - `scripts/directorShots.mjs` | Headless screenshots of played levels (default 1 and 10, desktop and phone
    size) with the director's own camera; checks `onDone` once, a second `enter`, `skip`, the automatic
    direction's callback, the closing shot, and the hall after `exit`.
  - Two clocks: add that `bt` can run ahead of the music during a played shift (`Sorter.mbt` is the music's
    beat, `ahead` the lead); lights and dancers use the music's.
  - How a parcel travels: during a shift a parcel has a `city` and, on the loop, is `spare` until the director
    sends it (`shiftSend`, `shiftStore`); a full or closed end makes it spare again.

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
- D · coordinator (`src/main.ts`): the music's tempo follows `scene.rate`. During a shift the director sets
  `scene.rate` to how busy the plan is (280–700, put back by `exit`), so nothing needs changing; just do not
  write `scene.rate` from the HUD while a shift plays.
- D · coordinator (`src/main.ts`): while the music is paused (space) the scene is not stepped, so the shift
  clock stands still too and `onClock` is silent. Either leave space out during a shift or show it as paused.
- D · coordinator / C2 (shift HUD): at 16× (128 minutes a second at the default) a shift lasts a few beats; the
  hall then only shows doors, signs and fills jumping. Fine as "fast forward", not as something to watch.
- D · coordinator (`package.json`): `scripts/directorShots.mjs` needs `playwright` like `scripts/shots.mjs`
  (neither is in devDependencies); it starts its own dev server on port 5183.
- D · coordinator: if the country is changed during a shift the door signs keep the names given to `enter`.
- D · coordinator (round 2, colours): the sixteen city colours are copied into `src/sim/shiftSchedule.ts`
  (`CITY_COLOURS`, from `--sh-city-0…15` in `src/ui/shifts/style.css`). Better in `src/shifts`, read by both.
- D · coordinator (round 2, camera by hand): during the game nothing lets the player move the camera (the free
  simulation's controls are hidden with its HUD, and `WalkControls` only acts in walk mode). The director
  notices any change of camera mode away from its own shot (walk, fly, follow, another stop) and then reports
  the automatic direction off; something in `src/ui` has to offer that control, for instance a drag on the hall
  calling `scene.setControl('cam', 'walk')`.
- D · coordinator (round 2, tempo): the director now holds `scene.rate` at 121 during a shift (96 beats a
  minute), so 0.4 shift minutes a second is the hall's own pace. The tempo moves a few beats a bar towards it,
  so the first bars of a shift run a little fast or slow, clock and hall together.
- D · coordinator (round 2, plans for the screenshots): the last plan per level in
  `tests/fixtures/shifts/golden.json` does not pass `checkPlan` for level 10 (five problems), so
  `scripts/directorShots.mjs` calls `simulate` directly.
- B · coordinator: decide the left-behind price (recommended § 1.50; then par 7, 8, 10 becomes about 7657,
  14015, 26590 and `PRICES.leftBehind` in the contract and `PR['left']` in `solve.py` change together).
- B · coordinator: decide on new badges for levels 2, 3, 8, 10 (see REPORT.md).
- B · A (model): blocks and robot cities must be put in the fixed order of `fixture.to_solver` (blocks by
  start, city, end, people, docks; robot cities by number) before scoring, or the same plan can score
  differently by list order. The golden plans do not show this.
- Done: `tests/shiftsBestPlans.test.ts` (every level: the best plan of `tools/balance/best` can start and scores
  900 to 1010; an empty and a poor plan score 0 or more), `scripts/shiftsPlay.mjs` with `shiftsPlay.lib.mjs`
  (plays levels in a headless browser with the best plans, at phone or desktop size, and lists small buttons,
  clipped text, things off screen, a clock or cards that stand still, the robot switch, the time from Skip or
  the end of the shift to the result, and the stored stars). Screenshots go to `shots/test/` (not committed).
- Played, software graphics (about 1 frame a second on the phone size, 0.3 on the desktop size): phone 390 × 780
  level 1 by hand and level 2 to the end at 16×, levels 3 to 10 started, watched briefly and skipped, then the end
  screen; desktop 1440 × 900 level 1 to the end, levels 5 and 10 briefing and planner only.
- Found (product code, not changed here): the shift overlay starts with no speed button lit (`hud.ts` starts at
  `speed = 8`, the game plays at 4×); on the phone the money row wraps so "Balance" and its amount are on two
  lines; long city names are cut ("Amsterd…", "Haarlemmermeer") in planner labels and city cards; planner
  blocks are 34 to 38 px high on the phone.
- Not done: no shift played on the desktop size for levels 5 and 10; departed-truck badges seen only in levels 1
  and 2; frame rate on a real graphics chip.
