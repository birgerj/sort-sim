# AGENTS.md — working on Sort sim

Read this before changing code. README.md describes the hall and the controls.

## Ground rules

- **No brand or product names anywhere** (scene textures, signs, code
  comments, docs, commit messages). Signs use generic words: Scanning,
  Sorting, Monitoring, Computing, Robot sorting, Parking, Manual sorting.
- **Two looks, one scene.** Day is clean production: light hall, black
  outlines, flat illustration colours, projectors only throw their working
  beam, people work. Night is a secret party: dark hall, bloom, fog, laser
  show from the projectors, robot underglow, moving heads, dancing workers.
  Every new object needs a day *and* a night appearance (see "Theme").
- **Everything on the beat.** Motion is timed in beats (`bt`, continuous),
  not seconds. Belts move `BEAT_M` = 2 m per beat; loop positions where
  things happen (inducts, diverts, chutes) are even metres so they land on
  beats. New moving things should do one move per beat, or a whole number
  of beats per move.
- **Projectors** hang above chute ends and roller belts only — never above
  the robots' boxes.
- Day palette (keep to it; add colours in the same flat style): see `DAY` in
  `src/scene/sorter.ts` — light greys, teal `#2fa58f` (sorter, cages),
  orange `#f2a51a` (scan tunnels), purple `#6b3fd1` (monitoring), magenta
  `#d6339a` (computing), yellow `#f2c200` (safety, workers), red `#e2231a`
  (column feet, sprinklers), ink `#1d1d1f` outlines, blue `#1755fe` accents.
- Verify visually: `npm run build && npm run shots -- <dept ids>` and look at
  the PNGs, by day and by night. Typecheck and tests must pass.
- Write in plain English; comments explain *why* and *what it represents*.

## File map

