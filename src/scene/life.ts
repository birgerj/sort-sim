// Life around the machines: people walking their rounds, a cleaner on a
// scrubber, a forklift charging
// station, safety details (exit signs, extinguishers, first aid, walkway),
// a break area and painted zone names on the floor.
//
// Walkers and vehicles move by day (by night the hall belongs to the party).
// Steps land on the beat: two steps per beat for walkers.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import type { FloorKit } from './floor';
import { buildForklift } from './forklift';
import { XMAS } from '../sim/season';
import { buildHuman, type Human } from './people';

type V2 = [number, number];

/** A closed polyline on the floor, walked at constant speed. */
class Route {
  private acc: number[] = [0];
  readonly len: number;
  constructor(private pts: V2[]) {
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i % pts.length]!;
      this.acc.push(this.acc[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    this.len = this.acc[this.acc.length - 1]!;
  }
  /** Position and heading (yaw, facing +z at 0) at distance s. */
  at(s: number): { x: number; z: number; yaw: number } {
    s = ((s % this.len) + this.len) % this.len;
    let i = 0;
    while (this.acc[i + 1]! < s) i++;
    const a = this.pts[i]!;
    const b = this.pts[(i + 1) % this.pts.length]!;
    const f = (s - this.acc[i]!) / (this.acc[i + 1]! - this.acc[i]!);
    return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  }
}

interface Walker {
  h: Human;
  route: Route;
  /** Metres per beat. */
  speed: number;
  s: number;
  yaw: number;
  /** Seated (a driver): no walking legs. */
  seated?: THREE.Group;
}

export interface LifeLayout {
  /** Hall walls. */
  wx: number;
  ex: number;
  hz: number;
  /** North wall (further out than the south one). */
  nz: number;
  /** East face of the high-bay rack, its half length and its shelf heights. */
  rackEastX: number;
  rackHalf: number;
  levels: number[];
  /** Front of the control room (x centre, z of the front wall). */
  controlRoom: [number, number];
  /** Wall columns: x positions on the north and south walls. */
  columnsNorth: number[];
  columnsSouth: number[];
}

export class Life {
  private walkers: Walker[] = [];
  private group = new THREE.Group();

  constructor(
    private k: FloorKit,
    private L: LifeLayout,
  ) {
    k.put(this.group, 'day');
    this.buildWalkers();
    this.buildCharging();
    this.buildSafety();
    this.buildBreakArea();
    this.buildExtras();
    this.buildFloorNames();
  }

  update(dt: number, bt: number): void {
    void dt;
    for (const w of this.walkers) {
      w.s = bt * w.speed;
      const p = w.route.at(w.s);
      let d = p.yaw - w.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      w.yaw += d * Math.min(1, dt * 6);
      w.h.root.position.set(p.x, 0, p.z);
      w.h.root.rotation.y = w.yaw;
      if (w.seated) {
        w.seated.position.set(p.x, 0, p.z);
        w.seated.rotation.y = w.yaw;
        continue;
      }
      // Two steps per beat.
      const swing = Math.sin(bt * Math.PI * 2) * 0.45;
      w.h.legL.rotation.x = swing;
      w.h.legR.rotation.x = -swing;
      w.h.armL.rotation.x = -swing * 0.7;
      w.h.armR.rotation.x = w.h.armR.userData.hold ? -0.9 : swing * 0.7;
      if (w.h.armR.userData.wave) {
        // Father Christmas waves (and carries his sack with the other hand).
        w.h.armR.rotation.x = -2.7;
        w.h.armR.rotation.z = 0.25 + Math.sin(bt * Math.PI * 2) * 0.35;
        w.h.armL.rotation.x = -0.35;
      }
      w.h.root.position.y = Math.abs(Math.cos(bt * Math.PI * 2)) * 0.03;
    }
  }

  // ---------- people and the scrubber ----------

