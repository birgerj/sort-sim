// Manual sorting: robots bring the small, flat parcels (envelopes) to a drop at
// the west end of the robot floor. A gravity roller belt runs them to the
// manual sort table, where a worker picks each one up, turns round and puts it
// in a pigeonhole. When a pigeonhole is full, the worker empties it into the
// blue crates beside the table (which go out with the post).
//
// Every move takes whole beats. People work here by day only: at night the
// robots keep the envelopes on the boxes instead.
import * as THREE from 'three';

import { DECK_Y, DROP, TABLE, type FloorKit } from './floor';
import { buildHuman, type Human } from './people';
import { crouch, gait, settle } from './motion';

/** What ManualSort moves: a parcel, by its base position. */
export interface Item {
  pos: THREE.Vector3;
  dead?: boolean;
  /** Its label could not be read: the worker prints and sticks on a new one first. */
  noread?: boolean;
}

type Stage = 'belt' | 'table' | 'hand' | 'cubby' | 'crate';

interface State {
  stage: Stage;
  t0: number;
  from: THREE.Vector3;
  cubby: number;
  slot: number;
}

/** One worker move: where to stand, which way to face, what the arms do, and what happens at the end. */
interface Move {
  x: number;
  face: number;
  reach: number;
  beats: number;
  done?: () => void;
}

const BELT_Y = 1.1;
const BELT_Z = DROP.z;
/** Which way the belt runs from the drop to the table (+1: east). */
const DIR = Math.sign(TABLE.x - DROP.x) || 1;
const BELT_X0 = DROP.x + DIR * 0.4;
const BELT_X1 = TABLE.x - DIR * 2.2;
/** Where parcels wait on the table, nearest first. */
const SPOT = (n: number) => new THREE.Vector3(TABLE.x - DIR * (1.6 - n * 0.75), 1.02, TABLE.z + 0.7);
const SHELF_Z = TABLE.z + 2.7;
const COLS = 6;
const ROWS = 4;
/** Parcels per pigeonhole before it is emptied. */
const CUBBY_CAP = 2;
const CRATE = new THREE.Vector3(TABLE.x + 3.6, 1.7, TABLE.z + 1.9);
const HOME = { x: TABLE.x, z: TABLE.z + 1.7 };
const TO_TABLE = Math.PI;
const TO_SHELF = 0;
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

export class ManualSort {
  private items = new Map<Item, State>();
  /** Parcels in each pigeonhole (some hold an envelope from the start). */
  private fill: number[] = [];
  private worker: Human;
  private moves: Move[] = [];
  private move: Move | null = null;
  private mt0 = 0;
  /** Beat the next move may start on, after a pause (−1: not set). */
  private next = -1;
  private from = { x: HOME.x, face: TO_TABLE, reach: 0 };
  private now = { x: HOME.x, face: TO_TABLE, reach: 0 };
  /** Parcels that went out in the crates. */
  shipped = 0;
  private readonly decor: number[] = [];

