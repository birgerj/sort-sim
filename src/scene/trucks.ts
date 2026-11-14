// Trucks at the dock doors. Each open door has a trailer behind it that fills
// up (roll cages on the north side, boxes on pallets on the south side). When
// it is full there is a cleardown: a warning lamp at the door flashes, nothing
// new goes in, then the door rolls down, the truck pulls away with its load, a
// new empty one backs in and the door rolls up again. All in whole beats.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { FloorKit } from './floor';
import { Labels } from './labels';
import { checkerPlate, checkerPlateNormal, sectionalDoor, sectionalDoorNormal } from './textures';

export type Cargo = 'cage' | 'box';

/**
 * A trailer's rear doors (at local z `end`, the door end, facing `dir`): two leaves, shut across
 * the opening, or swung right round and lying flat against the sides (when it stands at a dock).
 * `shut(true)` closes them for the road.
 */
export function trailerDoors(k: FloorKit, trailer: THREE.Object3D, end: number, dir: number, w: number, h: number, mat: THREE.Material, color: number): (shut: boolean) => void {
  const leafG = new THREE.BoxGeometry(w / 2, h, 0.05);
  const shut: THREE.Object3D[] = [];
  const open: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const a = k.batch(leafG, mat, trailer, color);
    a.position.set((sx * w) / 4, h / 2 + 0.04, end + dir * 0.06);
    shut.push(a);
    const b = k.batch(leafG, mat, trailer, color);
    b.position.set(sx * (w / 2 + 0.08), h / 2 + 0.04, end - (dir * w) / 4);
    b.rotation.y = Math.PI / 2;
    open.push(b);
  }
  return (s: boolean) => {
    for (const o of shut) o.visible = s;
    for (const o of open) o.visible = !s;
  };
}

export interface TruckDoor {
  x: number;
  /** z of the wall, and which way the hall is (+1: hall at +z of the wall). */
  wallZ: number;
  dir: 1 | -1;
  cargo: Cargo;
  /** Door number, destination city and its postcodes, for the screen above the door. */
  number: number;
  city: string;
  pc: string;
  /**
   * During cleardown: still loading, so wait. 2: someone is pushing a cage in or is in the
   * trailer (always waited for); 1: cages that should still go in (waited for a long while); 0: done.
   */
  hold?: () => number;
  /** How full the roll cages at this door are (0–1): shown on its screen instead of the trailer. */
  cages?: () => number;
}

type State = 'open' | 'cleardown' | 'closing' | 'leaving' | 'away' | 'arriving' | 'opening';

interface Dock extends TruckDoor {
  state: State;
  t0: number;
  load: number;
  /** Volume (m³) and weight (kg) on board. */
  vol: number;
  kg: number;
  /** Departure time of this truck (hub minutes), and whether cleardown came because it was full. */
  cutoff: number;
  full: boolean;
  /** Things on their way into this trailer (a forklift, a roll cage): keep the door open. */
  reserved: number;
  door: THREE.Object3D;
  trailer: THREE.Group;
  slots: THREE.Object3D[];
  /** Its rear doors: shut on the road, open against the sides at the dock. */
  doorsShut: (shut: boolean) => void;
  /** What the screen shows now (redrawn when it changes). */
  shown: string;
  /** Set while the shift director runs this door itself (see `Trucks.direct`); null: the free cycle. */
  run: Run | null;
}

/**
 * A door during a shift of the planning game: no timetable and no cleardown of its own. It is
 * up or down as the plan says, its trailer is swapped when the plan's is full, and its screen
 * and lamp say what the director tells them.
 */
interface Run {
  want: 'open' | 'shut';
  lamp: boolean;
  /** A full trailer is being swapped for an empty one: door down, away, back, door up; then loading goes on. */
  cycling: boolean;
  main: string;
  sub: string;
  tone: ScreenTone;
}

/** How a directed door's screen looks: dark (not in use), in use, warning, or bad news. */
export type ScreenTone = 'off' | 'ok' | 'warn' | 'bad';
const TONES: Record<ScreenTone, { bg: string; fg: string; sub: string }> = {
  off: { bg: '#101114', fg: '#4d525b', sub: '#4d525b' },
  ok: { bg: '#101114', fg: '#ffffff', sub: '#5be0a0' },
  warn: { bg: '#3a1f00', fg: '#ffffff', sub: '#ffb020' },
  bad: { bg: '#4a0d0d', fg: '#ffffff', sub: '#ff5a4f' },
};

