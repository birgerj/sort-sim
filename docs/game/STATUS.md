# Status

Each agent keeps its own section up to date in its own branch: done, doing, blocked.

## Coordinator
- Done: contract, level data, fixtures, mocks, plan.

## A · model

## B · balance

## C1 · screens

## C2 · planner

## D · hall
- Done: (a) `src/sim/shiftSchedule.ts`, pure and tested in `tests/shiftsDirector.test.ts` (door states per minute,
  parcels per door, trailer swaps, late and incomplete trucks, robot cities, events); (b) `enter` / `exit`;
  (c) doors, staff, cage cards, door screens and pillar displays per block, signs changing in the 15-minute switch;
  (d) departures: on time, late (amber lamp from the truck time, red screen), incomplete (trailer not full, cages
  with the parcels left behind stay at the closed door, count on the screen), robot cities from a south door;
  (e) fleet size (`Fleet.limit`); (f) buffer rack from `timeline.buffer`; (g) parcel flow: parcels ride the loop
  until the director sends them to an open dock or a robot station, belts short while a dock keeps up and full
  (chute lamp red) from 85 % of its pace. `enter` may be called again without `exit` (every attempt); `skip`
  before or after the first frame ends the shift once. `scripts/directorShots.mjs` plays the fixture and a
  made-up busy shift and checks both.
- Rough, not done ((h) polish): people appear at their place when a dock opens (nobody walks in); a trailer
  swap is the trailer driving off and back in two beats with the door up; cages fill from the timeline and a
  full one is emptied in one go when nobody happens to push it; the nested stacks of empty cages beside every
  door (fixed scenery) stay at doors that are not in the plan; the south side (boxes, forklifts) runs by itself
  apart from the robot cities' departures; at 16× nothing but the signs, fills and doors can keep up.
- File-map lines for AGENTS.md:
  - `src/sim/shiftSchedule.ts` | Ten Shifts: a `Timeline` turned into what the hall shows (`buildSchedule`): per
    block a `Stint` (door, signs from, parcels per step shared over a city's open doors by their pace, pressure,
    truck status), robot cities (what loads without an open door), events; `doorAt(schedule, door, minute)`,
    `robotsAt`, `robotRate`, `bufferAt`. Pure, tested in `tests/shiftsDirector.test.ts`.
  - `src/scene/director.ts` | `createDirector(scene)`: plays a shift in the hall. The clock runs in real time,
    the hall changes on whole beats to the schedule's state for that minute. Uses the scene's shift hooks:
    `Sorter.shift` (`ShiftHooks`; null = free simulation), `shiftParts`, `shiftReset`, `shiftSend` (a parcel
    riding the loop goes down a chute), `shiftStockUp`, `shiftClear`, `shiftBuffer`, `shiftSign`;
    `Docks.setDirected` / `directDock` / `directTrailer`; `Trucks.direct` / `want` / `swap` / `showLoad` /
    `say` / `warn` / `freeze` / `label` / `settle`; `Fleet.limit`; `BreakCrew.hold`; `FaultCrew.recall`.
  - `scripts/directorShots.mjs` | Headless screenshots of a played shift (fixture and a made-up busy one) at
    several clock times, day and night; checks `onDone` once, a second `enter`, `skip`, and the hall after `exit`.
  - Parcel flag `spare` (How a parcel travels): during a shift a parcel on the loop has no chute until the
    director sends it (`shiftSend`); a full or closed end makes it spare again (no store, no manual sorting).

## E · test

## Requests
(agent · what you need from whom)
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