  private buildWalkers(): void {
    const k = this.k;
    const walk = (look: Parameters<typeof buildHuman>[1], pts: V2[], speed: number, phase: number, tablet = false) => {
      const h = buildHuman(k, look);
      this.group.add(h.root);
      if (tablet) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.2), k.std(0x1d1d1f, 0.4, 0.2, 0x1d1d1f));
        t.position.set(0, -0.6, 0.12);
        h.armR.add(t);
        h.armR.userData.hold = true;
      }
      const route = new Route(pts);
      this.walkers.push({ h, route, speed, s: phase * route.len, yaw: 0 });
    };
    // Team leader with a tablet, round the manual sorting and control room.
    walk({ shirt: 0x6b3fd1, trousers: 0x22283f, cap: 0x1d1d1f }, [[-44, 15.3], [-26, 15.3], [-26, 17.3], [-44, 17.3]], 0.7, 0, true);
    // Two colleagues walking the infeed side.
    if (XMAS) {
      // Father Christmas walks a round by the control room, waving.
      const h = buildHuman(k, { shirt: 0xc8102e, trousers: 0xc8102e, skin: 0xf0cfb0, hair: 0xffffff, santa: true });
      this.group.add(h.root);
      h.armR.userData.wave = true;
      this.walkers.push({ h, route: new Route([[-55, 15], [-46.5, 15], [-46.5, 18.3], [-55, 18.3]]), speed: 0.35, s: 0, yaw: 0 });
    }
    walk({ shirt: 0x2fa58f, trousers: 0x3a3d44, vest: 0xc8ff3a, helmet: 0xffffff }, [[-58, 12.6], [-28, 12.6], [-28, 13.6], [-58, 13.6]], 0.6, 0.2);
    walk({ shirt: 0xf3f4f6, trousers: 0x22283f, vest: 0xf2a51a, helmet: 0xf2c200 }, [[-58, 12.6], [-28, 12.6], [-28, 13.6], [-58, 13.6]], 0.6, 0.7);
    // Cleaner on a ride-on scrubber, under the high infeeds.
    const sc = new THREE.Group();
    this.group.add(sc);
    const body = this.k.std(0x2fa58f, 0.5, 0.2, 0x2fa58f);
    const dark = this.k.std(0x1d1d1f, 0.6, 0.2, 0x2a2c31);
    sc.add(new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.7, 1.5, 3, 0.15).translate(0, 0.5, 0), body));
    sc.add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.1, 20).translate(0, 0.08, 0.5), dark));
    sc.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.2).translate(0, 0.06, -0.8), dark));
    sc.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6).rotateX(-0.5).translate(0, 1.05, 0.55), dark));
    sc.add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 14).rotateX(Math.PI / 2.5).translate(0, 1.32, 0.62), dark));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.2, 0.1) }));
    beacon.position.set(0, 1.0, -0.6);
    sc.add(beacon);
    this.k.blobUnder(sc, 1.6, 2.2);
    const driver = buildHuman(this.k, { shirt: 0x1755fe, trousers: 0x22283f, cap: 0x2fa58f });
    driver.root.position.set(0, 0.0, -0.2);
    driver.legL.rotation.x = driver.legR.rotation.x = -1.4;
    driver.armL.rotation.x = driver.armR.rotation.x = -0.9;
    for (const c of [...driver.root.children]) if (c.userData.noInk) driver.root.remove(c);
    const seat = new THREE.Group();
    seat.add(driver.root);
    driver.root.position.y = 0.0;
    sc.add(seat);
    seat.position.y = 0;
    this.walkers.push({ h: { ...driver, root: new THREE.Group() }, route: new Route([[-57, 10.6], [-28, 10.6], [-28, 11.4], [-57, 11.4]]), speed: 0.5, s: 0, yaw: 0, seated: sc });
  }

  // ---------- static details ----------

  private buildCharging(): void {
    const k = this.k;
    const z = this.L.hz - 0.4;
    const cab = k.std(0x6b7280, 0.5, 0.5, 0xdfe3e8);
    const green = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.5, 0.4) });
    for (const x of [106.5, 109.5]) {
      k.box('charger', cab, x, 0.9, z, 0.8, 1.8, 0.5);
      k.box('chargerled', green, x - 0.2, 1.5, z - 0.26, 0.12, 0.06, 0.02);
      k.box('chargercable', k.std(0x1d1d1f, 0.6, 0.2, 0x1d1d1f), x + 0.25, 0.6, z - 0.9, 0.05, 0.05, 1.3);
      const f = buildForklift(k, null);
      f.g.position.set(x, 0, z - 2.6);
      f.g.rotation.y = 0;
      f.beacon.color.setRGB(0.2, 1.2, 0.3);
    }
    k.box('chargesign', green, 108, 2.4, z - 0.02, 1.4, 0.4, 0.04);
    k.blob(108, z - 0.2, 5, 1.4);
  }

  private buildSafety(): void {
    const k = this.k;
    const L = this.L;
    // Exit signs: green, lit (so they glow at night too).
    const exit = new THREE.MeshBasicMaterial({ map: exitTex() });
    const place = (x: number, y: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.36, 0.06), [exit, exit, exit, exit, exit, exit]);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      k.put(m);
    };
    for (const z of [-24, 20]) place(L.wx + 0.1, 3.2, z, Math.PI / 2);
    for (const z of [-20, 20]) place(L.ex - 0.1, 3.2, z, -Math.PI / 2);
    place(-30, 4.2, L.nz + 0.1, 0);
    place(-46, 4.2, L.hz - 0.1, Math.PI);
    // Fire extinguishers with a sign, on the columns.
    const red = k.std(0x8a1a14, 0.4, 0.3, 0xe2231a);
    const black = k.std(0x1d1d1f, 0.5, 0.3, 0x1d1d1f);
    const signM = new THREE.MeshBasicMaterial({ map: fireTex() });
    const ext = (x: number, z: number, dir: 1 | -1) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      k.put(g);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 14).translate(0, 0.75, 0), red));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.08, 10).translate(0, 1.04, 0), black));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.03).translate(0.08, 0.86, 0.04 * dir), black));
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), signM);
      s.position.set(0, 1.6, 0.01 * dir);
      if (dir < 0) s.rotation.y = Math.PI;
      g.add(s);
    };
    for (const x of L.columnsNorth) ext(x + 0.55, L.nz + 0.45, 1);
    for (const x of L.columnsSouth) ext(x + 0.55, L.hz - 0.45, -1);
    // First aid box beside the control room door.
    const [cx, cz] = L.controlRoom;
    k.box('firstaid', new THREE.MeshBasicMaterial({ map: firstAidTex() }), cx + 2.9, 1.6, cz - 0.05, 0.5, 0.5, 0.12);
    // A green walkway with white edges and a yellow rail along the robot floor's west end.
    const paint = k.std(0x1f5f4f, 0.9, 0, 0x2fa58f);
    const white = k.std(0x9aa0a8, 0.9, 0, 0xffffff);
    k.box('walkway', paint, -43, 0.011, 13.1, 34, 0.01, 1.6);
    for (const dz of [-0.85, 0.85]) k.box('walkedge', white, -43, 0.012, 13.1 + dz, 34, 0.01, 0.1);
    const rail = k.std(0x8a6e00, 0.5, 0.3, 0xf2c200);
    for (let x = -60; x <= -26; x += 2) k.box('wrail', rail, x, 0.5, 14.1, 0.06, 1.0, 0.06);
    for (const y of [0.5, 1.0]) k.box('wrail', rail, -43, y, 14.1, 34, 0.05, 0.05);
  }

  /** Odds and ends of a working hall: cardboard baler, waste bins, empty pallets, a vending machine, a notice board. */
  private buildExtras(): void {
    const k = this.k;
    const grey = k.std(0x50545b, 0.5, 0.4, 0xb9c0c8);
    const yellow = k.std(0x8a6e00, 0.5, 0.3, 0xf2c200);
    const dark = k.std(0x1d1d1f, 0.6, 0.2, 0x1d1d1f);
    const card = k.std(0x8a7050, 0.95, 0, 0xc9a06c);
    // Cardboard baler by the west wall: body, a yellow door with a window, a control box, and a finished bale.
    const bx = -60.3;
    const bz = -8;
    k.box('baler', grey, bx, 1.3, bz, 1.6, 2.6, 1.8);
    k.box('baler', grey, bx, 2.9, bz, 1.2, 0.6, 1.2);
    k.box('balerdoor', yellow, bx + 0.82, 1.0, bz, 0.06, 1.6, 1.5);
    k.box('balerwin', dark, bx + 0.86, 1.5, bz, 0.02, 0.35, 1.0);
    k.box('balerctl', dark, bx + 0.82, 1.2, bz - 1.1, 0.2, 0.4, 0.3);
    k.box('bale', card, bx + 0.2, 0.55, bz + 1.8, 1.1, 1.1, 0.8);
    for (const y of [0.25, 0.85]) k.box('balestrap', dark, bx + 0.2, y, bz + 1.8, 1.12, 0.03, 0.82);
    k.blob(bx, bz + 0.6, 2.4, 3.6);
    // Wheelie bins: general, paper, plastic film.
    [0x3a3d44, 0x1755fe, 0x2fa58f].forEach((c, i) => {
      const m = k.std(0x2a2c31, 0.6, 0.1, c);
      const z = -4.2 + i * 1.35;
      k.box('bin', m, -60.9, 0.6, z, 1.0, 1.1, 1.2);
      k.box('binlid', m, -60.85, 1.2, z, 1.06, 0.07, 1.26);
      for (const dz of [-0.45, 0.45]) k.box('binwheel', dark, -61.2, 0.1, z + dz, 0.12, 0.2, 0.2);
    });
    k.blob(-60.9, -2.85, 1.6, 4.4);
    // Stacks of empty pallets.
    const wood = k.std(0x8a6a44, 0.9, 0, 0xd8b080);
    for (const [px, pz, n] of [[-59.6, 29.5, 12], [-59.6, 31.6, 8], [-57.8, 31.6, 15]] as const) {
      for (let i = 0; i < n; i++) k.box('epal', wood, px, 0.07 + i * 0.145, pz, 1.2, 0.13, 1.0, undefined, (i % 3) * 0.02);
      k.blob(px, pz, 1.8, 1.6);
    }
    // Vending machine next to the coffee machine.
    k.box('vend', k.std(0x2a2c31, 0.4, 0.3, 0x2fa58f), -43.1, 0.95, 31.6, 0.9, 1.9, 0.75);
    k.box('vendwin', new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.85, 0.95) }), -43.25, 1.15, 31.21, 0.55, 1.1, 0.02);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      k.box('venditem', k.std(0x444444, 0.6, 0, [0xe2231a, 0xf2c200, 0x1755fe, 0xd6339a][(r + c) % 4]!), -43.45 + c * 0.13, 0.75 + r * 0.26, 31.24, 0.08, 0.12, 0.04);
    }
    k.box('vendpad', dark, -42.8, 1.2, 31.21, 0.16, 0.35, 0.02);
    // Notice board with schedules on the south wall.
    k.box('board', k.std(0x6a5038, 0.8, 0, 0xc49a6c), -35, 1.7, 33.93, 2.4, 1.2, 0.04);
    for (let i = 0; i < 9; i++) {
      k.box('note', k.std(0x777777, 0.8, 0, [0xffffff, 0xf2c200, 0x86d3c3, 0xf3f4f6][i % 4]!), -35.9 + (i % 4) * 0.55 + (i > 3 ? 0.2 : 0), 2.0 - Math.floor(i / 4) * 0.42, 33.9, 0.36, 0.3, 0.01, undefined, ((i * 37) % 7 - 3) * 0.02);
    }
  }

  private buildBreakArea(): void {
    const k = this.k;
    const wood = k.std(0x8a6a44, 0.7, 0, 0xe0c89a);
    const grey = k.std(0x50545b, 0.5, 0.4, 0xb9c0c8);
    const teal = k.std(0x1f5f4f, 0.6, 0.1, 0x2fa58f);
    // (Just south of the robots' parking area.)
    for (const [tx, tz] of [[-38, 30.4], [-33, 30.4]] as const) {
      k.box('btable', wood, tx, 0.75, tz, 1.8, 0.06, 0.9);
      k.box('btleg', grey, tx, 0.37, tz, 0.08, 0.74, 0.08);
      k.box('btleg', grey, tx, 0.02, tz, 0.6, 0.04, 0.6);
      for (const sx of [-0.55, 0.55]) for (const sz of [-0.75, 0.75]) {
        k.box('bchair', teal, tx + sx, 0.46, tz + sz, 0.45, 0.06, 0.45);
        k.box('bchair', teal, tx + sx, 0.75, tz + sz + Math.sign(sz) * 0.22, 0.45, 0.5, 0.05);
        k.box('bcleg', grey, tx + sx, 0.22, tz + sz, 0.04, 0.44, 0.04);
      }
      k.box('bmug', k.std(0xffffff, 0.5, 0, 0xffffff), tx + 0.3, 0.83, tz - 0.1, 0.08, 0.1, 0.08);
      k.blob(tx, tz, 2.6, 2.6);
    }
    // Coffee machine, water cooler, lockers and a plant.
    k.box('coffee', k.std(0x1d1d1f, 0.4, 0.4, 0x1d1d1f), -41.5, 0.9, 31.6, 0.7, 1.8, 0.6);
    k.box('coffeescreen', new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.8, 1.2) }), -41.5, 1.3, 31.28, 0.4, 0.25, 0.02);
    k.box('cooler', k.std(0xdddddd, 0.5, 0.1, 0xffffff), -40.4, 0.6, 31.7, 0.4, 1.2, 0.4);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.45, 16), new THREE.MeshStandardMaterial({ color: 0x6fb6ff, transparent: true, opacity: 0.7 }));
    water.position.set(-40.4, 1.43, 31.7);
    k.put(water);
    for (let i = 0; i < 6; i++) {
      const x = -38.6 + i * 0.62;
      k.box('locker', [teal, grey][i % 2]!, x, 0.95, 33.4, 0.6, 1.9, 0.5);
      k.box('lockerv', k.std(0x1d1d1f, 0.5, 0.3, 0x1d1d1f), x, 1.6, 33.14, 0.3, 0.04, 0.02);
    }
    k.box('pot', k.std(0x5a4430, 0.8, 0, 0xd6339a), -30.5, 0.3, 31.5, 0.5, 0.6, 0.5);
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), k.std(0x1f5f2f, 0.8, 0, 0x5fb84a));
    leaves.position.set(-30.5, 1.05, 31.5);
    k.put(leaves);
    k.blob(-36, 32.5, 10, 2.5);
    const was = k.only;
    k.only = 'day';
    k.sign('Break', '#2fa58f', -36, 8.8, 29, 0, (g) => {
      g.beginPath();
      g.moveTo(-10, -10);
      g.lineTo(10, -10);
      g.lineTo(8, 14);
      g.lineTo(-8, 14);
      g.closePath();
      g.fill();
      g.lineWidth = 4;
      g.beginPath();
      g.arc(14, 0, 6, -1.5, 1.5);
      g.stroke();
    });
    k.only = was;
  }

  private buildFloorNames(): void {
    const k = this.k;
    const name = (text: string, x: number, z: number, w: number, ry: number, color: string) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 5), new THREE.MeshBasicMaterial({ map: floorText(text, color), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
      m.rotation.set(-Math.PI / 2, 0, ry);
      m.position.set(x, 0.02, z);
      m.userData.noInk = true;
      k.put(m, 'day');
    };
    name('INFEED', -44, 16.6, 8, 0, '#f2a51a');
    name('DOCKS 1–20', -21, -22, 9, Math.PI / 2, '#2fa58f');
    name('ROBOT ZONE', 40, 31.8, 10, 0, '#1755fe');
    name('STORAGE', 112, 12, 8, Math.PI / 2, '#2fa58f');
  }
}

