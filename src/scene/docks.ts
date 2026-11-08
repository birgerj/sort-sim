// The dock side of the hall (north wall): the chutes feed roller belts that
// end at truck docks. Each dock serves one city; its five roll cages each take
// a part of the city's postcodes (on the board on each cage). At the end of
// each belt a worker takes the parcels off; the flow projector above shows the
// parcel's postcode on it, and the worker walks it to the cage that takes it.
// The trucks stand outside, behind open dock doors.
//
// By day the workers work, one move per beat: pick, carry, drop, step back.
// By night they dance, and the parcels drop into the cages by themselves.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { FloorKit } from './floor';
import { NORTH_CITIES, rangeOf, rangeText, split } from '../sim/postcodes';
import { Labels } from './labels';
import { buildHuman } from './people';
import { checkerPlate, sectionalDoor, wireMesh } from './textures';

type V3 = THREE.Vector3;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** z of the end of the dock belts, and of the wall. */
export const DOCK_BELT_END = -25.4;
const WALL_Z = -34;

/** What the docks need from a parcel (the Sorter's parcels have all of it). */
export interface DockParcel {
  pos: V3;
  q: THREE.Quaternion;
  h: number;
  /** Length along the belt, width, and weight. */
  d: number;
  w: number;
  kg: number;
  dead: boolean;
  /** Postcode (four digits). */
  pc: number;
}

interface Cage {
  /** Home position by the belt. */
  at: V3;
  /** Postcodes it takes. */
  range: [number, number];
  n: number;
  /** Volume (m³) and weight (kg) of the parcels in it. */
  vol: number;
  kg: number;
  g: THREE.Group;
  pile: THREE.Object3D[];
  /** The parcels in it. */
  items: DockParcel[];
  /** By the belt; being pushed or pulled by the worker; in the trailer (gone with the truck). */
  state: 'home' | 'moving' | 'gone';
  /** Full: waiting to go into the trailer. */
  ry: number;
}

/** What a dock needs from its truck (by dock x). */
export interface TruckLink {
  open(x: number): boolean;
  reserve(x: number, n: 1 | -1): void;
  /** One load into the trailer: its volume (m³) and weight (kg). */
  load(x: number, vol: number, kg: number): void;
  /** The truck is in cleardown (it leaves once everything is in). */
  clearing?(x: number): boolean;
}

/**
 * One step of the worker's job, in whole beats: walk somewhere, pick a parcel off
 * the belt, carry it, put it in a cage, push a cage into the trailer, or pull an
 * empty one out of a new truck.
 */
interface Step {
  beats: number;
  /** Where the worker ends up. */
  to: V3;
  /** Point to face while doing it. */
  face?: V3;
  pose: 'walk' | 'pick' | 'carry' | 'drop' | 'push';
  /** A cage that moves along with the worker, to this spot. */
  cage?: { c: Cage; to: V3 };
  done?: () => void;
}

interface Worker {
  root: THREE.Group;
  torso: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  home: V3;
  steps: Step[];
  step: Step | null;
  /** Beat the current step started, and where the worker and its cage were then. */
  t0: number;
  from: V3;
  cageFrom: V3;
  parcel: DockParcel | null;
  /** Where the parcel lay on the belt when picked. */
  pickFrom: V3;
  cage: number;
  yaw: number;
}

interface Dock {
  x: number;
  chute: number;
  city: number;
  queue: DockParcel[];
  cages: Cage[];
  worker: Worker;
}

export interface DockHandlers {
  /** Flow projector of this dock shows the parcel's postcode on it (follows `target`). */
  mark(chute: number, target: V3, code: string): void;
  /** A parcel left in a cage (for the dock lamp). */
  shipped(chute: number): void;
  /** Keep a parcel inside a moving thing (a cage), at a local position. */
  hold(p: DockParcel, holder: THREE.Object3D, local: V3): void;
  /** A parcel for another dock (a missort), put in the return tote. */
  missort(p: DockParcel): void;
  truck: TruckLink;
}

