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
  /** During cleardown: still loading (the dock workers push the last cages in), so wait. */
  hold?: () => boolean;
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
  /** What the screen shows now (redrawn when it changes). */
  shown: string;
}

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
    const cageM = k.std(0x5d6670, 0.5, 0.6, 0x2fa58f);
    const boxM = k.std(0x8a7050, 0.95, 0, 0xe0b882);
    const shell = new THREE.BoxGeometry(W, H, L);
    const floorG = new THREE.BoxGeometry(W - 0.1, 0.04, L);
    const lampG = new THREE.BoxGeometry(0.2, 0.04, L - 2);
    // The door panel: 1 m high geometry, anchored at its top edge, scaled down from the roll.
    const doorG = new THREE.BoxGeometry(3.2, 1, 0.08).translate(0, -0.5, 0);
    const cageG = new THREE.BoxGeometry(1.3, 1.7, 1.0).translate(0, 0.95, 0);
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
      for (const zz of [L / 2 - 1.6, L / 2 - 2.8]) for (const sx of [-1, 1]) {
        const w = k.batch(wheelG, wheelM, trailer);
        w.position.set(sx * (W / 2 + 0.22), 0.5, -d.dir * zz);
      }
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
        const s = k.batch(d.cargo === 'cage' ? cageG : boxG, d.cargo === 'cage' ? cageM : boxM, trailer);
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
      this.docks.push({ ...d, state: 'open', t0: 0, load: 0, vol: 0, kg: 0, cutoff: 0, full: false, reserved: 0, door: panel, trailer, slots, shown: '' });
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
    d.slots.forEach((s, n) => (s.visible = n < d.load));
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
      if (d.state === 'open') {
        // Cleardown when full, or in time for the departure (the cutoff).
        const due = now >= d.cutoff - CLEARDOWN_LEAD;
        if (this.fill(d) >= 0.9 || due) {
          d.state = 'cleardown';
          d.t0 = Math.ceil(bt);
          d.full = !due;
        }
      } else if (d.state === 'cleardown' && bt >= d.t0 + DUR.cleardown && (d.reserved > 0 || d.hold?.()) && bt < d.t0 + DUR.cleardown + 120) {
        // (A safety net: after 120 beats of waiting the truck leaves anyway.)
        // Still something on its way out of the trailer: keep warning.
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
      // The warning lamp flashes on the half beat during cleardown and while the door comes down.
      const warn = d.state === 'cleardown' || d.state === 'closing';
      const on = warn && bt * 2 - Math.floor(bt * 2) < 0.5;
      this.lamps.setColorAt(this.docks.indexOf(d), on ? this.c.setRGB(3, 1.4, 0.1) : this.c.setRGB(0.25, 0.12, 0.02));
    }
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
    this.drawScreens();
  }

  /** Doors for the cleardown panel: number, city, postcodes and state. */
  list(): { number: number; city: string; pc: string; state: State; load: number; cap: number; cutoff: number; fill: number }[] {
    return this.docks.map((d) => ({ number: d.number, city: d.city, pc: d.pc, state: d.state, load: d.load, cap: CAP[d.cargo], cutoff: d.cutoff, fill: this.fill(d) }));
  }

  /** Start a cleardown at these doors (by index): the truck leaves with what it has. */
  cleardown(idx: number[], bt: number): void {
    for (const i of idx) {
      const d = this.docks[i];
      if (d && d.state === 'open') {
        d.state = 'cleardown';
        d.t0 = Math.ceil(bt);
      }
    }
  }

  private drawScreens(): void {
    this.docks.forEach((d, i) => {
      const hhmm = `${String(Math.floor(d.cutoff / 60) % 24).padStart(2, '0')}:${String(Math.floor(d.cutoff % 60)).padStart(2, '0')}`;
      const status =
        d.state === 'open' ? `dep ${hhmm} · ${d.cages ? `cages ${Math.round(d.cages() * 100)}%` : `truck ${Math.round(this.fill(d) * 100)}%`}` : d.state === 'cleardown' || d.state === 'closing' ? 'CLEARDOWN' : d.state === 'opening' ? `Opening · dep ${hhmm}` : 'Truck on its way';
      const key = status;
      if (d.shown === key) return;
      d.shown = key;
      const warn = d.state === 'cleardown' || d.state === 'closing';
      this.screens.set(i, `${d.number} · ${d.city}`, `${d.pc} · ${status}`, { bg: warn ? '#3a1f00' : '#101114', fg: '#ffffff', sub: warn ? '#ffb020' : d.state === 'open' ? '#5be0a0' : '#9aa0a8' });
    });
    this.screens.flush();
  }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