| File | What |
|---|---|
| `src/main.ts` | Wires scene + music + HUD; URL parameters; frame loop; time of day (`tod` 0 day … 1 night). Exposes `window.sortsim` for the console and the screenshot script. |
| `src/ui/hud.ts`, `src/ui/style.css` | Start screen, caption, control bar (departments, camera, time, sound), keys, auto-hide, settings in localStorage (`sortsim.settings`). |
| `src/audio/composer.ts` | The song as data: seeded, pure, testable. D minor, 32-bar form (intro / groove / breakdown), four styles by `mood`: ambient, deep, house, acid techno. |
| `src/audio/music.ts` | WebAudio synths and the clock; the tempo can change bar by bar (`setTempo`, 60–160 BPM, `bars` map), and the composer's mood follows it. The clock runs without sound too. `frame()` returns beats, drum envelopes, chord colours and the notes that just sounded (latency-compensated). |
| `src/scene/types.ts` | `SceneInput` (what the scene gets every frame) and control types. |
| `src/scene/sorter.ts` | The `Sorter` scene: renderer, post-processing, hall, infeed, loop, chutes, store and lift, parcels, club (night), day scenery, camera and tour. Owns the kit (`box`, `std`, `put`, `inkify`, `person`, `sign`) that the other scene modules use. |
| `src/scene/floor.ts` | `RobotFloor`: pickup stations, boxes on pallets, robots, flow projectors (all of them, including over the dock belts), manual sort table, floor details. |
| `src/scene/docks.ts` | `Docks`: north dock doors, five roll cages per dock (one postcode range each) and the dock workers. A worker plans jobs as steps of whole beats: sort a parcel, push a full cage into the trailer, at cleardown push all cages in, pull empty cages out of a new truck. Day and night alike; idle at night they dance. Also `buildDockDoor`. |
| `src/sim/kpi.ts` | `Kpi`: hub figures counted as things happen, sampled every 5 minutes of hub time; departures; `csv()`. The scene owns one (`scene.kpi`), hub time is `scene.hubTime()`. |
| `src/sim/addresses.ts` | Made-up recipients for the labels (common surnames, random initials, real streets per city). |
| `src/sim/postcodes.ts` | The 40 destinations (largest Dutch municipalities) with their four-digit postcode ranges; `split` into cage/box ranges; `randomPostcode(rnd, south)` (the sorter asks about 12% south, less while the pickup tables fill up). |
| `src/scene/labels.ts` | `Labels`: many signs with different text in one draw call (canvas atlas + instanced planes): cage boards, door screens, projected postcodes. Each atlas layout needs its own shader cache key. |
| `src/scene/batch.ts` | `Batcher`: models are built from proxy objects; one `InstancedMesh` per geometry+material, matrices copied every frame (`kit.batch`). Robots, people, forklifts, cages and trailers use it. |
| `src/scene/trucks.ts` | `Trucks`: a trailer behind every dock door, and a screen above it. Full (2 cages / 4 boxes) or by hand (`cleardown`) → cleardown (amber lamp flashes; waits while `hold()` says the workers are still loading) → door down → truck leaves → new empty truck → door up. |
| `src/scene/manualSort.ts` | `ManualSort`: robots tip envelopes into a hopper west of row 2; a roller belt takes them to the table; a worker puts them in pigeonholes and empties full ones into the crates. Day only, few parcels. |
| `src/scene/boxYard.ts` | `BoxYard`: south dock doors and the forklifts that swap full boxes. Keyframes of whole beats. |
| `src/scene/forklift.ts` | Forklift with driver (forks point to local +z); parts merged per material. |
| `src/scene/people.ts` | `buildHuman`: jointed people (workers with hi-vis vest and helmet, staff with cap). |
| `src/scene/post.ts` | `InkPass` (screen-space outlines), `toonify`/`TOON` (flat day shading), blob texture. |
| `src/scene/screens.ts` | Live canvases: dashboard, wall KPI boards, clocks (real time). Fed by `HubStats` from the scene. |
| `src/scene/life.ts` | Walkers (day), ride-on scrubber, charging station, exit signs, extinguishers, first aid, walkway, break area, floor zone names. |
| `src/scene/crowd.ts` | Night crowd inside the loop (instanced body parts, a few draw calls for 520 dancers) on an LED tile floor. |
| `src/ui/walk.ts` | Walk-mode input: keyboard, mouse drag, touch stick and look; feeds `Sorter.walkInput`. |
| `src/scene/party.ts` | Night party: DJ booth on the mezzanine, laser fans, mirror-ball floor spots, confetti on the drop. |
| `src/scene/textures.ts` | Generated, cached textures: cardboard, pallet wood, wire mesh, sectional door, checker plate, hi-vis, day floor and wall cladding, brushed steel. |
| `src/sim/robotFleet.ts` | Robot routing without drawing: grid, one-way lanes, BFS, reservations, detours. `FLOOR` sets the robot floor size. Tested. |
| `src/sim/rng.ts` | Seeded random numbers. |
| `scripts/shots.mjs` | Headless screenshots per department, day and night. |

## Two clocks

- `bt`: the music's beats. Robots, workers, forklifts, the lift and shuttles,
  lights and the camera run on it.
- `ct`: the conveyor clock, `bt × speed` (`BELT_SPEEDS` 0.5, 1, 2, 4; set by
  `setBeltSpeed`). Lanes, the loop, trays, chutes and dock belts are timed in
  it, so all `Parcel.t0/t1/tIn/divertAt` in `path` and `loop` mode are `ct`
  values. `onConveyorBeat` spawns parcels per conveyor beat. Speeds are
  powers of two so diverts still land on 8th/16th notes.

## How a parcel travels

`Parcel.mode` in `sorter.ts` says who moves it:

`path` (along a `Path`: `pathKind` lane → loop, chute, dock belt, intake, back)
→ `loop` (on a tray) → divert into a chute → `path` (chute) → then one of:

- dock chute → `path` (`pathKind: 'dock'`, the roller belt) → `dock` (owned
  by `Docks`: queue, worker) → `held` in its cage (it keeps its shape and
  colour and rides along) → the cage goes into the trailer and the parcel
  leaves with the truck. Dock belts bank parcels up nose to tail by length
  (`limit`, `Docks.depth`), as do pickup tables and the infeed hold points;
- station chute → `table` (queue at a pickup station) → `robot` (rides a
  robot; `dropAt` tips it into the box) → `held` in the box → a forklift takes
  the box into a truck (`RobotFloor.onEmptied`); small envelopes (by day, west stations) go to the
  manual drop instead → `manual` (owned by `ManualSort`);
- destination full (`room()`): the parcel stays on its tray and goes round
  the loop again (`laps`).
