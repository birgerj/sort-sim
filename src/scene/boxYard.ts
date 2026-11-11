// The south side of the robot floor: the boxes the robots fill stand in a row
// along a forklift aisle by the south wall, where trucks wait behind dock
// doors. When a box is full, a forklift drives up, lifts it off the floor,
// takes it into a truck and brings it back empty.
//
// Every move is a keyframe of whole beats, so the forklifts drive on the beat.
// They work day and night (the robots never stop filling boxes).
import * as THREE from 'three';

import { buildDockDoor, type TruckLink } from './docks';
import type { FloorKit, RobotFloor } from './floor';
import { buildForklift, FORK_REACH, type ForkliftModel } from './forklift';

/** Centre line of the forklift aisle, and the wall. */
export const AISLE_Z = 31.1;
const WALL_Z = 34;
/** 20 dock doors on the south wall: [x, number, in use]; door k serves south city k (its two boxes stand right by it). */
export const DOORS: [number, number, boolean][] = Array.from({ length: 20 }, (_, k) => [-16 + 6 * k, 21 + k, true]);
/**
 * Forklifts. Each waits in the middle of its own stretch of the aisle, but takes the nearest full
 * box anywhere, as long as its way there and back does not cross another forklift's.
 */
const LIFTS = 3;
/** Room kept between two forklifts in the aisle (m). */
const CLEAR = 3;

interface Key {
  x?: number;
  z?: number;
  yaw?: number;
  fork?: number;
  beats: number;
  /** Hold here until this is true (checked on every beat). */
  wait?: () => boolean;
  /** Runs when the key is reached. */
  done?: () => void;
  /** A sound as the move starts. */
  sound?: 'horn' | 'beep';
}

interface Lift extends ForkliftModel {
  x: number;
  z: number;
  yaw: number;
  fork: number;
  from: { x: number; z: number; yaw: number; fork: number };
  keys: Key[];
  key: Key | null;
  t0: number;
  carry: number | null;
  job: number | null;
  home: number;
  /** Beat the next move may start on, after a pause (−1: not set). */
  next: number;
  /** Stretch of the aisle this forklift waits in. */
  x0: number;
  x1: number;
  /** The stretch of aisle it needs for its job (there and back home), or null when idle. */
  span: [number, number] | null;
}

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const NORTH = Math.PI;
const SOUTH = 0;

export class BoxYard {
  readonly lifts: Lift[] = [];
  /** Sounds since the last frame: a horn when a forklift sets off, beeps while it reverses. */
  readonly sounds: { kind: 'horn' | 'beep'; at: THREE.Vector3 }[] = [];
  private jobs: number[] = [];

  constructor(
    kit: FloorKit,
    private floor: RobotFloor,
    /** The trucks behind the south doors (by door x). */
    private truck: TruckLink,
  ) {
    for (const [x, n, used] of DOORS) buildDockDoor(kit, x, WALL_Z, -1, n, !used);
    // Aisle markings: yellow lines on both sides.
    const paint = kit.std(0x8a6e00, 0.8, 0, 0xf2c200);
    const x0 = floor.bins[0]!.x - 3;
    const x1 = floor.bins[floor.bins.length - 1]!.x + 3;
    // (The lines run on west, past the zebra crossing where the walkway to the staff door crosses.)
    const px0 = Math.min(x0, -45.2);
    for (const z of [AISLE_Z - 2.4, AISLE_Z + 2.2]) kit.box('aisle', paint, (px0 + x1) / 2, 0.012, z, x1 - px0, 0.01, 0.1);
    for (let k = 0; k < LIFTS; k++) {
      const m = buildForklift(kit, null);
      const lx0 = x0 + ((x1 - x0) * k) / LIFTS;
      const lx1 = x0 + ((x1 - x0) * (k + 1)) / LIFTS;
      const home = (lx0 + lx1) / 2;
      const l: Lift = {
        ...m,
        x: home,
        z: AISLE_Z,
        yaw: Math.PI / 2,
        fork: 0.15,
        from: { x: home, z: AISLE_Z, yaw: Math.PI / 2, fork: 0.15 },
        keys: [],
        key: null,
        t0: 0,
        carry: null,
        job: null,
        home,
        next: -1,
        x0: lx0,
        x1: lx1,
        span: null,
      };
      this.lifts.push(l);
      this.place(l);
    }
  }

  /** A box is full: queue it for a forklift. */
  request(bin: number): void {
    if (!this.jobs.includes(bin)) this.jobs.push(bin);
  }

  /** A forklift at work on a box swap (not while it waits for a truck at the door). */
  busy(k: number): boolean {
    const l = this.lifts[k]!;
    if (l.job === null) return false;
    const k0 = !l.key ? l.keys[0] : undefined;
    return !(k0?.wait && !k0.wait());
  }