/** Parcels in a full roll cage. */
const CAGE_FULL = 12;
/** A roll cage is full by volume: about this much of parcels (m³), stacked as well as they go. */
const CAGE_M3 = 1.1;
/** Card colours on the cages (pastel, for black print). */
const CARD_COLS = ['#ffe45c', '#9fd8ff', '#a6e8a0', '#ffb877', '#f6a6d6'];
/** Roll cages per dock. */
const CAGES = 5;
/** The front parcel stops this far before the end of the belt. */
const QUEUE_FRONT = 0.1;

let cageGeo: Record<'frame' | 'wheels' | 'parcel', THREE.BufferGeometry> | null = null;
/** Roll cage geometry, built once: frame and wheels merged, and a parcel for the pile. */
function cageGeometry(): Record<'frame' | 'wheels' | 'parcel', THREE.BufferGeometry> {
  if (cageGeo) return cageGeo;
  const parts: THREE.BufferGeometry[] = [];
  const part = (w: number, h: number, d: number, x: number, y: number, z: number) => parts.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  part(1.4, 0.08, 1.1, 0, 0.3, 0);
  for (const sx of [-0.68, 0.68]) for (const sz of [-0.52, 0.52]) part(0.06, 1.7, 0.06, sx, 1.1, sz);
  for (const sz of [-0.52, 0.52]) part(1.4, 0.06, 0.06, 0, 1.92, sz);
  for (const sx of [-0.68, 0.68]) part(0.06, 0.06, 1.1, sx, 1.92, 0);
  const wheels: THREE.BufferGeometry[] = [];
  for (const sx of [-0.55, 0.55]) for (const sz of [-0.42, 0.42]) wheels.push(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 10).rotateX(Math.PI / 2).translate(sx, 0.12, sz));
  cageGeo = { frame: mergeGeometries(parts)!, wheels: mergeGeometries(wheels)!, parcel: new THREE.BoxGeometry(0.5, 0.28, 0.42) };
  return cageGeo;
}

/** Place k in a roll cage (local): two by two, in layers. */
function cageSlot(k: number, out: V3): V3 {
  return out.set((k % 2 ? 0.3 : -0.3), 0.36 + Math.floor(k / 4) * 0.48, (Math.floor(k / 2) % 2 ? 0.22 : -0.22));
}

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const UP = new THREE.Vector3(0, 1, 0);

export class Docks {
  readonly docks: Dock[] = [];
  private boardsDay: boolean | null = null;
  private readonly t = new THREE.Vector3();
  private readonly hands = new THREE.Vector3();
  private readonly o = new THREE.Object3D();
  private readonly q = new THREE.Quaternion();
  /** Postcode boards on the cages (two per cage, back to back). */
  private boards: Labels;
  private readonly m = new THREE.Matrix4();

  constructor(
    private kit: FloorKit,
    lines: { x: number; chute: number }[],
    private handlers: DockHandlers,
  ) {
    this.boards = new Labels(lines.length * CAGES * 2, 0.34, 0.24, 170, 120);
    kit.put(this.boards.mesh);
    for (const [n, l] of lines.entries()) this.buildDock(l.x, l.chute, n + 1, n);
  }

  /** City of a dock (by chute), or −1. */
  cityOf(chute: number): number {
    return this.docks.find((d) => d.chute === chute)?.city ?? -1;
  }

  /** Projector position and default target for each dock (for the projector rig). */
  static projectorAt(x: number): V3 {
    return v(x, 0, DOCK_BELT_END - 1.4);
  }

  /** Belt length taken by the queue at a dock's belt end (by chute). */
  depth(chute: number): number {
    const d = this.docks.find((x) => x.chute === chute);
    return QUEUE_FRONT + (d ? d.queue.reduce((a, p) => a + p.d + 0.06, 0) : 0);
  }

