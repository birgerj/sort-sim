# Balance report

Rules these figures were computed with: a parcel left behind costs § 1.50, a robot loads 17 parcels an
hour. Everything comes from `par.py`, which searches plans in the game's shape and scores each one through
`fixture.to_solver`. Results per level are in `out/`, the best plan per level in `best/level<N>.json`.
Par is rounded down, so the best known plan scores at least 1000.

## Levels changed

| Level | Was | Now | Why |
|---|---|---|---|
| 7 | 8 docks | 10 docks | the plain plan left a fifth of the night behind |
| 8 | volume × 3, 20 robots | volume × 2.8 (11,760 parcels), 24 robots | slower robots took the plain plan under one star |
| 9 | 12 docks, 16 people at most | 16 docks, 32 people at most | 16 people opened only 8 docks with two each |
| 10 | volume × 3 | volume × 2.8 (21,000 parcels) | slower robots took the plain plan to about 410 |

Level 9's limit of 32 people is two on every dock, so it no longer binds; what makes people scarce there
is the pay (× 1.5) and the extra goal (12 people). The level note says so. Levels 8 and 10 were not in the
first proposal: with robots at 17 an hour nothing else brought the plain plan back to one star (level 10
already has every dock of the hall).

## Par

| Level | Par | Search (profit per restart) | Plain plan | Best plan uses |
|---|---|---|---|---|
| 1 | 177 | 177.5 × 4 | 565 | 1 of 2 docks |
| 2 | 628 | 628.5, 628.5, 623.6, 598.5 | 814 | 2 of 4 docks, 3 people |
| 3 | 809 | 809 × 4 | 821 | 1 dock, 5 of 6 robots |
| 4 | 669 | 669.25 × 4 | 84 | 2 of 2 docks |
| 5 | 1622 | 1617, 1614, 1610, 1602; 1622.9 found in the badge search | 504 | 6 of 10 robots |
| 6 | 2443 | 2439, 2409, 2407, 2386; polished to 2443.6 | 525 | 4 of 8 docks, 7 of 14 robots |
| 7 | 7780 | 7723, 7675, 7661, 7657; polished to 7780.8 | 560 | 10 of 10 docks, 6 of 12 robots |
| 8 | 12726 | one polishing run of 200,000 plans from the best plan of the larger level, twice | 514 | 12 of 12 docks, 19 of 24 robots |
| 9 | 13429 | 13430, 13394, 13279, 13238 (with 28 people; no gain from 32) | 557 | 15 of 16 docks, 24 of 24 robots |
| 10 | 24214 | one polishing run of 200,000 plans from the best plan of the larger level | 528 | 20 of 20 docks, 29 of 30 robots |

"Plain plan" is its level score: steady cities to the robots while the fleet covers them (17 an hour
each), every other city ceil(needed rate ÷ 150) docks with two people from first parcel to truck time,
largest first, while docks and people last (`par.plain`).

How sure: levels 1–7 are settled within about 1%. **Levels 8 and 10 had a short search** after their
volume changed (5 minutes each, started from the best plan of the larger level): expect the true best 1–3%
higher, which would put the plain plan of level 8 at about 500. Level 9's four restarts lie within 1.5%.
A longer run before par is frozen: `par.py par <level> 400000 4`, then `par.py polish <level> 300000 2 40`.

The search no longer needs every robot in levels 5–7: at 17 an hour a robot costs § 11 an hour for
§ 25.50 to § 30.60 of parcels only when it is busy all night. Level 7's note was changed to match
("you need every dock").

## Badges (checked with 1.50 and 17)

| Level | Badge | Best with badge | Score | Best plan earns it | Plain plan earns it |
|---|---|---|---|---|---|
| 1 | lean: one person is enough | 160 | 904 | no | no |
| 2 | **lean3**: never more than 3 people at work (was oneDock, trivial) | 628.5 | 1000 | yes | no |
| 3 | **fleet3**: at most 3 robots (was noDockSmall, trivial) | 778 | 962 | no | no |
| 4 | lean3 | 663.75 | 992 | no | no |
| 5 | smallFleet: at most 6 robots | 1622.9 | 1000 | yes | no |
| 6 | halfBuffer | 2413 | 987 | no | **yes** (easy) |
| 7 | allOnTime | 7780 | 1000 | yes | no |
| 8 | **onTime9**: at least 9 trucks on time (was allOnTime, not reachable) | 12726 | 1000 | yes | no (6 on time) |
| 9 | lean12 | 7529 | 560 | no | no |
| 10 | **onTime15**: at least 15 trucks on time (was allOnTime, none found) | 24214 | 1000 | yes | no (9 on time) |

New ids `fleet<N>` and `onTime<N>` are known to both models (`fixture.badge_condition`, `badgeGoal` in
`src/shifts/model/simulate.ts`). Level 6 stays easy; "Buffer never over a quarter full" is the proposal,
not searched. Level 9's badge is hard: one star only just.

## Robots at 17 an hour

A robot line passes 60 an hour, so it now takes 60 ÷ 17 = 3.5 robots to fill one: 3 robots give 51 an hour
(85% of a line), 4 give 68. The planner's default of `lines × 3` robots when a city is switched to robots
leaves each line 15% short; `Math.ceil(lines × 60 ÷ RATES.robot)` (4 a line, within the level's fleet)
fills it.

## History

The study at § 2.50, § 2.00, § 1.50 and § 1.00 with 20-an-hour robots (plain plan 213 / 403 / 0 / 391 at
§ 2.50 in levels 7–10) led to the price of § 1.50; its tables are in this file's history in git.