// ---------- textures ----------

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function exitTex(): THREE.CanvasTexture {
  return canvas(256, 92, (g) => {
    g.fillStyle = '#12a150';
    g.fillRect(0, 0, 256, 92);
    g.fillStyle = '#ffffff';
    // A running figure, an arrow and the word.
    g.beginPath();
    g.arc(40, 22, 8, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(36, 34);
    g.lineTo(30, 56);
    g.lineTo(16, 74);
    g.moveTo(30, 56);
    g.lineTo(46, 72);
    g.moveTo(34, 40);
    g.lineTo(52, 48);
    g.moveTo(34, 40);
    g.lineTo(20, 46);
    g.stroke();
    g.beginPath();
    g.moveTo(70, 46);
    g.lineTo(104, 46);
    g.moveTo(92, 34);
    g.lineTo(104, 46);
    g.lineTo(92, 58);
    g.stroke();
    g.font = '800 44px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('EXIT', 124, 50);
  });
}

function fireTex(): THREE.CanvasTexture {
  return canvas(64, 64, (g) => {
    g.fillStyle = '#e2231a';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffffff';
    g.fillRect(26, 18, 12, 36);
    g.fillRect(22, 12, 20, 6);
    g.beginPath();
    g.moveTo(38, 14);
    g.lineTo(52, 8);
    g.lineTo(52, 14);
    g.fill();
  });
}

function firstAidTex(): THREE.CanvasTexture {
  return canvas(64, 64, (g) => {
    g.fillStyle = '#12a150';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffffff';
    g.fillRect(26, 12, 12, 40);
    g.fillRect(12, 26, 40, 12);
  });
}

function floorText(text: string, color: string): THREE.CanvasTexture {
  return canvas(1024, 205, (g) => {
    g.clearRect(0, 0, 1024, 205);
    g.fillStyle = color;
    g.globalAlpha = 0.8;
    g.font = '900 150px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 512, 110);
  });
}
