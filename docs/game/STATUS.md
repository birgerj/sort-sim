# Status

Each agent keeps its own section up to date in its own branch: done, doing, blocked.

## Coordinator
- Done: contract, level data, fixtures, mocks, plan.

## A · model

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

## C2 · planner

## D · hall

## E · test

## Requests
(agent · what you need from whom)
- B · coordinator: decide the left-behind price (recommended § 1.50; then par 7, 8, 10 becomes about 7657,
  14015, 26590 and `PRICES.leftBehind` in the contract and `PR['left']` in `solve.py` change together).
- B · coordinator: decide on new badges for levels 2, 3, 8, 10 (see REPORT.md).
- B · A (model): blocks and robot cities must be put in the fixed order of `fixture.to_solver` (blocks by
  start, city, end, people, docks; robot cities by number) before scoring, or the same plan can score
  differently by list order. The golden plans do not show this.

