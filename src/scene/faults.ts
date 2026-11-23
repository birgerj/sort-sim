// The technician: when a dock chute goes down (see `src/sim/faults.ts`) he leaves his
// workbench under the maintenance platform, rides a stand-up scooter along the inside of
// the loop, ducks under it beside the chute, walks to the chute exit with his toolbox and
// works on it for a few bars. Then the chute runs again, and he rides on to the next fault
// or back to his bench.
//
// Day and night alike (the hall keeps running at the party). Every move takes whole beats:
// a leg of the ride or a walk is stretched to end on a beat, and the repair is two bars of
// work at the chute, a reach for a tool in the box, and so on, on the beat.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import type { FloorKit } from './floor';
import { buildHuman, type Human } from './people';
import { crouch, gait, reach, relaxArms, settle, swingArms } from './motion';
import type { Fault, FaultPlan } from '../sim/faults';

type V2 = [number, number];

/** One dock chute where a fault can be repaired. */
export interface FaultSite {
  chute: number;
  /** Where the scooter is left (outside the loop, beside the chute's belt). */
  park: V2;
  /** Where the technician stands to work, and what he works on (hand height, world). */
  stand: V2;
  work: THREE.Vector3;
  /** The way in from the corridor inside the loop: the corridor point first, `park` last. */
  way: V2[];
}

export interface CrewLayout {
  /** At the workbench: where he stands, and the point on the bench top he works at. */
  bench: V2;
  benchTop: THREE.Vector3;
  /** Where the scooter waits at home, and its heading. */
  park: V2;
  parkYaw: number;
  /** From the home park to the corridor inside the loop (not including `park`). */
  out: V2[];
  sites: FaultSite[];
}

/** Ride speed (metres per beat): a brisk stand-up scooter. Walking speed. */
const RIDE = 2.6;
const WALK = 0.75;
/** Beats of work at a chute (two bars of four, and a last check). */
const REPAIR_BEATS = 12;
/** Height of the scooter deck's top: the technician stands on it. */
const DECK = 0.155;

type Toolbox = 'scooter' | 'hand' | 'floor';

/** A leg of movement: along a polyline, at a constant speed, over whole beats. */
interface Leg {
  pts: V2[];
  acc: number[];
  t0: number;
  t1: number;
  ride: boolean;
}

interface Task {
  /** Walk or ride along these points (from where he is), or stay for `beats`. */
  pts?: V2[];
  ride?: boolean;
  beats?: number;
  pose: 'walk' | 'ride' | 'bench' | 'repair';
  toolbox: Toolbox;
  /** Face this point while staying. */
  face?: V2;
  start?: () => void;
  end?: () => void;
}

export class FaultCrew {
  readonly h: Human;
  private group = new THREE.Group();
  private scooter = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private toolbox!: THREE.Group;
  private light!: THREE.MeshBasicMaterial;
  /** Faults waiting for him, oldest first, and the one he is on. */
  private queue: Fault[] = [];
  private on: Fault | null = null;
  private site: FaultSite | null = null;
  private tasks: Task[] = [];
  private task: Task | null = null;
  private leg: Leg | null = null;
  private until = 0;
  private x: number;
  private z: number;
  private yaw = Math.PI;
  private sx: number;
  private sz: number;
  private syaw: number;
  private toolPos = new THREE.Vector3();
  private readonly sites = new Map<number, FaultSite>();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  /** Called when a chute runs again (the scene flashes its lamps green). */
  onRepaired: (chute: number) => void = () => {};
  /** Called when a random fault starts (not for faults reported from outside). */
  onFault: (f: Fault) => void = () => {};