  /** Room left on a dock's belt end (the sorter holds parcels back when it is full). */
  space(chute: number): number {
    // The belt end counts as full when the parcels on it reach back about 4 m (a photo eye there).
    const d = this.docks.find((x) => x.chute === chute);
    return d ? Math.min(6 - d.queue.length, Math.floor((4.2 - this.depth(chute)) / 0.7)) : 0;
  }

  /** Cages still to go into the trailer at this dock's cleardown (the truck waits for them). */
  pending(x: number): boolean {
    const d = this.docks.find((k) => k.x === x);
    return !!d && (d.cages.some((c) => c.state !== 'gone') || d.worker.step?.pose === 'push');
  }

  arrive(chute: number, p: DockParcel): void {
    const d = this.docks.find((x) => x.chute === chute);
    if (!d || d.queue.length >= 5) {
      p.dead = true;
      return;
    }
    d.queue.push(p);
  }

  /** One beat: each worker finishes a step or starts the next job. Day and night alike. */
  beat(b: number, day: boolean): void {
    void day;
    for (const d of this.docks) {
      const w = d.worker;
      if (w.step && b >= w.t0 + w.step.beats) {
        const st = w.step;
        w.step = null;
        if (st.cage) st.cage.c.g.position.copy(st.cage.to);
        w.root.position.copy(st.to).setY(0);
        st.done?.();
      }
      if (!w.step && !w.steps.length) this.plan(d);
      if (!w.step && w.steps.length) {
        w.step = w.steps.shift()!;
        w.t0 = b;
        w.from.copy(w.root.position).setY(0);
        if (w.step.cage) w.cageFrom.copy(w.step.cage.c.g.position);
      }
    }
  }

  /** The next job: load the trailer at cleardown, fetch empty cages from a new truck, ship full ones, or sort a parcel. */
  private plan(d: Dock): void {
    const w = d.worker;
    const T = this.handlers.truck;
    const door = v(d.x, 0, WALL_Z - 1.4);
    const aisle = v(d.x, 0, DOCK_BELT_END - 3.4);
    const home = d.cages.filter((c) => c.state === 'home');
    // The order cages go in: the one at the end first (it stands in the way), then the sides.
    const order = [2, 1, 3, 0, 4];
    if (T.clearing?.(d.x) && home.length) {
      this.pushJob(d, d.cages[order.find((i) => d.cages[i]!.state === 'home')!]!, door, aisle);
      return;
    }
    if (T.open(d.x)) {
      const gone = [...order].reverse().find((i) => d.cages[i]!.state === 'gone');
      if (gone !== undefined) {
        this.fetchJob(d, d.cages[gone]!, door, aisle);
        return;
      }
      const full = home.find((c) => this.isFull(c));
      if (full) {
        this.pushJob(d, full, door, aisle);
        return;
      }
    }
    const p = d.queue[0];
    // Not for any cage here (sent to the wrong dock): into the return tote beside the belt.
    if (p && rangeOf(d.cages.map((c) => c.range), p.pc) < 0) {
      d.queue.shift();
      w.parcel = p;
      w.cage = -1;
      w.pickFrom.copy(p.pos);
      this.handlers.mark(d.chute, p.pos, String(p.pc));
      const tote = v(d.x + 0.9, 0, DOCK_BELT_END - 0.4);
      w.steps.push(
        { beats: 1, to: w.home, face: v(d.x, 0, DOCK_BELT_END + 0.35), pose: 'pick' },
        { beats: 1, to: w.home, face: tote, pose: 'carry' },
        {
          beats: 1,
          to: w.home,
          face: tote,
          pose: 'drop',
          done: () => {
            w.parcel = null;
            this.handlers.missort(p);
          },
        },
      );
      return;
    }
    const ci = p ? this.pickCage(d, p) : -1;
    if (!p || ci < 0) return;
    // A parcel: pick it off the belt (the projector shows its postcode), walk to its cage, put it in, step back.
    d.queue.shift();
    w.parcel = p;
    w.pickFrom.copy(p.pos);
    w.cage = ci;
    const c = d.cages[ci]!;
    const belt = v(d.x, 0, DOCK_BELT_END + 0.35);
    const near = w.home.clone().lerp(c.at, 0.5).setY(0);
    this.handlers.mark(d.chute, p.pos, String(p.pc));
    w.steps.push(
      { beats: 1, to: w.home, face: belt, pose: 'pick' },
      { beats: 1, to: near, face: c.at, pose: 'carry' },
      {
        beats: 1,
        to: near,
        face: c.at,
        pose: 'drop',
        done: () => {
          this.put(d, ci, p);
          w.parcel = null;
        },
      },
      { beats: 1, to: w.home, face: belt, pose: 'walk' },
    );
  }