const L = 12; // trailer length
const W = 3.1;
const H = 3.7;
const DOOR_H = 3.8;
/** Loads a truck is planned for: ten roll cages, or four boxes. */
const CAP: Record<Cargo, number> = { cage: 10, box: 4 };
/** Places in a trailer for cages or boxes, and what it can carry (scaled to the hall). */
const SLOTS: Record<Cargo, number> = { cage: 10, box: 8 };
const TRAILER_M3: Record<Cargo, number> = { cage: 11.5, box: 4.5 };
const TRAILER_KG: Record<Cargo, number> = { cage: 3200, box: 2400 };
/**
 * Minutes of hub time between two departures from the same door: long enough for a
 * trailer of ten roll cages to fill (it leaves earlier when full).
 */
const EVERY: Record<Cargo, number> = { cage: 240, box: 120 };
/** Minutes of hub time before the departure that the cleardown starts. */
const CLEARDOWN_LEAD = 6;
const DUR: Record<Exclude<State, 'open'>, number> = { cleardown: 4, closing: 2, leaving: 4, away: 6, arriving: 4, opening: 2 };
/** Beats a cleardown waits for cages still to go in, and at most for anything. */
const WAIT_CAGES = 480;
const WAIT_MAX = 2000;
const NEXT: Record<Exclude<State, 'open'>, State> = { cleardown: 'closing', closing: 'leaving', leaving: 'away', away: 'arriving', arriving: 'opening', opening: 'open' };

/** Trailer and cab colours (plain, no liveries). */
const TRUCK_COLS = [0xf3f4f6, 0xe6e9ed, 0x1755fe, 0xe2231a, 0x2fa58f, 0x3a3d44, 0xf2c200, 0x6b3fd1];

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

export class Trucks {
  readonly docks: Dock[] = [];
  /** Cleardown warning lamps, one per door (flashing amber before the door closes). */
  private lamps: THREE.InstancedMesh;
  private readonly c = new THREE.Color();
  /** Hub time (minutes since midnight); set by the scene. */
  clock: () => number = () => 0;
  /** A truck left (for the figures). */
  onDepart: (d: { door: number; city: string; at: number; cutoff: number; load: number; room: number; onTime: boolean; full: boolean }) => void = () => {};
  private scheduled = false;
  /** Sounds since the last frame (the cleardown buzzer), with where they come from. */
  readonly sounds: { kind: 'buzz'; at: THREE.Vector3 }[] = [];
  private lastBeat = -1;
  /** Screens above the doors: destination, postcodes, and what the truck is doing. */
  private screens: Labels;