  constructor(
    private k: FloorKit,
    private L: CrewLayout,
    private plan: FaultPlan,
  ) {
    for (const s of L.sites) this.sites.set(s.chute, s);
    k.put(this.group);
    // Navy work clothes with reflective bands (a vest of the same blue).
    this.h = buildHuman(k, { shirt: 0x22283f, trousers: 0x22283f, vest: 0x1d4ed8, build: { height: 1, width: 1, belly: 0.3 }, hairStyle: 0 });
    this.group.add(this.h.root);
    this.buildScooter();
    this.buildBench();
    [this.x, this.z] = L.bench;
    [this.sx, this.sz] = L.park;
    this.syaw = L.parkYaw;
    this.idle();
  }


  /** Where he is (for the camera and taps). */
  get root(): THREE.Object3D {
    return this.h.root;
  }

  /** Which way he faces (for the camera). */
  get heading(): number {
    return this.yaw;
  }

  /** What he is doing now (for the camera): at the bench, walking, riding, or repairing. */
  get doing(): Task['pose'] {
    return this.task?.pose ?? 'bench';
  }

  /** What he is doing, for the chute displays: on the way, or at work on it. */
  status(chute: number): 'waiting' | 'coming' | 'working' {
    if (this.on?.chute !== chute) return this.queue.some((f) => f.chute === chute) ? 'waiting' : 'coming';
    return this.task?.pose === 'repair' ? 'working' : 'coming';
  }

  /**
   * Everything runs again and he is at his bench, at once (a shift of the planning game
   * begins: no faults there). Whatever he was on is dropped.
   */
  recall(bt: number): void {
    for (const chute of [...this.plan.down.keys()]) this.plan.repaired(chute, bt);
    this.queue.length = 0;
    this.on = null;
    const away = this.site !== null || this.leg !== null || this.tasks.some((t) => t.pose !== 'bench');
    if (!away) return;
    this.site = null;
    this.task = null;
    this.leg = null;
    [this.x, this.z] = this.L.bench;
    [this.sx, this.sz] = this.L.park;
    this.syaw = this.L.parkYaw;
    this.idle();
  }

  /** A new fault: he goes as soon as he is free. */
  report(f: Fault): void {
    if (!this.sites.has(f.chute)) return;
    // (At the bench he finishes the bar he is in, then goes.)
    this.queue.push(f);
  }

  update(dt: number, bt: number): void {
    for (const f of this.plan.tick(bt)) {
      this.onFault(f);
      this.report(f);
    }
    // Start what comes next once the current task is done (on its beat).
    if (!this.task) this.next(Math.ceil(bt));
    let guard = 0;
    while (this.task && bt >= this.until && guard++ < 8) this.next(this.until);
    this.move(bt);
    this.place();
    this.pose(dt, bt);
  }

  // ---------- plans ----------

  /** At the bench: stays there (a bar at a time) until a fault comes in. */
  private idle(): void {
    this.tasks = [{ pose: 'bench', beats: 4, toolbox: 'scooter', face: [this.L.benchTop.x, this.L.benchTop.z] }];
  }

  /** The next task, from beat `t`. */
  private next(t: number): void {
    this.task?.end?.();
    if (!this.tasks.length) this.plan_(t);
    const task = this.tasks.shift()!;
    this.task = task;
    task.start?.();
    if (task.pts) {
      const pts: V2[] = [task.ride ? [this.sx, this.sz] : [this.x, this.z], ...task.pts];
      const acc = [0];
      for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
      const len = acc[acc.length - 1]!;
      const beats = Math.max(1, Math.ceil(len / (task.ride ? RIDE : WALK)));
      this.leg = { pts, acc, t0: t, t1: t + beats, ride: !!task.ride };
      this.until = t + beats;
    } else {
      this.leg = null;
      this.until = t + (task.beats ?? 1);
    }
  }