  /** Walk to the cage, push it out through the door into the trailer, come back. */
  private pushJob(d: Dock, c: Cage, door: V3, aisle: V3): void {
    const w = d.worker;
    const T = this.handlers.truck;
    c.state = 'moving';
    T.reserve(d.x, 1);
    const back = (to: V3, from: V3) => to.clone().addScaledVector(this.t.subVectors(to, from).setY(0).normalize(), -0.9);
    const turn = c.at.distanceTo(aisle) > 0.5;
    w.steps.push({ beats: 1, to: back(c.at, turn ? aisle : door), face: c.at, pose: 'walk' });
    if (turn) w.steps.push({ beats: 2, to: back(aisle, door), face: aisle, pose: 'push', cage: { c, to: aisle } });
    w.steps.push({
      beats: 2,
      to: back(door, aisle),
      face: door,
      pose: 'push',
      cage: { c, to: door },
      done: () => {
        c.state = 'gone';
        c.g.visible = false;
        T.load(d.x, c.vol, c.kg);
        c.n = 0;
        c.vol = 0;
        c.kg = 0;
        // Its parcels leave with the truck.
        for (const p of c.items) p.dead = true;
        c.items = [];
        T.reserve(d.x, -1);
      },
    });
    w.steps.push({ beats: 2, to: w.home, face: v(d.x, 0, DOCK_BELT_END), pose: 'walk' });
  }

  /** Walk into the new truck, pull out an empty cage, push it to its place. */
  private fetchJob(d: Dock, c: Cage, door: V3, aisle: V3): void {
    const w = d.worker;
    const T = this.handlers.truck;
    c.state = 'moving';
    T.reserve(d.x, 1);
    w.steps.push({
      beats: 2,
      to: door.clone().setZ(door.z + 0.9),
      face: door,
      pose: 'walk',
      done: () => {
        c.g.position.copy(door);
        c.g.visible = true;
      },
    });
    const turn = c.at.distanceTo(aisle) > 0.5;
    const ahead = (to: V3, from: V3) => to.clone().addScaledVector(this.t.subVectors(to, from).setY(0).normalize(), -0.9);
    if (turn) w.steps.push({ beats: 2, to: ahead(aisle, door), face: aisle, pose: 'push', cage: { c, to: aisle } });
    w.steps.push({
      beats: 2,
      to: ahead(c.at, turn ? aisle : door),
      face: c.at,
      pose: 'push',
      cage: { c, to: c.at },
      done: () => {
        c.state = 'home';
        c.g.rotation.y = c.ry;
        T.reserve(d.x, -1);
      },
    });
    w.steps.push({ beats: 1, to: w.home, face: v(d.x, 0, DOCK_BELT_END), pose: 'walk' });
  }

