// The canteen: a first floor over the inbound docks, across the whole width of the wing. A steel
// mezzanine on columns between the collector belts carries a room with a glass front that looks
// out over the hall: tables and chairs, a counter with a coffee machine, a fridge, plants, lamps,
// and a few people on their break. A straight stair along the wing's east wall goes up to a
// landing at the east end, with a door into the room.
//
// All static except the people (who sit and talk); both looks: drawn by day, lit windows at night.
import * as THREE from 'three';

import type { FloorKit } from './floor';
import { buildHuman, type Human } from './people';
import { settle, sit } from './motion';

export interface CanteenLayout {
  /** The wing's walls: west and east (x), north (z). */
  x0: number;
  x1: number;
  z0: number;
  /** Front edge of the mezzanine (z), and its floor's height. */
  front: number;
  floorY: number;
  /** x of the columns along the front edge (clear of the telescopes and collectors). */
  columns: number[];
  /** The stair: along the east wall, its foot (z) on the hall floor. */
  stairX: number;
  stairFootZ: number;
}

/** Room height, and the width of the landing at the east end (the stair comes up there). */
const ROOM_H = 2.9;
const LANDING = 2.4;

export class Canteen {
  private people: { h: Human; talk: number }[] = [];

  constructor(
    private k: FloorKit,
    private L: CanteenLayout,
  ) {
    this.buildFloor();
    this.buildRoom();
    this.buildFurniture();
    this.buildStair();
  }

  /** The people at the tables: they talk now and then (the rest is breathing and blinking). */
  update(dt: number, bt: number): void {
    this.people.forEach((p, i) => {
      p.h.m.talk = Math.sin(bt * 0.5 + i * 1.7) > 0.4 ? 1 : 0;
      p.h.head.rotation.y = Math.sin(bt * 0.13 + i) * 0.35;
      settle(p.h, dt, { idle: 0 });
    });
  }

  private buildFloor(): void {
    const { k, L } = this;
    const y = L.floorY;
    const steel = k.std(0x3a3d44, 0.5, 0.5, 0x1755fe);
    const deck = k.std(0x50545b, 0.7, 0.3, 0xb9c0c8);
    const yellow = k.std(0x8a6e00, 0.5, 0.3, 0xf2c200);
    const w = L.x1 - L.x0;
    const d = L.front - L.z0;
    const cx = (L.x0 + L.x1) / 2;
    const cz = (L.z0 + L.front) / 2;
    // The deck (0.3 m deep), and a beam along its front edge.
    k.box('mezz', deck, cx, y - 0.15, cz, w, 0.3, d);
    k.box('mezzbeam', steel, cx, y - 0.3, L.front - 0.12, w, 0.3, 0.24);
    // Columns along the front edge.
    for (const x of L.columns) {
      k.box('mezzcol', steel, x, (y - 0.45) / 2, L.front - 0.15, 0.25, y - 0.45, 0.25);
      k.box('mezzfoot', steel, x, 0.01, L.front - 0.15, 0.45, 0.02, 0.45);
      k.blob(x, L.front - 0.15, 0.7, 0.7);
    }
    // Yellow edge of the landing, with a railing (open where the stair comes up).
    const lx0 = L.x1 - LANDING;
    k.box('mezzedge', yellow, (lx0 + L.x1) / 2, y + 0.02, L.front - 0.05, LANDING, 0.04, 0.1);
    const railX0 = lx0;
    const railX1 = L.stairX - 0.7;
    for (const yy of [0.55, 1.05]) k.box('mezzrail', yellow, (railX0 + railX1) / 2, y + yy, L.front - 0.05, railX1 - railX0, 0.05, 0.05);
    for (let x = railX0; x <= railX1 + 0.01; x += (railX1 - railX0) / 2) k.box('mezzrail', yellow, x, y + 0.53, L.front - 0.05, 0.05, 1.05, 0.05);
  }

