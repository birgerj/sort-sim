# Balance report

All figures come from `par.py`, which searches plans in the game's shape (blocks with a dock count, robot
cities, a fleet size) and scores each one through `fixture.to_solver`, so doors and robot lines are the
ones the game gives. Results per run are in `out/`, the best plan per level in `best/level<N>.json`.

Two things were fixed on the way and are worth knowing:

- `to_solver` now puts blocks and robot cities in a fixed order before scoring. Before, the same plan
  listed in another order could score differently (level 9: up to § 1,900 apart), because blocks of one
  city that start together fill their belts in list order. The fixtures did not change by this.
- Par is rounded down, so the best known plan scores at least 1000.

## Par

| Level | Old par | Par | Restarts (4 each, profit) | Spread | After polishing |
|---|---|---|---|---|---|
| 1 | 178 | 177 | 177.5 × 4 | 0 | |
| 2 | 612 | 628 | 628.5, 628.5, 623.6, 598.5 | 30 | |
| 3 | 833 | 836 | 836.5 × 3, 834.9 | 2 | |
| 4 | 669 | 669 | 669.25 × 3, 664.75 | 5 | |
| 5 | 1687 | 1688 | 1688.7 × 4 (300,000 plans each) | 0 | |
| 6 | 2549 | 2537 | 2537, 2535, 2526, 2525 (300,000) | 13 | |
| 7 | 7659 | 7637 | 7632, 7617, 7286, 7233 (400,000) | 399 (5%) | 7637.58 |
| 8 | 13560 | 13699 | 13629, 13522, 13498, 13327 (400,000) | 302 (2%) | 13699.02 |
| 9 | 11746 | 13743 | 12547, 12110, 11921, 11918 and 13138, 11898, 11694, 11639 (400,000) | 1,499 (11%) | 13743.07 |
| 10 | 23762 | 26233 | 25418, 25310, 25285, 25167 (400,000) | 251 (1%) | 26233.16 |

"Polishing" is further cooler runs that start from the best plan known (150,000 to 300,000 plans each).

How sure: levels 1–5 are settled. Level 6 and the old par 2549 differ because the old search could give
robot lines its own hours. Levels 7 and 8 moved little in polishing. **Levels 9 and 10 are not settled**:
every polishing round still found more (level 9: 13138 → 13683 → 13743; level 10: 25811 → 26058 → 26233),
and the restarts of level 9 lie 11% apart. Expect the true best a few percent higher; a longer run before
par is frozen is worth it (`par.py polish 9 300000 3 40`, about 10 minutes; the same for 10, 15 minutes).

Level 4: par stays 669, so `level.par`, `result.score` (906) and `stars` (3) in the example are unchanged.

## Price of a parcel left behind

The plain plan (`par.plain`): steady cities go to the robots, smallest first, while the fleet covers
them; every other city, largest first, gets ceil(needed rate ÷ 150) docks with two people from first
parcel to truck time while docks and people last. Its score against the best plan at each price:

| Level | § 2.50 | § 2.00 | § 1.50 | § 1.00 | Parcels the plain plan leaves |
|---|---|---|---|---|---|
| 7 | 213 (1,627 of 7,638) | 297 | 381 (2,914 of 7,657) | 464 | 1,287 |
| 8 | 403 (5,517 of 13,699) | 458 | 511 (7,162 of 14,015) | 563 | 1,645 |
| 9 | 0 (−2,735 of 13,743) | 0 (−800) | 83 (1,135 of 13,743) | 223 | 3,870 |
| 10 | 391 (10,244 of 26,233) | 451 | 512 (13,601 of 26,590) | 571 | 3,356 |

A second plain plan that shares the docks out (one dock per city first, then second docks;
`par.plain_spread`) gives 273 / 514 / 0 / 316 at § 2.50 and 419 / 582 / 95 / 450 at § 1.50.

**Recommendation: § 1.50.** It is the price of a parcel, so it is easy to say ("a parcel left behind
costs what it would have earned"), and it brings the plain plan to one star in levels 8 and 10.
Shipping still always beats leaving: a shipped parcel brings + § 1.50 against − § 1.50, a swing of
§ 3.00, while loading it costs § 0.50 to § 0.78 (dock and people per parcel, the dearest case being one
person at holiday pay), and one parcel left also loses the on-time bonus of its whole truck. Even one
extra hour of a dock with one person (§ 55, § 70 in level 9) pays from 19 to 24 parcels on.

The price alone does not get levels 7 and 9 to 500, not even at § 1.00:

- Level 7: the plain plan runs out of docks (8) and its robots stand still for an hour; it leaves a
  fifth of the night. One star needs either a lower one-star line for this level or about two more docks.
- Level 9: 16 people at two per dock open only 8 of the 12 docks, and 3,870 parcels stay behind. The
  level is about exactly that (one person per dock, robots for the rest), so a plain two-person plan
  cannot pass at any price. Either accept that level 9 asks for more than the plain plan, or raise the
  limit on people (20 would open 10 docks).

Par at § 1.50 would be about 7,657 / 14,015 / 13,743 / 26,590 for levels 7–10 (levels 1–6 and 9 leave
nothing behind in their best plan, so their par does not move). The price was not changed in code.

## Badges

"With badge" is the best profit found that also meets the goal; the badge needs a score of 500.

| Level | Badge | With badge | Score | Verdict |
|---|---|---|---|---|
| 1 | lean | 160 | 904 | Reachable, costs a little: fine for a first level. |
| 2 | oneDock | 628.5 | 1000 | **Trivial**: the best plan and the plain plan both earn it. |
| 3 | noDockSmall | 836.5 | 1000 | **Trivial**: the best plan and the plain plan both earn it. |
| 4 | lean3 | 663.75 | 993 | Good: the best plan uses 4 people at one moment; the example plan earns it. |
| 5 | smallFleet | 1,674 | 992 | Good: the best plan uses more robots. |
| 6 | halfBuffer | 2,512 | 990 | Easy: the plain plan (score 612) already earns it; the best plan does not. |
| 7 | allOnTime | 7,628 | 999 | Good: the best plan leaves 19 parcels; the plain plan does not earn it. |
| 8 | allOnTime | none found | | **Impossible as far as searched**: with leaving and lateness made very dear the best is 9 of 10 trucks, 258 parcels left. The briefing itself says not everything fits. |
| 9 | lean12 | 7,932 | 577 | Reachable but only just one star (short search; more is likely possible). Hard, fits the level. |
| 10 | allOnTime | none found | | **Impossible as far as searched**: best is 14 of 16 trucks, 280 parcels left. |

Proposed replacements, in words (levels.json is unchanged):

- Level 2: "No trailer swap lost": the big city never waits for a swap, or simpler "At most 5 people at
  work" if it turns out to cost something; best checked with the search first.
- Level 3: "At most 3 robots" (the best plan has to trade robots against a second dock).
- Level 6: "Buffer never over a quarter full" (63 parcels) instead of half.
- Level 8: "At most 300 parcels left behind" or "At least 9 trucks on time".
- Level 10: "At least 14 trucks on time".

None of the replacements has been searched yet.

## Not done

- Longer runs for levels 9 and 10 (see above); the last polishing rounds for levels 8 and 10 were cut off.
- The badge search for levels 8 and 10 was 150,000 plans × 2 per stage: "impossible" is a strong
  indication, not a proof.