  /** Out of tasks: the next fault in the queue, or home. */
  private plan_(_t: number): void {
    const L = this.L;
    const f = this.queue.shift();
    const atHome = this.site === null;
    if (!f) {
      if (atHome) return this.idle();
      // Back home: ride out from under the loop, along the corridor, to the bench.
      const back = [...this.site!.way].reverse().slice(1);
      this.site = null;
      this.tasks = [
        { pose: 'ride', ride: true, pts: [...back, ...[...L.out].reverse(), L.park], toolbox: 'scooter' },
        { pose: 'walk', pts: [L.bench], toolbox: 'scooter' },
      ];
      this.tasks.push(...this.idleTasks());
      return;
    }
    const s = this.sites.get(f.chute)!;
    this.on = f;
    this.tasks = [];
    if (atHome) {
      // From the bench to the scooter, and off along the corridor.
      this.tasks.push({ pose: 'walk', pts: [this.parkSide()], toolbox: 'scooter' });
      this.tasks.push({ pose: 'ride', ride: true, pts: [...L.out, ...s.way], toolbox: 'scooter' });
    } else {
      // From one chute to the next: back under the loop, along the corridor, and in again.
      this.tasks.push({ pose: 'ride', ride: true, pts: [...[...this.site!.way].reverse().slice(1), ...s.way], toolbox: 'scooter' });
    }
    this.site = s;
    const face: V2 = [s.work.x, s.work.z];
    this.tasks.push(
      { pose: 'walk', pts: [s.stand], toolbox: 'hand' },
      {
        pose: 'repair',
        beats: REPAIR_BEATS,
        toolbox: 'floor',
        face,
        start: () => this.plan.repairing(f.chute, this.until),
        end: () => {
          this.plan.repaired(f.chute, this.until);
          this.on = null;
          this.onRepaired(f.chute);
        },
      },
      { pose: 'walk', pts: [this.parkSide(s.park)], toolbox: 'hand' },
    );
  }

  private idleTasks(): Task[] {
    return [{ pose: 'bench', beats: 4, toolbox: 'scooter', face: [this.L.benchTop.x, this.L.benchTop.z] }];
  }

  /** Where he steps on or off: beside the scooter's deck (it stands where it was left). */
  private parkSide(at: V2 = [this.sx, this.sz]): V2 {
    return [at[0] - Math.sin(this.syaw) * 0.05, at[1] - Math.cos(this.syaw) * 0.05];
  }

  // ---------- moving ----------

  private move(bt: number): void {
    const leg = this.leg;
    if (!leg) return;
    const f = Math.min(1, Math.max(0, (bt - leg.t0) / (leg.t1 - leg.t0)));
    // Ease into and out of a ride (a scooter does not stop dead); walks are even.
    const e = leg.ride ? smooth(f) : f;
    const s = e * leg.acc[leg.acc.length - 1]!;
    let i = 0;
    while (i < leg.acc.length - 2 && leg.acc[i + 1]! < s) i++;
    const a = leg.pts[i]!;
    const b = leg.pts[i + 1]!;
    const seg = leg.acc[i + 1]! - leg.acc[i]!;
    const u = seg > 1e-6 ? (s - leg.acc[i]!) / seg : 1;
    const x = a[0] + (b[0] - a[0]) * u;
    const z = a[1] + (b[1] - a[1]) * u;
    const want = seg > 1e-6 ? Math.atan2(b[0] - a[0], b[1] - a[1]) : this.yaw;
    if (leg.ride) {
      const d = Math.hypot(x - this.sx, z - this.sz);
      for (const w of this.wheels) w.rotation.x += d / 0.1;
      this.sx = x;
      this.sz = z;
      this.syaw = turnTo(this.syaw, want, 0.25);
      this.x = x;
      this.z = z;
      this.yaw = this.syaw;
    } else {
      this.x = x;
      this.z = z;
      if (f < 1) this.yaw = turnTo(this.yaw, want, 0.3);
    }
  }