- store: `path` (intake) → `queue` → `carriage` (lift) → `shuttle` → `fixed`
  (in the rack) → back out via `tween`/`carriage` → `path` (`back`) → loop.

`pathEnd()` hands parcels from one stage to the next. Parcels are drawn as
one `InstancedMesh` (`writeParcels`), with an inverted-hull outline by day.

## Layout constants (sorter.ts, top)

- Loop: rounded rectangle, `LOOP_LEN` 284 m (`LOOP_ZH` 8.5), `LOOP_R` corner radius,
  `LOOP_ZH` half depth, `LX` start x of the north straight. `loopAt(s)` gives
  position and direction; `s` runs east along the north side. Section
  starts are in the comment above `INDUCT`.
- `CHUTES`: 20 dock chutes (s 4…118) and 20 station chutes (s 144…258), 6 m
  apart. Infeeds: `INDUCT` (four join points on the west end, from the
  outside, s 268, 272, 276, 280; `LANE_PHASE` lands lanes 1 and 3 half a beat
  later so they fill the odd trays; one parcel per lane per beat; `LANE_Z`;
  the belt reaches over the tray edge, so there is no gap), `HOLD_S` (queue point), `LANE_QUEUE`.
  Pickup tables: `STATION_TABLE` (floor.ts) long, `STATION_CAP` parcels. `DOCK_X` = dock positions (straight north of each chute end).
- Hall: `WX`/`EX` west/east wall, `HZ` half depth, `HH` height; `HCX`/`HW`
  centre and width.
- Store: `STORE_DX` puts the rack against the east wall (no aisle behind it).
  It is a buffer: `buffer(p)` when a chute is full (sets `p.buffered`),
  `requestRetrieve()` every bar calls the oldest back whose chute has room.
- Robot floor: `FLOOR` in `robotFleet.ts` (x0, z0, cell size, columns, rows).
  Boxes are in the last row (every other column). All parking is one block
  at the west end (`PARK_COLS` columns, rows 0, 2, 3, 6; columns 0 and 1 are
  the aisles in and out). The manual-sort drop is at the east end, the table
  east of it (`TABLE` in `floor.ts`). Run
  `npm test` after any change.
- South aisle: `AISLE_Z` in `boxYard.ts`; doors and forklift count there.

## Rendering

- **Ink outlines** are a screen effect (`InkPass` in `post.ts`): the scene is
  drawn once more with normals and depth, and edges are inked where normals
  turn or depth jumps. Day only. Objects get no outline when they are lines,
  points, additive or see-through, or have `userData.noInk = true`; call
  `ink.refresh()` after adding objects at runtime. `inkify()` and
  `outline()` are now no-ops kept as hooks.
- **Toon shading** by day: `toonify(material)` rounds light to three steps;
  every `std()`/themed material has it; `TOON.value` follows the day amount.
- **Contact shadows:** `blob(x, z, w, d)` (static, batched) and
  `blobUnder(object, w, d)` (moves with it).
- **Quality** (`setQuality`, HUD, `?quality=`): `low` (pixel ratio 1),
  `normal` (1.5), `high` (2, plus GTAO, sun shadows from `keyLight` with a
  shadow box that follows the camera, an additive mirror floor at night and
  depth of field while following a parcel). `ultra` (laptops/desktops): at least 2× pixel ratio (supersampling), 4096 shadow map over a ±55 m box, more GTAO samples. The ink pass scales its line width with the pixel ratio. Shadow casting is set once for
  all standard-material meshes in `setupShadows()`.

## Theme (day / night)

- `std(color, rough, metal, day?)` makes a `MeshStandardMaterial` with a
  night colour and an optional day colour; `applyTheme()` lerps all of them.
- `put(obj, only?)` adds to the scene; with `only = 'day' | 'night'` (or
  `kit.only` set while building) the object shows in one look only.
- `inkify(mesh)` adds the black day outline (edges, day only).
- `outline(mesh, width)` adds a day outline for rounded shapes (an inverted
  hull pushed out along the normals); use it for capsules, spheres and
  rounded boxes, where `inkify` would miss the silhouette.
- `box(key, mat, x, y, z, sx, sy, sz)` adds a box to an instanced batch per
  key+material, flushed with `flushBoxes()`: use it for static clutter.
