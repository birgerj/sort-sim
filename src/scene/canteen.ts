// The canteen and the office: rooms on the first floor outside the hall, against its west wall,
// looking out over the sorter loop's west end. From the hall you see their windows high in the
// wall (the office: two managers at their computers; the canteen: tables, lockers, a counter with
// coffee, plants, people on their break), a balcony along the wall in front of their doors, and a
// steel stair down along the wall at its north end.
//
// The windows and doors are holes in the west wall (`canteenOpenings`; the Sorter cuts them);
// this module builds what is behind and in front of them. Static apart from the people.
import * as THREE from 'three';

import type { FloorKit } from './floor';
import { buildHuman, type Human } from './people';
import { settle, sit } from './motion';
import { Trip, walkOn, type P3 } from './trips';

export interface CanteenLayout {
  /** The hall's west wall (x); the rooms are west of it. */
  wallX: number;
  /** Floor height of the rooms and the balcony, and how deep the rooms are (out from the wall). */
  floorY: number;
  depth: number;
  /** The office and the canteen along the wall (z ranges, north to south; the office is north). */
  office: [number, number];
  canteen: [number, number];
}

type Box4 = [number, number, number, number];

/** Room height, window band (above the room's floor), door width, the stair's step, the balcony's depth. */
const ROOM_H = 3.0;
const WIN = [0.85, 2.55] as const;
const DOOR_W = 1.1;
const RISE = 0.19;
const TREAD = 0.27;
const BALCONY = 1.4;

/** Each room's door: at its north end. */
function doorOf(r: [number, number]): [number, number] {
  return [r[0] + 0.4, r[0] + 0.4 + DOOR_W];
}

/** The balcony in front of the doors (z range): from the stair's top to just past the canteen's door. */
export function balcony(L: CanteenLayout): [number, number] {
  return [L.office[0] - 1.0, doorOf(L.canteen)[1] + 0.6];
}

/** Where the stair reaches the hall floor (z): it goes down north from the balcony's north end. */
export function canteenStairFoot(L: CanteenLayout): number {
  return balcony(L)[0] - Math.ceil(L.floorY / RISE) * TREAD;
}

/** Windows of one room: panes between narrow piers, from past its door to its south end. */
function windowsOf(r: [number, number], y: number): Box4[] {
  const a = doorOf(r)[1] + 0.6;
  const b = r[1] - 0.5;
  const n = Math.max(1, Math.round((b - a) / 1.6));
  const pane = (b - a) / n;
  const out: Box4[] = [];
  for (let i = 0; i < n; i++) out.push([a + i * pane + 0.08, a + (i + 1) * pane - 0.08, y + WIN[0], y + WIN[1]]);
  return out;
}

/** The openings the rooms need in the west wall: windows and doors, each [z0, z1, y0, y1]. */
export function canteenOpenings(L: CanteenLayout): { windows: Box4[]; doors: Box4[] } {
  const y = L.floorY;
  return {
    windows: [...windowsOf(L.office, y), ...windowsOf(L.canteen, y)],
    doors: [L.office, L.canteen].map((r) => {
      const [a, b] = doorOf(r);
      return [a, b, y + 0.02, y + 2.2] as Box4;
    }),
  };
}

/** A manager's desk, and the walk they are on (null: seated); `pause`: where on it they stop at the window. */
interface Desk {
  x: number;
  z: number;
  walk: Trip | null;
  s: number;
  pause: number;
  until: number;
  next: number;
}

export class Canteen {
  private people: Human[] = [];
  /** The managers at their computers: where each sits, and what each is doing (at the desk, or on a walk). */
  private typists: Human[] = [];
  private desks: Desk[] = [];
  /** The way from the foot of the stair onto the hall floor and round the loop's walkway, and back (set by the Sorter). */
  private hallRound: P3[] | null = null;
  /** Seats free for people on their break (by the middle aisle), and who has one. */
  readonly seats: { x: number; z: number; ry: number; taken: boolean }[] = [];
  private lastBt = 0;
  private db = 0;
  private readonly x0: number;

  constructor(
    private k: FloorKit,
    private L: CanteenLayout,
  ) {
    this.x0 = L.wallX - L.depth;
    this.buildRooms();
    this.buildOffice();
    this.buildCanteen();
    this.buildBalcony();
  }

