# Balance report

Rules these figures were computed with: a parcel left behind costs § 1.50, a robot loads 17 an hour, the
trailer and belt belong to the door and city, a full buffer refuses parcels, a city's truck time is its
cut-off followed by a cleardown. Everything comes from
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

3. **Cut-off and cleardown** (round 7). As in DESIGN.md. Decided while building:
   - A truck's `planned` time in the result is cut-off + 15; `left` and the departure's `at` are when it
     really left (cut-off + 15 to + 45).
   - A door is done the minute its belt is found empty; with an empty belt at the cut-off it still pays
     and holds its crew for 15 minutes. A block that ends before the cut-off has no cleardown at all.
   - A robot city always has a cleardown for what is on its tables; without robots (or in the outage) the
     tables never empty and the truck leaves at cut-off + 45, late.
   - People limits and people badges count planned blocks only; doors are handed out from planned blocks.
   - The model plays 45 minutes past the shift (was 30); the timeline has that many samples.
   - Parcels in the buffer at a cut-off are left behind and their places come free, so parcels of an
     unserved city no longer block the buffer all night, only until that city's cut-off.
4. **Equal blocks are one block.** Two blocks with the same city, start, end and crew are added up into
   one with more docks before doors are handed out. Before, the two writings could get their doors in
   another order, and with the cleardown that decided which door stood with a full belt at the cut-off:
   the search had found plans for levels 8 and 10 that scored 12,359 and 19,593 written one way and
   8,098 and 17,009 written the other.
   **Still open:** docks of one city are filled in door order (lowest door first), and door numbers follow
   from how blocks sort. Which dock ends the night with a full belt is therefore something a player cannot
   see or steer. Filling the emptiest belt first would make docks of one city equal; that is a rule
   change and was not made.

## Levels changed in this round (cut-off)

| Level | Was | Now | Why |
|---|---|---|---|
| 3 | small cities 60, 70, 50 parcels | 80, 90, 70 | obvious plan fell to 204 with the cleardown to pay |
| 4 | third city 90 parcels | 60 | the plan that fills both docks fell to 194 |
| 8 | volume × 2.8 (11,760) | × 2.7 (11,340) | plain plan fell to 497 |

## Par, first plans, blocks, late trucks

| Level | Par | Search (profit) | Obvious plan | Plain plan | Blocks in best plan (cities) | Trucks late: best / plain |
|---|---|---|---|---|---|---|
| 1 | 177 | 177.5 × 2 | 446 | 446 | 1 (1) | 0 / 0 |
| 2 | 611 | 612, 612, 612, 602 | 766 | 766 | 3 (2) | 0 / 0 |
| 3 | 856 | 857, 857, 856, 840 | 315 | 655 | 2 (4) | 0 / 0 |
| 4 | 530 | 530, 528, 528, 524 | cannot start; 306 with the two largest | 306 | 4 (3) | 0 / 0 |
| 5 | 1606 | 1607, 1596, 1594, 1589 | 299 | 456 | 3 (6) | 0 / 0 |
| 6 | 2408 | 2408, 2404, 2399, 2395 | 340 | 488 | 4 (8) | 0 / 0 |
| 7 | 7566 | 7481, 7415; polished 7567 | 184 | 510 | 26 (9) | 0 / 3 of 9 |
| 8 | 12300 | 12211, 12096; polished 12300 | 0 | 520 | 27 (10) | 0 / 1 of 10 |
| 9 | 13084 | polished 13084 | 0 | 515 | 43 (12) | 0 / 1 of 12 |
| 10 | 19424 | polished 19424 | 61 | 557 | 52 (16) | 0 / 0 |

Obvious plan: every city one dock with two people from first parcel to cut-off, no robots. Plain plan:
`par.plain`. Both end every block at the cut-off, so both now pay 15 minutes of cleardown per door; a
better plan ends blocks early where the parcels have stopped coming.

How sure: each level had at most six minutes. Levels 1–6 are settled. Levels 8 and 10 were searched again
after the equal-blocks fix (about four minutes each) and levels 7–10 would gain from the longer run they
had last round (`par.py par <level> 120000 2`, `par.py polish <level> 250000 2 40`).

Things to look at: level 1's obvious plan (two people) is now under one star (446; one person scores 825).
The plain plan is under 500 in levels 5 and 6 (456, 488). Neither was in this round's brief.

No best plan has a late truck: a cleardown past 15 minutes costs § 0.30 per parcel per 10 minutes on the
whole truck and its bonus, so the search ends blocks early or staffs the last hour with two. Late trucks
happen in careless plans: one person on a busy dock until the cut-off stands with up to 40 parcels on the
belt and needs 27 minutes.

Blocks: levels 1–6 need 1 to 4 blocks; levels 7–10 take 26 to 52.

## Badges ("on time" now means left by cut-off + 15, complete)

| Level | Badge | Best with badge | Score | Best plan earns it | Plain plan earns it |
|---|---|---|---|---|---|
| 1 | lean: one person is enough | 165 | 932 | no | no |
| 2 | lean3: never more than 3 people | 612 | 1000 | yes | no |
| 3 | fleet3: at most 3 robots | 828 | 967 | no | no |
| 4 | lean3 | 530 | 1000 | yes | no |
| 5 | smallFleet: at most 6 robots | 1602 | 997 | no | no |
| 6 | lean6: never more than 6 people | 2408 | 1000 | yes | no |
| 7 | allOnTime | 7567 | 1000 | yes | no |
| 8 | onTime9: at least 9 trucks on time | 12300 | 1000 | yes | no |
| 9 | lean16: never more than 16 people | 9255 | 707 | no | no |
| 10 | allOnTime | 19424 | 1000 | yes | no |

Ids the models know: `lean`, `lean<N>`, `oneDock`, `noDockSmall`, `smallFleet`, `fleet<N>`, `halfBuffer`,
`allOnTime`, `onTime<N>`.
