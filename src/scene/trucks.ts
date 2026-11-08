// Trucks at the dock doors. Each open door has a trailer behind it that fills
// up (roll cages on the north side, boxes on pallets on the south side). When
// it is full there is a cleardown: a warning lamp at the door flashes, nothing
// new goes in, then the door rolls down, the truck pulls away with its load, a
// new empty one backs in and the door rolls up again. All in whole beats.
import * as THREE from 'three';

import type { FloorKit } from './floor';
import { checkerPlate, sectionalDoor } from './textures';

export type Cargo = 'cage' | 'box';

export interface TruckDoor {
  x: number;
  /** z of the wall, and which way the hall is (+1: hall at +z of the wall). */
  wallZ: number;
  dir: 1 | -1;
  cargo: Cargo;
}

type State = 'open' | 'cleardown' | 'closing' | 'leaving' | 'away' | 'arriving' | 'opening';

interface Dock extends TruckDoor {
  state: State;
  t0: number;
  load: number;
  /** Things on their way into this trailer (a forklift, a roll cage): keep the door open. */
  reserved: number;
  door: THREE.Object3D;
  trailer: THREE.Group;
  slots: THREE.Object3D[];
}

const L = 12; // trailer length
const W = 3.1;
const H = 3.7;
const DOOR_H = 3.8;
/** Loads per truck. */
const CAP = 4;
const DUR: Record<Exclude<State, 'open'>, number> = { cleardown: 4, closing: 2, leaving: 4, away: 6, arriving: 4, opening: 2 };
const NEXT: Record<Exclude<State, 'open'>, State> = { cleardown: 'closing', closing: 'leaving', leaving: 'away', away: 'arriving', arriving: 'opening', opening: 'open' };

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

export class Trucks {
  readonly docks: Dock[] = [];
  /** Cleardown warning lamps, one per door (flashing amber before the door closes). */
  private lamps: THREE.InstancedMesh;
  private readonly c = new THREE.Color();

  constructor(k: FloorKit, doors: TruckDoor[]) {
    const inside = k.std(0x1b1d22, 0.7, 0.3, 0xe6e9ed);
    inside.side = THREE.BackSide;
    inside.map = sectionalDoor();
    const floorM = k.std(0x2a2c31, 0.8, 0.2, 0xb9c0c8);
    floorM.map = checkerPlate();
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.25, 1.1) });
    const doorM = k.std(0x2c3038, 0.6, 0.4, 0xffffff);
    doorM.map = sectionalDoor();
    const cageM = k.std(0x5d6670, 0.5, 0.6, 0x2fa58f);
    const boxM = k.std(0x8a7050, 0.95, 0, 0xe0b882);
    const shell = new THREE.BoxGeometry(W, H, L);
    const floorG = new THREE.BoxGeometry(W - 0.1, 0.04, L);
    const lampG = new THREE.BoxGeometry(0.2, 0.04, L - 2);
    // The door panel: 1 m high geometry, anchored at its top edge, scaled down from the roll.
    const doorG = new THREE.BoxGeometry(3.2, 1, 0.08).translate(0, -0.5, 0);
    const cageG = new THREE.BoxGeometry(1.3, 1.7, 1.0).translate(0, 0.95, 0);
    const boxG = new THREE.BoxGeometry(1.2, 1.0, 1.2).translate(0, 0.5, 0);
    for (const d of doors) {
      const trailer = new THREE.Group();
      trailer.position.set(d.x, 0, d.wallZ - d.dir * (L / 2 + 0.02));
      k.put(trailer);
      k.batch(shell, inside, trailer).position.y = H / 2;
      k.batch(floorG, floorM, trailer).position.y = 0.02;
      k.batch(lampG, lamp, trailer).position.y = H - 0.12;
      // Cargo slots: two across, from the far end towards the door.
      const slots: THREE.Object3D[] = [];
      for (let n = 0; n < 8; n++) {
        const s = k.batch(d.cargo === 'cage' ? cageG : boxG, d.cargo === 'cage' ? cageM : boxM, trailer);
        s.position.set((n % 2 ? 0.7 : -0.7), 0.05, -d.dir * (L / 2 - 0.9 - Math.floor(n / 2) * 1.35));
        s.visible = false;
        slots.push(s);
      }
      const door = new THREE.Group();
      door.position.set(d.x, DOOR_H, d.wallZ + d.dir * 0.12);
      k.put(door);
      const panel = k.batch(doorG, doorM, door);
      panel.scale.y = 0.6;
      this.docks.push({ ...d, state: 'open', t0: 0, load: 0, reserved: 0, door: panel, trailer, slots });
    }
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

  isOpen(i: number): boolean {
    return this.docks[i]?.state === 'open';
  }

  reserve(i: number, n: 1 | -1): void {
    const d = this.docks[i];
    if (d) d.reserved = Math.max(0, d.reserved + n);
  }

  /** One more load in the trailer (a cage or a box). */
  load(i: number): void {
    const d = this.docks[i];
    if (!d) return;
    d.load = Math.min(8, d.load + 1);
    d.slots.forEach((s, n) => (s.visible = n < d.load));
  }

  update(bt: number): void {
    for (const d of this.docks) {
      if (d.state === 'open') {
        if (d.load >= CAP) {
          // Cleardown: warn first, take nothing new.
          d.state = 'cleardown';
          d.t0 = Math.ceil(bt);
        }
      } else if (d.state === 'cleardown' && bt >= d.t0 + DUR.cleardown && d.reserved > 0) {
        // Still something on its way out of the trailer: keep warning.
      } else if (bt >= d.t0 + DUR[d.state]) {
        d.t0 += DUR[d.state];
        d.state = NEXT[d.state];
        if (d.state === 'arriving') {
          d.load = 0;
          d.slots.forEach((s) => (s.visible = false));
        }
      }
      const f = d.state === 'open' ? 1 : clamp01((bt - d.t0) / DUR[d.state]);
      // Door: rolled up (0.6 m showing) when open, down (3.8 m) when closed.
      const down = d.state === 'closing' ? ease(f) : d.state === 'opening' ? 1 - ease(f) : d.state === 'open' ? 0 : 1;
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
  }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