  update(dt: number, bt: number): void {
    // (Beats since the last frame, from the clock: a slow frame still walks the full way.)
    this.db = Math.min(2, Math.max(0, bt - this.lastBt));
    this.lastBt = bt;
    this.people.forEach((h, i) => {
      h.m.talk = Math.sin(bt * 0.5 + i * 1.7) > 0.4 ? 1 : 0;
      h.head.rotation.y = Math.sin(bt * 0.13 + i) * 0.35;
      settle(h, dt, { idle: 0 });
    });
    // The managers type on the beat, now and then looking up from the screens; now and then
    // one gets up to look out of the window, or (the second) walks a round over the loop's walkway.
    this.typists.forEach((h, i) => {
      const d = this.desks[i]!;
      if (d.walk) {
        this.walkManager(h, d, dt, bt);
        return;
      }
      if (bt >= d.next) this.startWalk(i);
      const t = bt * Math.PI * 2 + i;
      h.foreL.rotation.x = -1.2 + 0.1 * Math.max(0, Math.sin(t));
      h.foreR.rotation.x = -1.2 + 0.1 * Math.max(0, Math.sin(t + 1.6));
      h.head.rotation.x = Math.sin(bt * 0.21 + i * 2) > 0.7 ? -0.12 : 0.1;
      settle(h, dt, { idle: 0 });
    });
  }

  /** The way from the stair's foot over the hall floor, round the loop's walkway, and back to the foot. */
  setHallRound(pts: P3[]): void {
    this.hallRound = pts;
  }

  /** Where the stair meets the floor (just off its last step), and the stair up to the balcony. */
  stairUp(): P3[] {
    const L = this.L;
    const sx = L.wallX + 0.7;
    const foot = canteenStairFoot(L);
    return [
      [sx, 0, foot - 0.5],
      [sx, 0, foot],
      [sx, L.floorY, balcony(L)[0]],
    ];
  }

  /** From the top of the stair along the balcony, in at the canteen's door and down the middle aisle to seat `i`. */
  toSeat(i: number): P3[] {
    const L = this.L;
    const y = L.floorY;
    const st = this.seats[i]!;
    const dz = (doorOf(L.canteen)[0] + doorOf(L.canteen)[1]) / 2;
    const aisle = (L.wallX - 1.6 + this.x0 + 2.2) / 2;
    const sx = L.wallX + 0.7;
    return [
      [sx, y, balcony(L)[0]],
      [sx, y, dz],
      [L.wallX - 0.6, y, dz],
      [aisle, y, dz + 0.6],
      [aisle, y, st.z],
      [st.x, y, st.z],
    ];
  }

  /** Seat a person on seat `i` (hips at seat height, facing the table). */
  sitAt(h: Human, i: number): void {
    const st = this.seats[i]!;
    h.root.position.set(st.x, this.L.floorY - 0.4, st.z);
    h.root.rotation.y = st.ry;
    sit(h);
    h.armL.rotation.x = h.armR.rotation.x = -0.9;
    h.foreL.rotation.x = h.foreR.rotation.x = -0.9;
  }

  /** A manager gets up: to the window (both), or down the stair for a round over the loop's walkway (the second, now and then). */
  private startWalk(i: number): void {
    const d = this.desks[i]!;
    const L = this.L;
    const y = L.floorY;
    if (i === 1 && this.hallRound && Math.random() < 0.45) {
      const sx = L.wallX + 0.7;
      const doorZ = (doorOf(L.office)[0] + doorOf(L.office)[1]) / 2;
      const out: P3[] = [
        [d.x, y, d.z],
        [d.x, y, doorZ + 0.3],
        [L.wallX - 0.6, y, doorZ],
        [sx, y, doorZ],
        ...[...this.stairUp()].reverse(),
      ];
      // Out, round the walkway, and the same way back.
      d.walk = new Trip([...out, ...this.hallRound.slice(1), ...[...out].reverse().slice(1)]);
      d.pause = -1;
    } else {
      const wz = d.z + 1.1;
      const out: P3[] = [
        [d.x, y, d.z],
        [d.x, y, wz],
        [L.wallX - 0.6, y, wz],
      ];
      // To the window, a while looking out over the hall, and back.
      d.walk = new Trip([...out, ...[...out].reverse().slice(1)]);
      d.pause = new Trip(out).len;
    }
    d.s = 0;
    d.until = 8 + Math.random() * 10;
  }