  private pose(dt: number, bt: number): void {
    const h = this.h;
    const task = this.task;
    const k = Math.min(1, dt * 8);
    if (task?.face && !this.leg) this.yaw = turnTo(this.yaw, Math.atan2(task.face[0] - this.x, task.face[1] - this.z), Math.min(1, dt * 6));
    h.root.position.set(this.x, task?.pose === 'ride' ? DECK : 0, this.z);
    h.root.rotation.y = this.yaw;
    const pose = task?.pose ?? 'bench';
    let bend = 0.03;
    let nod = 0;
    let squat = 0;
    let walk = 0;
    if (pose === 'walk' && this.leg) walk = WALK;
    if (pose === 'ride') bend = 0.22;
    if (pose === 'bench') {
      bend = 0.32;
      nod = 0.35;
    }
    // Repair: work at the chute exit for three beats out of four; on the fourth, crouch to the toolbox.
    const ph = bt - (this.until - REPAIR_BEATS);
    const toBox = pose === 'repair' && Math.floor(ph) % 4 === 3;
    if (pose === 'repair') {
      bend = toBox ? 0.5 : 0.12;
      nod = toBox ? 0.5 : -0.05;
      squat = toBox ? 0.75 * Math.sin(Math.PI * (ph % 1)) : 0;
    }
    h.torso.rotation.x += (bend - h.torso.rotation.x) * k;
    h.head.rotation.x += (nod - h.head.rotation.x) * k * 0.6;
    h.head.rotation.y += (0 - h.head.rotation.y) * k * 0.4;
    const swing = gait(h, dt, Math.PI * bt, walk);
    crouch(h, squat);
    const kk = Math.min(1, dt * 12);
    if (pose === 'ride') {
      // Hands on the grips: each on its own side (the left arm sits at the body's −x).
      for (const side of ['L', 'R'] as const) {
        this.v.set(side === 'L' ? -0.24 : 0.24, 1.18, 0.34).applyMatrix4(this.scooter.matrix);
        reach(h, side, this.v, kk, 0);
      }
    } else if (pose === 'repair') {
      // Both hands at the chute exit, moving a little on the beat (a screwdriver, a sensor's lens);
      // or the right hand down into the toolbox.
      const w = this.site!.work;
      const right = this.v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const jig = 0.04 * Math.sin(bt * Math.PI * 2);
      if (toBox) {
        reach(h, 'R', this.v.copy(this.toolPos).setY(this.toolPos.y + 0.12), kk, 0);
        relaxArms(h, k * 0.5);
        h.armL.rotation.x += (-0.2 - h.armL.rotation.x) * k;
      } else {
        reach(h, 'L', this.v.copy(w).addScaledVector(right, -0.12 + jig), kk, 0.3);
        reach(h, 'R', this.v.copy(w).addScaledVector(right, 0.1).setY(w.y + 0.06 - jig), kk, 0.3);
      }
    } else if (pose === 'bench') {
      // Tinkering at the bench: hands on the top, a little movement on the beat.
      const t = this.L.benchTop;
      const right = this.v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const jig = 0.05 * Math.sin(bt * Math.PI);
      reach(h, 'L', this.v.copy(t).addScaledVector(right, -0.18), kk, 0.2);
      reach(h, 'R', this.v.copy(t).addScaledVector(right, 0.14 + jig).setY(t.y + Math.abs(jig)), kk, 0.2);
    } else {
      swingArms(h, swing, k);
      if (task?.toolbox === 'hand') {
        // The toolbox in the right hand: that arm hangs, a little out.
        h.armR.rotation.x += (0.05 - h.armR.rotation.x) * k;
        relaxArms(h, k, 0, 0.12);
      }
    }
    settle(h, dt, { idle: pose === 'ride' ? 0 : 1 });
    this.light.color.setScalar(pose === 'ride' ? 2.2 : 0.4);
  }

