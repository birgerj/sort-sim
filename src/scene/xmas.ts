// Christmas decorations (Settings → Christmas): trees with baubles and lights, garlands
// along the walls, light strings under the roof beams and along the loop (twinkling on
// the beat), wreaths on the dock doors, giant candy canes, hanging stars, snowflakes
// projected on the floor, and a little Christmas market in the break area with a
// hot-chocolate stall and a nativity stable. Built only when the option is on.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { FloorKit } from './floor';

export interface XmasLayout {
  wx: number;
  ex: number;
  hz: number;
  /** North wall. */
  nz: number;
  hh: number;
  /** x of the roof beams (they run north–south). */
  beams: number[];
  northDoors: number[];
  southDoors: number[];
  /** Points along the loop's outer edge, with the outward normal (for the light string). */
  loopEdge: { x: number; z: number; nx: number; nz: number; y: number }[];
  trees: { x: number; z: number; y?: number; h: number }[];
  canes: { x: number; z: number; ry: number }[];
  stars: { x: number; z: number; y: number; r: number }[];
  snow: { x: number; z: number }[];
  /** The Christmas market: stall and stable, side by side, backs to the south wall. */
  market: { x: number; z: number };
  /** The inbound wing north of the north wall (x0…x1, back wall at z0): the garlands follow its walls, its doors get wreaths. */
  wing?: { x0: number; x1: number; z0: number; doors: number[] };
}

const RED = 0xc8102e;
const GREEN = 0x1f7a3a;
const GOLD = 0xe8b923;
const BULBS = [0xff3b30, 0x34c759, 0xffcc00, 0x3b82f6, 0xffffff];

const merge = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!;

