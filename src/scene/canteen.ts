// The canteen: a room on the first floor outside the hall, against its west wall, beside the
// inbound wing. From the hall you see a band of windows high in the west wall with the room
// behind it (tables, chairs, a counter with coffee, plants, lamps, people on their break), and a
// door at its south end onto a landing, with a steel stair down along the wall.
//
// The windows and the door are holes in the west wall (`windows()`, `door()`; the Sorter cuts
// them); this module builds what is behind and in front of them. Static apart from the people.
import * as THREE from 'three';

import type { FloorKit } from './floor';
import { buildHuman, type Human } from './people';
import { settle, sit } from './motion';

export interface CanteenLayout {
  /** The hall's west wall (x); the room is west of it. */
  wallX: number;
  /** The room's extent along the wall (z, north to south), its depth out from the wall, and its floor's height. */
  z0: number;
  z1: number;
  depth: number;
  floorY: number;
}

/** Where the canteen's stair reaches the hall floor (z). */
export function canteenStairFoot(L: CanteenLayout): number {
  return L.z1 - 0.9 + DOOR_W / 2 + 0.9 + Math.ceil(L.floorY / RISE) * TREAD;
}

/** The openings the room needs in the west wall: windows and the door, each [z0, z1, y0, y1]. */
export function canteenOpenings(L: CanteenLayout): { windows: [number, number, number, number][]; door: [number, number, number, number] } {
  const dz = L.z1 - 0.9;
  const door: [number, number, number, number] = [dz - DOOR_W / 2, dz + DOOR_W / 2, L.floorY + 0.02, L.floorY + 2.2];
  const a = L.z0 + 0.8;
  const b = door[0] - 0.8;
  const n = Math.max(1, Math.round((b - a) / 1.6));
  const pane = (b - a) / n;
  const windows: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) windows.push([a + i * pane + 0.08, a + (i + 1) * pane - 0.08, L.floorY + WIN[0], L.floorY + WIN[1]]);
  return { windows, door };
}

/** Room height, window band (above the room's floor), door width and the stair's step. */
const ROOM_H = 3.0;
const WIN = [0.85, 2.55] as const;
const DOOR_W = 1.1;
const RISE = 0.19;
const TREAD = 0.27;

export class Canteen {
  private people: Human[] = [];

  constructor(
    private k: FloorKit,
    private L: CanteenLayout,
  ) {
    this.buildRoom();
    this.buildFurniture();
    this.buildStair();
  }

  /** The door's z range (at the room's south end). */
  door(): [number, number] {
    const d = canteenOpenings(this.L).door;
    return [d[0], d[1]];
  }

  /** Window openings in the west wall: [z0, z1, y0, y1]. */
  windows(): [number, number, number, number][] {
    return canteenOpenings(this.L).windows;
  }

  /** Where the stair reaches the hall floor (z). */
  stairFoot(): number {
    return canteenStairFoot(this.L);
  }

  update(dt: number, bt: number): void {
    this.people.forEach((h, i) => {
      h.m.talk = Math.sin(bt * 0.5 + i * 1.7) > 0.4 ? 1 : 0;
      h.head.rotation.y = Math.sin(bt * 0.13 + i) * 0.35;
      settle(h, dt, { idle: 0 });
    });
  }