  update(dt: number, bt: number, s: { kick: number; snare: number; dayShown: boolean }): void {
    if (s.dayShown !== this.boardsDay) {
      this.boardsDay = s.dayShown;
      for (const m of boardMats) m.color.setScalar(s.dayShown ? 1 : 0.22);
      this.boards.dim(s.dayShown ? 1 : 0.3);
    }
    const ph = bt - Math.floor(bt);
    for (const d of this.docks) {
      // Parcels waiting at the belt end.
      // Parcels banked up at the belt end, nose to tail.
      let at = QUEUE_FRONT;
      for (const p of d.queue) {
        this.t.set(d.x, 1.02, DOCK_BELT_END + at + p.d / 2);
        at += p.d + 0.06;
        p.pos.lerp(this.t, Math.min(1, dt * 8));
      }
      this.animateWorker(d, dt, bt, ph, s);
    }
    // Cage cards hang on the outside of the mesh, on the side facing the worker and on the back.
    this.docks.forEach((d, n) =>
      d.cages.forEach((c, i) => {
        c.g.updateMatrix();
        for (const side of [0, 1]) {
          if (c.state === 'gone') this.m.makeScale(0, 0, 0);
          else this.m.makeRotationY(side * Math.PI).setPosition(0, 1.25, side ? -0.565 : 0.565).premultiply(c.g.matrix);
          this.boards.place((n * CAGES + i) * 2 + side, this.m);
        }
      }),
    );
    this.boards.flush();
  }

  /** The cage for this parcel's postcode, if it is by the belt and not full (−1 if not). */
  private pickCage(d: Dock, p: DockParcel): number {
    const i = rangeOf(d.cages.map((c) => c.range), p.pc);
    const c = d.cages[i];
    return c && c.state === 'home' && !this.isFull(c) ? i : -1;
  }

  /** Full by volume (or out of places to stack). */
  private isFull(c: Cage): boolean {
    return c.n >= CAGE_FULL || c.vol >= CAGE_M3;
  }

  /** How full each cage is (0–1), for the boards and screens. */
  fillOf(c: Cage): number {
    return Math.min(1, Math.max(c.vol / CAGE_M3, c.n / CAGE_FULL));
  }

  private writePile(c: Cage): void {
    c.pile.forEach((p, k) => (p.visible = k < c.n));
  }

  /** Where the next parcel goes in this cage (world). */
  private cageTop(c: Cage): V3 {
    c.g.updateMatrixWorld();
    const p = cageSlot(c.n, new THREE.Vector3());
    return p.setY(p.y + 0.3).applyMatrix4(c.g.matrixWorld);
  }

  private put(d: Dock, cage: number, p: DockParcel): void {
    const c = d.cages[cage]!;
    // The parcel itself stays in the cage (same shape and colour), stacked, and rides along with it.
    this.handlers.hold(p, c.g, cageSlot(c.n, new THREE.Vector3()));
    c.items.push(p);
    c.n = Math.min(CAGE_FULL, c.n + 1);
    c.vol += p.w * p.h * p.d;
    c.kg += p.kg;
    this.handlers.shipped(d.chute);
  }

