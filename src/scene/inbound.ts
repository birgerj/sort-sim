// The inbound wing: ten dock doors in the north wall of the wing, a truck full of parcels at
// each, a telescopic conveyor that reaches into the trailer up to the wall of parcels, and an
// unloader who takes the parcels off that wall one at a time and puts them on the telescope's
// nose. The telescopes run onto collector belts that merge into the four infeed lanes (the
// collectors and the parcels' way are the Sorter's).
//
// As a trailer empties, the wall of parcels moves back, the telescope follows it and the unloader
// with it. An empty trailer: the door rolls down, the truck pulls away, a full one backs in, the
// door rolls up and the telescope goes in again. All in whole beats.
import * as THREE from 'three';

import type { FloorKit } from './floor';
import { buildDockDoor } from './docks';
import { buildHuman, type Human } from './people';
import { crouch, gait, reach, relaxArms, settle, swingArms } from './motion';
import { canvasTexture, checkerPlate, sectionalDoor } from './textures';

export interface InboundLayout {
  /** z of the wing's north wall (the hall is at +z of it). */
  wallZ: number;
  /** Door positions (x), west to east, and the number on each. */
  doors: number[];
  firstNumber: number;
  /** Height of the belts (where a parcel's base rides). */
  beltY: number;
}

/** What the unloader holds on to while a parcel is on its way from the wall to the nose. */
export interface Carried {
  pos: THREE.Vector3;
  sPrev: number;
  mode: string;
}

type State = 'open' | 'closing' | 'leaving' | 'away' | 'arriving' | 'opening';
const DUR: Record<Exclude<State, 'open'>, number> = { closing: 2, leaving: 4, away: 4, arriving: 4, opening: 2 };
const NEXT: Record<Exclude<State, 'open'>, State> = { closing: 'leaving', leaving: 'away', away: 'arriving', arriving: 'opening', opening: 'open' };

/** Trailer size (as at the outbound docks) and how many parcels one brings. */
const L = 12;
const W = 3.1;
const H = 3.7;
const DOOR_H = 3.8;
export const TRAILER_PARCELS = 90;
/** The telescope's base reaches this far into the hall from the wall. */
export const TELESCOPE_BASE = 6.8;
const TRUCK_COLS = [0xf3f4f6, 0x1755fe, 0xe6e9ed, 0xe2231a, 0x2fa58f, 0x3a3d44, 0xf2c200, 0x6b3fd1];
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

interface Bay {
  x: number;
  number: number;
  state: State;
  t0: number;
  /** Parcels still in the trailer, and taken but not yet picked off the wall. */
  left: number;
  trailer: THREE.Object3D;
  cargo: THREE.Object3D;
  door: THREE.Object3D;
  sections: THREE.Object3D[];
  noseBar: THREE.Object3D;
  /** Where the telescope's nose is (z), eased towards the wall of parcels. */
  nose: number;
  /** The unloaders (the second one only works while the rate needs two). */
  crew: Unloader[];
}

interface Unloader {
  h: Human;
  /** Which side of the nose he works on (+1 east, −1 west). */
  side: 1 | -1;
  ux: number;
  uz: number;
  yaw: number;
  /** The parcels on their way off the wall (he holds the first), with the length of that first stretch. */
  carry: { p: Carried; leg: number }[];
}

export class Inbound {
  private bays: Bay[] = [];
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  /** A trailer that just came is this full (a new one is never quite the same). */
  private readonly rnd: () => number;

