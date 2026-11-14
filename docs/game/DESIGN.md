# Ten Shifts: what is being built

A planning game on top of the hall. The player is the planner of the night shift. Per level: read the
orders, make a plan, start the shift, read the result. Profit is the score. Ten fixed levels, the same
for every player; only the city names follow the chosen country. No randomness anywhere in the game.

The mocks in `docs/game/mocks/` (open the `.html` files; `-phone` is 390 × 844) are the reference for
layout, wording and style. Style: light grey ground, white panels with thin grey lines, small radii,
one blue accent for actions and selection, muted colours per city, the system font, tabular figures.
No drop shadows, no illustrations, no emoji.

## Flow

1. **Start.** At launch the player chooses: *Free simulation* (the hall exactly as it is today) or
   *Ten Shifts*. `?ui=0` and the screenshot scripts go straight to the free simulation.
2. **How to play.** Four steps, shown once (remembered), skippable, replayable from the level screen.
3. **Levels.** Ten tiles: done (stars, best score, badge), next (playable), locked. One star on a level
   opens the next. Total = sum of the best score per level.
4. **Briefing.** Orders (city, parcels, when they arrive, truck time), what is open tonight, the price
   list (only prices that matter in this level), profit needed per star, the extra goal, a card
   *New in this level* (`level.notes.fresh`) and a list *Set for you tonight* (`level.notes.setForYou`).
5. **Planner.** One row per city on a time line. A block = start, end, people per dock (1 or 2), number
   of docks. Robots: switch a city to robots (a city may have both) and set the fleet size. Steps of
   half an hour; a block may also start exactly on the city's first parcel and end exactly on its truck
   time; at least an hour long; at most 30 minutes past the truck time. Tapping an order makes a starter
   block (first parcel to truck time, 1 person). No clock runs here.
   The planner shows: the fixed costs (docks, people, robots), how full each block is from public
   numbers, docks in use, and a **rough** buffer guess per hour in three steps (empty, some, a lot)
   from `src/shifts/estimate.ts`. It never shows profit, real buffer figures or whether trucks will be
   on time. It never calls the score model.
6. **Shift.** The plan is locked. The hall plays the timeline. Clock, pause, 1×, 4×, 16×, skip to
   result. A card per city (loaded so far, truck time), money earned and spent so far.
7. **Result.** Stars, profit against par, level score, profit and loss with the difference from the
   previous attempt, trucks, the real buffer curve with the stretches it was full, badge. Adjust plan
   (back to the planner with the plan kept) or next level.
8. **End score** after level 10.

Progress (best score, stars, badge and last plan per level, intro seen) lives in localStorage under
`sortsim.shifts`. Storage may be missing: the game must still run.

## Rules of the score model

The definition is `tools/balance/solve.py` (`sim`, `evaluate`) with `tools/balance/fixture.py`
(`to_solver`, `run`). In words:

- One person on a dock loads 90 parcels an hour, two load 170. A trailer holds 220; swapping it takes
  the dock 10 minutes. A dock belt holds 40 waiting parcels.
- A robot carries 20 an hour; a robot line passes 60 an hour at most and its table holds 20. A robot
  city gets enough lines for its busiest minute (at most 4), open from its first parcel to its truck
  time. The fleet is shared by all open lines in proportion to what waits there.
- Parcels that find no room on a belt or table go to the buffer (until it is full; then they wait
  upstream). The buffer gives back 150 an hour, earliest truck first.
- A dock that switches city is idle for 15 minutes.
- A city's truck leaves when its last block or line ends. After its truck time that is late; whatever
  is not loaded by then is left behind.
- Money: + § 1.50 per parcel shipped; + § 0.30 per parcel when the truck is on time and complete;
  − § 0.30 per parcel per 10 minutes late; − § 2.50 per parcel left behind; docks § 25 an hour per
  block; people § 30 an hour per block (× the level's wage factor); robots § 11 × shift hours each, for
  the whole shift; buffer § 0.15 per parcel that goes in.
- Level score = 1000 × profit ÷ par, never below 0, not capped. Stars at 500, 750, 900.

## The hall during the game

The score comes from the model, never from counting in the 3D scene. The hall shows the same shift.
**Everything the player chose must be visible; everything else may be scenery.**

- Doors not in the plan are down, without cages, staff or lamp. Door screens and cage boards show the
  city from the plan and change when a dock switches city.
- 0, 1 or 2 people at a dock (one person picks and loads alone).
- As many robots drive as the plan has; the rest stay parked.
- The buffer rack fills and empties with `timeline.buffer`.
- Trucks leave at `timeline.departures`: on time, late, or visibly not full.
- Time is compressed (a shift plays in 30 to 90 seconds at the default speed): one visible parcel stands
  for many. Where an animation cannot keep up, trailers and cages are filled to the timeline.
- Random faults, missorts and no-reads are off in the game. The technician stays at his bench.
- Level 1 shows an almost empty hall with one open door. That is intended.
- Leaving the game restores the free simulation exactly.

## Built later, not now

Leaderboard and the score service on a server (phase 2), the player planning the unloading of inbound
trailers, a share card, a daily shift.

## Phase 2 constraints that shape the code now

- `src/shifts/model/**` imports nothing from `src/ui`, `src/scene`, three.js or the DOM.
- Screens reach the model only through `ScoreService`. `LocalScoreService` waits 5 seconds before it
  answers, like the server will, and the shift's opening (doors, people walking in) plays meanwhile.
- The hall consumes only a `Timeline`.
- `src/shifts/estimate.ts` uses only what the briefing shows.
