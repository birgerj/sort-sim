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

## C2 · planner

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