  constructor(
    private k: FloorKit,
    private lay: InboundLayout,
    rnd: () => number = Math.random,
  ) {
    this.rnd = rnd;
    const wallZ = lay.wallZ;
    // Materials, shared by all the bays.
    const inside = k.std(0x1b1d22, 0.7, 0.3, 0xe6e9ed);
    inside.side = THREE.BackSide;
    const floorM = k.std(0x2a2c31, 0.8, 0.2, 0xb9c0c8);
    floorM.map = checkerPlate();
    const skinM = k.std(0xffffff, 0.5, 0.2, 0xffffff);
    const wheelM = k.std(0x15161a, 0.9, 0, 0x26282e);
    const doorM = k.std(0x2c3038, 0.6, 0.4, 0xffffff);
    doorM.map = sectionalDoor();
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.25, 1.1) });
    // The load: a wall of cartons, stacked to the roof.
    const cargoM = k.std(0x6e5638, 0.95, 0, 0xd2ad7a);
    cargoM.map = cartonWall();
    const teleM = k.std(0x3a3e45, 0.5, 0.6, 0xb9c0c8);
    const beltM = k.std(0x15161a, 0.8, 0.1, 0x3a3d44);
    const noseM = k.std(0x8a6e00, 0.6, 0.2, 0xf2c200);

    const shell = new THREE.BoxGeometry(W, H, L);
    const floorG = new THREE.BoxGeometry(W - 0.1, 0.04, L);
    const lampG = new THREE.BoxGeometry(0.2, 0.04, L - 2);
    const skin = (() => {
      // The outside: a box without the end at the door (+z) and without a floor.
      const g = new THREE.BoxGeometry(W + 0.08, H + 0.08, L + 0.04);
      const idx = g.getIndex()!.array;
      const keep: number[] = [];
      for (const grp of g.groups) if (grp.materialIndex !== 4 && grp.materialIndex !== 3) for (let i = grp.start; i < grp.start + grp.count; i++) keep.push(idx[i]!);
      g.setIndex(keep);
      g.clearGroups();
      return g;
    })();
    const wheelG = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 18).rotateZ(Math.PI / 2);
    const cabG = new THREE.BoxGeometry(2.5, 2.6, 2.4).translate(0, 1.9, 0);
    // Cargo: 1 m deep, its back at local z 0 (scaled to the load left).
    const cargoG = new THREE.BoxGeometry(W - 0.25, H - 0.35, 1).translate(0, (H - 0.35) / 2 + 0.04, 0.5);
    const doorG = new THREE.BoxGeometry(3.2, 1, 0.08).translate(0, -0.5, 0);
    // Telescope sections: 1 m long boxes, their back at local z 0, scaled to length (they reach to −z).
    const secG = [0, 1, 2].map((i) => new THREE.BoxGeometry(1.0 - i * 0.08, 0.32, 1).translate(0, 0.72 - i * 0.03, -0.5));
    const beltG = [0, 1, 2].map((i) => new THREE.BoxGeometry(0.8 - i * 0.08, 0.02, 1).translate(0, lay.beltY - 0.02 - i * 0.03 + 0.01, -0.5));
    const noseG = new THREE.BoxGeometry(0.84, 0.08, 0.12);

    lay.doors.forEach((x, i) => {
      buildDockDoor(k, x, wallZ, 1, lay.firstNumber + i);
      // The telescope's base: a long housing on the floor inside, the belt on top.
      const zb = wallZ + TELESCOPE_BASE / 2 + 0.1;
      k.box('telebase', teleM, x, 0.42, zb, 1.1, 0.84, TELESCOPE_BASE);
      k.box('telebelt', beltM, x, lay.beltY - 0.01, zb, 0.9, 0.02, TELESCOPE_BASE);
      for (const sx of [-0.5, 0.5]) k.box('telerail', noseM, x + sx, lay.beltY + 0.03, zb, 0.04, 0.06, TELESCOPE_BASE);
      k.box('telectl', noseM, x + 0.62, 0.95, wallZ + 1.1, 0.12, 0.3, 0.2);
      k.blob(x, zb, 1.6, TELESCOPE_BASE + 0.4);

      const trailer = new THREE.Group();
      trailer.position.set(x, 0, wallZ - (L / 2 + 0.02));
      k.put(trailer);
      k.batch(shell, inside, trailer).position.y = H / 2;
      k.batch(floorG, floorM, trailer).position.y = 0.02;
      k.batch(lampG, lamp, trailer).position.y = H - 0.12;
      k.batch(skin, skinM, trailer, TRUCK_COLS[(i * 5 + 2) % TRUCK_COLS.length]).position.y = H / 2;
      for (const zz of [-(L / 2 - 1.6), -(L / 2 - 2.8)]) for (const sx of [-1, 1]) k.batch(wheelG, wheelM, trailer).position.set(sx * (W / 2 + 0.22), 0.5, zz);
      const cab = k.batch(cabG, skinM, trailer, TRUCK_COLS[(i * 3 + 1) % TRUCK_COLS.length]);
      cab.position.set(0, 0, -(L / 2 + 1.7));
      const cargo = k.batch(cargoG, cargoM, trailer);
      cargo.position.set(0, 0, -L / 2 + 0.1);
      const door = new THREE.Group();
      door.position.set(x, DOOR_H, wallZ + 0.12);
      k.put(door);
      const panel = k.batch(doorG, doorM, door);
      panel.scale.y = 0.6;
      // The telescope's moving sections, hung from a group at the end of the base (at the wall).
      const tele = new THREE.Group();
      tele.position.set(x, 0, wallZ + 0.6);
      k.put(tele);
      const sections = secG.map((g, n) => {
        const s = k.batch(g, teleM, tele);
        k.batch(beltG[n]!, beltM, s);
        return s;
      });
      const nose = k.batch(noseG, noseM, tele);
      nose.position.y = lay.beltY - 0.04;
      // The unloaders: hi-vis, gloves.
      const crew: Unloader[] = ([1, -1] as const).map((side, j) => {
        const h = buildHuman(k, { shirt: [0x3a3d44, 0x22283f, 0x1755fe][(i + j) % 3]!, trousers: 0x22283f, vest: [0xf2a51a, 0xc8ff3a][(i + j) % 2]!, helmet: [0xf2c200, 0xffffff][((i >> 1) + j) % 2]! });
        k.put(h.root);
        return { h, side, ux: x + side * 1.25, uz: wallZ + 1.4, yaw: Math.PI, carry: [] };
      });
      const bay: Bay = { x, number: lay.firstNumber + i, state: 'open', t0: 0, left: Math.round(TRAILER_PARCELS * (0.35 + 0.65 * this.rnd())), trailer, cargo, door: panel, sections, noseBar: nose, nose: wallZ, crew };
      this.bays.push(bay);
      this.placeCargo(bay);
      bay.nose = this.noseFor(bay);
      for (const u of crew) {
        u.ux = x + u.side * 0.75;
        u.uz = this.faceZ(bay) + 0.75;
      }
    });
  }

  /** Unloaders per truck: 1 or 2 (the second only comes when the rate needs it). */
  crewSize: 1 | 2 = 1;

  get count(): number {
    return this.bays.length;
  }

  /** The door can give a parcel now: its truck is there and still has some. */
  ready(d: number): boolean {
    const b = this.bays[d];
    return !!b && b.state === 'open' && b.left > 0;
  }

  /** The trucks for the hub plan: where, what they are doing, and how much is still in them (0…1). */
  list(): { x: number; z: number; state: State; left: number }[] {
    return this.bays.map((b) => ({ x: b.x, z: this.lay.wallZ, state: b.state, left: b.state === 'open' || b.state === 'opening' ? Math.min(1, b.left / TRAILER_PARCELS) : 0 }));
  }

  /** Parcels left in a trailer (for the screens). */
  left(d: number): number {
    return this.bays[d]?.left ?? 0;
  }

  /**
   * A parcel comes off door d's wall: a point on the wall of parcels to pick it from (its base),
   * and the telescope's nose, where the unloader puts it down.
   */
  take(d: number, pick: THREE.Vector3, nose: THREE.Vector3): number {
    const b = this.bays[d]!;
    b.left--;
    const face = this.faceZ(b);
    const r = this.rnd;
    // Whoever has the least in hand; off the wall on his side of the nose, at any height he can reach.
    const n = this.crewSize === 2 && b.crew[1]!.carry.length < b.crew[0]!.carry.length ? 1 : 0;
    const side = b.crew[n]!.side;
    pick.set(b.x + side * (0.15 + r() * 0.75), 0.25 + r() * 1.5, face - 0.1);
    nose.set(b.x, this.lay.beltY, this.noseFor(b, face) - 0.15);
    return n;
  }

  /** The parcel just taken from door d is on its way (unloader n carries it while it is on the first `leg` metres). */
  carrying(d: number, n: number, p: Carried, leg: number): void {
    this.bays[d]!.crew[n]!.carry.push({ p, leg });
  }

  update(dt: number, bt: number): void {
    for (const b of this.bays) {
      this.step(b, bt);
      // The cargo and the telescope follow the wall of parcels.
      this.placeCargo(b);
      const want = b.state === 'open' || b.state === 'opening' ? this.noseFor(b) : this.lay.wallZ + 0.4;
      b.nose += (want - b.nose) * Math.min(1, dt * 2);
      this.placeTelescope(b);
      b.crew.forEach((u, n) => this.poseUnloader(b, u, n, dt, bt));
    }
  }

  // ---------- trucks ----------

  private step(b: Bay, bt: number): void {
    if (b.state === 'open') {
      // Empty (and nothing still on its way off the wall): the truck goes, a full one comes.
      if (b.left <= 0 && b.crew.every((u) => !u.carry.length)) {
        b.state = 'closing';
        b.t0 = bt;
      }
    } else {
      const s = b.state;
      while (b.state !== 'open' && bt - b.t0 >= DUR[b.state as Exclude<State, 'open'>]) {
        b.t0 += DUR[b.state as Exclude<State, 'open'>];
        b.state = NEXT[b.state as Exclude<State, 'open'>];
        if (b.state === 'arriving') b.left = TRAILER_PARCELS - Math.floor(this.rnd() * 12);
      }
      void s;
    }
    const f = b.state === 'open' ? 1 : Math.min(1, (bt - b.t0) / DUR[b.state as Exclude<State, 'open'>]);
    // The door: rolled up while the truck is there.
    const shut = b.state === 'closing' ? ease(f) : b.state === 'opening' ? 1 - ease(f) : b.state === 'open' ? 0 : 1;
    b.door.scale.y = 0.6 + (DOOR_H - 0.6) * shut;
    // The truck pulls away (north) and backs in.
    const out = b.state === 'leaving' ? ease(f) : b.state === 'away' ? 1 : b.state === 'arriving' ? 1 - ease(f) : 0;
    b.trailer.position.z = this.lay.wallZ - (L / 2 + 0.02) - out * 30;
    b.trailer.visible = b.state !== 'away';
  }

  /** z of the wall of parcels (its face, towards the door). */
  private faceZ(b: Bay): number {
    return b.trailer.position.z - L / 2 + 0.1 + this.depth(b);
  }

  /** How deep the load is (m), from the trailer's front. */
  private depth(b: Bay): number {
    return Math.max(0, Math.min(1, b.left / TRAILER_PARCELS)) * (L - 0.6);
  }

  private noseFor(b: Bay, face = this.faceZ(b)): number {
    // About a step in front of the wall, but never past the wall of the hall into the room.
    return Math.min(face + 0.85, this.lay.wallZ + 0.2);
  }

  private placeCargo(b: Bay): void {
    const d = this.depth(b);
    b.cargo.scale.set(1, 1, Math.max(0.001, d));
    b.cargo.visible = d > 0.01;
  }

  /** Three sections from the end of the base (at the wall) out to the nose, each a third, overlapping. */
  private placeTelescope(b: Bay): void {
    const start = this.lay.wallZ + 0.6;
    const reach = Math.max(0.3, start - b.nose);
    b.sections.forEach((s, n) => {
      s.position.set(0, 0, -(n * reach) / 3 + (n ? 0.25 : 0));
      s.scale.z = reach / 3 + (n ? 0.25 : 0);
    });
    b.noseBar.position.z = -reach;
  }

  // ---------- the unloader ----------

  private poseUnloader(b: Bay, u: Unloader, n: number, dt: number, bt: number): void {
    const h = u.h;
    const k = Math.min(1, dt * 8);
    // Drop the parcels that are past his hands.
    u.carry = u.carry.filter((c) => c.p.mode === 'path' && c.p.sPrev < c.leg + 0.05);
    const held = u.carry.find((c) => c.p.sPrev > 0.001) ?? null;
    // The second one only comes while the rate needs two (and finishes what he has in hand).
    const on = n === 0 || this.crewSize === 2 || u.carry.length > 0;
    // Where he stands: beside the nose, a step from the wall; out in the hall while the truck is away
    // (the second one, when not needed, at the side of the door).
    const inTruck = on && b.state === 'open' && (b.left > 0 || u.carry.length > 0);
    const tx = inTruck ? b.x + u.side * 0.75 : b.x + u.side * (n ? 2.6 : 1.25);
    const tz = inTruck ? this.faceZ(b) + 0.75 : this.lay.wallZ + (n ? 2.2 : 1.4);
    const dx = tx - u.ux;
    const dz = tz - u.uz;
    const d = Math.hypot(dx, dz);
    const step = Math.min(d, dt * 2.2);
    if (d > 1e-4) {
      u.ux += (dx / d) * step;
      u.uz += (dz / d) * step;
    }
    const walking = d > 0.08;
    const wantYaw = walking && d > 0.4 ? Math.atan2(dx, dz) : Math.PI;
    let dy = wantYaw - u.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    u.yaw += dy * Math.min(1, dt * 6);
    h.root.position.set(u.ux, 0, u.uz);
    h.root.rotation.y = u.yaw;
    // (The second one is only there while needed: he comes in from the side of the door.)
    h.root.visible = on || walking;
    // Upper body: bending to the parcel, upright otherwise.
    const low = held ? Math.max(0, 0.9 - held.p.pos.y) : 0;
    const bend = held ? 0.15 + low * 0.5 : inTruck ? 0.12 : 0.03;
    h.torso.rotation.x += (bend - h.torso.rotation.x) * k;
    h.head.rotation.x += ((held ? 0.25 : 0.05) - h.head.rotation.x) * k * 0.6;
    const swing = gait(h, dt, Math.PI * bt + b.number + n, walking ? Math.min(1.2, (step / Math.max(dt, 1e-3)) * 0.5) : 0);
    crouch(h, held ? Math.min(0.8, low * 1.4) : 0);
    if (held) {
      // Hands on the sides of the parcel.
      const right = this.v2.set(-Math.cos(u.yaw), 0, Math.sin(u.yaw));
      const c = this.v.copy(held.p.pos).setY(held.p.pos.y + 0.15);
      const kk = Math.min(1, dt * 14);
      reach(h, 'L', c.clone().addScaledVector(right, -0.22), kk, 1);
      reach(h, 'R', c.addScaledVector(right, 0.22), kk, 1);
    } else if (inTruck && !walking) {
      // Hands up to the wall, sizing up the next one (on the beat).
      const face = this.faceZ(b);
      const y = 1.1 + 0.25 * Math.sin(bt * Math.PI * 0.5 + b.number + n * 2);
      const kk = Math.min(1, dt * 6);
      const x0 = b.x + u.side * 0.5;
      reach(h, 'L', this.v.set(x0 - 0.22, y, face + 0.05), kk, 0);
      reach(h, 'R', this.v.set(x0 + 0.22, y - 0.15, face + 0.05), kk, 0);
    } else {
      swingArms(h, swing, k);
      relaxArms(h, k);
    }
    settle(h, dt, { idle: walking ? 0 : 1 });
  }
}

