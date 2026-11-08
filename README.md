# Sort sim

A parcel sorting hub in 3D that moves to its own ambient music. By day it is
clean production; at night the hall throws a secret party: projector laser
shows, robots with underglow, dancing dock workers.

**Live:** https://birgerj.github.io/sort-sim/

Built with three.js, TypeScript and Vite. No assets: every model, texture and
sound is generated in code.

## The hall

```
                      north wall: 20 truck docks
        ┌──────────────────────────────────────────────────────────┐
        │  ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯  roll cages,     │
        │  │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │  workers         │
 west:  │  20 dock chutes + roller belts                            │ east:
 infeed │ ╭────────────────────────────────────────────────────╮   │ lift +
 lanes ═╪═╡           sorter loop (294 m, trays)               ╞═══╪ high-bay
 + scan │ ╰────────────────────────────────────────────────────╯   │ storage
 tunnels│  20 station chutes → pickup roller tables                 │ (buffer)
        │  robot floor: robots carry parcels to boxes on pallets    │
        │  ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢   forklift aisle  │
        └──────────────────────────────────────────────────────────┘
                      south wall: 20 dock doors (box trucks)
```

1. **Infeed (west).** Four lanes (two low, two on a mezzanine) come through
   the wall, pass a scan tunnel and join the west side of the loop at 30°.
2. **Sorter loop.** A rounded rectangle of trays. Two loop scanners. Every
   parcel has a destination: a dock chute, a robot station, or the store.
3. **Docks (north).** 20 chutes drop onto roller belts that end at truck
   docks. A worker takes each parcel off the belt and puts it in one of three
   roll cages; the flow projector above marks which cage.
4. **Robots (south).** 20 chutes end at pickup roller tables. Robots each
   drive their own job: from parking to a station, load a parcel, drive to a
   box, tip it in, then to a free parking spot.
5. **Boxes and trucks (south wall).** When a box is full, a forklift lifts
   it, drives it into a truck behind a dock door and brings it back empty.
6. **Storage (east).** Parcels go up a lift into a high-bay rack (a buffer)
   and come back out onto the loop later.
7. Around it: manual sorting table, control room, monitoring desk, computing
   racks, forklifts, signs.

8. Life: people walking their rounds, a ride-on scrubber, a reach truck at
   the rack, a forklift charging station, live screens with the hub's
   numbers, wall clocks, exit signs, extinguishers, a break area.
9. At night: a crowd of 520 dancing inside the loop on an LED dance floor, a DJ on the mezzanine, laser fans, mirror-ball spots, dancing
   dock workers and confetti when the groove drops in.

Everything moves on the beat of the music: belts move 2 m per beat, parcels
are diverted on beats, robots move one cell per beat, forklifts and workers
do one move per beat.

## Controls

| Control | Keys |
|---|---|
| Go to a department | `1`–`9`, `0` |
| Camera: Auto / Fly / Follow a parcel | `A` / `F` / `P` (next parcel) |
| Walk around on foot | `V`, then `W A S D` / arrows, drag to look, `Shift` run, `Esc` stop; touch: left thumb walks, right thumb looks |
| Time: Day / Night / Day ↔ night cycle | `D` / `N` / `C` |
| Belt speed: 1.7 / 3.3 / 6.7 / 13.3 m/s | `[` / `]` |
| Sound on/off | `M` |
| Hide the controls | `H` |
| Quality: Low / Normal / High / Ultra | buttons (`?quality=`) |

The control bar hides after three seconds without mouse movement, a tap or a key (also when the pointer rests on it); move the mouse or tap to bring it back.

URL parameters: `?time=day|night|cycle`, `?camera=auto|fly|follow|walk`,
`?speed=0.5|1|2|4`, `?dept=<id>` (e.g. `docks`, `boxes`, `loop`, `store`), `?mute=1`, `?ui=0`
(no controls: for recordings), `?quality=low|high`.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # robot fleet routing, composer
npm run build      # typecheck + production build into dist/
npm run shots      # screenshots of every department, day and night, into shots/
```

`npm run shots` needs Playwright with Chromium (`npm i -D playwright && npx
playwright install chromium`); it runs `vite preview` on `dist/`, so build
first. Pass department ids to limit it: `npm run shots -- docks boxes`.

Deploys to GitHub Pages from `main` (`.github/workflows/pages.yml`).

For the architecture and how to extend it, see [AGENTS.md](AGENTS.md).
