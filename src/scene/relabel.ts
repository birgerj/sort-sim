// No-reads: parcels whose label no scanner could read leave the loop by their own chute (on the
// north straight, just east of the infeeds) onto a short roller table. A worker there takes each
// one, prints a new label at the printer and sticks it on, carries it over the walkways to the
// east infeed and puts it back on that belt, before its buffer; then walks back to the table.
// Moves are whole beats; the walk is so many metres per beat.
import * as THREE from 'three';

import type { FloorKit } from './floor';
import { buildHuman, type Human } from './people';
import { crouch, gait, reach, settle } from './motion';
import { Trip, walkOn, type P3 } from './trips';

/** What the station moves: a parcel, by its base position and size. */
export interface Item {
  pos: THREE.Vector3;
  h: number;
  noread?: boolean;
  dead?: boolean;
}

/** Parcels the table holds. */
const CAP = 3;
const SPEED = 1.0;

type Stage = 'table' | 'hand';

export interface RelabelSetup {
  /** Where the chute ends (the table starts there and runs north), at the table's height. */
  end: THREE.Vector3;
  /** The way from the worker's place at the table to where they stand by the infeed (walkways). */
  way: P3[];
  /** Which way they face at the infeed to put the parcel on the belt (yaw), and the belt point. */
  face: number;
  belt: THREE.Vector3;
  /** Put the parcel on the infeed now; false: no room on the belt just there yet (wait a beat). */
  onPlace: (it: Item) => boolean;
}

export class Relabel {
  readonly worker: Human;
  private queue: Item[] = [];
  private hand: Item | null = null;
  /** What the worker is doing, since which beat. */
  private step: 'idle' | 'take' | 'print' | 'out' | 'put' | 'back' = 'idle';
  private t0 = 0;
  private s = 0;
  private trip: Trip;
  private lastBt = 0;
  private readonly home: P3;
  private readonly printAt: P3;
  private readonly back: Trip;
  private readonly v = new THREE.Vector3();

  constructor(
    k: FloorKit,
    private set: RelabelSetup,
  ) {
    const e = set.end;
    // The roller table: from the chute's end north, rollers across, and a label printer at its far end.
    const steel = k.std(0x3a3e45, 0.5, 0.7, 0xc9ced4);
    const roller = k.std(0x50555e, 0.4, 0.8, 0x9aa0a8);
    const dark = k.std(0x1d1d1f, 0.4, 0.4, 0x1d1d1f);
    const len = 2.4;
    const cz = e.z - len / 2;
    k.box('rltable', steel, e.x, e.y - 0.06, cz, 1.0, 0.06, len);
    for (let z = e.z - 0.1; z > e.z - len; z -= 0.2) k.box('rlroller', roller, e.x, e.y - 0.02, z, 0.9, 0.04, 0.05);
    for (const sx of [-0.45, 0.45]) for (const z of [e.z - 0.15, e.z - len + 0.15]) k.box('rlleg', steel, e.x + sx, (e.y - 0.06) / 2, z, 0.05, e.y - 0.06, 0.05);
    // The printer on a stand just past the table's far end, with a roll of labels.
    const px = e.x;
    const pz = e.z - len - 0.35;
    k.box('rlstand', steel, px, 0.45, pz, 0.5, 0.9, 0.45);
    k.box('rlprinter', dark, px, 1.05, pz, 0.36, 0.28, 0.32);
    k.box('rllabel', k.std(0xdddddd, 0.5, 0.1, 0xffffff), px + 0.19, 1.02, pz, 0.01, 0.08, 0.14);
    k.blob(e.x - 0.3, cz, 2.0, len + 0.6);
    // The worker stands on the table's east side (facing west, over it); prints at its far end.
    this.home = [e.x + 1.0, 0, e.z - 0.8];
    this.printAt = [e.x + 1.0, 0, e.z - len - 0.25];
    this.trip = new Trip([this.printAt, ...set.way]);
    this.back = new Trip([...[...set.way].reverse(), this.printAt, this.home]);
    this.worker = buildHuman(k, { shirt: 0x22283f, trousers: 0x22283f, vest: 0xf2a51a }, { x: this.home[0], z: this.home[2], ry: -Math.PI / 2 });
    k.put(this.worker.root);
  }

  /** Room on the table for `coming` more on their way down the chute. */
  room(coming: number): boolean {
    return this.queue.length + coming < CAP;
  }

  /** Working (not standing at the table with nothing to do). */
  get busy(): boolean {
    return this.step !== 'idle';
  }