/** The face of a load: cartons of all sizes, stacked, in kraft shades. */
function cartonWall(): THREE.CanvasTexture {
  return canvasTexture('cartonWall', 256, 256, (g) => {
    g.fillStyle = '#b48a58';
    g.fillRect(0, 0, 256, 256);
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < 256; ) {
      const hh = 28 + r() * 40;
      for (let x = -r() * 40; x < 256; ) {
        const ww = 30 + r() * 60;
        const shade = 150 + Math.floor(r() * 60);
        g.fillStyle = `rgb(${shade + 30}, ${shade}, ${shade - 50})`;
        g.fillRect(x + 1, y + 1, ww - 2, hh - 2);
        // Tape and a label on some.
        if (r() < 0.5) {
          g.fillStyle = 'rgba(120, 90, 50, 0.6)';
          g.fillRect(x + ww / 2 - 3, y + 1, 6, hh - 2);
        }
        if (r() < 0.35) {
          g.fillStyle = '#f3f1ea';
          g.fillRect(x + 6, y + hh * 0.4, Math.min(22, ww * 0.4), Math.min(14, hh * 0.3));
        }
        x += ww;
      }
      y += hh;
    }
    g.strokeStyle = 'rgba(40, 30, 20, 0.5)';
    g.lineWidth = 1;
  });
}