  /** The scooter and the toolbox where they belong this frame. */
  private place(): void {
    const sc = this.scooter;
    sc.position.set(this.sx, 0, this.sz);
    sc.rotation.y = this.syaw;
    sc.updateMatrix();
    const tb = this.toolbox;
    const where = this.task?.toolbox ?? 'scooter';
    if (where === 'scooter') {
      if (tb.parent !== sc) sc.add(tb);
      tb.position.set(0, DECK + 0.09, 0.27);
      tb.rotation.set(0, Math.PI / 2, 0);
    } else if (where === 'hand') {
      if (tb.parent !== this.h.handR) this.h.handR.add(tb);
      tb.position.set(0, -0.2, 0);
      tb.rotation.set(0, 0, 0);
    } else {
      // On the floor beside him, at his right foot.
      if (tb.parent !== this.group) this.group.add(tb);
      const right = this.v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      // (A little behind him, out of his way.)
      tb.position.set(this.x + right.x * 0.5 - Math.sin(this.yaw) * 0.15, 0.09, this.z + right.z * 0.5 - Math.cos(this.yaw) * 0.15);
      tb.rotation.set(0, this.yaw + Math.PI / 2, 0);
      this.toolPos.copy(tb.position);
    }
  }

  // ---------- models ----------

  /** A stand-up scooter: long low deck, two small wheels, a stem with a handlebar and a lamp. Faces +z. */
  private buildScooter(): void {
    const k = this.k;
    const sc = this.scooter;
    this.group.add(sc);
    const body = k.std(0x1d4ed8, 0.45, 0.3, 0x1755fe);
    const dark = k.std(0x1d1d1f, 0.7, 0.1, 0x2a2c31);
    const steel = k.std(0x6b7078, 0.35, 0.8, 0xb9c0c8);
    const deck = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.06, 1.0, 2, 0.025), body);
    deck.position.set(0, DECK - 0.03, -0.02);
    sc.add(deck);
    // Grip tape on top.
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.004, 0.78), dark);
    tape.position.set(0, DECK + 0.002, -0.08);
    sc.add(tape);
    for (const z of [-0.5, 0.48]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 18).rotateZ(Math.PI / 2), dark);
      w.position.set(0, 0.1, z);
      sc.add(w);
      this.wheels.push(w);
      // A fork either side of the wheel.
      for (const x of [-0.045, 0.045]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.1, 0.03), steel);
        f.position.set(x, 0.14, z);
        sc.add(f);
      }
    }
    // The stem, leaning back a little, and the handlebar with black grips.
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.05, 10), steel);
    stem.position.set(0, 0.68, 0.43);
    stem.rotation.x = -0.1;
    sc.add(stem);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.56, 8).rotateZ(Math.PI / 2), steel);
    bar.position.set(0, 1.18, 0.34);
    sc.add(bar);
    for (const x of [-0.24, 0.24]) {
      const g = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.11, 8).rotateZ(Math.PI / 2), dark);
      g.position.set(x, 1.18, 0.34);
      sc.add(g);
    }
    // Headlamp on the stem: bright while riding (and it glows at the party).
    this.light = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.4, 0.4) });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12).rotateX(Math.PI / 2), this.light);
    lamp.position.set(0, 0.95, 0.425);
    sc.add(lamp);
    this.k.blobUnder(sc, 0.5, 1.3);
    sc.matrixAutoUpdate = true;

    // The toolbox: red, with a black lid edge and a handle.
    const tb = new THREE.Group();
    const red = k.std(0x8a1a14, 0.45, 0.2, 0xe2231a);
    tb.add(new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.17, 0.18, 2, 0.02), red));
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.02, 0.19), dark);
    lid.position.y = 0.05;
    tb.add(lid);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 14, Math.PI), dark);
    handle.position.y = 0.085;
    tb.add(handle);
    this.toolbox = tb;
    sc.add(tb);
  }

  /** His corner under the maintenance platform: a workbench with a pegboard of tools and a parts cabinet. */
  private buildBench(): void {
    const k = this.k;
    const [bx, bz] = this.L.bench;
    const t = this.L.benchTop;
    // The bench stands north of where he stands, the long side across the hall.
    const cz = t.z - 0.1;
    const top = k.std(0x6b5a44, 0.8, 0, 0xc9a26a);
    const steel = k.std(0x3a3d44, 0.5, 0.5, 0x1755fe);
    const grey = k.std(0x50545b, 0.5, 0.3, 0xb9c0c8);
    const board = k.std(0x4a4d55, 0.8, 0, 0xe9ecef);
    const dark = k.std(0x1d1d1f, 0.6, 0.2, 0x1d1d1f);
    const yellow = k.std(0x8a6e00, 0.6, 0.2, 0xf2c200);
    const red = k.std(0x8a1a14, 0.45, 0.2, 0xe2231a);
    k.box('benchtop', top, bx, 0.88, cz, 2.0, 0.05, 0.75);
    for (const sx of [-0.95, 0.95]) for (const sz of [-0.33, 0.33]) k.box('benchleg', steel, bx + sx, 0.43, cz + sz, 0.05, 0.86, 0.05);
    k.box('benchshelf', grey, bx, 0.2, cz, 1.9, 0.03, 0.68);
    // A drawer unit under one end, and a vise at the other.
    k.box('benchdrawer', steel, bx + 0.6, 0.55, cz, 0.6, 0.6, 0.66);
    for (const y of [0.38, 0.56, 0.74]) k.box('benchpull', dark, bx + 0.6, y, cz + 0.335, 0.2, 0.025, 0.02);
    k.box('vise', dark, bx - 0.75, 0.97, cz + 0.22, 0.16, 0.13, 0.22);
    // Odds and ends on the top: a spare photo eye, cable ties, a multimeter.
    k.box('benchpart', yellow, bx + 0.25, 0.94, cz + 0.05, 0.12, 0.07, 0.08);
    k.box('benchpart', dark, bx - 0.2, 0.92, cz - 0.1, 0.2, 0.03, 0.12);
    k.box('benchpart', red, bx + 0.05, 0.93, cz + 0.15, 0.09, 0.05, 0.16);
    // Pegboard behind it, with spanners and screwdrivers (outlines of the tools painted on).
    const pz = cz - 0.39;
    k.box('pegboard', board, bx, 1.45, pz, 2.0, 0.95, 0.03);
    for (let i = 0; i < 9; i++) {
      const x = bx - 0.8 + i * 0.2;
      const len = 0.16 + ((i * 37) % 5) * 0.03;
      k.box('tool', i % 3 === 0 ? red : i % 3 === 1 ? yellow : dark, x, 1.55 - len / 2 + 0.1, pz + 0.025, 0.035, len, 0.02);
    }
    for (let i = 0; i < 4; i++) k.box('tool', grey, bx - 0.7 + i * 0.45, 1.2, pz + 0.03, 0.22, 0.05, 0.03);
    // A tall parts cabinet beside the bench.
    const cx = bx + 1.6;
    k.box('cabinet', grey, cx, 0.9, cz - 0.05, 0.9, 1.8, 0.55);
    k.box('cabinetline', dark, cx, 0.9, cz + 0.225, 0.01, 1.7, 0.01);
    for (const sx of [-0.06, 0.06]) k.box('cabinetpull', dark, cx + sx, 1.0, cz + 0.235, 0.02, 0.18, 0.02);
    k.blob(bx, cz, 2.4, 1.0);
    k.blob(cx, cz - 0.05, 1.2, 0.8);
  }
}

const smooth = (f: number) => {
  // Accelerate over the first and last eighth; even in between.
  const a = 0.125;
  if (f < a) return (f * f) / (2 * a * (1 - a));
  if (f > 1 - a) return 1 - ((1 - f) * (1 - f)) / (2 * a * (1 - a));
  return (f - a / 2) / (1 - a);
};

function turnTo(yaw: number, want: number, k: number): number {
  let d = want - yaw;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return yaw + d * k;
}
