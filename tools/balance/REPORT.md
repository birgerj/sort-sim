# Balance report

Rules these figures were computed with: a parcel left behind costs § 1.50, a robot loads 17 an hour, the
trailer and belt belong to the door and city, a full buffer refuses parcels. Everything comes from
`par.py`, which searches plans in the game's shape and scores each through `fixture.to_solver`. Results
per level are in `out/`, the best plan per level in `best/level<N>.json`. Par is rounded down.

## What changed in the model (both models, same to the last bit)

1. **Trailer and belt belong to the door and the city.** A run is one door serving one city, block after
   block. Its trailer fill, its swap (ten minutes from the minute the trailer is full, whoever stands at
   the door, also across a gap) and its belt are kept per run. A block that starts the minute another
   block of the same city ends goes on at that door; nothing is handed back at that minute, also when the
   crew size changes. Doors are handed out so that this happens: blocks that start together for one city
   first go on where the same crew stops, then where the city stops, then a free door of the city, then
   the door free longest. Docks are served by truck time, city, door (was: by start), so the order no
   longer depends on how a plan is cut.
   Checked (`par.py invariance`, `tests/shiftsCuts.test.ts`): every allowed cut of every block of every
   golden, plain and best plan, and every plan written with its blocks merged, gives the same profit
   (1,487 plans, largest difference 0.0). One case is left out because it has no single answer: a cut
   exactly where another block of the same city and crew starts or ends, or a block with a twin (same
   city, crew, docks and start); there the model picks by door number and the two readings can differ
   by a few Sorty.
2. **Full is full.** A parcel that finds no room on a belt or table goes to the buffer; when that is
   full it is refused: missed for the night, left behind for its city (no revenue, § 1.50), no buffer
   fee. Nothing waits outside any more. `Result.buffer.refused` is the total.
   What a belt still holds when its block ends (and the door does not go on for that city) is handed
   back and looks for a place the next minute like a new parcel: another dock or line of the city, else
   the buffer, else refused. Parcels of a city nobody serves (or whose truck has gone) stay in the
   buffer until the end and keep it full for the others; that is now the main way a careless plan
   loses a night.

## Levels changed in this round

| Level | Was | Now | Why |
|---|---|---|---|
| 3 | small cities' trucks at 01:30, 01:30, 02:00 | 00:30, 00:30, 01:00 (arrivals end 30 minutes before) | obvious plan scored 0 |
| 4 | third city 150 parcels | 90 parcels | the plan that fills both docks scored 84 |
| 8 | 12 docks | 14 docks | plain plan fell to 463 once refused parcels were lost |
| 10 | volume × 2.8 (21,000) | × 2.2 (16,500) | plain plan fell to 292: unserved cities filled the small buffer |

Level 10 is sensitive: at × 2.3 the plain plan scores about 390, at × 2.2 about 540.

## Par, first plans, blocks

| Level | Par | Search (profit) | Obvious plan | Plain plan | Blocks in best plan (cities) |
|---|---|---|---|---|---|
| 1 | 177 | 177.5 × 4 | 565 | 565 | 1 (1) |
| 2 | 621 | 621.4, 619.6, 612.0, 598.5 | 823 | 823 | 4 (2) |
| 3 | 779 | 779, 779, 772, 766 | 316 | 796 | 2 (4) |
| 4 | 596 | 596.65 × 4 | cannot start; 260 with the two largest | 260 | 3 (3) |
| 5 | 1601 | 1594, 1589, 1583, 1582; 1601.5 in the badge search | 380 | 511 | 7 (6) |
| 6 | 2398 | 2399, 2397, 2378, 2350 | 412 | 535 | 6 (8) |
| 7 | 7577 | 7565, 7520; polished 7577 | 213 | 575 | 27 (9) |
| 8 | 12655 | long run: 12571, 12403; polished 12633, 12633, 12656 | 0 | 522 | 26 (10) |
| 9 | 13066 | long run: 13029, 13067; five polishing runs all 13067 | 0 | 573 | 34 (12) |
| 10 | 19584 | long run: 19343, 19512; four polishing runs all 19585 | 63 | 536 | 53 (16) |

Obvious plan: every city one dock with two people from first parcel to truck, no robots. Plain plan:
`par.plain` (steady cities to robots, the others ceil(needed rate ÷ 150) docks with two people, largest
first, while docks and people last).

How sure: levels 1–6 are settled. Levels 8, 9 and 10 had a longer search (about 15 minutes each, two
restarts and four to five polishing runs from the best plan): level 10 rose 1.3% (19342 to 19584) and then
stood still over four runs, level 9 rose 0.3% and stood still over five, level 8 rose 0.7% and was still
creeping (12633 to 12656 in its last run). Level 7 had six minutes and moved under 1%. Nothing in the
levels changed in that round; the plain plan stays above 500 in all three (522, 573, 536).

One thing the long run showed: a block with two docks and two equal blocks side by side can score a
little differently (a few Sorty, in one searched plan much more) when a third block of that city and crew
starts with them, because the doors are then handed out in another order and docks are served by door.
The saved best plans are in the form the search scored. Making docks of one city take parcels by what
waits on their belt instead of by door number would remove this; that is a rule change and was not made.

Blocks: the search prefers short plans (one Sorty per block as a tie-break) and writes blocks that follow
each other as one. Levels 1–6 need 1 to 7 blocks. Levels 7–10 still take 26 to 53: the best plans change
crew size and dock count through the night, about three blocks a city. On a phone that is a lot; a
plan with one or two blocks a city (the plain plan) earns one star, and what 2 blocks a city can reach
has not been searched.

Leaving late: no best plan does it. A late truck pays § 0.30 per parcel per 10 minutes on everything it
carries and loses its bonus, against § 3.00 for each parcel saved, so 30 minutes late only pays when
about a third of the truck would otherwise stay behind (15 minutes late: about a sixth).

## Badges

| Level | Badge | Best with badge | Score | Best plan earns it | Plain plan earns it |
|---|---|---|---|---|---|
| 1 | lean: one person is enough | 160 | 904 | no | no |
| 2 | lean3: never more than 3 people | 621 | 1000 | yes | no |
| 3 | fleet3: at most 3 robots | 765 | 982 | no | no |
| 4 | lean3 | 597 | 1000 | yes | no |
| 5 | smallFleet: at most 6 robots | 1601 | 1000 | yes | no |
| 6 | **lean6**: never more than 6 people (was halfBuffer: the plain plan never uses the buffer) | 2398 | 1000 | yes | no |
| 7 | allOnTime | 7577 | 1000 | yes | no |
| 8 | onTime9: at least 9 trucks on time | 12571 | 1000 | yes | no (7) |
| 9 | **lean16**: never more than 16 people (was lean12: 445 at best, no star) | 9649 | 741 | no | no |
| 10 | **allOnTime** again (was onTime15; the best plan now has all 16 on time) | 19343 | 1000 | yes | no (10) |

Ids the models know: `lean`, `lean<N>`, `oneDock`, `noDockSmall`, `smallFleet`, `fleet<N>`, `halfBuffer`,
`allOnTime`, `onTime<N>`.