  constructor(k: FloorKit, doors: TruckDoor[]) {
    const inside = k.std(0x1b1d22, 0.7, 0.3, 0xe6e9ed);
    inside.side = THREE.BackSide;
    inside.map = sectionalDoor();
    k.realNormal(inside, sectionalDoorNormal(), 0.7);
    const floorM = k.std(0x2a2c31, 0.8, 0.2, 0xb9c0c8);
    floorM.map = checkerPlate();
    k.realNormal(floorM, checkerPlateNormal());
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.25, 1.1) });
    const doorM = k.std(0x2c3038, 0.6, 0.4, 0xffffff);
    doorM.map = sectionalDoor();
    k.realNormal(doorM, sectionalDoorNormal());
    const boxM = k.std(0x8a7050, 0.95, 0, 0xe0b882);
    const shell = new THREE.BoxGeometry(W, H, L);
    const floorG = new THREE.BoxGeometry(W - 0.1, 0.04, L);
    const lampG = new THREE.BoxGeometry(0.2, 0.04, L - 2);
    // The door panel: 1 m high geometry, anchored at its top edge, scaled down from the roll.
    const doorG = new THREE.BoxGeometry(3.2, 1, 0.08).translate(0, -0.5, 0);
    // A roll cage's load of cartons, as a block (only shown during a shift of the planning game,
    // inside a cage frame the docks put round it: see `showLoad`).
    const cageG = mergeGeometries([
      new THREE.BoxGeometry(1.2, 0.5, 0.9).translate(0, 0.6, 0),
      new THREE.BoxGeometry(1.1, 0.45, 0.86).translate(0.03, 1.08, 0.01),
      new THREE.BoxGeometry(0.7, 0.36, 0.8).translate(-0.2, 1.49, -0.02),
    ].map((g) => g.toNonIndexed()))!;
    const boxG = new THREE.BoxGeometry(1.2, 1.0, 1.2).translate(0, 0.5, 0);
    // The trailer's outside: a box without the end at the door and without a floor.
    const skin = (open: number) => {
      const g = new THREE.BoxGeometry(W + 0.08, H + 0.08, L + 0.04);
      const idx = g.getIndex()!.array;
      const keep: number[] = [];
      for (const grp of g.groups) if (grp.materialIndex !== open && grp.materialIndex !== 3) for (let i = grp.start; i < grp.start + grp.count; i++) keep.push(idx[i]!);
      g.setIndex(keep);
      g.clearGroups();
      return g;
    };
    const skinN = skin(4);
    const skinS = skin(5);
    const skinM = k.std(0xffffff, 0.5, 0.2, 0xffffff);
    const wheelG = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 18).rotateZ(Math.PI / 2);
    const wheelM = k.std(0x15161a, 0.9, 0, 0x26282e);
    // Tractor: cab with a raised roof, bonnet and bumper (facing away from the trailer, local −z).
    const cabG = mergeGeometries([
      new THREE.BoxGeometry(2.5, 2.4, 2.2).translate(0, 2.0, 0.2),
      new THREE.BoxGeometry(2.4, 0.6, 2.0).translate(0, 3.5, 0.3),
      new THREE.BoxGeometry(2.5, 1.0, 1.2).translate(0, 1.0, -1.3),
      new THREE.BoxGeometry(2.6, 0.3, 0.2).translate(0, 0.55, -1.95),
    ].map((g) => g.toNonIndexed()))!;
    const glassG = new THREE.BoxGeometry(2.3, 0.9, 0.05).translate(0, 2.6, -0.92);
    const glassM = k.std(0x0d1016, 0.15, 0.8, 0x2a3442);
    for (const d of doors) {
      const trailer = new THREE.Group();
      trailer.position.set(d.x, 0, d.wallZ - d.dir * (L / 2 + 0.02));
      k.put(trailer);
      k.batch(shell, inside, trailer).position.y = H / 2;
      k.batch(floorG, floorM, trailer).position.y = 0.02;
      k.batch(lampG, lamp, trailer).position.y = H - 0.12;
      // Outside: the trailer's skin (open at the door end), wheels, and the tractor in front.
      k.batch(d.dir > 0 ? skinN : skinS, skinM, trailer, TRUCK_COLS[(d.number * 5) % TRUCK_COLS.length]).position.y = H / 2;
      // (A semi-trailer's axles are at the back, by the doors; its front rests on the tractor.)
      for (const zz of [L / 2 - 2.2, L / 2 - 3.3]) for (const sx of [-1, 1]) {
        const w = k.batch(wheelG, wheelM, trailer);
        w.position.set(sx * (W / 2 + 0.22), 0.5, d.dir * zz);
      }
      const doorsShut = trailerDoors(k, trailer, (d.dir * L) / 2, d.dir, W + 0.08, H, skinM, TRUCK_COLS[(d.number * 5) % TRUCK_COLS.length]!);
      doorsShut(false);
      const cab = new THREE.Group();
      cab.position.set(0, 0, -d.dir * (L / 2 + 1.7));
      if (d.dir < 0) cab.rotation.y = Math.PI;
      trailer.add(cab);
      k.batch(cabG, skinM, cab, TRUCK_COLS[(d.number * 3 + 1) % TRUCK_COLS.length]);
      k.batch(glassG, glassM, cab);
      for (const sx of [-1, 1]) for (const zz of [-0.6, 0.9]) {
        const w = k.batch(wheelG, wheelM, cab);
        w.position.set(sx * 1.1, 0.5, zz);
      }
      // Cargo slots: two across, from the far end towards the door.
      const slots: THREE.Object3D[] = [];
      for (let n = 0; n < SLOTS[d.cargo]; n++) {
        const s = k.batch(d.cargo === 'cage' ? cageG : boxG, boxM, trailer);
        // (Cages two across, 1.1 m deep each; boxes two across, 1.35 m.)
        const pitch = d.cargo === 'cage' ? 1.12 : 1.35;
        s.position.set((n % 2 ? 0.72 : -0.72), 0.05, -d.dir * (L / 2 - 0.75 - Math.floor(n / 2) * pitch));
        s.visible = false;
        slots.push(s);
      }
      const door = new THREE.Group();
      door.position.set(d.x, DOOR_H, d.wallZ + d.dir * 0.12);
      k.put(door);
      const panel = k.batch(doorG, doorM, door);
      panel.scale.y = 0.6;
      this.docks.push({ ...d, state: 'open', t0: 0, load: 0, vol: 0, kg: 0, cutoff: 0, full: false, reserved: 0, door: panel, trailer, slots, shown: '', doorsShut, run: null });
    }
    this.screens = new Labels(doors.length, 3.4, 1.0, 340, 100);
    const sm = new THREE.Matrix4();
    const frame = k.std(0x1b1c20, 0.5, 0.3, 0x1d1d1f);
    this.docks.forEach((d, i) => {
      sm.makeRotationY(d.dir < 0 ? Math.PI : 0).setPosition(d.x, 6.6, d.wallZ + d.dir * 0.14);
      this.screens.place(i, sm);
      k.box('dscreen', frame, d.x, 6.6, d.wallZ + d.dir * 0.08, 3.6, 1.2, 0.1);
    });
    k.put(this.screens.mesh);
    this.drawScreens();
    // Warning lamps on the wall beside each door, above the traffic light.
    this.lamps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 16).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial(), doors.length);
    const o = new THREE.Object3D();
    this.docks.forEach((d, i) => {
      o.position.set(d.x + 2.3, 4.55, d.wallZ + d.dir * 0.16);
      o.updateMatrix();
      this.lamps.setMatrixAt(i, o.matrix);
      this.lamps.setColorAt(i, this.c.setRGB(0.25, 0.12, 0.02));
    });
    this.lamps.frustumCulled = false;
    k.put(this.lamps);
  }

  /** How full a trailer is: by volume, weight, or places for cages and boxes, whichever is first. */
  private fill(d: Dock): number {
    return Math.max(d.vol / TRAILER_M3[d.cargo], d.kg / TRAILER_KG[d.cargo], d.load / SLOTS[d.cargo]);
  }

  /**
   * A truck in cleardown still waits: for anyone in the trailer or pushing a cage in (the door
   * never comes down on them), and for the cages still to go in (up to WAIT_CAGES beats). A
   * safety net after WAIT_MAX beats, should a job never finish.
   */
  private waiting(d: Dock, bt: number): boolean {
    const late = bt - (d.t0 + DUR.cleardown);
    if (late >= WAIT_MAX) return false;
    const h = d.hold?.() ?? 0;
    return d.reserved > 0 || h >= 2 || (h >= 1 && late < WAIT_CAGES);
  }

  /** A trailer at this door with its door up (open, in cleardown, or the door coming down). */
  atDoor(i: number): boolean {
    const s = this.docks[i]?.state;
    return s === 'open' || s === 'cleardown' || s === 'closing';
  }

  /** In cleardown (warning, still loading the last things). */
  clearing(i: number): boolean {
    return this.docks[i]?.state === 'cleardown';
  }

  isOpen(i: number): boolean {
    return this.docks[i]?.state === 'open';
  }

  reserve(i: number, n: 1 | -1): void {
    const d = this.docks[i];
    if (d) d.reserved = Math.max(0, d.reserved + n);
  }

  /**
   * Where the next load goes in this trailer (world position of its place, from the far
   * end towards the door), or null if the trailer is full or not at the door.
   */
  nextSlot(i: number): THREE.Vector3 | null {
    const d = this.docks[i];
    if (!d || (d.state !== 'open' && d.state !== 'cleardown')) return null;
    const n = d.load + d.reserved;
    const s = d.slots[n];
    if (!s) return null;
    d.trailer.updateMatrixWorld();
    return s.getWorldPosition(new THREE.Vector3()).setY(0);
  }

  /** One more load in the trailer (a cage or a box), with its volume and weight. */
  load(i: number, vol = 0, kg = 0): void {
    const d = this.docks[i];
    if (!d) return;
    d.load = Math.min(SLOTS[d.cargo], d.load + 1);
    d.vol += vol;
    d.kg += kg;
    // (Roll cages are drawn by the docks, with their parcels: the slots only show boxes.)
    d.slots.forEach((s, n) => (s.visible = n < d.load && d.cargo !== 'cage'));
  }

  update(bt: number): void {
    const now = this.clock();
    if (!this.scheduled) {
      // Every door has a truck leaving every EVERY minutes; the doors' departures are spread over that time.
      this.scheduled = true;
      // Doors of the same city take turns: a city with n doors has a departure every EVERY/n
      // minutes, one door after the other, and the cities are spread over the hour too.
      const base = Math.ceil(now / 60) * 60 + 60;
      for (const side of ['cage', 'box'] as const) {
        const list = this.docks.filter((d) => d.cargo === side);
        const cities = [...new Set(list.map((d) => d.city))];
        for (const d of list) {
          const group = list.filter((x) => x.city === d.city);
          const c = cities.indexOf(d.city);
          const off = (c / cities.length + group.indexOf(d) / group.length) % 1;
          d.cutoff = base + Math.round(off * EVERY[d.cargo]) + (side === 'box' ? 1 : 0);
        }
      }
    }
    // The cleardown buzzer sounds on every other beat at a door in cleardown.
    const beat = Math.floor(bt);
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      if (beat % 2 === 0) for (const d of this.docks) if (d.state === 'cleardown' || d.state === 'closing') this.sounds.push({ kind: 'buzz', at: new THREE.Vector3(d.x, 4, d.wallZ) });
    }
    for (const d of this.docks) {
      if (d.run) this.stepDirected(d, d.run, bt);
      else if (d.state === 'open') {
        // Cleardown when full, or in time for the departure (the cutoff). (During a shift of the
        // planning game the other doors keep no timetable: `frozen`.)
        const due = !this.frozen && now >= d.cutoff - CLEARDOWN_LEAD;
        if (this.fill(d) >= 0.9 || due) {
          d.state = 'cleardown';
          d.t0 = Math.ceil(bt);
          d.full = !due;
        }
      } else if (d.state === 'cleardown' && bt >= d.t0 + DUR.cleardown && this.waiting(d, bt)) {
        // Still something on its way into the trailer, or someone in it: keep warning.
      } else if (bt >= d.t0 + DUR[d.state]) {
        // (After a held cleardown, the next state starts now, not when it would have.)
        d.t0 = bt - (d.t0 + DUR[d.state]) > 1 ? Math.floor(bt) : d.t0 + DUR[d.state];
        d.state = NEXT[d.state];
        if (d.state === 'leaving') {
          this.onDepart({ door: d.number, city: d.city, at: now, cutoff: d.cutoff, load: +d.vol.toFixed(2), room: TRAILER_M3[d.cargo], onTime: now <= d.cutoff + 2, full: d.full });
          // The next truck takes the next hour's departure (a full one that left early keeps this hour's).
          if (!d.full || now >= d.cutoff - CLEARDOWN_LEAD) while (d.cutoff <= now + CLEARDOWN_LEAD + 10) d.cutoff += EVERY[d.cargo];
        }
        if (d.state === 'arriving') {
          d.load = 0;
          d.vol = 0;
          d.kg = 0;
          d.slots.forEach((s) => (s.visible = false));
        }
      }
      const f = d.state === 'open' ? 1 : clamp01((bt - d.t0) / DUR[d.state]);
      // Door: rolled up (0.6 m showing) when open, down (3.8 m) when closed.
      const down = d.state === 'closing' ? ease(f) : d.state === 'opening' ? 1 - ease(f) : d.state === 'open' || d.state === 'cleardown' ? 0 : 1;
      d.door.scale.y = 0.6 + (DOOR_H - 0.6) * down;
      // Trailer: pulls away from the wall and comes back.
      const out = d.state === 'leaving' ? ease(f) : d.state === 'away' ? 1 : d.state === 'arriving' ? 1 - ease(f) : 0;
      d.trailer.position.z = d.wallZ - d.dir * (L / 2 + 0.02 + out * 16);
      d.trailer.visible = d.state !== 'away';
      d.doorsShut(d.state === 'leaving');
      // The warning lamp flashes on the half beat during cleardown and while the door comes down.
      const k = this.docks.indexOf(d);
      const warn = d.state === 'cleardown' || d.state === 'closing' || d.run?.lamp === true || this.warned.has(k);
      const on = warn && bt * 2 - Math.floor(bt * 2) < 0.5;
      this.lamps.setColorAt(k, on ? this.c.setRGB(3, 1.4, 0.1) : this.c.setRGB(0.25, 0.12, 0.02));
    }
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
    this.drawScreens();
  }

  // ---------- a shift of the planning game (see director.ts) ----------

  /** No timetable: nothing leaves by the clock (a full truck still does). The director's doors are separate. */
  private frozen = false;
  /** Doors whose lamp flashes although they are not in cleardown (a truck that is late). */
  private readonly warned = new Set<number>();

  /**
   * The director takes door `i` (down, no truck business of its own), or gives it back to the
   * free cycle (a truck at the door, the door rolling up, an empty trailer).
   */
  direct(i: number, on: boolean, bt: number): void {
    const d = this.docks[i];
    if (!d || !!d.run === on) return;
    d.reserved = 0;
    d.load = 0;
    d.vol = 0;
    d.kg = 0;
    d.full = false;
    d.slots.forEach((s) => (s.visible = false));
    d.shown = '';
    if (on) {
      d.run = { want: 'shut', lamp: false, cycling: false, main: String(d.number), sub: '', tone: 'off' };
      if (d.state === 'arriving' || d.state === 'away') d.state = 'away';
      else if (d.state !== 'closing' && d.state !== 'leaving') {
        d.state = 'closing';
        d.t0 = Math.ceil(bt);
      }
    } else {
      d.run = null;
      if (d.state !== 'open') {
        d.state = 'opening';
        d.t0 = Math.ceil(bt);
      }
    }
  }

  /**
   * One step of a directed door: towards up with a trailer behind it, or down and the truck
   * gone. A swap is the same way round once: down, away, a new trailer in, up. The door never
   * comes down on someone in the trailer or pushing a cage in (`hold`).
   */
  private stepDirected(d: Dock, r: Run, bt: number): void {
    const next = (st: State, from = d.t0 + DUR[d.state as Exclude<State, 'open'>]) => {
      d.state = st;
      // (After a wait the next move starts on the coming beat, not in the past.)
      d.t0 = bt - from > 1 ? Math.floor(bt) : from;
    };
    const timeUp = d.state !== 'open' && bt >= d.t0 + DUR[d.state];
    if (r.want === 'open' && !r.cycling) {
      if (d.state === 'closing' || d.state === 'leaving' || d.state === 'away') {
        // (The trailer backed in behind the closed door, out of sight.)
        d.state = 'opening';
        d.t0 = Math.ceil(bt);
        d.load = 0;
      } else if ((d.state === 'opening' || d.state === 'arriving') && timeUp) next(d.state === 'arriving' ? 'opening' : 'open');
      return;
    }
    if (d.state === 'open' || d.state === 'cleardown') {
      if (d.reserved > 0 || (d.hold?.() ?? 0) >= 2) return;
      d.state = 'closing';
      d.t0 = Math.ceil(bt);
    } else if (d.state === 'opening' && !r.cycling) {
      d.state = 'closing';
      d.t0 = Math.ceil(bt);
    } else if (d.state === 'closing' && timeUp) next('leaving');
    else if (d.state === 'leaving' && timeUp) {
      next('away');
      d.load = 0;
      d.vol = 0;
      d.kg = 0;
    } else if (d.state === 'away' && r.cycling && timeUp) next('arriving');
    else if (d.state === 'arriving' && r.cycling && timeUp) next('opening');
    else if (d.state === 'opening' && r.cycling && timeUp) {
      d.state = 'open';
      r.cycling = false;
    } else if (d.state === 'arriving' && !r.cycling) d.state = 'away';
  }

  /** A directed door: up (with a trailer) or down. */
  want(i: number, open: boolean): void {
    const r = this.docks[i]?.run;
    if (r) r.want = open ? 'open' : 'shut';
  }

  /** A directed door at once in its end position (a jump in time): no rolling, no driving. */
  settle(i: number, bt: number): void {
    const d = this.docks[i];
    if (!d?.run) return;
    d.run.cycling = false;
    d.reserved = 0;
    d.state = d.run.want === 'open' ? 'open' : 'away';
    d.t0 = Math.floor(bt);
    if (d.state === 'away') {
      d.load = 0;
      d.vol = 0;
      d.kg = 0;
    }
  }

  /** A directed door: the full trailer leaves and an empty one comes (door down, away, back, door up). */
  swap(i: number): void {
    const r = this.docks[i]?.run;
    if (r && r.want === 'open') r.cycling = true;
  }

  /** Is a directed door in the middle of a trailer swap? */
  swapping(i: number): boolean {
    return this.docks[i]?.run?.cycling === true;
  }

  /** A directed door's screen. */
  say(i: number, main: string, sub: string, tone: ScreenTone): void {
    const r = this.docks[i]?.run;
    if (!r) return;
    r.main = main;
    r.sub = sub;
    r.tone = tone;
  }

  /** The warning lamp of a directed door, or (any door) of a truck that is late. */
  warn(i: number, on: boolean): void {
    const r = this.docks[i]?.run;
    if (r) r.lamp = on;
    else if (on) this.warned.add(i);
    else this.warned.delete(i);
  }

  /**
   * While a shift is played the doors the director does not run keep no timetable (nothing
   * leaves by the clock); afterwards the departures are shared out again from now.
   */
  freeze(on: boolean): void {
    this.frozen = on;
    this.warned.clear();
    if (!on) this.scheduled = false;
    for (const d of this.docks) d.shown = '';
  }

  /** Another name on a door's screen (a robot city of the shift at a south door), or its own back. */
  label(i: number, city: string, pc: string): void {
    const d = this.docks[i];
    if (!d) return;
    d.city = city;
    d.pc = pc;
    d.shown = '';
  }

  /** Doors for the cleardown panel: number, city, postcodes and state. */
  list(): { number: number; city: string; pc: string; state: State; load: number; cap: number; cutoff: number; fill: number }[] {
    return this.docks.map((d) => ({ number: d.number, city: d.city, pc: d.pc, state: d.state, load: d.load, cap: CAP[d.cargo], cutoff: d.cutoff, fill: this.fill(d) }));
  }

  /** Start a cleardown at these doors (by index): the truck leaves with what it has. */
  cleardown(idx: number[], bt: number): void {
    for (const i of idx) {
      const d = this.docks[i];
      // (Not a door the shift director runs: the plan says when its truck goes.)
      if (d && d.state === 'open' && !d.run) {
        d.state = 'cleardown';
        d.t0 = Math.ceil(bt);
      }
    }
  }

  /**
   * The screen above each door: number and city, postcodes, and the departure counting down
   * (`dep 14:35 · 12 min`, with how full it is); in red once the truck is late (past its
   * departure and still at the door: `LATE +3 min`).
   */
  private drawScreens(): void {
    const now = this.clock();
    this.docks.forEach((d, i) => {
      if (d.run) {
        const key = `${d.run.main}|${d.run.sub}|${d.run.tone}`;
        if (d.shown === key) return;
        d.shown = key;
        this.screens.set(i, d.run.main, d.run.sub, TONES[d.run.tone]);
        return;
      }
      const hhmm = `${String(Math.floor(d.cutoff / 60) % 24).padStart(2, '0')}:${String(Math.floor(d.cutoff % 60)).padStart(2, '0')}`;
      const left = Math.ceil(d.cutoff - now);
      const atDoor = d.state === 'open' || d.state === 'cleardown' || d.state === 'closing';
      const late = atDoor && left < 0;
      const inMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`);
      const fill = d.cages ? `cages ${Math.round(d.cages() * 100)}%` : `truck ${Math.round(this.fill(d) * 100)}%`;
      const status = this.frozen
        ? d.state === 'open' ? fill : d.state === 'cleardown' || d.state === 'closing' ? 'CLEARDOWN' : 'Truck on its way'
        : late
        ? `LATE +${-left} min · dep ${hhmm}`
        : d.state === 'open'
          ? `dep ${hhmm} · ${inMin(left)} · ${fill}`
          : d.state === 'cleardown' || d.state === 'closing'
            ? `CLEARDOWN · dep ${hhmm} · ${inMin(left)}`
            : d.state === 'opening'
              ? `Opening · dep ${hhmm}`
              : 'Truck on its way';
      const key = `${d.city}|${status}`;
      if (d.shown === key) return;
      d.shown = key;
      const warn = d.state === 'cleardown' || d.state === 'closing';
      this.screens.set(i, `${d.number} · ${d.city}`, `${d.pc} · ${status}`, {
        bg: late && !this.frozen ? '#4a0d0d' : warn ? '#3a1f00' : '#101114',
        fg: '#ffffff',
        sub: this.frozen ? (warn ? '#ffb020' : '#5be0a0') : late ? '#ff5a4f' : warn ? '#ffb020' : d.state === 'open' ? (left <= 10 ? '#ffd24a' : '#5be0a0') : '#9aa0a8',
      });
    });
    this.screens.flush();
  }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