/** A five-pointed star, extruded a little. */
function starGeo(r: number, depth: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let k = 0; k <= 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = k % 2 ? r * 0.45 : r;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (k === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Xmas {
  /** Twinkling lights: two sets that take turns on the beat. */
  private lights: THREE.MeshBasicMaterial[] = [];
  private stars: THREE.MeshBasicMaterial;
  private flakes: THREE.Mesh[] = [];
  private flakeMat: THREE.MeshBasicMaterial;

  constructor(
    private k: FloorKit,
    private L: XmasLayout,
  ) {
    this.lights = [0, 1].map(() => new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.stars = new THREE.MeshBasicMaterial({ color: new THREE.Color(GOLD) });
    const flake = canvasTex(256, 256, (g) => {
      g.translate(128, 128);
      g.strokeStyle = '#ffffff';
      g.lineCap = 'round';
      for (let a = 0; a < 6; a++) {
        g.save();
        g.rotate((a * Math.PI) / 3);
        g.lineWidth = 10;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0, -110);
        g.stroke();
        g.lineWidth = 7;
        for (const d of [45, 75]) {
          g.beginPath();
          g.moveTo(0, -d);
          g.lineTo(-22, -d - 22);
          g.moveTo(0, -d);
          g.lineTo(22, -d - 22);
          g.stroke();
        }
        g.restore();
      }
    });
    this.flakeMat = new THREE.MeshBasicMaterial({ map: flake, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(0.7, 0.85, 1) });
    this.buildLightStrings();
    this.buildGarlands();
    this.buildWreaths();
    this.trees(L.trees);
    for (const c of L.canes) this.cane(c.x, c.z, c.ry);
    this.buildStars();
    this.buildSnow();
    this.buildMarket();
  }

  /** Lights twinkle on the beat (the two sets swap), brighter at night for the bloom. */
  update(bt: number, night: number, kick: number): void {
    const on = Math.floor(bt) % 2;
    const base = 1 + night * 1.6;
    this.lights.forEach((m, i) => {
      const lit = i === on ? 1 : 0.45;
      m.color.setScalar(base * lit * (1 + kick * 0.3 * night));
    });
    this.stars.color.setRGB(1, 0.78, 0.2).multiplyScalar(1 + night * 1.4 + Math.sin(bt * Math.PI) * 0.15);
    this.flakeMat.opacity = 0.18 + night * 0.5;
    this.flakes.forEach((f, i) => (f.rotation.z = bt * 0.05 * (i % 2 ? 1 : -1)));
  }

  /** An instanced string of bulbs (colours cycling), split over the two twinkle sets. */
  private bulbs(points: THREE.Vector3[], r = 0.05): void {
    const geo = new THREE.SphereGeometry(r, 8, 6);
    for (const set of [0, 1]) {
      const pts = points.filter((_, i) => i % 2 === set);
      const m = new THREE.InstancedMesh(geo, this.lights[set]!, pts.length);
      const mat = new THREE.Matrix4();
      const c = new THREE.Color();
      pts.forEach((p, i) => {
        m.setMatrixAt(i, mat.makeTranslation(p.x, p.y, p.z));
        m.setColorAt(i, c.set(BULBS[(i * 2 + set) % BULBS.length]!));
      });
      m.userData.noInk = true;
      this.k.put(m);
    }
  }

  /** Light strings sagging under the roof beams, and along the outer edge of the loop. */
  private buildLightStrings(): void {
    const L = this.L;
    const pts: THREE.Vector3[] = [];
    for (const x of L.beams) {
      const span = 8;
      for (let z = L.nz + 1; z <= L.hz - 1; z += 0.8) {
        const u = (((z - L.nz) % span) + span) % span / span;
        pts.push(new THREE.Vector3(x + 0.3, L.hh - 1.0 - Math.sin(u * Math.PI) * 0.6, z));
      }
    }
    for (const e of L.loopEdge) pts.push(new THREE.Vector3(e.x + e.nx * 0.82, e.y - 0.38, e.z + e.nz * 0.82));
    this.bulbs(pts, 0.045);
  }

  /** Green garlands in swags along the long walls (above the doors) and the west wall, with baubles. */
  private buildGarlands(): void {
    const L = this.L;
    const tubes: THREE.BufferGeometry[] = [];
    const balls: THREE.Vector3[] = [];
    const swag = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
      const mid = a.clone().lerp(b, 0.5);
      mid.y -= sag;
      tubes.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 16, 0.13, 6, false));
      balls.push(a.clone().setY(a.y - 0.25));
    };
    const y = 6.2;
    const step = 6;
    // Along a straight stretch of wall: swags of about `step` metres, ends `inset` in from the corners.
    const along = (ax: number, az: number, bx: number, bz: number, inset = 1) => {
      const len = Math.hypot(bx - ax, bz - az) - 2 * inset;
      if (len < 2) return;
      const n = Math.max(1, Math.round(len / step));
      const ux = (bx - ax) / Math.hypot(bx - ax, bz - az);
      const uz = (bz - az) / Math.hypot(bx - ax, bz - az);
      for (let i = 0; i < n; i++) {
        const s0 = inset + (len * i) / n;
        const s1 = inset + (len * (i + 1)) / n;
        swag(new THREE.Vector3(ax + ux * s0, y, az + uz * s0), new THREE.Vector3(ax + ux * s1, y, az + uz * s1), 0.9);
      }
    };
    for (const z of [L.nz + 0.25, L.hz - 0.25]) {
      for (let x = L.wx + 2; x + step <= L.ex - 1; x += step) {
        // (Not across the opening to the wing: there the garland follows the wing's walls.)
        if (L.wing && z < 0 && x + step > L.wing.x0 && x < L.wing.x1 + 0.5) continue;
        swag(new THREE.Vector3(x, y, z), new THREE.Vector3(x + step, y, z), 0.9);
      }
    }
    if (L.wing) {
      const W = L.wing;
      along(W.x0 + 0.25, L.nz, W.x0 + 0.25, W.z0 + 0.25);
      along(W.x0 + 0.25, W.z0 + 0.25, W.x1 - 0.25, W.z0 + 0.25);
      along(W.x1 - 0.25, W.z0 + 0.25, W.x1 - 0.25, L.nz + 0.25);
      // On the north wall again from the wing's east wall to the first full swag.
      const first = L.wx + 2 + step * Math.ceil((W.x1 + 0.5 - (L.wx + 2)) / step);
      along(W.x1 - 0.25, L.nz + 0.25, first, L.nz + 0.25, 0);
    }
    for (let z = L.nz + 2; z + step <= L.hz - 1; z += step) swag(new THREE.Vector3(L.wx + 0.25, y, z), new THREE.Vector3(L.wx + 0.25, y, z + step), 0.9);
    const green = this.k.std(0x14532d, 0.9, 0, GREEN);
    this.k.put(new THREE.Mesh(merge(tubes), green));
    // Red and gold baubles where the swags meet, each with a small bow.
    const ball = new THREE.SphereGeometry(0.2, 12, 10);
    const red = this.k.std(0x8a0b1f, 0.3, 0.4, RED);
    const gold = this.k.std(0x8a6a10, 0.25, 0.7, GOLD);
    for (const [mat, pick] of [[red, 0], [gold, 1]] as const) {
      const pts = balls.filter((_, i) => i % 2 === pick);
      const m = new THREE.InstancedMesh(ball, mat, pts.length);
      const M = new THREE.Matrix4();
      pts.forEach((p, i) => m.setMatrixAt(i, M.makeTranslation(p.x, p.y, p.z)));
      this.k.put(m);
    }
  }

  /** A wreath with a red bow above every dock door. */
  private buildWreaths(): void {
    const L = this.L;
    const ring = new THREE.TorusGeometry(0.42, 0.13, 8, 20);
    const green = this.k.std(0x14532d, 0.9, 0, GREEN);
    const red = this.k.std(0x8a0b1f, 0.5, 0.1, RED);
    const berries = this.k.std(0x8a0b1f, 0.3, 0.2, 0xe2231a);
    const bow = merge([new THREE.ConeGeometry(0.14, 0.26, 4).rotateZ(Math.PI / 2).translate(-0.13, 0, 0), new THREE.ConeGeometry(0.14, 0.26, 4).rotateZ(-Math.PI / 2).translate(0.13, 0, 0), new THREE.SphereGeometry(0.06, 8, 6)]);
    const doors = [...L.northDoors.map((x) => [x, L.nz + 0.2, 0] as const), ...(L.wing?.doors ?? []).map((x) => [x, L.wing!.z0 + 0.2, 0] as const), ...L.southDoors.map((x) => [x, L.hz - 0.2, Math.PI] as const)];
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, dy: number, dz: number) => {
      const m = new THREE.InstancedMesh(geo, mat, doors.length);
      const o = new THREE.Object3D();
      doors.forEach(([x, z, ry], i) => {
        o.position.set(x, 4.45 + dy, z + (ry ? -dz : dz));
        o.rotation.set(0, ry, 0);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      });
      this.k.put(m);
    };
    mk(ring, green, 0, 0.05);
    mk(bow, red, -0.4, 0.2);
    // A few berries on each wreath.
    const b = merge([0.6, 2.1, 3.8, 5.2].map((a) => new THREE.SphereGeometry(0.05, 6, 5).translate(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0.12)));
    mk(b, berries, 0, 0.05);
  }

  /** Christmas trees, all in a few draw calls: trunk in a pot, three tiers, baubles, a spiral of lights, a star, and presents. */
  private trees(list: { x: number; z: number; h: number; y?: number }[]): void {
    const k = this.k;
    const tiers: THREE.BufferGeometry[] = [];
    const trunks: THREE.BufferGeometry[] = [];
    const pots: THREE.BufferGeometry[] = [];
    const baubles: THREE.BufferGeometry[] = [];
    const gold: THREE.BufferGeometry[] = [];
    const stars: THREE.BufferGeometry[] = [];
    const lights: THREE.Vector3[] = [];
    const wraps = [RED, GOLD, 0x1755fe, 0x2fa58f, 0xffffff];
    list.forEach(({ x, z, h, y }, ti) => {
      const y0 = y ?? 0;
      const s = h / 4;
      const at = (g: THREE.BufferGeometry) => g.translate(x, y0, z);
      for (let i = 0; i < 3; i++) tiers.push(at(new THREE.ConeGeometry(s * (1.3 - i * 0.3), s * 1.7, 16).translate(0, s * (1.25 + i * 0.95), 0)));
      trunks.push(at(new THREE.CylinderGeometry(s * 0.12, s * 0.15, s * 0.6, 8).translate(0, s * 0.45, 0)));
      pots.push(at(new THREE.CylinderGeometry(s * 0.32, s * 0.25, s * 0.42, 12).translate(0, s * 0.21, 0)));
      for (let i = 0; i < 34; i++) {
        const u = i / 34;
        const r = s * 1.25 * (1 - u * 0.85) * 0.94;
        const a = i * 2.4 + ti;
        (i % 3 ? baubles : gold).push(at(new THREE.SphereGeometry(s * 0.085, 8, 6).translate(Math.cos(a) * r, s * (0.6 + u * 2.9), Math.sin(a) * r)));
      }
      for (let i = 0; i < 80; i++) {
        const u = i / 80;
        const r = s * 1.3 * (1 - u * 0.86);
        const a = u * Math.PI * 2 * 6;
        lights.push(new THREE.Vector3(x + Math.cos(a) * r, y0 + s * (0.55 + u * 3.0), z + Math.sin(a) * r));
      }
      stars.push(starGeo(s * 0.32, s * 0.08).translate(x, y0 + s * 3.75, z));
      // Presents under the tree (on the floor only).
      if (y0 === 0) {
        for (let i = 0; i < 5; i++) {
          const a = i * 1.3 + 0.4 + ti;
          const bx = x + Math.cos(a) * s * 1.4;
          const bz = z + Math.sin(a) * s * 1.4;
          const w = 0.25 + (i % 3) * 0.1;
          const hh = 0.18 + ((i * 7) % 3) * 0.08;
          k.box('gift', k.std(0x444444, 0.6, 0, 0xffffff), bx, hh / 2, bz, w, hh, w * 0.9, wraps[(i + ti) % wraps.length], a);
          k.box('giftribbon', k.std(0x8a6a10, 0.4, 0.4, 0xffffff), bx, hh / 2 + 0.005, bz, 0.05, hh + 0.01, w * 0.9 + 0.01, i % 2 ? RED : GOLD, a);
          k.box('giftribbon', k.std(0x8a6a10, 0.4, 0.4, 0xffffff), bx, hh / 2 + 0.005, bz, w + 0.01, hh + 0.01, 0.05, i % 2 ? RED : GOLD, a);
        }
      }
      k.blob(x, z, s * 3, s * 3);
    });
    k.put(new THREE.Mesh(merge(tiers), k.std(0x14532d, 0.85, 0, GREEN)));
    k.put(new THREE.Mesh(merge(trunks), k.std(0x4a2f1a, 0.9, 0, 0x7a4a2a)));
    k.put(new THREE.Mesh(merge(pots), k.std(0x8a0b1f, 0.6, 0.1, RED)));
    k.put(new THREE.Mesh(merge(baubles), k.std(0x8a0b1f, 0.25, 0.5, RED)));
    k.put(new THREE.Mesh(merge(gold), k.std(0x8a6a10, 0.25, 0.7, GOLD)));
    k.put(new THREE.Mesh(merge(stars), this.stars));
    this.bulbs(lights, 0.05);
  }

  /** A giant candy cane: a red-and-white striped staff with a hook. */
  private cane(x: number, z: number, ry: number): void {
    const stripes = canvasTex(64, 256, (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 64, 256);
      g.fillStyle = '#d0021b';
      for (let y = -64; y < 320; y += 48) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(64, y + 32);
        g.lineTo(64, y + 52);
        g.lineTo(0, y + 20);
        g.fill();
      }
    });
    stripes.wrapS = stripes.wrapT = THREE.RepeatWrapping;
    stripes.repeat.set(1, 6);
    const pts: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.4, 0)];
    for (let a = 0; a <= 180; a += 15) {
      const r = (a * Math.PI) / 180;
      pts.push(new THREE.Vector3(0.28 - Math.cos(r) * 0.28, 1.6 + Math.sin(r) * 0.3, 0));
    }
    pts.push(new THREE.Vector3(0.56, 1.45, 0));
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.09, 12, false);
    const mat = this.k.std(0xffffff, 0.35, 0, 0xffffff);
    mat.map = stripes;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0, z);
    m.rotation.y = ry;
    m.scale.setScalar(1.3);
    this.k.put(m);
    this.k.blob(x, z, 0.5, 0.5);
  }

  /** Gold stars hanging from the roof on thin wires. */
  private buildStars(): void {
    const wire = new THREE.LineBasicMaterial({ color: 0x9aa0a8 });
    for (const s of this.L.stars) {
      const m = new THREE.Mesh(starGeo(s.r, s.r * 0.25), this.stars);
      m.position.set(s.x, s.y, s.z);
      this.k.put(m);
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(s.x, s.y + s.r, s.z), new THREE.Vector3(s.x, this.L.hh - 0.3, s.z)]);
      this.k.put(new THREE.LineSegments(g, wire));
    }
  }

  /** Snowflakes projected on the floor, turning slowly. */
  private buildSnow(): void {
    for (const s of this.L.snow) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), this.flakeMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(s.x, 0.02, s.z);
      m.userData.noInk = true;
      this.k.put(m);
      this.flakes.push(m);
    }
  }

  /** A hot-chocolate stall with a striped awning, and a little nativity stable, in the break area. */
  private buildMarket(): void {
    const k = this.k;
    const { x, z } = this.L.market;
    const wood = k.std(0x6b4a2a, 0.85, 0, 0xb5835a);
    const dark = k.std(0x3a2a1a, 0.9, 0, 0x6b4a2a);
    // Stall: back, sides, counter, posts and a sloping awning.
    k.box('stall', wood, x, 1.1, z + 0.6, 2.6, 2.2, 0.08);
    for (const sx of [-1.3, 1.3]) k.box('stall', wood, x + sx, 1.1, z, 0.08, 2.2, 1.2);
    k.box('stall', wood, x, 0.55, z - 0.55, 2.6, 1.1, 0.1);
    k.box('stall', dark, x, 1.13, z - 0.55, 2.7, 0.06, 0.5);
    for (const sx of [-1.28, 1.28]) k.box('stall', dark, x + sx, 1.6, z - 0.6, 0.08, 1.0, 0.08);
    const awning = canvasTex(256, 64, (g) => {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#ffffff' : '#c8102e';
        g.fillRect(i * 32, 0, 32, 64);
      }
    });
    const awMat = k.std(0xffffff, 0.8, 0, 0xffffff);
    awMat.map = awning;
    const aw = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.05, 1.6), awMat);
    aw.position.set(x, 2.35, z - 0.1);
    aw.rotation.x = -0.25;
    k.put(aw);
    const sign = canvasTex(512, 96, (g) => {
      g.fillStyle = '#2b1a0e';
      g.fillRect(0, 0, 512, 96);
      g.fillStyle = '#ffe9b0';
      g.font = '700 52px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('Hot chocolate', 256, 50);
    });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.42), new THREE.MeshBasicMaterial({ map: sign }));
    sm.position.set(x, 2.75, z - 0.62);
    sm.rotation.y = Math.PI;
    k.put(sm);
    // Mugs and a big pot on the counter.
    for (let i = 0; i < 6; i++) k.box('mug', k.std(0x888888, 0.5, 0, [RED, 0xffffff, GREEN][i % 3]!), x - 1.0 + i * 0.22, 1.21, z - 0.55, 0.08, 0.1, 0.08);
    k.box('pot', k.std(0x50545b, 0.3, 0.8, 0xb9c0c8), x + 0.85, 1.32, z - 0.5, 0.36, 0.32, 0.36);
    this.bulbs(Array.from({ length: 14 }, (_, i) => new THREE.Vector3(x - 1.4 + i * 0.215, 2.15 - Math.sin((i / 13) * Math.PI) * 0.12, z - 0.86)), 0.04);
    // Nativity stable, east of the stall: a lean-to roof, straw, a manger and a star.
    const sx = x + 3.6;
    k.box('stable', dark, sx, 1.0, z + 0.6, 2.2, 2.0, 0.08);
    for (const dx of [-1.1, 1.1]) k.box('stable', dark, sx + dx, 0.9, z, 0.08, 1.8, 1.2);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.6), wood);
    roof.position.set(sx, 2.05, z - 0.05);
    roof.rotation.x = -0.35;
    k.put(roof);
    k.box('straw', k.std(0x8a7020, 0.95, 0, 0xe2c25a), sx, 0.03, z, 2.1, 0.06, 1.1);
    k.box('manger', wood, sx, 0.3, z, 0.6, 0.3, 0.35);
    k.box('straw', k.std(0x8a7020, 0.95, 0, 0xe2c25a), sx, 0.46, z, 0.55, 0.05, 0.3);
    // Figures: simple robed shapes.
    const robe = (fx: number, fz: number, h: number, col: number) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.18, h, 10).translate(0, h / 2, 0), k.std(0x444444, 0.8, 0, col));
      m.position.set(fx, 0, fz);
      k.put(m);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), k.std(0x7a5a40, 0.8, 0, 0xe0b48a));
      head.position.set(fx, h + 0.07, fz);
      k.put(head);
    };
    robe(sx - 0.6, z + 0.05, 0.85, 0x1755fe);
    robe(sx + 0.6, z + 0.05, 0.95, 0x8a5a2a);
    robe(sx - 0.95, z - 0.4, 0.75, 0x6b3fd1);
    robe(sx + 0.95, z - 0.4, 0.8, 0x2fa58f);
    const star = new THREE.Mesh(starGeo(0.25, 0.06), this.stars);
    star.position.set(sx, 2.55, z - 0.3);
    k.put(star);
  }
}