  private animateWorker(d: Dock, dt: number, bt: number, ph: number, s: { kick: number; snare: number; dayShown: boolean }): void {
    const w = d.worker;
    const k = Math.min(1, dt * 12);
    const st = w.step;
    let pos: V3 = w.root.position.clone().setY(0);
    let face = w.yaw;
    let bend = 0;
    let armF = 0.1;
    let armUpL = 0;
    let armUpR = 0;
    let bounce = 0;
    let step = 0;
    let dance = false;
    if (st) {
      const f = Math.min(1, Math.max(0, (bt - w.t0) / st.beats));
      const e = ease(f);
      pos = w.from.clone().lerp(st.to, e);
      if (st.face) face = Math.atan2(st.face.x - pos.x, st.face.z - pos.z);
      const moving = w.from.distanceTo(st.to) > 0.2;
      if (moving) step = Math.sin(f * Math.PI * 2 * st.beats) * 0.5;
      if (st.cage) {
        st.cage.c.g.position.lerpVectors(w.cageFrom, st.cage.to, e);
        // Push from behind: face the way the cage goes.
        this.t.subVectors(st.cage.to, w.cageFrom);
        if (this.t.lengthSq() > 0.01) face = Math.atan2(this.t.x, this.t.z);
      }
      if (st.pose === 'pick') {
        bend = 0.55 * Math.sin(f * Math.PI);
        armF = 0.1 + 1.3 * f;
      } else if (st.pose === 'carry') armF = 1.4;
      else if (st.pose === 'drop') {
        bend = 0.5 * Math.sin(f * Math.PI);
        armF = 1.4 - 1.2 * f;
      } else if (st.pose === 'push') {
        armF = 1.5;
        bend = 0.25;
      }
      // The parcel follows the hands.
      if (w.parcel && (st.pose === 'pick' || st.pose === 'carry' || st.pose === 'drop')) {
        // (Its own vector: cageTop below uses this.t.)
        const hands = this.hands.set(Math.sin(w.yaw) * 0.55, 0.95, Math.cos(w.yaw) * 0.55).add(w.root.position).setY(0.95);
        if (st.pose === 'pick') w.parcel.pos.lerpVectors(w.pickFrom, hands, ease(ph));
        else if (st.pose === 'drop') w.parcel.pos.lerpVectors(hands, w.cage < 0 ? v(d.x + 0.9, 0.5, DOCK_BELT_END - 0.4) : this.cageTop(d.cages[w.cage]!), ease(ph));
        else w.parcel.pos.copy(hands);
        this.q.setFromAxisAngle(UP, w.yaw);
        w.parcel.q.copy(this.q);
      }
    } else if (!s.dayShown) {
      // Nothing to do at night: dance. Bounce on the kick, arms up in turns.
      dance = true;
      const beat = Math.floor(bt);
      face = w.yaw + Math.sin(bt * Math.PI * 0.5) * 0.04;
      bounce = 0.12 * s.kick;
      armUpL = beat % 2 ? 2.6 : 0.6 + s.snare;
      armUpR = beat % 2 ? 0.6 + s.snare : 2.6;
      bend = -0.15 * s.snare;
      step = Math.sin(bt * Math.PI) * 0.4;
    } else bend = 0.04 * Math.sin(bt * Math.PI * 0.5);
    w.root.position.lerp(this.t.copy(pos).setY(bounce), st ? 1 : k);
    let dy = face - w.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    w.yaw += dy * (dance ? 0.08 : k);
    w.root.rotation.y = w.yaw;
    w.torso.rotation.x += (bend - w.torso.rotation.x) * k;
    const armL = dance ? -armUpL : -armF;
    const armR = dance ? -armUpR : -armF;
    w.armL.rotation.x += (armL - w.armL.rotation.x) * k;
    w.armR.rotation.x += (armR - w.armR.rotation.x) * k;
    w.legL.rotation.x = step;
    w.legR.rotation.x = -step;
  }

  // ---------- building ----------

  private buildDock(x: number, chute: number, number: number, city: number): void {
    const k = this.kit;
    buildDockDoor(k, x, WALL_Z, 1, number);
    // Five roll cages around the belt end: two on each side, one at the end; each takes part of the city.
    // (The belt stops short of them, so the worker can get round to every cage.)
    const E = DOCK_BELT_END;
    const cageAt: [V3, number][] = [
      [v(x - 2.0, 0, E - 1.2), Math.PI / 2],
      [v(x - 2.0, 0, E - 2.9), Math.PI / 2],
      [v(x, 0, E - 4.6), 0],
      [v(x + 2.0, 0, E - 2.9), -Math.PI / 2],
      [v(x + 2.0, 0, E - 1.2), -Math.PI / 2],
    ];
    const ranges = split(NORTH_CITIES[city]!, CAGES);
    const cages: Cage[] = cageAt.map(([at, ry], i) => this.buildCage(at, ry, ranges[i]!));
    const n0 = this.docks.length * CAGES;
    cages.forEach((c, i) => {
      // A coloured card about A4 size, black print: postcodes and city.
      const bg = CARD_COLS[i % CARD_COLS.length]!;
      for (const side of [0, 1]) this.boards.set((n0 + i) * 2 + side, rangeText(c.range), NORTH_CITIES[city]!.name, { bg, fg: '#111111', sub: '#111111', border: '#111111' });
    });
    // The return tote for parcels sent here by mistake.
    k.box('tote', k.std(0x1f3f80, 0.6, 0.1, 0x2c62c8), x + 0.9, 0.22, E - 0.4, 0.6, 0.44, 0.42);
    const worker = this.buildWorker(v(x, 0, E - 1.1));
    this.docks.push({ x, chute, city, queue: [], cages, worker });
  }

