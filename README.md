# Sort sim

A parcel sorting hub in 3D that moves to its own ambient music. By day it is
clean production; at night the hall throws a secret party: projector laser
shows, robots with underglow, dancing dock workers.

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

0. **Inbound wing (north-west).** An extension of the hall to the north, its west wall in
   line with the hall's, about 40 × 14 m, with
   ten dock doors (41–50) in its north wall. A truck stands at each; when its door
   opens, its load is there as real parcels stacked on the trailer floor. A telescopic
   conveyor reaches into the trailer up to the stack, and an unloader takes the parcels
   off one at a time (about 1,000 an hour each; a second unloader
   joins when the rate needs more). The telescopes run onto five collector belts, two doors
   each (41–42, 43–44, 45–46, 47–48, 49–50), each the start of one infeed lane, centred
   over the lanes.
   An empty truck leaves and a full one backs in. The video wall in the control room
   shows the wing, the lanes and the inbound trucks (it grew taller; the plan kept its
   scale). The **canteen** and the **office** are rooms on the first floor outside the hall,
   against the west wall where it looks out over the loop's west end: from the hall you see
   their windows (the office: two planners at their computers; the canteen, 32 m long:
   tables, lockers, a counter with coffee, plants, people on their break) and their doors
   onto a balcony hung on the wall, with a stair down along the wall at its north end. The
   manager's walkway inside the loop has black/yellow taped edges, with (in Day) a worn floor
   coating only just greener than the concrete. More walkways: from the canteen stair down the west
   wall, under the loop's west end, to the corridor south of the loop, and an aisle along the north
   docks between the roll cages and the doors. The dock projectors show each waiting parcel's
   roll cage (1–6, from the cage by the belt on its west side, clockwise; the cage cards carry the
   number too) with a soft beam onto it. **Ride a robot** stays with one robot, pickup after pickup. The old break area by the robots is gone; its coffee
   machine and vending machine stay.