  update(bt: number): void {
    // Hand out jobs: each idle forklift the nearest full box it can reach without crossing another
    // forklift's way (busy ones: the stretch their job needs; idle ones: where they stand).
    for (const l of this.lifts) {
      if (l.job !== null || l.keys.length || l.key) continue;
      l.span = null;
      const taken = this.lifts.filter((o) => o !== l).map((o): [number, number] => o.span ?? [o.x, o.x]);
      let best = -1;
      let bestD = Infinity;
      this.jobs.forEach((b, k) => {
        const bx = this.floor.bins[b]!.x;
        const a = Math.min(l.x, bx, l.home) - CLEAR;
        const z = Math.max(l.x, bx, l.home) + CLEAR;
        if (taken.some(([p, q]) => p < z && q > a)) return;
        const d = Math.abs(bx - l.x);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      if (best < 0) continue;
      const [b] = this.jobs.splice(best, 1);
      const bx = this.floor.bins[b!]!.x;
      l.span = [Math.min(l.x, bx, l.home) - CLEAR, Math.max(l.x, bx, l.home) + CLEAR];
      this.plan(l, b!);
    }
    for (const l of this.lifts) {
      // Next key: straight after the previous one, or on the next whole beat after a pause.
      if (!l.key && l.keys.length) {
        const k = l.keys[0]!;
        // (When idle for a while, the next whole beat; remembered, so it is reached.)
        if (bt - l.t0 >= 1 && l.next < 0) l.next = Math.ceil(bt);
        const start = bt - l.t0 < 1 ? l.t0 : l.next;
        if (bt >= start && (!k.wait || k.wait())) {
          l.next = -1;
          l.keys.shift();
          l.key = k;
          if (k.sound) this.sounds.push({ kind: k.sound, at: new THREE.Vector3(l.x, 2, l.z) });
          l.t0 = start;
          l.from = { x: l.x, z: l.z, yaw: l.yaw, fork: l.fork };
        }
      }
      const k = l.key;
      if (k) {
        const f = k.beats > 0 ? Math.min(1, (bt - l.t0) / k.beats) : 1;
        const e = ease(f);
        if (k.x !== undefined) l.x = l.from.x + (k.x - l.from.x) * e;
        if (k.z !== undefined) l.z = l.from.z + (k.z - l.from.z) * e;
        if (k.fork !== undefined) l.fork = l.from.fork + (k.fork - l.from.fork) * e;
        if (k.yaw !== undefined) {
          let d = k.yaw - l.from.yaw;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          l.yaw = l.from.yaw + d * e;
        }
        if (f >= 1) {
          l.key = null;
          l.t0 += k.beats;
          k.done?.();
        }
      }
      this.place(l);
      // Amber beacon flashes on the beat while working.
      const busy = l.job !== null;
      l.beacon.color.setRGB(3, 1.3, 0.1).multiplyScalar(busy ? 0.1 + (1 - (bt % 1)) ** 4 : 0.05);
    }
  }

  private place(l: Lift): void {
    l.g.position.set(l.x, 0, l.z);
    l.g.rotation.y = l.yaw;
    l.forks.position.y = l.fork;
    if (l.carry !== null) {
      const g = this.floor.bins[l.carry]!.g;
      g.position.set(l.x + Math.sin(l.yaw) * FORK_REACH, l.fork - 0.15, l.z + Math.cos(l.yaw) * FORK_REACH);
      g.rotation.y = l.yaw;
    }
  }

  /** Drive along the aisle to x: turn to face the way, then go (about 2.5 m per beat). */
  private drive(keys: Key[], fromX: number, x: number): void {
    if (Math.abs(x - fromX) < 0.05) return;
    keys.push({ yaw: x > fromX ? Math.PI / 2 : -Math.PI / 2, beats: 1 });
    keys.push({ x, z: AISLE_Z, beats: Math.max(1, Math.round(Math.abs(x - fromX) / 2.5)) });
  }

  private plan(l: Lift, b: number): void {
    const bin = this.floor.bins[b]!;
    const keys: Key[] = [];
    // The door of the box's city; if its truck is not there (cleardown, away), try again later.
    const door = DOORS[bin.city]![0];
    if (!this.truck.open(door)) {
      this.jobs.push(b);
      return;
    }
    // Keep the truck here until the forklift is out again.
    this.truck.reserve(door, 1);
    const nose = bin.z + FORK_REACH;
    l.job = b;
    keys.push({ z: AISLE_Z, beats: 1, sound: 'horn' });
    this.drive(keys, l.x, bin.x);
    keys.push({ yaw: NORTH, beats: 1 });
    // Wait until no robot is still on its way to this box.
    keys.push({ beats: 0, wait: () => !this.floor.fleet.binBusy(b) });
    keys.push({ z: nose, fork: 0.12, beats: 1 });
    keys.push({ fork: 0.45, beats: 1, done: () => (l.carry = b) });
    keys.push({ z: AISLE_Z, beats: 1 });
    this.drive(keys, bin.x, door);
    keys.push({ yaw: SOUTH, beats: 1 });
    // Into the truck; the box is emptied there.
    // All the way into the trailer (the forklift too), set the box down at the front of the load.
    keys.push({ z: WALL_Z + 3.0, beats: 3 });
    keys.push({
      fork: 0.3,
      beats: 2,
      done: () => {
        // The parcels stay in the truck (a box on a pallet in its load).
        this.truck.load(door, this.floor.bins[b]!.vol, this.floor.bins[b]!.kg);
        this.floor.emptied(b);
      },
    });
    keys.push({ fork: 0.45, beats: 1 });
    // Reversing out of the truck: the beeper sounds on each beat.
    keys.push({ z: WALL_Z + 0.5, beats: 2, sound: 'beep' });
    keys.push({ z: AISLE_Z, beats: 1, sound: 'beep', done: () => this.truck.reserve(door, -1) });
    this.drive(keys, door, bin.x);
    keys.push({ yaw: NORTH, beats: 1 });
    keys.push({ z: nose, beats: 1 });
    keys.push({
      fork: 0.15,
      beats: 1,
      done: () => {
        l.carry = null;
        bin.g.position.set(bin.x, 0, bin.z);
        bin.g.rotation.y = 0;
        this.floor.reopen(b);
      },
    });
    keys.push({ z: AISLE_Z, beats: 1 });
    this.drive(keys, bin.x, l.home);
    keys.push({ yaw: Math.PI / 2, beats: 1, done: () => (l.job = null) });
    l.keys = keys;
  }
}