  arrive(it: Item): void {
    this.queue.push(it);
  }

  /** Where a parcel on the table, or in the worker's hands, is this frame. */
  place(it: Item): void {
    const e = this.set.end;
    const i = this.queue.indexOf(it);
    if (i >= 0) {
      // Along the rollers, nearest the worker first.
      it.pos.lerp(this.v.set(e.x, e.y, e.z - 0.8 - i * 0.6), 0.15);
      return;
    }
    if (it === this.hand) {
      // In front of the worker's chest.
      const r = this.worker.root;
      it.pos.set(r.position.x + Math.sin(r.rotation.y) * 0.42, r.position.y + 0.95 - it.h / 2, r.position.z + Math.cos(r.rotation.y) * 0.42);
    }
  }

  update(dt: number, bt: number): void {
    const beats = Math.min(2, Math.max(0, bt - this.lastBt));
    this.lastBt = bt;
    const h = this.worker;
    const e = this.set.end;
    switch (this.step) {
      case 'idle': {
        this.stand(this.home, -Math.PI / 2, dt);
        this.queue = this.queue.filter((x) => !x.dead);
        if (this.queue.length) this.go('take', bt);
        break;
      }
      case 'take': {
        // Leans over the table and takes the nearest one.
        this.stand(this.home, -Math.PI / 2, dt);
        const f = Math.min(1, (bt - this.t0) / 1);
        const it = this.queue[0];
        if (it) {
          reach(h, 'L', this.v.copy(it.pos).setY(it.pos.y + it.h / 2).add(new THREE.Vector3(0, 0, 0.12)), f);
          reach(h, 'R', this.v.copy(it.pos).setY(it.pos.y + it.h / 2).add(new THREE.Vector3(0, 0, -0.12)), f);
        }
        if (bt >= this.t0 + 1) {
          this.hand = this.queue.shift() ?? null;
          this.go(this.hand ? 'print' : 'idle', bt);
        }
        break;
      }
      case 'print': {
        // At the printer: the new label comes out and goes on (two beats).
        this.stand(this.printAt, -Math.PI / 2, dt);
        this.hold();
        if (bt >= this.t0 + 2) {
          if (this.hand) this.hand.noread = false;
          this.s = 0;
          this.go('out', bt);
        }
        break;
      }
      case 'out':
      case 'back': {
        const trip = this.step === 'out' ? this.trip : this.back;
        this.s += SPEED * beats;
        if (this.s >= trip.len) {
          this.s = 0;
          this.go(this.step === 'out' ? 'put' : 'idle', bt);
          break;
        }
        walkOn(h, trip, this.s, dt, bt, SPEED);
        if (this.hand) this.hold();
        return;
      }
      case 'put': {
        // At the infeed: leans over the belt and puts it down, when the belt has room just there.
        const w = this.set.way[this.set.way.length - 1]!;
        this.stand(w, this.set.face, dt);
        const f = Math.min(1, (bt - this.t0) / 1);
        crouch(h, 0.15 * f);
        reach(h, 'L', this.v.copy(this.set.belt).setY(this.set.belt.y + 0.3), f);
        reach(h, 'R', this.v.copy(this.set.belt).setY(this.set.belt.y + 0.3), f);
        if (this.hand && f >= 1) {
          if (this.set.onPlace(this.hand)) {
            this.hand = null;
            this.go('back', bt);
          } else this.t0 = bt - 0.99;
        } else if (!this.hand) this.go('back', bt);
        break;
      }
    }
    settle(h, dt);
  }


  private go(step: Relabel['step'], bt: number): void {
    this.step = step;
    this.t0 = Math.ceil(bt);
  }

  /** Stand still at a spot, turned that way. */
  private stand(at: P3, yaw: number, dt: number): void {
    const r = this.worker.root;
    r.position.set(at[0], at[1], at[2]);
    let d = yaw - r.rotation.y;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    r.rotation.y += d * Math.min(1, dt * 6);
    gait(this.worker, dt, 0, 0);
  }

  /** Both hands round the parcel in front of the chest. */
  private hold(): void {
    const it = this.hand;
    if (!it) return;
    const r = this.worker.root;
    r.updateMatrixWorld(true);
    for (const [side, off] of [['L', 0.14], ['R', -0.14]] as const) {
      this.v.set(off, 0.95, 0.4).applyMatrix4(r.matrixWorld);
      reach(this.worker, side, this.v, 1);
    }
  }
}
