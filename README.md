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
 lanes ═╪═╡           sorter loop (284 m, trays)               ╞═══╪ high-bay
 + scan │ ╰────────────────────────────────────────────────────╯   │ storage
 tunnels│  20 station chutes → pickup roller tables                 │ (buffer)
        │  robot floor: robots carry parcels to boxes on pallets    │
        │  ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢   forklift aisle  │
        └──────────────────────────────────────────────────────────┘
                      south wall: 20 dock doors (box trucks)
```

1. **Infeed (west).** Four low lanes, 4 m apart, come through the west wall
   and pass a row of scan tunnels just inside it. They run under the west
   end of the loop into the middle, climb to loop height and, one after the
   other, turn left onto the north straight from the inside at 30°, 6 m
   apart; two land on the beat and two half a beat later, so every tray can
   be filled. Parcels come in
   at a set rate; when that is more than the lanes take, they queue at the
   hold points after the tunnels (and outside).
2. **Sorter loop.** A rounded rectangle of trays. Two loop scanners. Every
   parcel carries a Dutch postcode (four digits): about 88% for the 20 largest
   municipalities (north docks), about 12% for the next 20 (robots; fewer while
   their pickup tables fill up), and now and
   then an exception for manual sorting. When its chute is full, a parcel
   goes round again.
3. **Docks (north), doors 1–20.** Each dock serves one city. Its chute drops
   onto a roller belt; five roll cages stand round the belt end, each for
   part of the city's postcodes (on its board). The flow projector shows the
   parcel's postcode on it and the worker walks it to the right cage. Full
   cages are pushed into the trailer. At a cleardown the amber lamp flashes,
   the worker pushes the remaining cages in, the truck leaves, and the worker
   pulls empty cages out of the next truck.
4. **Robots (south).** 20 chutes end at long pickup roller tables. A robot
   takes a parcel (the projector shows its postcode), drives to the box for
   that postcode (two boxes per city, doors 21–40), tips it in, and parks.
5. **Boxes and trucks (south wall).** When a box is full, a forklift takes it
   into the truck at its city's door and brings it back empty.
   Above every door a screen shows the door number, city, postcodes and what
   the truck is doing.
6. **Buffer store (east).** A high-bay rack against the east wall, empty at
   the start. When a parcel's chute is full it goes up the lift into the rack
   instead of going round again; once that chute has room it comes back out
   onto the loop (oldest first). Only when the rack is full do parcels go
   round, and after 3 rounds to manual sorting.
7. Around it: robot parking in one block at the west end, manual sorting
   at the east end (robots bring the exceptions to a drop; a belt
   takes them to the table; a worker puts them in pigeonholes), the control
   room with a video wall (live plan: chute fill, cleardowns, trucks, robots,
   infeed queue), computing racks, forklifts, signs.

8. Life: people walking their rounds, a ride-on scrubber, a reach truck at
   the rack, a forklift charging station, live screens with the hub's
   numbers, wall clocks, exit signs, extinguishers, a break area.
9. At night: a crowd of 520 dancing inside the loop on an LED dance floor, a DJ on the mezzanine, laser fans, mirror-ball spots, dancing
   dock workers and confetti when the groove drops in.

Everything moves on the beat of the music: belts move 2 m per beat, parcels
are diverted on beats, robots move one cell per beat, forklifts and workers
do one move per beat.

## Logistics

- **Hub time** starts at 18:00; a beat is 15 seconds of hub time.
- **Departures:** every door has a truck leaving every hour (the doors' times are spread over the hour). The cleardown starts 6 minutes before; a truck also leaves early when it is full by volume, weight or places. A departure more than 2 minutes after its cutoff counts as late.
- **Destinations** are weighted by inhabitants (rounded, about 2024); within a city the postcodes are equally likely.
- **Sorter:** a parcel longer than a tray takes two trays. The scan tunnel measures and weighs every parcel (and the volumetric weight, L×W×H/5000); too big or too heavy goes to manual sorting, as do labels that cannot be read (about 2%, of which the loop scanners still read some) and parcels whose chute stayed full for 3 rounds. Now and then a parcel lands in the next dock chute (a missort): the worker puts it in the return tote and it goes back to the infeed.
- **Fill by volume:** roll cages, boxes and trailers are full by volume (or weight, or places), not by count. Dock belts are full when the parcels reach back about 4 m.
- **Figures** (button in the Hub group): parcels in and out per hour, dwell time, recirculation, no-reads, to manual, missorts, chutes full, robots busy, infeed queue, trucks on time, load factor; a chart, the last departures, and a CSV download of the timeline and all departures.

## As an app

Sort sim is a progressive web app: install it from the browser (the **Install app** button, or on iPhone/iPad Share → Add to Home Screen) and it opens in its own window, full screen, and works offline (a service worker keeps every file). A new version shows an **Update** prompt instead of interrupting the hall. While it is on screen it keeps the screen awake; the music can be played and paused from the lock screen and media keys. **Full screen** button or key `Z`; `Space` pauses the whole simulation. Shortcuts from the app icon: night party, truck docks, control room, walk around.

## Controls

| Control | Keys |
|---|---|
| Go to a department | `1`–`9`, `0` |
| Camera: Auto / Fly / Follow a parcel | `A` / `F` / `P` (next parcel) |
| Walk around on foot | `V`, then `W A S D` / arrows, drag to look, `Shift` run, `Esc` stop; touch: left thumb walks, right thumb looks |
| Time: Day / Night / Day ↔ night cycle | `D` / `N` / `C` |
| Belt speed: 1.7 / 3.3 / 6.7 / 13.3 m/s | `[` / `]` |
| Hub: parcels per minute (slider), Cleardown… (pick doors 1–40, start) | buttons (`?rate=`) |
| Sound on/off | `M` |
| Hide the controls | `H` |
| Quality: Low / Normal / High / Ultra | buttons (`?quality=`) |

Click or tap a parcel to see its shipping label (a made-up recipient, with a common Dutch surname and random initials, at a real street in the parcel's city; postcode letters and house number are random) and to follow it. Drag (mouse) or swipe (touch) on the hall to look around; ten seconds after the last swipe the camera turns back to its own view. On touch screens the bar only comes up with the **☰ Menu** button (top right), so swiping never opens it by accident.

The music follows the parcels per minute: its tempo moves (3 BPM per bar) between 60 BPM at the lowest rate and 160 BPM at the highest, and its style with it, four of them: ambient with warm pads below 82 BPM, deep (thin pads, soft beat) up to 112, pounding house (claps, open hats, off-beat bass, chord stabs, no pads) up to 136, and acid techno above. The whole hall runs on the beat, so it speeds up and slows down with the music.

The control bar hides after three seconds without mouse movement, a tap or a key (also when the pointer rests on it); move the mouse or tap to bring it back.

URL parameters: `?time=day|night|cycle`, `?camera=auto|fly|follow|walk`,
`?speed=0.5|1|2|4`, `?rate=<parcels per minute>`, `?dept=<id>` (e.g. `docks`, `boxes`, `loop`, `store`), `?mute=1`, `?ui=0`
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
