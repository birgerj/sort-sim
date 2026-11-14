# Decisions (coordinator writes; one line each)

- 2026-11-14 Ten fixed levels, no seed; city names follow the country. Currency: Sorty, sign §.
- 2026-11-14 Plan in steps of half an hour, blocks of at least an hour. No door numbers for the player.
- 2026-11-14 Robots: § 11 × shift hours each for the whole shift; no separate price or timing for lines.
- 2026-11-14 Levels 7–10 run a full hall (volumes × 2.3, 3, 2.5, 3 against the first draft).
- 2026-11-14 Level 10: at most 40 people (was 32), so all 20 docks can open.
- 2026-11-14 The planner shows fixed costs and a rough buffer guess only; real figures come with the result.
- 2026-11-14 Skipping the shift stays. The score service answers after 5 seconds (as the server will later).
- 2026-11-14 This build has no unloading plan for the player; unloading runs by itself in every level.
- 2026-11-14 The old night game (seed, drift, moves) is removed once the new game is merged.
- 2026-11-14 Open, for agent B: the price of a parcel left behind (now § 2.50). Aim: in levels 7–10 a plain
  plan that gives every city enough docks still earns one star. Report a value; the coordinator decides.
- 2026-11-14 Open, for agent B: par for every level under the final rules. `levels.json` holds provisional values.
- 2026-11-14 New code lives in `src/shifts`, `src/ui/shifts` and `src/scene/director.ts`; `src/game` is the old game.
- 2026-11-14 An invalid plan makes `ScoreService.run` reject with a plain `PlanProblem[]` (not an Error).
- 2026-11-14 Badge counting: people and docks per minute a block is open; the buffer badge looks at every minute.
- 2026-11-14 For agent B: write arrivals and volumes unrounded in `levels.json`; golden plans must be startable (half-hour grid, no robot cities where robots are off); `fixture.run` should compute the badge.
- 2026-11-14 The game is wired into the app: after the start card the player chooses free simulation or game (`?start=free|game` skips the choice; a department or the demo tour in the address goes to the free simulation). The old night game is removed.
- 2026-11-14 Until the hall's director is merged, a clock-only stand-in (`src/shifts/clockDirector.ts`) plays the shift: the game is fully playable, the hall just keeps running as in the free simulation.
- 2026-11-14 While the game's screens cover the hall, the hall is not drawn (saves the device; it only draws during a shift).