  private readonly cageMeshGeo = (() => {
    const g = new THREE.BoxGeometry(1.36, 1.5, 1.04);
    // Drop the top and bottom faces (groups 2 and 3), keep the four sides.
    const idx = g.getIndex()!.array;
    const keep: number[] = [];
    for (const grp of g.groups) if (grp.materialIndex !== 2 && grp.materialIndex !== 3) for (let i = grp.start; i < grp.start + grp.count; i++) keep.push(idx[i]!);
    g.setIndex(keep);
    g.clearGroups();
    return g;
  })();
  private meshMat: THREE.MeshStandardMaterial | null = null;
  private cageMeshMat(): THREE.MeshStandardMaterial {
    if (!this.meshMat) {
      const t = wireMesh().clone();
      t.repeat.set(4, 4);
      t.needsUpdate = true;
      this.meshMat = this.kit.std(0x5d6670, 0.5, 0.6, 0x2fa58f);
      this.meshMat.alphaMap = t;
      this.meshMat.alphaTest = 0.5;
      this.meshMat.side = THREE.DoubleSide;
    }
    return this.meshMat;
  }

  private buildCage(at: V3, ry: number, range: [number, number]): Cage {
    const k = this.kit;
    const geo = cageGeometry();
    const mats = this.cageMats ?? (this.cageMats = {
      teal: k.std(0x5d6670, 0.5, 0.6, 0x2fa58f),
      wheel: k.std(0x222222, 0.8, 0.1, 0x333333),
      card: k.std(0x6f5a3f, 0.95, 0, 0xd9b07a),
    });
    const g = new THREE.Group();
    g.position.copy(at);
    g.rotation.y = ry;
    k.put(g);
    k.blobUnder(g, 1.9, 1.6);
    // All parts instanced across the 60 cages.
    k.batch(geo.frame, mats.teal, g);
    k.batch(this.cageMeshGeo, this.cageMeshMat(), g).position.y = 1.1;
    k.batch(geo.wheels, mats.wheel, g);
    const pile: THREE.Object3D[] = [];
    for (let i = 0; i < CAGE_FULL; i++) {
      const p = k.batch(geo.parcel, mats.card, g);
      p.position.set(((i % 2) - 0.5) * 0.5, 0.42 + Math.floor(i / 2) * 0.3, ((Math.floor(i / 2) % 2) - 0.5) * 0.3);
      p.rotation.y = i * 0.7;
      p.visible = false;
      pile.push(p);
    }
    return { at, range, n: 0, vol: 0, kg: 0, g, pile, items: [], state: 'home', ry };
  }

  private cageMats: Record<'teal' | 'wheel' | 'card', THREE.MeshStandardMaterial> | null = null;


  /** A worker with jointed arms, legs and torso, so they can work and dance. */
  private buildWorker(home: V3): Worker {
    const n = this.docks.length;
    const h = buildHuman(this.kit, {
      shirt: [0x2f3b6b, 0x2fa58f, 0xf3f4f6, 0x6b7280][n % 4]!,
      trousers: [0x22283f, 0x3a3d44][n % 2]!,
      vest: n % 3 === 2 ? 0xf2a51a : 0xc8ff3a,
      helmet: [0xffffff, 0xf2c200, 0x1755fe][n % 3]!,
      skin: [0xf0cfb0, 0xd9a77e, 0x8d5a3b, 0xf5d9c4][n % 4]!,
    });
    h.root.position.copy(home);
    this.kit.put(h.root);
    return { ...h, home, steps: [], step: null, t0: 0, from: home.clone(), cageFrom: new THREE.Vector3(), parcel: null, pickFrom: new THREE.Vector3(), cage: 0, yaw: Math.PI };
  }

}