1. **Infeed (north-west).** Five lanes, 4 m apart, start at the collectors in
   the inbound wing, each through a scan tunnel, then a buffer (where parcels
   queue), sideways to its place, then up a ramp to loop height and, one
   after the other, turn left onto the north straight from the outside at
   30°, 4 m apart, before the loop scanner and the first dock chute. Three land
   on the beat and two half a beat later, so every tray can be filled (four
   lanes already fill every tray at the top rate; the fifth shares the load). A maintenance walkway with
   a stair runs along the lanes. The loop now runs almost to the west wall;
   inside its west end is a maintenance platform (the DJ's at night). Parcels come in
   at a set rate; when that is more than the lanes take, they queue at the
   buffers after the tunnels (and outside).
2. **Sorter loop.** A rounded rectangle of trays. Two loop scanners. Every
   parcel carries a postcode of the chosen country: about 88% for the largest
   municipalities (north docks), about 12% for the next 20 (robots; fewer while
   their pickup tables fill up), and now and
   then an exception for manual sorting. When its chute is full, a parcel
   goes round again.
3. **Docks (north), doors 1–20.** Each dock serves one city. The 20 doors are
   shared out by volume (post in proportion to inhabitants): every city at the
   docks gets at least one, the rest go one by one to the city with the most
   post per door, and the number of cities at the docks is chosen so the post
   per door is as even as possible, with at most four doors per city (the
   Netherlands: 12 cities, Amsterdam 4
   doors, Rotterdam and The Hague 3, Utrecht 2). A city's doors sit side by
   side, with the same postcodes, and take turns, also at cleardown: a city
   with four doors has a truck leaving every 15 minutes, door after door.
   Inhabitants come from the national statistics offices (via the Wikipedia
   lists; NL 2024, BE 2025, FR 2023, DE 2021, FI 2025, SE 2025, MD 2024 census,
   IN 2011 census, AU 2025 urban areas). Its chute drops onto a roller belt; six roll cages stand
   round the belt end, each for part of the city's postcodes (on its cards).
   The flow projector shows the postcodes of the first three parcels and the
   picker walks each to the right cage. As soon as a cage is full, a loader
   takes it away and brings an empty one from the stack by the door: straight
   into the truck (ten fit in a trailer), or, while there is no truck, to a
   waiting place by the door, from where it goes in when the next truck is
   there. At a cleardown the amber lamp flashes, the loader pushes every cage
   with parcels in, and the truck leaves.
4. **Robots (south).** 20 chutes end at long pickup roller tables. A robot
   takes a parcel (the projector shows its postcode), drives to the box for
   that postcode (two boxes per city, doors 21–40), tips it in, and parks.
5. **Boxes and trucks (south wall).** When a box is full, a forklift takes it
   into the truck at its city's door and brings it back empty.
   Above every door a screen shows the door number, city, postcodes, how
   full the roll cages (north) or the truck (south) are, and what
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
   numbers, wall clocks, exit signs, extinguishers, a coffee machine and a vending machine (breaks are in the canteen).
   **Faults:** now and then a dock chute goes down (a blocked photo eye, a
   tripped belt drive, a parcel jammed at the exit). Its signal towers flash
   red, its display says what is wrong, the video wall marks it, and the sorter
   sends nothing more down it. The technician leaves his workbench under the
   maintenance platform, rides a stand-up scooter along the inside of the
   loop, ducks under it beside the chute and works on the photo eye with his
   toolbox for a few bars; then the towers flash green and the chute runs
   again. He takes faults one after the other, oldest first. **Go to → Technician**
   rides along behind him (the fly tour only stops there while a chute is down).
9. At night: a crowd of 520 dancing inside the loop on an LED dance floor, a DJ on the mezzanine, laser fans, mirror-ball spots, dancing
   dock workers and confetti when the groove drops in.

Everything moves on the beat of the music: belts move 2 m per beat, parcels
are diverted on beats, robots move one cell per beat, forklifts and workers
do one move per beat.

## Easter eggs

Little jokes for those who look closely, or tap things:

- **Dock 6** has a picker who does not walk: he throws the parcels into the
  cages. Except fragile ones: those he carries over on tiptoe.
- **Dock 3**'s picker wears headphones and nods along while working, with a
  little dance when idle. Tap him and he is caught: stock-still, then very busy.
- Now and then a **Mexican wave** runs along the docks, a loader nearly trips
  on a longer walk, a missort earns a facepalm, and after a cleardown the
  loader stretches. When the music turns to acid techno, someone plays air
  guitar.
- A **rubber duck** comes through very rarely (for the developer; it quacks
  when tapped). A parcel on its third round of the loop turns a little green
  and sways.
- A parcel with **little legs** sometimes jumps off a pickup table and makes a
  run for it, until someone catches it and carries it back.
- A **ginger cat** sleeps in odd places (a break-area chair, the pallet stack,
  the cardboard bale, a bin lid) and wanders between them. Tap it and it bolts.
- In the break area someone is on the phone, pacing, and takes selfies.
  Walkers passing each other give a **high five** (and sometimes miss). Tap the
  **coffee machine** and people nearby come over for a coffee.
- The cleaner sometimes draws a **heart** on the floor inside the loop with
  the scrubber; it dries up after a while.
- Someone hides behind the pigeonholes at **manual sorting** and peeks out at
  the camera.
- **Taps:** a person waves (once), bows (twice) or does a cartwheel (three
  times in a row). A forklift honks a note of the chord that is playing; keep
  tapping for a riff. A parked robot does a pirouette; on the third tap it
  sulks off. Parked robots also spin now and then when they are bored.
- **At night:** a conga line winds round the DJ's end of the dance floor every
  24 bars; tap the DJ for an airhorn and an extra load of confetti.

## Logistics

- **Hub time** starts at 18:00; a beat is 15 seconds of hub time.
- **Departures:** a roll-cage door has a truck leaving every 4 hours of hub time, a box door every 2 hours; the doors of one city take turns (Amsterdam: one of its four every hour), and the cities are spread over that time. The cleardown starts 6 minutes before; a truck also leaves early when it is full by volume, weight or places. A departure more than 2 minutes after its cutoff counts as late.
- **Christmas** (Settings, `?xmas=1`): trees with baubles, lights and presents, garlands along the walls, light strings under the roof and along the loop (twinkling on the beat), wreaths on the dock doors, giant candy canes, hanging stars, snowflakes on the floor, presents among the parcels, Christmas hats, Father Christmas walking round, decorated forklifts, a Christmas market (hot-chocolate stall, nativity stable), sleigh bells and bells in the music, and a countdown on the wall boards.
- **Country** (Settings): the Netherlands, Belgium, France, Germany, Finland, Sweden, Moldova, India or Australia; by default from the browser's language. Its 40 largest towns or municipalities (with their postcode ranges) are the 40 destinations; names, streets and address format follow the country.
- **Destinations** are weighted by inhabitants (rounded, about 2024); within a city the postcodes are equally likely.
- **Sorter:** a parcel longer than a tray takes two trays. The scan tunnel measures and weighs every parcel (and the volumetric weight, L×W×H/5000); too big or too heavy goes to manual sorting, as do labels that cannot be read (about 2%, of which the loop scanners still read some) and parcels whose chute stayed full for 3 rounds. Now and then a parcel lands in the next dock chute (a missort): the worker puts it in the return tote and it goes back to the infeed.
- **Faults:** about one an hour of hub time (at least 24 minutes apart), at most two chutes down at once; a chute is down from the fault until the technician has finished (riding there, then 3 minutes of work). The **Fault** button (Hub) takes a dock chute down now; `?faults=0` switches the random ones off. Figures count them.
- **Fill by volume:** roll cages, boxes and trailers are full by volume (or weight, or places), not by count. Dock belts are full when the parcels reach back about 4 m.
- **Figures** (button in the Hub group): parcels in and out per hour, dwell time, recirculation, no-reads, to manual, missorts, chutes full, robots busy, infeed queue, trucks on time, load factor; a chart, the last departures, and a CSV download of the timeline and all departures.

## As an app

Sort sim is a progressive web app: install it from the browser (the **Install app** button, or on iPhone/iPad Share → Add to Home Screen) and it opens in its own window, full screen, and works offline (a service worker keeps every file). A new version shows an **Update** prompt instead of interrupting the hall. While it is on screen it keeps the screen awake; the music can be played and paused from the lock screen and media keys. **Full screen** button or key `Z`; `Space` pauses the whole simulation (you can still walk, fly and look around). Shortcuts from the app icon: night party, truck docks, control room, walk around.

## Controls

The menu is a dock of tabs at the bottom, the same on phones and desktops: **Go to**, **Camera**, **Hub**, **Night** (only while the night look is on) and **More**. Tapping a tab opens its panel above the dock; tap it again, the ✕, the hall or `Esc` to close it.

| Control | Keys |
|---|---|
| Go to a department | `1`–`9`, `0` |
| Camera: Auto / Fly / Follow a parcel | `A` / `F` / `P` (next parcel) |
| Walk and fly | `V`, then `W A S D` / arrows, drag to look, `Shift` run (fly faster), `E` / `Q` or `PgUp` / `PgDn` up and down, `Esc` stop; touch: a stick under the left thumb (at its edge you run), drag on the right half to look, hold **Up** / **Down** at the right edge. Climbing from the floor is flying, coming down to it is walking; **Walk / Fly** at the top lands or takes off. Keep climbing and you fly up through the roof (hidden from above, with everything hung under it) until the whole floor fits on screen; look straight down. **Go to → Top down** goes there at once; there, scroll or pinch to zoom in on the floor under the pointer, and drag to move along. The menu stays usable |
| Time: Day / Night (in Settings) | `D` / `N` |
| Belt speed: 1.7 / 3.3 / 6.7 / 13.3 m/s | `[` / `]` |
| Hub: parcels per minute (slider), Cleardown… (pick doors 1–40, start), Fault (a dock chute goes down now) | buttons (`?rate=`, `?faults=0`) |
| Sound on/off and volume (in Settings) | `M` |
| Hide the controls | `H` |
| Product info (demo): a card describing the product behind each tour stop; the tour only visits stops with a card and waits until it is read, with Pause and Next stop | Only with `?pv=true` in the address; then More › Product info (`?info=0\|1`) |
| Night tab (only at night): presets Party / Calm / Dark, how brightly parcels glow, and on/off for crowd, DJ, lasers, mirror ball, confetti, projector show, robot glow, dancing, haze, strobes and bloom; remembered | button (`?night=party\|calm\|dark`) |
| More: time of day, sound, graphics quality (Low / Normal / High / Ultra), Christmas, country, install, full screen, hide controls | tab (`?quality=`, `?country=nl\|be\|fr\|de\|fi\|se\|md\|in\|au`) |

Click or tap a robot, forklift or person to follow it with the camera. Everyone with a job in the hall (pickers, loaders, the technician, the manual sorter, forklift drivers) has a name from the chosen country; tap one for their staff card: job, door, on shift since, and how long they have worked and waited. **Hub → Figures** lists the whole staff with their share of time working and waiting (tap a name to follow them). Click or tap a parcel to see its shipping label (a made-up recipient: a common surname of the country with a first name, or initials in the Netherlands, at a street in the parcel's town, real ones in the Netherlands; written the way that country writes addresses) and to follow it. Drag (mouse) or swipe (touch) on the hall to look around; ten seconds after the last swipe the camera turns back to its own view. While following someone or something (a person, robot, forklift, parcel, or a moving stop such as the technician), a drag or swipe turns the camera around it instead: sideways to go round, up and down to look from higher or lower. Pinch (touch) or scroll (mouse wheel, trackpad) to zoom in or out on it. It stays turned and zoomed until you follow something else.

The music follows the parcels per minute: its tempo moves (3 BPM per bar) between 60 BPM at the lowest rate and 160 BPM at the highest, and its style with it, four of them: ambient with warm pads below 82 BPM, deep (thin pads, soft beat) up to 112, pounding house (claps, open hats, off-beat bass, chord stabs, no pads) up to 136, and acid techno above. The whole hall runs on the beat, so it speeds up and slows down with the music.

With a mouse, the dock fades after three seconds without movement or a key and comes back when the mouse moves; on touch screens it stays. **Hide controls** (More, or key `H`) hides everything; click or tap the hall to bring it back.

URL parameters: `?time=day|night`, `?look=minimal|real` (the day as a drawing or lit like a photo), `?camera=auto|fly|follow|walk`,
`?speed=0.5|1|2|4`, `?rate=<parcels per minute>`, `?faults=0` (no random faults), `?dept=<id>` (e.g. `docks`, `boxes`, `loop`, `store`), `?mute=1`, `?ui=0`
(no controls: for recordings), `?quality=low|high`, `?night=party|calm|dark`.

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

While the repo is public, `main` also deploys to GitHub Pages
(https://birgerj.github.io/sort-sim/). Every push builds a zip of the static site (`.github/workflows/build.yml`):
open the run under Actions and download the `sort-sim-<commit>` artifact. Unzip
it into any folder on any static web server; paths are relative, so a subfolder
works too. Offline mode (service worker) needs HTTPS or localhost. Push a tag
`v*` to also attach the zip to a GitHub Release.

For the architecture and how to extend it, see [AGENTS.md](AGENTS.md).