  /** The box behind the wall: floor, ceiling, outer walls; glass and sills in the openings; lamps. */
  private buildRoom(): void {
    const { k, L } = this;
    const y = L.floorY;
    const x0 = L.wallX - L.depth;
    const x1 = L.wallX;
    const cx = (x0 + x1) / 2;
    const cz = (L.z0 + L.z1) / 2;
    const len = L.z1 - L.z0;
    const wall = k.std(0x3a3d44, 0.6, 0.3, 0xf3f4f6);
    const floorM = k.std(0x5a4430, 0.8, 0, 0xc9a26a);
    const frame = k.std(0x1d1d1f, 0.5, 0.4, 0x1d1d1f);
    k.box('cfloor', floorM, cx, y - 0.05, cz, L.depth, 0.1, len);
    k.box('cceil', wall, cx, y + ROOM_H + 0.06, cz, L.depth, 0.12, len);
    // The box's walls (the hall's west wall closes it on the east).
    k.box('cwall', wall, x0 + 0.06, y + ROOM_H / 2, cz, 0.12, ROOM_H + 0.2, len);
    for (const z of [L.z0 + 0.06, L.z1 - 0.06]) k.box('cwall', wall, cx, y + ROOM_H / 2, z, L.depth, ROOM_H + 0.2, 0.12);
    // Under the room, down to the ground, and its roof: a closed box outside the hall.
    k.box('cbase', wall, cx, (y - 0.1) / 2, cz, L.depth, y - 0.1, len);
    // Glass in every window, with a frame and a sill.
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfd8e8, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    for (const [z0, z1, y0, y1] of this.windows()) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(z1 - z0, y1 - y0), glass);
      g.position.set(L.wallX - 0.05, (y0 + y1) / 2, (z0 + z1) / 2);
      g.rotation.y = Math.PI / 2;
      g.userData.noInk = true;
      k.put(g);
      k.box('csill', frame, L.wallX, y0 - 0.03, (z0 + z1) / 2, 0.3, 0.06, z1 - z0 + 0.1);
      k.box('cframe', frame, L.wallX, y1 + 0.03, (z0 + z1) / 2, 0.22, 0.06, z1 - z0 + 0.1);
      for (const z of [z0, z1]) k.box('cframe', frame, L.wallX, (y0 + y1) / 2, z, 0.22, y1 - y0, 0.05);
    }
    // The door: a frame in the opening, the door leaf standing open into the room.
    const [d0, d1] = this.door();
    for (const z of [d0, d1]) k.box('cdoorf', frame, L.wallX, y + 1.1, z, 0.24, 2.2, 0.06);
    k.box('cdoorf', frame, L.wallX, y + 2.22, (d0 + d1) / 2, 0.24, 0.06, d1 - d0 + 0.12);
    k.box('cdoor', k.std(0x6b2b6b, 0.6, 0.1, 0x6b3fd1), L.wallX - 0.55, y + 1.05, d0 + 0.05, DOOR_W - 0.05, 2.1, 0.05);
    // Lamps under the ceiling: lit panels, they glow at night through the windows.
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.35, 1.2) });
    for (let z = L.z0 + 2; z < L.z1 - 1; z += 3.5) for (const x of [x0 + 1.8, x1 - 1.8]) k.box('clamp', lamp, x, y + ROOM_H - 0.02, z, 0.3, 0.03, 1.2);
  }

  /** Tables with chairs, a counter with coffee at the far end, plants under the windows, people on their break. */
  private buildFurniture(): void {
    const { k, L } = this;
    const y = L.floorY;
    const x0 = L.wallX - L.depth;
    const wood = k.std(0x6b5a44, 0.8, 0, 0xe0c49a);
    const grey = k.std(0x3a3d44, 0.5, 0.5, 0x6b7078);
    const chairs = [k.std(0x0f5c4f, 0.7, 0, 0x2fa58f), k.std(0x8a6e00, 0.7, 0, 0xf2c200), k.std(0x6b2b6b, 0.7, 0, 0xd6339a)];
    const white = k.std(0xdddddd, 0.5, 0.1, 0xffffff);
    const dark = k.std(0x1d1d1f, 0.4, 0.4, 0x1d1d1f);
    const green = k.std(0x1f5a2a, 0.9, 0, 0x2f9a4a);
    // Counter along the north end: coffee machine, microwave, fridge.
    const cz = L.z0 + 0.5;
    k.box('ccounter', white, (x0 + L.wallX) / 2 - 0.4, y + 0.45, cz, L.depth - 1.6, 0.9, 0.7);
    k.box('ccoffee', dark, x0 + 1.5, y + 1.15, cz, 0.4, 0.5, 0.4);
    k.box('ccoffee', new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.8, 1.2) }), x0 + 1.5, y + 1.25, cz + 0.21, 0.25, 0.15, 0.02);
    k.box('cmicro', grey, x0 + 2.6, y + 1.07, cz, 0.55, 0.32, 0.45);
    k.box('cfridge', white, L.wallX - 0.9, y + 0.95, cz, 0.7, 1.9, 0.7);
    // Tables in two rows along the room: one by the windows, one by the back wall.
    const tables: [number, number][] = [];
    for (let z = L.z0 + 2.6; z < this.door()[0] - 1.2; z += 3.0) for (const x of [L.wallX - 1.6, x0 + 2.2]) tables.push([x, z]);
    tables.forEach(([tx, tz], i) => {
      k.box('ctable', wood, tx, y + 0.75, tz, 0.9, 0.05, 1.6);
      k.box('ctleg', grey, tx, y + 0.37, tz, 0.08, 0.74, 0.08);
      k.box('ctleg', grey, tx, y + 0.02, tz, 0.5, 0.04, 0.5);
      let n = 0;
      for (const sx of [-0.65, 0.65]) {
        for (const sz of [-0.45, 0.45]) {
          const m = chairs[(i + n++) % chairs.length]!;
          k.box('cchair', m, tx + sx, y + 0.46, tz + sz, 0.44, 0.05, 0.44);
          k.box('cchair', m, tx + sx + Math.sign(sx) * 0.21, y + 0.74, tz + sz, 0.05, 0.5, 0.44);
          k.box('ccleg', grey, tx + sx, y + 0.22, tz + sz, 0.04, 0.44, 0.04);
        }
      }
      if (i % 3 !== 2) k.box('cmug', white, tx - 0.1, y + 0.83, tz + 0.3, 0.08, 0.1, 0.08);
      if (i % 2) k.box('clunch', chairs[i % 3]!, tx + 0.12, y + 0.82, tz - 0.35, 0.16, 0.08, 0.25);
    });
    // Lockers along the back wall, between the tables' chairs and the wall.
    const teal = k.std(0x1f5f4f, 0.6, 0.1, 0x2fa58f);
    const lz0 = L.z0 + 1.6;
    for (let i = 0; i < 16; i++) {
      const z = lz0 + i * 0.62;
      k.box('locker', [teal, grey][i % 2]!, x0 + 0.38, y + 0.95, z, 0.5, 1.9, 0.6);
      k.box('lockerv', dark, x0 + 0.64, y + 1.6, z, 0.02, 0.04, 0.3);
    }
    // A notice board with schedules beside them.
    k.box('cboard', k.std(0x6a5038, 0.8, 0, 0xc49a6c), x0 + 0.15, y + 1.7, lz0 + 16 * 0.62 + 1.2, 0.04, 1.0, 1.8);
    // Plants under the windows, between the tables.
    for (let z = L.z0 + 4.1; z < this.door()[0] - 1; z += 6) {
      k.box('cpot', dark, L.wallX - 0.35, y + 0.25, z, 0.4, 0.5, 0.4);
      k.box('cplant', green, L.wallX - 0.35, y + 0.85, z, 0.5, 0.7, 0.6);
    }
    // People on their break, sitting at the tables (across from each other, facing along x).
    const looks = [
      { shirt: 0x3a3d44, trousers: 0x22283f, vest: 0xf2a51a },
      { shirt: 0xf3f4f6, trousers: 0x22283f, cap: 0x2fa58f },
      { shirt: 0x1755fe, trousers: 0x3a3d44, vest: 0xc8ff3a },
      { shirt: 0x6b3fd1, trousers: 0x22283f },
      { shirt: 0x22283f, trousers: 0x22283f, vest: 0x1d4ed8 },
    ];
    const seats: [number, number, number][] = [];
    [0, 1, 4, 5, 8].forEach((t, n) => {
      const tb = tables[t];
      if (!tb) return;
      const [tx, tz] = tb;
      // (Facing +x when on the −x side of the table, −x on the other.)
      seats.push([tx - 0.62, tz + (n % 2 ? 0.45 : -0.45), Math.PI / 2]);
      if (n % 2 === 0) seats.push([tx + 0.62, tz - 0.45, -Math.PI / 2]);
    });
    seats.slice(0, 7).forEach(([x, z, ry], i) => {
      const h = buildHuman(k, looks[i % looks.length]!);
      // (The hips at seat height: the skeleton stands with its hips at about 0.92 m.)
      h.root.position.set(x, y - 0.4, z);
      h.root.rotation.y = ry;
      sit(h);
      h.armL.rotation.x = h.armR.rotation.x = -0.9;
      h.foreL.rotation.x = h.foreR.rotation.x = -0.9;
      k.put(h.root);
      this.people.push(h);
    });
  }

  /** A landing in front of the door, inside the hall, and a straight stair down along the wall (south). */
  private buildStair(): void {
    const { k, L } = this;
    const steel = k.std(0x3a3e45, 0.6, 0.7, 0xc9ced4);
    const yellow = k.std(0x8a6e00, 0.5, 0.3, 0xf2c200);
    const [d0, d1] = this.door();
    const x = L.wallX + 0.7;
    const y = L.floorY;
    // Landing: from the door's north side to a little past its south side.
    const l0 = d0 - 0.2;
    const l1 = d1 + 0.9;
    k.box('landing', steel, x, y - 0.04, (l0 + l1) / 2, 1.4, 0.08, l1 - l0);
    k.box('landing', steel, x, y - 0.2, (l0 + l1) / 2, 1.4, 0.2, 0.1);
    for (const z of [l0 + 0.1, l1 - 0.1]) k.box('landpost', steel, x + 0.6, (y - 0.1) / 2, z, 0.12, y - 0.1, 0.12);
    // Railing round the landing's open sides (north end and hall side; open towards the stair).
    for (const yy of [0.55, 1.05]) {
      k.box('lrail', yellow, x + 0.68, y + yy, (l0 + l1) / 2, 0.05, 0.05, l1 - l0);
      k.box('lrail', yellow, x, y + yy, l0, 1.4, 0.05, 0.05);
    }
    for (const z of [l0, (l0 + l1) / 2, l1]) k.box('lrail', yellow, x + 0.68, y + 0.53, z, 0.05, 1.05, 0.05);
    // The stair: steps going down to the south.
    const n = Math.ceil(y / RISE);
    const rise = y / n;
    const foot = this.stairFoot();
    for (let i = 0; i < n; i++) {
      const z = l1 + (i + 0.5) * TREAD;
      k.box('stairstep', steel, x, y - (i + 1) * rise + 0.02, z, 1.2, 0.05, TREAD + 0.03);
    }
    const len = Math.hypot(foot - l1, y);
    const ang = Math.atan2(y, foot - l1);
    for (const sx of [-0.62, 0.62]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, len), steel);
      s.position.set(x + sx, y / 2 - 0.1, (l1 + foot) / 2);
      s.rotation.x = -ang;
      k.put(s);
      if (sx < 0) continue;
      // A handrail on the open side (the wall has one fixed to it too).
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), yellow);
      r.position.set(x + sx, y / 2 + 0.95, (l1 + foot) / 2);
      r.rotation.x = -ang;
      k.put(r);
      for (let i = 0; i <= 4; i++) {
        const f = i / 4;
        k.box('stairpost', yellow, x + sx, (1 - f) * y + 0.5, l1 + f * (foot - l1), 0.04, 0.95, 0.04);
      }
    }
    const wr = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), yellow);
    wr.position.set(L.wallX + 0.06, y / 2 + 0.95, (l1 + foot) / 2);
    wr.rotation.x = -ang;
    k.put(wr);
    k.blob(x, foot - 0.6, 1.6, 1.4);
  }
}