/**
 * A dock door in a wall at z = wallZ, opening into the hall towards +z (dir 1)
 * or −z (dir −1): a dark trailer behind an open door, rubber shelter, rolled-up
 * door, leveler, bumpers, an amber lamp and a number board. `closed` rolls the
 * door down.
 */
/** Number boards of all dock doors: paper, not lights, so dimmed by night (in Docks.update). */
const boardMats: THREE.MeshBasicMaterial[] = [];

const doorMats = new WeakMap<FloorKit, Record<string, THREE.Material>>();
/** Materials shared by all dock doors (so the box batches stay few). */
function dockMats(k: FloorKit): Record<string, THREE.Material> {
  let m = doorMats.get(k);
  if (!m) {
    const door = k.std(0x2c3038, 0.6, 0.5, 0xd5dae0);
    const closedDoor = k.std(0x2c3038, 0.6, 0.4, 0xffffff);
    closedDoor.map = sectionalDoor();
    const leveler = k.std(0x3a3d44, 0.6, 0.6, 0xb9c0c8);
    leveler.map = checkerPlate();
    m = {
      dark: k.std(0x0d0e10, 0.9, 0, 0x2a2c31),
      rubber: k.std(0x15161a, 0.9, 0, 0x26282e),
      door,
      closedDoor,
      leveler,
      stripes: k.std(0x8a6e00, 0.6, 0.2, 0xf2c200),
      ampOn: new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.1, 0.1) }),
      ampOff: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.05, 0.03) }),
      green: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.4, 0.4) }),
    };
    doorMats.set(k, m);
  }
  return m;
}

export function buildDockDoor(k: FloorKit, x: number, wallZ: number, dir: 1 | -1, number: number, closed = false): void {
  const z = (d: number) => wallZ + dir * d;
  const M = dockMats(k);
  const { dark, rubber, door } = M as Record<string, THREE.Material>;
  if (closed) k.box('rolldoor', M.closedDoor!, x, 1.9, z(0.08), 3.2, 3.8, 0.1);
  else {
    // (The wall has an opening here; the trailer behind it is built by the hall.)
    void dark;
    k.box('rolldoor', door!, x, 4.4, z(0.25), 3.6, 0.7, 0.35);
  }
  k.box('shelter', rubber!, x - 1.8, 2.0, z(0.2), 0.4, 4.0, 0.3);
  k.box('shelter', rubber!, x + 1.8, 2.0, z(0.2), 0.4, 4.0, 0.3);
  k.box('shelter', rubber!, x, 3.95, z(0.2), 4.0, 0.3, 0.3);
  // Yellow guide stripes down the shelter.
  for (const sx of [-1.8, 1.8]) k.box('sstripe', M.stripes!, x + sx, 2.0, z(0.36), 0.12, 3.6, 0.02);
  k.box('leveler', M.leveler!, x, 0.03, z(1.1), 3.0, 0.06, 2.2);
  for (const sx of [-1.65, 1.65]) k.box('bumper', M.stripes!, x + sx, 0.5, z(0.3), 0.3, 1.0, 0.3);
  // Traffic light for the truck driver: amber when loading, dark red when closed; a green one beside it.
  k.box('dockled', closed ? M.ampOff! : M.ampOn!, x - 2.3, 4.0, z(0.15), 0.3, 0.3, 0.1);
  if (!closed) k.box('dockled', M.green!, x - 2.3, 3.6, z(0.15), 0.22, 0.22, 0.1);
  // Control box with buttons, beside the door.
  k.box('dockctl', door!, x + 2.35, 1.4, z(0.12), 0.35, 0.5, 0.15);
  const bm = new THREE.MeshBasicMaterial({ map: numberTex(String(number)) });
  boardMats.push(bm);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), bm);
  board.position.set(x, 5.4, z(0.12));
  if (dir < 0) board.rotation.y = Math.PI;
  k.put(board);
}

function numberTex(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#1d1d1f';
    g.lineWidth = 4;
    g.strokeRect(2, 2, 60, 60);
    g.fillStyle = '#1d1d1f';
    g.font = '700 40px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 32, 35);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