- Night lights are `MeshBasicMaterial` with colours above 1 so bloom picks
  them up. By day, tone mapping is off and walls are flat basic materials.

## Next step: nicer, more detailed graphics

The scene is built so models can be upgraded one at a time without touching
the simulation:

- **Done so far (detail pass 1):** robots, forklifts (with driver),
  people, boxes on pallets, roll cages (wire mesh), dock doors (sectional
  doors, checker plate, seals, lights), day floor and wall cladding.
  Pass 2: belts (guide rails, drive motors, feet), loop (tilt trays with
  lips, drive units, cable tray), brushed chutes, scan tunnels (rounded
  shell, camera pods, light stack, vents), store rack (bracing, guards,
  cardboard cartons), lift (mast bracing, cable chain, mesh fence),
  projectors (finned housing, yoke, lens).
  Pass 3: framed signs, control room (`buildControlRoom`: window band,
  door, roof plant, railing), monitoring desk (three screens, chair),
  manual sort table (pigeonhole shelf, scale, printer, mat), trolleys
  (mesh sides, casters, handle), rounded parcels, day ceiling (LED
  fixtures, cable trays).
  Pass 4: screen-space ink, toon shading, contact shadows, quality levels
  (AO, sun shadows, mirror floor, depth of field), projector pictures,
  scan lines, wall openings with trailers, walkers and vehicles, live
  screens, safety details, break area, parcel shapes (box, envelope,
  polybag, tube), night party, loop-ride camera.
  Ideas for later: merge robot and people meshes into instanced batches
  (draw calls), animated trailer arrivals, staff shift change at dusk,
  sound effects for the forklifts' horns on the beat.
- **Where each thing is built:** loop/belts/chutes `buildConveyors`, scan
  tunnels `tunnel()`, store and lift `buildStore`, parcels `buildParcels`,
  hall `buildHall` (night) and `buildDay` (day), people `person()`, signs
  `sign()`, robots `RobotFloor.buildRobots`, boxes `buildBins`, projectors
  `buildProjectors`, dock doors `buildDockDoor`, cages `Docks.buildCage`,
  workers `Docks.buildWorker`, forklifts `buildForklift`.
- **Animated models** keep their joints/groups (robot `top`, forklift
  `forks`, worker `torso/armL/armR/legL/legR`, box `g` + `fill`). A
  replacement model must expose the same handles.
- **Textures:** all textures are generated on canvases (`canvasTex`, `tex`).
  To add image textures, put them in `public/` and load with
  `TextureLoader`; keep them small (≤ 512 px, KTX2 if many).
- **GLTF models:** load with `GLTFLoader` into the same groups; use
  `InstancedMesh` for anything repeated (20 docks × 3 cages, 40 boxes, 20
  robots). Watch draw calls: every `inkify` mesh adds a line object.
- **Budget:** aim for 60 fps on a mid-range laptop at quality normal.
  Measured per frame (headless): about 2,600 draw calls by day (scene plus
  the ink pass's normal render), 1,300 by night, about 5,500 at high
  (adds GTAO and the shadow map). Biggest cost: per-robot and per-person
  meshes; instancing them is the next win. Check with
  `sortsim.scene.renderer.info` (set `info.autoReset = false` around a frame).
- Keep the day look's flat colours with black outlines; detail comes from
  shape (bevels, ribs, rollers, bolts, labels), not from noise.

## Gotchas

- `CatmullRomCurve3` breaks on repeated points; `planTour` removes them.
- The first animation frame can have a negative dt; it is clamped.
- Parcels' `pos` is the base of the parcel, not its centre.
- `SceneInput.beats` can jump (tab hidden); the scene re-phases instead of
  replaying beats.
- The long walls are `ShapeGeometry` with holes at open doors; their UVs are
  in metres (textures use per-metre repeat and an offset).
- Toggling shadows (quality high) recompiles all materials once.
- Robots move one grid cell per beat in the fleet, but are drawn half a cell
  behind on Bezier curves through the cell edges (`RobotFloor.updateRobots`),
  so they drive continuously and round corners; they only ease when starting
  or stopping.
- `Reflector` renders the scene again: it exists only at night on high.