  private walkManager(h: Human, d: Desk, dt: number, bt: number): void {
    const speed = 0.7;
    const w = d.walk!;
    // Standing at the window for a while (in beats), looking out over the hall.
    if (d.pause > 0 && d.s >= d.pause && d.until > 0) {
      d.until -= this.db;
      walkOn(h, w, d.pause, dt, bt, 0);
      h.root.rotation.y = Math.PI / 2;
      return;
    }
    d.s += speed * this.db;
    if (d.s >= w.len) {
      // Back at the desk: sit down and type again.
      d.walk = null;
      d.next = bt + 60 + Math.random() * 120;
      h.root.position.set(d.x + 0.05, this.L.floorY - 0.4, d.z);
      h.root.rotation.y = Math.PI / 2;
      sit(h);
      h.armL.rotation.x = h.armR.rotation.x = -0.6;
      return;
    }
    walkOn(h, w, d.s, dt, bt, speed);
  }

  /** Both rooms: floors, ceiling, outer walls, the wall between them, glass and frames, doors, lamps. */
  private buildRooms(): void {
    const { k, L, x0 } = this;
    const y = L.floorY;
    // (The boxes stop a few centimetres short of the hall's wall, so their faces never meet it.)
    const x1 = L.wallX - 0.08;
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    const z0 = L.office[0];
    const z1 = L.canteen[1];
    const cz = (z0 + z1) / 2;
    const len = z1 - z0;
    const wall = k.std(0x3a3d44, 0.6, 0.3, 0xf3f4f6);
    const frame = k.std(0x1d1d1f, 0.5, 0.4, 0x1d1d1f);
    k.box('cceil', wall, cx, y + ROOM_H + 0.06, cz, w, 0.12, len);
    k.box('cwall', wall, x0 + 0.06, y + ROOM_H / 2, cz, 0.12, ROOM_H + 0.2, len);
    for (const z of [z0 + 0.06, z1 - 0.06]) k.box('cwall', wall, cx, y + ROOM_H / 2, z, w, ROOM_H + 0.2, 0.12);
    // Between the office and the canteen.
    k.box('cwall', wall, cx, y + ROOM_H / 2, (L.office[1] + L.canteen[0]) / 2, w, ROOM_H, Math.max(0.12, L.canteen[0] - L.office[1]));
    // Under the rooms, down to the ground: a closed box outside the hall.
    k.box('cbase', wall, cx, (y - 0.1) / 2, cz, w, y - 0.1, len);
    // Floors: carpet in the office, a warm floor in the canteen.
    k.box('ofloor', k.std(0x2c3550, 0.9, 0, 0x7b88b0), cx, y - 0.05, (L.office[0] + L.office[1]) / 2, w, 0.1, L.office[1] - L.office[0]);
    k.box('cfloor', k.std(0x5a4430, 0.8, 0, 0xc9a26a), cx, y - 0.05, (L.canteen[0] + L.canteen[1]) / 2, w, 0.1, L.canteen[1] - L.canteen[0]);
    const open = canteenOpenings(L);
    // Glass in every window, with a frame and a sill.
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfd8e8, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    for (const [a, b, y0, y1] of open.windows) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(b - a, y1 - y0), glass);
      g.position.set(L.wallX - 0.05, (y0 + y1) / 2, (a + b) / 2);
      g.rotation.y = Math.PI / 2;
      g.userData.noInk = true;
      k.put(g);
      k.box('csill', frame, L.wallX, y0 - 0.03, (a + b) / 2, 0.3, 0.06, b - a + 0.1);
      k.box('cframe', frame, L.wallX, y1 + 0.03, (a + b) / 2, 0.22, 0.06, b - a + 0.1);
      for (const z of [a, b]) k.box('cframe', frame, L.wallX, (y0 + y1) / 2, z, 0.22, y1 - y0, 0.05);
    }
    // Doors: a frame in the opening and the leaf standing open into the room.
    const leaf = k.std(0x6b2b6b, 0.6, 0.1, 0x6b3fd1);
    for (const [a, b] of open.doors) {
      for (const z of [a, b]) k.box('cdoorf', frame, L.wallX, y + 1.1, z, 0.24, 2.2, 0.06);
      k.box('cdoorf', frame, L.wallX, y + 2.22, (a + b) / 2, 0.24, 0.06, b - a + 0.12);
      k.box('cdoor', leaf, L.wallX - 0.6, y + 1.05, a + 0.05, DOOR_W - 0.05, 2.1, 0.05);
    }
    // Lamps under the ceiling: lit panels, they glow at night through the windows.
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.35, 1.2) });
    for (let z = z0 + 2; z < z1 - 1; z += 3.5) for (const x of [x0 + 1.8, x1 - 1.8]) k.box('clamp', lamp, x, y + ROOM_H - 0.02, z, 0.3, 0.03, 1.2);
  }

  /** The office: two desks facing the windows, a manager at a computer at each, cabinets, a whiteboard. */
  private buildOffice(): void {
    const { k, L, x0 } = this;
    const y = L.floorY;
    const [o0, o1] = L.office;
    const top = k.std(0x4a4d55, 0.6, 0.2, 0xe9ecef);
    const grey = k.std(0x3a3d44, 0.5, 0.5, 0x6b7078);
    const dark = k.std(0x1d1d1f, 0.4, 0.4, 0x1d1d1f);
    const screen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.75, 1.1) });
    const dx = L.wallX - 2.0;
    const looks = [
      { shirt: 0x2b2f3a, trousers: 0x2b2f3a, suit: { tie: 0x1755fe }, skin: 0xe8c4a0, hair: 0x6a4a2c, hairStyle: 0 },
      { shirt: 0xf3f4f6, trousers: 0x22283f, skin: 0xc68e62, hair: 0x1d1d1f, hairStyle: 2 },
    ];
    [o0 + (o1 - o0) * 0.45, o0 + (o1 - o0) * 0.8].forEach((dz, i) => {
      k.box('odesk', top, dx, y + 0.74, dz, 0.8, 0.05, 1.7);
      for (const sz of [-0.8, 0.8]) k.box('odleg', grey, dx, y + 0.37, dz + sz, 0.7, 0.74, 0.05);
      // Two screens facing the manager (west), their backs to the windows.
      for (const sz of [-0.33, 0.33]) {
        k.box('omon', dark, dx + 0.2, y + 1.1, dz + sz, 0.04, 0.38, 0.6);
        k.box('oscreen', screen, dx + 0.175, y + 1.1, dz + sz, 0.01, 0.33, 0.55);
      }
      k.box('omonarm', grey, dx + 0.24, y + 0.88, dz, 0.06, 0.3, 0.06);
      k.box('okbd', dark, dx - 0.15, y + 0.78, dz, 0.18, 0.02, 0.48);
      k.box('omouse', dark, dx - 0.15, y + 0.78, dz + 0.36, 0.1, 0.03, 0.06);
      k.box('omug', k.std(0xdddddd, 0.5, 0.1, 0xffffff), dx + 0.05, y + 0.82, dz - 0.65, 0.08, 0.1, 0.08);
      // The chair, and the manager in it, facing east: the screens, and past them the hall.
      const cx = dx - 0.7;
      k.box('ochair', dark, cx, y + 0.48, dz, 0.5, 0.08, 0.5);
      k.box('ochair', dark, cx - 0.27, y + 0.85, dz, 0.06, 0.7, 0.48);
      k.box('ochair', grey, cx, y + 0.24, dz, 0.06, 0.45, 0.06);
      k.box('ochair', grey, cx, y + 0.03, dz, 0.55, 0.04, 0.55);
      const h = buildHuman(k, looks[i]!);
      h.root.position.set(cx + 0.05, y - 0.4, dz);
      h.root.rotation.y = Math.PI / 2;
      sit(h);
      h.armL.rotation.x = h.armR.rotation.x = -0.6;
      k.put(h.root);
      this.typists.push(h);
      this.desks.push({ x: cx, z: dz, walk: null, s: 0, pause: 0, until: 0, next: 30 + i * 50 + Math.random() * 60 });
    });
    // Filing cabinets and a plant along the back wall, a whiteboard with the shift plan.
    for (let i = 0; i < 3; i++) k.box('ocab', grey, x0 + 0.45, y + 0.65, o0 + 1.0 + i * 0.55, 0.6, 1.3, 0.5);
    const mid = (o0 + o1) / 2 + 1;
    k.box('owb', k.std(0xdddddd, 0.3, 0.1, 0xffffff), x0 + 0.14, y + 1.6, mid, 0.04, 1.0, 2.2);
    const ink = k.std(0x1755fe, 0.5, 0, 0x1755fe);
    for (let i = 0; i < 4; i++) k.box('owbline', ink, x0 + 0.17, y + 1.85 - i * 0.18, mid - 0.3 + (i % 2) * 0.3, 0.01, 0.03, 1.2 - (i % 3) * 0.3);
    k.box('cpot', dark, x0 + 0.4, y + 0.25, o1 - 0.6, 0.4, 0.5, 0.4);
    k.box('cplant', k.std(0x1f5a2a, 0.9, 0, 0x2f9a4a), x0 + 0.4, y + 0.85, o1 - 0.6, 0.6, 0.7, 0.6);
  }

  /** The canteen: tables in two rows, lockers along the back wall, a counter with coffee, plants, people. */
  private buildCanteen(): void {
    const { k, L, x0 } = this;
    const y = L.floorY;
    const [c0, c1] = L.canteen;
    const wood = k.std(0x6b5a44, 0.8, 0, 0xe0c49a);
    const grey = k.std(0x3a3d44, 0.5, 0.5, 0x6b7078);
    const chairs = [k.std(0x0f5c4f, 0.7, 0, 0x2fa58f), k.std(0x8a6e00, 0.7, 0, 0xf2c200), k.std(0x6b2b6b, 0.7, 0, 0xd6339a)];
    const white = k.std(0xdddddd, 0.5, 0.1, 0xffffff);
    const dark = k.std(0x1d1d1f, 0.4, 0.4, 0x1d1d1f);
    const green = k.std(0x1f5a2a, 0.9, 0, 0x2f9a4a);
    const teal = k.std(0x1f5f4f, 0.6, 0.1, 0x2fa58f);
    // Counter along the south end: coffee machine, microwave, fridge.
    const cz = c1 - 0.5;
    k.box('ccounter', white, (x0 + L.wallX) / 2 - 0.4, y + 0.45, cz, L.depth - 1.6, 0.9, 0.7);
    k.box('ccoffee', dark, x0 + 1.5, y + 1.15, cz, 0.4, 0.5, 0.4);
    k.box('ccoffee', new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.8, 1.2) }), x0 + 1.5, y + 1.25, cz - 0.21, 0.25, 0.15, 0.02);
    k.box('cmicro', grey, x0 + 2.6, y + 1.07, cz, 0.55, 0.32, 0.45);
    k.box('cfridge', white, L.wallX - 0.9, y + 0.95, cz, 0.7, 1.9, 0.7);
    // Lockers along the back wall in two blocks, a notice board between them.
    const mid = (c0 + c1) / 2;
    const lockers = (from: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const z = from + i * 0.62;
        k.box('locker', [teal, grey][i % 2]!, x0 + 0.38, y + 0.95, z, 0.5, 1.9, 0.6);
        k.box('lockerv', dark, x0 + 0.64, y + 1.6, z, 0.02, 0.04, 0.3);
      }
    };
    lockers(c0 + 2.0, 16);
    lockers(mid + 1.8, 16);
    k.box('cboard', k.std(0x6a5038, 0.8, 0, 0xc49a6c), x0 + 0.15, y + 1.7, mid + 0.4, 0.04, 1.0, 2.0);
    // Tables in two rows: one by the windows, one in front of the lockers.
    const tables: [number, number][] = [];
    for (let z = c0 + 3.0; z < c1 - 1.8; z += 3.0) for (const x of [L.wallX - 1.6, x0 + 2.2]) tables.push([x, z]);
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
    // Plants under the windows, between the tables.
    for (let z = c0 + 4.5; z < c1 - 2; z += 6) {
      k.box('cpot', dark, L.wallX - 0.35, y + 0.25, z, 0.4, 0.5, 0.4);
      k.box('cplant', green, L.wallX - 0.35, y + 0.85, z, 0.5, 0.7, 0.6);
    }
    // People on their break, sitting at the tables across from each other.
    const looks = [
      { shirt: 0x3a3d44, trousers: 0x22283f, vest: 0xf2a51a },
      { shirt: 0xf3f4f6, trousers: 0x22283f, cap: 0x2fa58f },
      { shirt: 0x1755fe, trousers: 0x3a3d44, vest: 0xc8ff3a },
      { shirt: 0x6b3fd1, trousers: 0x22283f },
      { shirt: 0x22283f, trousers: 0x22283f, vest: 0x1d4ed8 },
    ];
    const seats: [number, number, number][] = [];
    [0, 1, 4, 7, 10, 13, 16].forEach((t, n) => {
      const tb = tables[t];
      if (!tb) return;
      const [tx, tz] = tb;
      // (Facing +x when on the −x side of the table, −x on the other.)
      seats.push([tx - 0.62, tz + (n % 2 ? 0.45 : -0.45), Math.PI / 2]);
      if (n % 2 === 0) seats.push([tx + 0.62, tz - 0.45, -Math.PI / 2]);
    });
    // The other tables' seats by the middle aisle are free for people coming up on their break.
    tables.forEach(([tx, tz], t) => {
      if ([0, 1, 4, 7, 10, 13, 16].includes(t)) return;
      const west = tx < (x0 + L.wallX) / 2;
      for (const dz of [-0.45, 0.45]) this.seats.push(west ? { x: tx + 0.62, z: tz + dz, ry: -Math.PI / 2, taken: false } : { x: tx - 0.62, z: tz + dz, ry: Math.PI / 2, taken: false });
    });
    seats.slice(0, 11).forEach(([x, z, ry], i) => {
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

  /** The balcony along the wall in front of the doors, inside the hall, and the stair down at its north end. */
  private buildBalcony(): void {
    const { k, L } = this;
    const steel = k.std(0x3a3e45, 0.6, 0.7, 0xc9ced4);
    const yellow = k.std(0x8a6e00, 0.5, 0.3, 0xf2c200);
    const [b0, b1] = balcony(L);
    const y = L.floorY;
    const bx = L.wallX + BALCONY / 2;
    const xo = L.wallX + BALCONY;
    const bz = (b0 + b1) / 2;
    k.box('balcony', steel, bx, y - 0.04, bz, BALCONY, 0.08, b1 - b0);
    k.box('balcony', steel, xo - 0.05, y - 0.2, bz, 0.1, 0.25, b1 - b0);
    // Hung on the wall (nothing on the floor below, where the baler and the bins stand): a bracket every 3 m.
    const n = Math.max(1, Math.round((b1 - b0) / 3));
    const brace = Math.hypot(BALCONY - 0.15, 1.1);
    for (let i = 0; i <= n; i++) {
      const z = b0 + 0.15 + ((b1 - b0 - 0.3) * i) / n;
      k.box('balbracket', steel, bx, y - 0.16, z, BALCONY, 0.16, 0.1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(brace, 0.1, 0.08), steel);
      m.position.set(L.wallX + (BALCONY - 0.15) / 2 + 0.02, y - 0.2 - 0.55, z);
      m.rotation.z = Math.atan2(1.1, BALCONY - 0.15);
      k.put(m);
    }
    // Railing along the hall side and at the south end (open at the north end, where the stair goes down).
    for (const yy of [0.55, 1.05]) {
      k.box('brail', yellow, xo - 0.02, y + yy, bz, 0.05, 0.05, b1 - b0);
      k.box('brail', yellow, bx, y + yy, b1, BALCONY, 0.05, 0.05);
    }
    const posts = Math.max(1, Math.round((b1 - b0) / 1.5));
    for (let i = 0; i <= posts; i++) k.box('brail', yellow, xo - 0.02, y + 0.53, b0 + ((b1 - b0) * i) / posts, 0.05, 1.05, 0.05);
    // The stair: steps down to the north, along the wall.
    const sx = L.wallX + 0.7;
    const steps = Math.ceil(y / RISE);
    const rise = y / steps;
    const foot = canteenStairFoot(L);
    for (let i = 0; i < steps; i++) k.box('stairstep', steel, sx, y - (i + 1) * rise + 0.02, b0 - (i + 0.5) * TREAD, 1.2, 0.05, TREAD + 0.03);
    // Stringers and handrails: high at the balcony (+z end), low at the foot (−z end).
    const len = Math.hypot(b0 - foot, y);
    const ang = Math.atan2(y, b0 - foot);
    const sloped = (sxz: number, py: number, w: number, h: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
      m.position.set(sxz, py, (b0 + foot) / 2);
      // (Turned −ang about x: the box's +z end goes up.)
      m.rotation.x = -ang;
      k.put(m);
    };
    for (const ox of [-0.62, 0.62]) sloped(sx + ox, y / 2 - 0.12, 0.06, 0.3, steel);
    sloped(sx + 0.62, y / 2 + 0.95, 0.05, 0.05, yellow);
    sloped(L.wallX + 0.08, y / 2 + 0.95, 0.05, 0.05, yellow);
    for (let i = 0; i <= 4; i++) {
      const f = i / 4;
      k.box('stairpost', yellow, sx + 0.62, f * y + 0.5, foot + f * (b0 - foot), 0.04, 0.95, 0.04);
    }
    k.blob(sx, foot - 0.6, 1.6, 1.4);
  }
}