  constructor(k: FloorKit) {
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) this.decor[c * ROWS + r] = this.fill[c * ROWS + r] = (c * 7 + r * 3) % 4 === 0 ? 1 : 0;
    // The drop: a small hopper at the end of row 2, and a roller belt down to the table.
    const frame = k.std(0x50545b, 0.5, 0.5, 0xdfe3e8);
    const roller = k.std(0x2a2c31, 0.4, 0.7, 0x9aa0a8);
    const teal = k.std(0x1f6e60, 0.6, 0.2, 0x2fa58f);
    const len = Math.abs(BELT_X0 - BELT_X1);
    const mid = (BELT_X0 + BELT_X1) / 2;
    k.box('mbelt', frame, mid, BELT_Y - 0.06, BELT_Z, len, 0.06, 0.62);
    for (const dz of [-0.33, 0.33]) k.box('mbelt', teal, mid, BELT_Y + 0.02, BELT_Z + dz, len, 0.14, 0.05);
    const bx0 = Math.min(BELT_X0, BELT_X1);
    const bx1 = Math.max(BELT_X0, BELT_X1);
    for (let x = bx0 + 0.1; x < bx1; x += 0.22) k.box('mroll', roller, x, BELT_Y - 0.02, BELT_Z, 0.06, 0.05, 0.56);
    for (let x = bx0 + 0.4; x < bx1; x += 1.6) for (const dz of [-0.26, 0.26]) k.box('mleg', frame, x, (BELT_Y - 0.09) / 2, BELT_Z + dz, 0.06, BELT_Y - 0.09, 0.06);
    k.blob(mid, BELT_Z, len + 0.6, 1.0);
    // Hopper: a sloped tray the robot tips into, with side walls.
    // (Its lip is just under the robots' deck, so parcels slide off the robot into it.)
    const hy = DECK_Y - 0.1;
    k.box('mhop', teal, DROP.x, hy, DROP.z, 0.8, 0.05, 0.9);
    for (const dz of [-0.45, 0.45]) k.box('mhop', teal, DROP.x, hy + 0.12, DROP.z + dz, 0.8, 0.28, 0.04);
    k.box('mleg', frame, DROP.x, hy / 2, DROP.z, 0.1, hy, 0.1);
    // The worker at the table (by day).
    const was = k.only;
    k.only = 'day';
    this.worker = buildHuman(k, { shirt: 0x2fa58f, trousers: 0x22283f, vest: 0xf2c200, helmet: 0xffffff }, { x: HOME.x, z: HOME.z, ry: TO_TABLE });
    k.only = was;
  }

  /** Room for another parcel, with `onRobots` already on their way here. */
  room(onTheWay: number, cap = 4): boolean {
    let here = 0;
    for (const s of this.items.values()) if (s.stage !== 'cubby' && s.stage !== 'crate') here++;
    return onTheWay + here < cap && this.fill.some((f) => f < CUBBY_CAP);
  }

  /** Where the worker stands along the table (x), for the camera. */
  workerX(): number {
    return this.now.x;
  }

  /** Called when the worker sticks a new label on a parcel (to redraw it). */
  relabel: (it: Item) => void = () => {};

  /** A robot tipped `it` into the hopper. */
  arrive(it: Item, bt: number, onBelt = false): void {
    // From the hopper, or (from the no-read chute) straight onto the belt where it lands.
    const u0 = onBelt ? 0.5 + (3 * (it.pos.x - BELT_X0)) / (BELT_X1 - BELT_X0) : 0;
    this.items.set(it, { stage: 'belt', t0: onBelt ? bt - u0 : Math.round(bt), from: it.pos.clone(), cubby: -1, slot: 0 });
  }

  /** Position of an item this beat (call per frame for each item it owns). */
  place(it: Item, bt: number): void {
    const s = this.items.get(it);
    if (!s) return;
    const f = (beats: number) => Math.min(1, Math.max(0, (bt - s.t0) / beats));
    switch (s.stage) {
      case 'belt': {
        // Down the hopper onto the belt, then along the rollers (3 beats), then onto the table.
        const u = f(4) * 4;
        if (u < 0.5) it.pos.lerpVectors(s.from, this.v.set(BELT_X0, BELT_Y, BELT_Z), u * 2);
        else if (u < 3.5) it.pos.set(BELT_X0 + ((BELT_X1 - BELT_X0) * (u - 0.5)) / 3, BELT_Y, BELT_Z);
        else it.pos.lerpVectors(this.v.set(BELT_X1, BELT_Y, BELT_Z), this.spot(it), ease((u - 3.5) * 2));
        if (u >= 4) {
          s.stage = 'table';
          s.t0 += 4;
        }
        break;
      }
      case 'table':
        it.pos.lerp(this.spot(it), 0.2);
        break;
      case 'hand': {
        // In the worker's hand, in front of the chest.
        const w = this.worker.root;
        it.pos.set(w.position.x + Math.sin(w.rotation.y) * 0.45, 1.12, w.position.z + Math.cos(w.rotation.y) * 0.45);
        break;
      }
      case 'cubby':
        // Pushed into the pigeonhole while the worker reaches.
        it.pos.lerpVectors(s.from, this.cubbyPos(s.cubby, s.slot, this.v), ease(f(1)));
        break;
      case 'crate': {
        // Carried to the crates (3 beats), then dropped in: it leaves with the post.
        const w = this.worker.root;
        this.v.set(w.position.x + Math.sin(w.rotation.y) * 0.45, 1.15 + s.slot * 0.08, w.position.z + Math.cos(w.rotation.y) * 0.45);
        if (bt - s.t0 < 3) it.pos.copy(this.v);
        else it.pos.lerpVectors(this.v, CRATE, ease(Math.min(1, bt - s.t0 - 3)));
        if (bt - s.t0 >= 4) {
          it.dead = true;
          this.items.delete(it);
          this.shipped++;
        }
        break;
      }
    }
  }

  /** Once a frame: the worker's next move, and the pose. */
  private lastBt = 0;

  update(bt: number, day: boolean): void {
    if (!this.move && !this.moves.length && day) this.plan();
    if (!this.move && this.moves.length) {
      // Straight after the previous move, or on the next whole beat after a pause.
      if (bt - this.mt0 >= 1 && this.next < 0) this.next = Math.ceil(bt);
      const start = bt - this.mt0 < 1 ? this.mt0 : this.next;
      if (bt >= start) {
        this.next = -1;
        this.move = this.moves.shift()!;
        this.mt0 = start;
        this.from = { ...this.now };
      }
    }
    const m = this.move;
    const w = this.worker;
    let walking = 0;
    if (m) {
      const f = Math.min(1, Math.max(0, (bt - this.mt0) / m.beats));
      const e = ease(f);
      this.now.x = this.from.x + (m.x - this.from.x) * e;
      let d = m.face - this.from.face;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.now.face = this.from.face + d * e;
      this.now.reach = this.from.reach + (m.reach - this.from.reach) * e;
      walking = Math.abs(m.x - this.from.x) > 0.1 && f < 1 ? Math.abs(m.x - this.from.x) / m.beats : 0;
      if (f >= 1) {
        this.move = null;
        this.mt0 += m.beats;
        m.done?.();
      }
    }
    w.root.position.set(this.now.x, 0, HOME.z);
    w.root.rotation.y = this.now.face;
    w.armL.rotation.x = w.armR.rotation.x = -this.now.reach * 1.3;
    w.foreL.rotation.x = w.foreR.rotation.x = -0.14 - this.now.reach * 0.5;
    w.torso.rotation.x = this.now.reach * 0.25;
    // (No frame time here: about half a second per beat is close enough for easing.)
    const dt = Math.min(0.1, Math.max(0, (bt - this.lastBt) * 0.5));
    this.lastBt = bt;
    gait(w, dt, Math.PI * bt, walking);
    crouch(w, this.now.reach * 0.15);
    settle(w, dt);
  }

  // ---------- planning ----------

  private readonly v = new THREE.Vector3();

  private spot(it: Item): THREE.Vector3 {
    const waiting = [...this.items].filter(([, s]) => s.stage === 'table').map(([i]) => i);
    return SPOT(Math.max(0, waiting.indexOf(it)));
  }

  private cubbyPos(c: number, slot: number, out: THREE.Vector3): THREE.Vector3 {
    const col = Math.floor(c / ROWS);
    const row = c % ROWS;
    return out.set(TABLE.x - 2.2 + (col + 0.5) * (4.4 / COLS), 0.62 + row * 0.45 + slot * 0.1, SHELF_Z);
  }

  private plan(): void {
    const full = this.fill.findIndex((f) => f >= CUBBY_CAP);
    const waiting = [...this.items].filter(([, s]) => s.stage === 'table');
    const first = waiting[0];
    if (first) {
      const [it, s] = first;
      const spot = SPOT(0);
      // A free pigeonhole near the middle (shortest walk).
      let c = -1;
      for (const n of this.fill.map((_, i) => i).sort((a, b) => Math.abs(Math.floor(a / ROWS) - 2.5) - Math.abs(Math.floor(b / ROWS) - 2.5))) {
        if (this.fill[n]! < CUBBY_CAP) {
          c = n;
          break;
        }
      }
      if (c < 0) return;
      const slot = this.fill[c]!;
      this.fill[c]!++;
      const cx = this.cubbyPos(c, 0, this.v).x;
      this.moves.push(
        { x: spot.x, face: TO_TABLE, reach: 0, beats: 1 },
        { x: spot.x, face: TO_TABLE, reach: 1, beats: 1, done: () => (s.stage = 'hand') },
        // No-read: hold it at the label printer, and stick on a new label.
        ...(it.noread
          ? [
              { x: TABLE.x - DIR * 1.2, face: TO_TABLE, reach: 0.4, beats: 1 },
              {
                x: TABLE.x - DIR * 1.2,
                face: TO_TABLE,
                reach: 0.9,
                beats: 1,
                done: () => {
                  it.noread = false;
                  this.relabel(it);
                },
              },
            ]
          : []),
        {
          x: cx,
          face: TO_SHELF,
          reach: 0.2,
          beats: 1,
          done: () => {
            s.stage = 'cubby';
            s.cubby = c;
            s.slot = slot;
            s.t0 = this.mt0;
            s.from.copy(it.pos);
          },
        },
        { x: cx, face: TO_SHELF, reach: 1, beats: 1 },
        { x: cx, face: TO_SHELF, reach: 0, beats: 1 },
      );
      return;
    }
    if (full >= 0) {
      // Nothing waiting: empty a full pigeonhole into the crates.
      const cx = this.cubbyPos(full, 0, this.v).x;
      const inside = [...this.items].filter(([, s]) => s.stage === 'cubby' && s.cubby === full);
      this.moves.push(
        { x: cx, face: TO_SHELF, reach: 0, beats: 1 },
        {
          x: cx,
          face: TO_SHELF,
          reach: 1,
          beats: 1,
          done: () => {
            for (const [, s] of inside) {
              s.stage = 'crate';
              s.t0 = this.mt0;
            }
            this.fill[full] = this.decor[full]!;
          },
        },
        { x: CRATE.x - 1.2, face: Math.PI / 2, reach: 0.4, beats: 2 },
        { x: CRATE.x - 1.2, face: Math.PI / 2, reach: 1, beats: 1 },
        { x: HOME.x, face: TO_TABLE, reach: 0, beats: 2 },
      );
    }
  }
}