  /** The room: a glass front with mullions, a partition with a door at the landing, a ceiling and lamps. */
  private buildRoom(): void {
    const { k, L } = this;
    const y = L.floorY;
    const rx0 = L.x0 + 0.1;
    const rx1 = L.x1 - LANDING;
    const fz = L.front - 0.3;
    const w = rx1 - rx0;
    const cx = (rx0 + rx1) / 2;
    const wall = k.std(0x3a3d44, 0.6, 0.3, 0xf3f4f6);
    const frame = k.std(0x1d1d1f, 0.5, 0.4, 0x1d1d1f);
    const floorM = k.std(0x5a4430, 0.8, 0, 0xc9a26a);
    // Floor finish and ceiling.
    k.box('cfloor', floorM, cx, y + 0.01, (L.z0 + fz) / 2, w, 0.02, fz - L.z0);
    k.box('cceil', wall, cx, y + ROOM_H + 0.06, (L.z0 + fz) / 2, w + 0.2, 0.12, fz - L.z0 + 0.1);
    // Front: a sill, the window band, a header; mullions every 1.5 m.
    k.box('cfront', wall, cx, y + 0.4, fz, w, 0.8, 0.12);
    k.box('cfront', wall, cx, y + ROOM_H - 0.2, fz, w, 0.4, 0.12);
    const n = Math.round(w / 1.5);
    for (let i = 0; i <= n; i++) k.box('cmull', frame, rx0 + (w * i) / n, y + 1.65, fz, 0.07, 1.7, 0.14);
    k.box('cmull', frame, cx, y + 0.82, fz, w, 0.05, 0.14);
    // The glass: see-through, a little blue, so the room shows from the hall.
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfd8e8, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    const g = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.65), glass);
    g.position.set(cx, y + 1.65, fz);
    g.userData.noInk = true;
    k.put(g);
    // Partition at the landing, with a door (a gap and a frame).
    const pz0 = L.z0;
    const doorZ = fz - 1.2;
    k.box('cpart', wall, rx1, y + ROOM_H / 2, (pz0 + doorZ - 0.55) / 2, 0.12, ROOM_H, doorZ - 0.55 - pz0);
    k.box('cpart', wall, rx1, y + ROOM_H / 2, (doorZ + 0.55 + fz) / 2, 0.12, ROOM_H, fz - doorZ - 0.55);
    k.box('cpart', wall, rx1, y + ROOM_H - 0.3, doorZ, 0.12, 0.6, 1.1);
    for (const dz of [-0.55, 0.55]) k.box('cdoorf', frame, rx1, y + 1.15, doorZ + dz, 0.16, 2.3, 0.06);
    // Lamps under the ceiling: lit panels (they glow at night, through the glass).
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.35, 1.2) });
    for (let x = rx0 + 3; x < rx1 - 1; x += 5) for (const z of [L.z0 + 1.8, fz - 1.6]) k.box('clamp', lamp, x, y + ROOM_H - 0.02, z, 1.2, 0.03, 0.3);
  }

  /** Tables with chairs in two rows, a counter with a coffee machine and a fridge, plants, a few people. */
  private buildFurniture(): void {
    const { k, L } = this;
    const y = L.floorY;
    const rx0 = L.x0 + 0.1;
    const rx1 = L.x1 - LANDING;
    const fz = L.front - 0.3;
    const wood = k.std(0x6b5a44, 0.8, 0, 0xe0c49a);
    const grey = k.std(0x3a3d44, 0.5, 0.5, 0x6b7078);
    const chairs = [k.std(0x0f5c4f, 0.7, 0, 0x2fa58f), k.std(0x8a6e00, 0.7, 0, 0xf2c200), k.std(0x6b2b6b, 0.7, 0, 0xd6339a)];
    const white = k.std(0xdddddd, 0.5, 0.1, 0xffffff);
    const dark = k.std(0x1d1d1f, 0.4, 0.4, 0x1d1d1f);
    const green = k.std(0x1f5a2a, 0.9, 0, 0x2f9a4a);
    // Counter along the west end: a coffee machine, a fridge and a microwave.
    const cx0 = rx0 + 0.45;
    k.box('ccounter', white, cx0, y + 0.45, (L.z0 + fz) / 2, 0.7, 0.9, fz - L.z0 - 1.6);
    k.box('ccoffee', dark, cx0, y + 1.15, L.z0 + 1.5, 0.4, 0.5, 0.4);
    k.box('ccoffee', new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.8, 1.2) }), cx0 + 0.21, y + 1.25, L.z0 + 1.5, 0.02, 0.15, 0.25);
    k.box('cmicro', grey, cx0, y + 1.07, L.z0 + 2.5, 0.45, 0.32, 0.55);
    k.box('cfridge', white, cx0, y + 0.95, fz - 0.6, 0.7, 1.9, 0.7);
    // Tables: a row along the windows and one along the back wall, four chairs each.
    let seat = 0;
    const tables: [number, number][] = [];
    for (let x = rx0 + 2.6; x < rx1 - 1.2; x += 3.2) for (const z of [L.z0 + 1.5, fz - 1.4]) tables.push([x, z]);
    tables.forEach(([tx, tz], i) => {
      k.box('ctable', wood, tx, y + 0.75, tz, 1.6, 0.05, 0.9);
      k.box('ctleg', grey, tx, y + 0.37, tz, 0.08, 0.74, 0.08);
      k.box('ctleg', grey, tx, y + 0.02, tz, 0.5, 0.04, 0.5);
      for (const sx of [-0.45, 0.45]) {
        for (const sz of [-0.65, 0.65]) {
          const m = chairs[(i + seat++) % chairs.length]!;
          k.box('cchair', m, tx + sx, y + 0.46, tz + sz, 0.44, 0.05, 0.44);
          k.box('cchair', m, tx + sx, y + 0.74, tz + sz + Math.sign(sz) * 0.21, 0.44, 0.5, 0.05);
          k.box('ccleg', grey, tx + sx, y + 0.22, tz + sz, 0.04, 0.44, 0.04);
        }
      }
      // Something on most tables: a mug, a lunch box, a phone.
      if (i % 3 !== 2) k.box('cmug', white, tx + 0.3, y + 0.83, tz - 0.1, 0.08, 0.1, 0.08);
      if (i % 2) k.box('clunch', chairs[i % 3]!, tx - 0.35, y + 0.82, tz + 0.12, 0.25, 0.08, 0.16);
    });
    // Plants at the windows.
    for (let x = rx0 + 4.2; x < rx1 - 1; x += 9.6) {
      k.box('cpot', dark, x, y + 0.25, fz - 0.35, 0.4, 0.5, 0.4);
      k.box('cplant', green, x, y + 0.85, fz - 0.35, 0.6, 0.7, 0.5);
    }
    // A few people on their break, sitting at the tables (facing across them).
    const looks = [
      { shirt: 0x3a3d44, trousers: 0x22283f, vest: 0xf2a51a },
      { shirt: 0xf3f4f6, trousers: 0x22283f, cap: 0x2fa58f },
      { shirt: 0x1755fe, trousers: 0x3a3d44, vest: 0xc8ff3a },
      { shirt: 0x6b3fd1, trousers: 0x22283f },
      { shirt: 0x22283f, trousers: 0x22283f, vest: 0x1d4ed8 },
    ];
    const spots: [number, number, number][] = [];
    const pickT = [0, 1, 4, 7, 8].filter((t) => t < tables.length);
    pickT.forEach((t, n) => {
      const [tx, tz] = tables[t]!;
      const sz = n % 2 ? 0.62 : -0.62;
      spots.push([tx + (n % 3 ? 0.45 : -0.45), tz + sz, sz > 0 ? Math.PI : 0]);
      if (n % 2 === 0) spots.push([tx - 0.45, tz - sz, sz > 0 ? 0 : Math.PI]);
    });
    spots.slice(0, 7).forEach(([x, z, ry], i) => {
      const h = buildHuman(k, looks[i % looks.length]!);
      h.root.position.set(x, y + 0.03, z);
      h.root.rotation.y = ry;
      sit(h);
      // Hands on the table.
      h.armL.rotation.x = h.armR.rotation.x = -0.9;
      h.foreL.rotation.x = h.foreR.rotation.x = -0.9;
      k.put(h.root);
      this.people.push({ h, talk: 0 });
    });
  }

  /** A straight steel stair along the east wall, from the hall floor up to the landing. */
  private buildStair(): void {
    const { k, L } = this;
    const steel = k.std(0x3a3e45, 0.6, 0.7, 0xc9ced4);
    const yellow = k.std(0x8a6e00, 0.5, 0.3, 0xf2c200);
    const top = L.front;
    const n = Math.ceil(L.floorY / 0.19);
    const rise = L.floorY / n;
    const run = (L.stairFootZ - top) / n;
    const x = L.stairX;
    for (let i = 0; i < n; i++) {
      const z = L.stairFootZ - (i + 0.5) * run;
      k.box('stairstep', steel, x, (i + 1) * rise - 0.03, z, 1.2, 0.05, run + 0.04);
    }
    // Stringers and handrails, both sides (as sloped boxes: one per stretch of steps).
    const len = Math.hypot(L.stairFootZ - top, L.floorY);
    const ang = Math.atan2(L.floorY, L.stairFootZ - top);
    for (const sx of [-0.62, 0.62]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, len), steel);
      s.position.set(x + sx, L.floorY / 2 - 0.1, (L.stairFootZ + top) / 2);
      s.rotation.x = ang;
      k.put(s);
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), yellow);
      r.position.set(x + sx, L.floorY / 2 + 0.95, (L.stairFootZ + top) / 2);
      r.rotation.x = ang;
      k.put(r);
      for (let i = 0; i <= 4; i++) {
        const f = i / 4;
        k.box('stairpost', yellow, x + sx, f * L.floorY + 0.5, L.stairFootZ - f * (L.stairFootZ - top), 0.04, 0.95, 0.04);
      }
    }
    k.blob(x, L.stairFootZ - 0.6, 1.6, 1.4);
  }
}
