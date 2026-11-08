// The south side of the robot floor: the boxes the robots fill stand in a row
// along a forklift aisle by the south wall, where trucks wait behind dock
// doors. When a box is full, a forklift drives up, lifts it off the floor,
// takes it into a truck and brings it back empty.
//
// Every move is a keyframe of whole beats, so the forklifts drive on the beat.
// They work day and night (the robots never stop filling boxes).
import * as THREE from 'three';

import { buildDockDoor } from './docks';
import type { FloorKit, RobotFloor } from './floor';
import { buildForklift, FORK_REACH, type ForkliftModel } from './forklift';

/** Centre line of the forklift aisle, and the wall. */
export const AISLE_Z = 32.3;
const WALL_Z = 34;
/** 20 dock doors on the south wall: [x, number, in use]; every fourth is closed (no truck). */
const DOORS: [number, number, boolean][] = Array.from({ length: 20 }, (_, k) => [-16 + 6 * k, 21 + k, k % 4 !== 3]);
/** Forklifts; each serves one stretch of the row of boxes, with the doors in it. */
const LIFTS = 4;

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
  /** Stretch of the aisle this forklift serves. */
  x0: number;
  x1: number;
}

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const NORTH = Math.PI;
const SOUTH = 0;

export class BoxYard {
  readonly lifts: Lift[] = [];
  private jobs: number[] = [];

  constructor(
    kit: FloorKit,
    private floor: RobotFloor,
  ) {
    for (const [x, n, used] of DOORS) buildDockDoor(kit, x, WALL_Z, -1, n, !used);
    // Aisle markings: yellow lines on both sides.
    const paint = kit.std(0x8a6e00, 0.8, 0, 0xf2c200);
    const x0 = floor.bins[0]!.x - 3;
    const x1 = floor.bins[floor.bins.length - 1]!.x + 3;
    for (const z of [AISLE_Z - 1.75, AISLE_Z + 1.4]) kit.box('aisle', paint, (x0 + x1) / 2, 0.012, z, x1 - x0, 0.01, 0.1);
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
        x0: lx0,
        x1: lx1,
      };
      this.lifts.push(l);
      this.place(l);
    }
  }

  /** A box is full: queue it for a forklift. */
  request(bin: number): void {
    if (!this.jobs.includes(bin)) this.jobs.push(bin);
  }

  update(bt: number): void {
    // Hand out jobs to idle forklifts on their side.
    for (const l of this.lifts) {
      if (l.job !== null || l.keys.length || l.key) continue;
      const k = this.jobs.findIndex((b) => this.floor.bins[b]!.x >= l.x0 && this.floor.bins[b]!.x < l.x1);
      if (k < 0) continue;
      const [b] = this.jobs.splice(k, 1);
      this.plan(l, b!);
    }
    for (const l of this.lifts) {
      // Next key: straight after the previous one, or on the next whole beat after a pause.
      if (!l.key && l.keys.length) {
        const k = l.keys[0]!;
        const start = bt - l.t0 < 1 ? l.t0 : Math.ceil(bt);
        if (bt >= start && (!k.wait || k.wait())) {
          l.keys.shift();
          l.key = k;
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
    // The nearest open door.
    let door = Infinity;
    for (const [x, , open] of DOORS) if (open && Math.abs(x - bin.x) < Math.abs(door - bin.x)) door = x;
    const nose = bin.z + FORK_REACH;
    l.job = b;
    keys.push({ z: AISLE_Z, beats: 1 });
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
    keys.push({ z: WALL_Z + 1.2, beats: 2 });
    keys.push({ fork: 0.3, beats: 2, done: () => this.floor.emptied(b) });
    keys.push({ fork: 0.45, beats: 1 });
    keys.push({ z: AISLE_Z, beats: 2 });
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
