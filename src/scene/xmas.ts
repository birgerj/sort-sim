// Christmas decorations (Settings → Christmas): trees with baubles and lights, garlands
// along the walls, light strings under the roof beams and along the loop (twinkling on
// the beat), wreaths on the dock doors, giant candy canes, hanging stars, snowflakes
// projected on the floor, and a little Christmas market in the break area with a
// hot-chocolate stall and a nativity stable. Always built, and shown while it is Christmas.
// Switched on, it all comes in as a wave from where the camera looks: trees grow out of the
// floor, lights come on one by one, baubles and wreaths pop up, presents drop in, stars come
// down from the roof. Switched off, it all shrinks away again (faster).
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
  /** Along the west wall, no garland from z0 to z1 (the canteen's windows and stair). */
  westGap?: [number, number];
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

/** How fast the wave runs out over the floor (m/s), and how long one thing takes to come in (s). */
const WAVE = 28;
const IN = 0.9;
const OUT = 0.35;

type Kind = 'pop' | 'grow' | 'drop' | 'lower';

/** Something that comes in on its own: a group at its anchor point (its parts placed relative to it). */
interface Piece {
  g: THREE.Group;
  at: THREE.Vector3;
  kind: Kind;
  /** Seconds after the wave reaches it. */
  extra: number;
  /** For 'lower': how far above its place it starts. */
  from?: number;
  del: number;
}

/** Instances that come in each on their own. */
interface InstPiece {
  im: THREE.InstancedMesh;
  base: THREE.Matrix4[];
  at: THREE.Vector3[];
  kind: Kind;
  extra: number[];
  del: number[];
}

/** Garland swags, all in one mesh: drawn one after another as the wave reaches them. */
interface Swag {
  geo: THREE.BufferGeometry;
  at: THREE.Vector3;
}

const backOut = (p: number) => {
  const c = 1.9;
  return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2;
};
const bounceOut = (x: number) => {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};
const elasticOut = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 2 ** (-9 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);

export class Xmas {
  /** Everything, hidden while it is not Christmas. */
  readonly root = new THREE.Group();
  private pieces: Piece[] = [];
  private insts: InstPiece[] = [];
  private swags: Swag[] = [];
  private swagMesh: THREE.Mesh | null = null;
  private swagEnds: { n: number; del: number }[] = [];
  /** On or going on; since when (s); where the wave starts. */
  private on: boolean;
  private t0 = -1;
  /** The last thing the wave reaches (s). */
  private lastDel = 0;
  private readonly origin = new THREE.Vector3();
  /** Where things go while being built (a piece's group, else the root). */
  private into: THREE.Object3D;
  private readonly m4 = new THREE.Matrix4();
  private readonly m5 = new THREE.Matrix4();
  /** Twinkling lights: two sets that take turns on the beat. */
  private lights: THREE.MeshBasicMaterial[] = [];
  private stars: THREE.MeshBasicMaterial;
  private flakes: THREE.Mesh[] = [];
  private flakeMat: THREE.MeshBasicMaterial;
  private flakeFade = 1;

  constructor(
    private k: FloorKit,
    private L: XmasLayout,
    on: boolean,
  ) {
    this.on = on;
    this.root.visible = on;
    this.into = this.root;
    k.put(this.root);
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
    this.swagMesh = new THREE.Mesh(merge(this.swags.map((x) => x.geo)), this.k.std(0x14532d, 0.9, 0, GREEN));
    this.add(this.swagMesh);
  }

  // ---------- coming in and going ----------

  /** Switch on or off: the wave starts at `from` (where the camera looks). */
  set(on: boolean, from: THREE.Vector3): void {
    if (on === this.on) return;
    this.on = on;
    this.t0 = performance.now() / 1000;
    this.origin.copy(from).setY(0);
    const delay = (at: THREE.Vector3) => Math.hypot(at.x - this.origin.x, at.z - this.origin.z) / WAVE;
    for (const p of this.pieces) p.del = delay(p.at) + p.extra;
    for (const x of this.insts) x.del = x.at.map((a, i) => delay(a) + x.extra[i]!);
    // The swags in the order the wave reaches them.
    const order = this.swags.map((sw) => ({ sw, del: delay(sw.at) })).sort((a, b) => a.del - b.del);
    this.swagMesh!.geometry.dispose();
    this.swagMesh!.geometry = merge(order.map((o) => o.sw.geo));
    let n = 0;
    this.swagEnds = order.map((o) => ({ n: (n += o.sw.geo.attributes.position!.count), del: o.del }));
    this.lastDel = Math.max(...this.pieces.map((p) => p.del), ...this.insts.flatMap((x) => x.del), ...order.map((o) => o.del));
    this.root.visible = true;
  }

  /** Where everything is while coming in or going (until it is all done). */
  private animate(): void {
    if (this.t0 < 0) return;
    const t = performance.now() / 1000 - this.t0;
    const on = this.on;
    // Going: each thing in a third of the time, and the wave faster too.
    const f = (del: number) => (on ? Math.min(1, Math.max(0, (t - del) / IN)) : 1 - Math.min(1, Math.max(0, (t - del * 0.4) / OUT)));
    for (const p of this.pieces) this.pose(p.g, p.kind, f(p.del), p.from ?? 0);
    for (const it of this.insts) {
      it.base.forEach((b, i) => {
        this.instPose(b, it.at[i]!, it.kind, f(it.del[i]!), this.m4);
        it.im.setMatrixAt(i, this.m4);
      });
      it.im.instanceMatrix.needsUpdate = true;
    }
    // The swags, nearest first: coming, those the wave has reached (the first one not yet whole
    // growing along its length); going, the nearest gone first.
    const geo = this.swagMesh!.geometry;
    const ends = this.swagEnds;
    if (on) {
      let n = 0;
      for (let i = 0; i < ends.length; i++) {
        const x = f(ends[i]!.del);
        const start = i ? ends[i - 1]!.n : 0;
        n = start + Math.floor(((ends[i]!.n - start) * x) / 3) * 3;
        if (x < 1) break;
      }
      geo.setDrawRange(0, n);
    } else {
      let start = 0;
      for (const e of ends) if (f(e.del) <= 0) start = e.n;
      geo.setDrawRange(start, Math.max(0, (ends[ends.length - 1]?.n ?? 0) - start));
    }
    this.flakeFade = on ? Math.min(1, t / 2) : 1 - Math.min(1, t / 0.8);
    if (t > (on ? this.lastDel + IN : this.lastDel * 0.4 + OUT) + 0.1) {
      this.t0 = -1;
      this.flakeFade = 1;
      if (!on) this.root.visible = false;
      geo.setDrawRange(0, Infinity);
    }
  }

  private pose(g: THREE.Group, kind: Kind, x: number, from: number): void {
    const at = g.userData.at as THREE.Vector3;
    g.visible = x > 0;
    g.position.copy(at);
    g.scale.setScalar(1);
    if (kind === 'pop') g.scale.setScalar(Math.max(1e-3, backOut(x)));
    else if (kind === 'grow') {
      // Up out of the floor, a little springy, and then out to its full width.
      const y = elasticOut(x);
      const w = backOut(Math.min(1, x * 1.4));
      g.scale.set(Math.max(1e-3, w), Math.max(1e-3, y), Math.max(1e-3, w));
    } else if (kind === 'drop') g.position.y += (1 - bounceOut(x)) * 4;
    else if (kind === 'lower') g.position.y += (1 - elasticOut(x)) * from;
  }

  private instPose(base: THREE.Matrix4, at: THREE.Vector3, kind: Kind, x: number, out: THREE.Matrix4): void {
    if (x <= 0) {
      out.makeScale(0, 0, 0);
      return;
    }
    if (kind === 'drop') {
      out.makeTranslation(0, (1 - bounceOut(x)) * 4, 0).multiply(base);
      return;
    }
    const s = kind === 'grow' ? elasticOut(x) : backOut(x);
    this.m5.makeScale(s, s, s).setPosition(at.x * (1 - s), at.y * (1 - s), at.z * (1 - s));
    out.multiplyMatrices(this.m5, base);
  }

  /** Put an object in (into the piece being built, else the root). */
  private add(o: THREE.Object3D): void {
    this.into.add(o);
  }

  /** A piece with its own group at `at`; what `build` adds goes in it, placed as if in the hall. */
  private piece(at: THREE.Vector3, kind: Kind, extra: number, build: () => void, from?: number): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(at);
    g.userData.at = at.clone();
    const inner = new THREE.Group();
    inner.position.copy(at).negate();
    g.add(inner);
    this.root.add(g);
    const was = this.into;
    this.into = inner;
    build();
    this.into = was;
    this.pieces.push({ g, at: at.clone(), kind, extra, from, del: 0 });
    return g;
  }

  /** An instanced mesh whose instances come in each on their own (the matrices as placed now). */
  private inst(im: THREE.InstancedMesh, kind: Kind, extra: (i: number) => number = () => 0): void {
    const base: THREE.Matrix4[] = [];
    const at: THREE.Vector3[] = [];
    for (let i = 0; i < im.count; i++) {
      const m = new THREE.Matrix4();
      im.getMatrixAt(i, m);
      base.push(m);
      at.push(new THREE.Vector3().setFromMatrixPosition(m));
    }
    this.insts.push({ im, base, at, kind, extra: at.map((_, i) => extra(i)), del: at.map(() => 0) });
    // (Instances come and go: the bounds are the whole hall's.)
    im.frustumCulled = false;
    this.add(im);
  }

  /** Boxes (as the kit's), instanced per material, that come in each on their own. */
  private boxes(list: { mat: THREE.Material; x: number; y: number; z: number; sx: number; sy: number; sz: number; col?: number; ry?: number; extra?: number }[], kind: Kind | null): void {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    for (const mat of new Set(list.map((b) => b.mat))) {
      const mine = list.filter((b) => b.mat === mat);
      const im = new THREE.InstancedMesh(geo, mat, mine.length);
      mine.forEach((b, i) => {
        o.position.set(b.x, b.y, b.z);
        o.rotation.set(0, b.ry ?? 0, 0);
        o.scale.set(b.sx, b.sy, b.sz);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
        if (b.col !== undefined) im.setColorAt(i, c.setHex(b.col));
      });
      if (kind) this.inst(im, kind, (i) => mine[i]!.extra ?? 0);
      else this.add(im);
    }
  }

  /** A soft shadow on the floor under the piece being built (it comes and goes with it). */
  private shadow(x: number, z: number, w: number, d: number): void {
    const o = new THREE.Object3D();
    o.position.set(x, 0, z);
    this.add(o);
    this.k.blobUnder(o, w, d);
  }

  /** Lights twinkle on the beat (the two sets swap), brighter at night for the bloom. */
  update(bt: number, night: number, kick: number): void {
    this.animate();
    if (!this.root.visible) return;
    const on = Math.floor(bt) % 2;
    const base = 1 + night * 1.6;
    this.lights.forEach((m, i) => {
      const lit = i === on ? 1 : 0.45;
      m.color.setScalar(base * lit * (1 + kick * 0.3 * night));
    });
    this.stars.color.setRGB(1, 0.78, 0.2).multiplyScalar(1 + night * 1.4 + Math.sin(bt * Math.PI) * 0.15);
    this.flakeMat.opacity = (0.18 + night * 0.5) * this.flakeFade;
    this.flakes.forEach((f, i) => (f.rotation.z = bt * 0.05 * (i % 2 ? 1 : -1)));
  }

  /** An instanced string of bulbs (colours cycling), split over the two twinkle sets. */
  private bulbs(points: THREE.Vector3[], r = 0.05, extra: (i: number) => number = () => 0): void {
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
      this.inst(m, 'pop', (i) => extra(i * 2 + set));
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
    const balls: THREE.Vector3[] = [];
    const swag = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
      const mid = a.clone().lerp(b, 0.5);
      mid.y -= sag;
      // (Merged in the order the wave reaches them: see set.)
      this.swags.push({ geo: new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 16, 0.13, 6, false).toNonIndexed(), at: a.clone() });
      balls.push(a.clone().setY(a.y - 0.25));
    };
    const y = 6.2;
    const step = 6;
    // Along a straight stretch of wall: swags of about `step` metres, ends `inset` in from the corners.
    const along = (ax: number, az: number, bx: number, bz: number, inset = 1, yy = y, sag = 0.9) => {
      const len = Math.hypot(bx - ax, bz - az) - 2 * inset;
      if (len < 2) return;
      const n = Math.max(1, Math.round(len / step));
      const ux = (bx - ax) / Math.hypot(bx - ax, bz - az);
      const uz = (bz - az) / Math.hypot(bx - ax, bz - az);
      for (let i = 0; i < n; i++) {
        const s0 = inset + (len * i) / n;
        const s1 = inset + (len * (i + 1)) / n;
        swag(new THREE.Vector3(ax + ux * s0, yy, az + uz * s0), new THREE.Vector3(ax + ux * s1, yy, az + uz * s1), sag);
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
      // (Its west wall has the canteen's windows: no garland there.)
      along(W.x0 + 0.25, W.z0 + 0.25, W.x1 - 0.25, W.z0 + 0.25);
      along(W.x1 - 0.25, W.z0 + 0.25, W.x1 - 0.25, L.nz + 0.25);
      // On the north wall again from the wing's east wall to the first full swag.
      const first = L.wx + 2 + step * Math.ceil((W.x1 + 0.5 - (L.wx + 2)) / step);
      along(W.x1 - 0.25, L.nz + 0.25, first, L.nz + 0.25, 0);
    }
    for (let z = L.nz + 2; z + step <= L.hz - 1; z += step) {
      if (L.westGap && z + step > L.westGap[0] && z < L.westGap[1]) continue;
      swag(new THREE.Vector3(L.wx + 0.25, y, z), new THREE.Vector3(L.wx + 0.25, y, z + step), 0.9);
    }
    // Red and gold baubles where the swags meet, each with a small bow.
    const ball = new THREE.SphereGeometry(0.2, 12, 10);
    const red = this.k.std(0x8a0b1f, 0.3, 0.4, RED);
    const gold = this.k.std(0x8a6a10, 0.25, 0.7, GOLD);
    for (const [mat, pick] of [[red, 0], [gold, 1]] as const) {
      const pts = balls.filter((_, i) => i % 2 === pick);
      const m = new THREE.InstancedMesh(ball, mat, pts.length);
      const M = new THREE.Matrix4();
      pts.forEach((p, i) => m.setMatrixAt(i, M.makeTranslation(p.x, p.y, p.z)));
      this.inst(m, 'pop', () => 0.4);
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
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, dy: number, dz: number, extra = 0) => {
      const m = new THREE.InstancedMesh(geo, mat, doors.length);
      const o = new THREE.Object3D();
      doors.forEach(([x, z, ry], i) => {
        o.position.set(x, 4.45 + dy, z + (ry ? -dz : dz));
        o.rotation.set(0, ry, 0);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      });
      this.inst(m, 'pop', () => extra);
    };
    mk(ring, green, 0, 0.05);
    mk(bow, red, -0.4, 0.2, 0.25);
    // A few berries on each wreath.
    const b = merge([0.6, 2.1, 3.8, 5.2].map((a) => new THREE.SphereGeometry(0.05, 6, 5).translate(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0.12)));
    mk(b, berries, 0, 0.05, 0.4);
  }

  /**
   * Christmas trees, each its own piece: trunk in a pot, three tiers and baubles grow out of the
   * floor; then the spiral of lights comes on from the bottom up, the star pops out on top, and
   * the presents drop in.
   */
  private trees(list: { x: number; z: number; h: number; y?: number }[]): void {
    const k = this.k;
    const green = k.std(0x14532d, 0.85, 0, GREEN);
    const brown = k.std(0x4a2f1a, 0.9, 0, 0x7a4a2a);
    const potMat = k.std(0x8a0b1f, 0.6, 0.1, RED);
    const redMat = k.std(0x8a0b1f, 0.25, 0.5, RED);
    const goldMat = k.std(0x8a6a10, 0.25, 0.7, GOLD);
    const wrapMat = k.std(0x444444, 0.6, 0, 0xffffff);
    const ribbonMat = k.std(0x8a6a10, 0.4, 0.4, 0xffffff);
    const wraps = [RED, GOLD, 0x1755fe, 0x2fa58f, 0xffffff];
    const gifts: Parameters<Xmas['boxes']>[0] = [];
    list.forEach(({ x, z, h, y }, ti) => {
      const y0 = y ?? 0;
      const s = h / 4;
      this.piece(new THREE.Vector3(x, y0, z), 'grow', 0, () => {
        const tiers: THREE.BufferGeometry[] = [];
        const baubles: THREE.BufferGeometry[] = [];
        const gold: THREE.BufferGeometry[] = [];
        const at = (g: THREE.BufferGeometry) => g.translate(x, y0, z);
        for (let i = 0; i < 3; i++) tiers.push(at(new THREE.ConeGeometry(s * (1.3 - i * 0.3), s * 1.7, 16).translate(0, s * (1.25 + i * 0.95), 0)));
        for (let i = 0; i < 34; i++) {
          const u = i / 34;
          const r = s * 1.25 * (1 - u * 0.85) * 0.94;
          const a = i * 2.4 + ti;
          (i % 3 ? baubles : gold).push(at(new THREE.SphereGeometry(s * 0.085, 8, 6).translate(Math.cos(a) * r, s * (0.6 + u * 2.9), Math.sin(a) * r)));
        }
        this.add(new THREE.Mesh(merge(tiers), green));
        this.add(new THREE.Mesh(at(new THREE.CylinderGeometry(s * 0.12, s * 0.15, s * 0.6, 8).translate(0, s * 0.45, 0)), brown));
        this.add(new THREE.Mesh(at(new THREE.CylinderGeometry(s * 0.32, s * 0.25, s * 0.42, 12).translate(0, s * 0.21, 0)), potMat));
        this.add(new THREE.Mesh(merge(baubles), redMat));
        this.add(new THREE.Mesh(merge(gold), goldMat));
        this.shadow(x, z, s * 3, s * 3);
      });
      // The lights, bottom to top along the spiral, once the tree is up.
      const lights: THREE.Vector3[] = [];
      for (let i = 0; i < 80; i++) {
        const u = i / 80;
        const r = s * 1.3 * (1 - u * 0.86);
        const a = u * Math.PI * 2 * 6;
        lights.push(new THREE.Vector3(x + Math.cos(a) * r, y0 + s * (0.55 + u * 3.0), z + Math.sin(a) * r));
      }
      this.bulbs(lights, 0.05, (i) => 0.7 + i * 0.012);
      this.piece(new THREE.Vector3(x, y0 + s * 3.75, z), 'pop', 1.7, () => this.add(new THREE.Mesh(starGeo(s * 0.32, s * 0.08).translate(x, y0 + s * 3.75, z), this.stars)));
      // Presents under the tree (on the floor only), dropping in one after another.
      if (y0 === 0) {
        for (let i = 0; i < 5; i++) {
          const a = i * 1.3 + 0.4 + ti;
          const bx = x + Math.cos(a) * s * 1.4;
          const bz = z + Math.sin(a) * s * 1.4;
          const w = 0.25 + (i % 3) * 0.1;
          const hh = 0.18 + ((i * 7) % 3) * 0.08;
          const extra = 1.2 + i * 0.18;
          const rib = i % 2 ? RED : GOLD;
          gifts.push(
            { mat: wrapMat, x: bx, y: hh / 2, z: bz, sx: w, sy: hh, sz: w * 0.9, col: wraps[(i + ti) % wraps.length], ry: a, extra },
            { mat: ribbonMat, x: bx, y: hh / 2 + 0.005, z: bz, sx: 0.05, sy: hh + 0.01, sz: w * 0.9 + 0.01, col: rib, ry: a, extra },
            { mat: ribbonMat, x: bx, y: hh / 2 + 0.005, z: bz, sx: w + 0.01, sy: hh + 0.01, sz: 0.05, col: rib, ry: a, extra },
          );
        }
      }
    });
    this.boxes(gifts, 'drop');
  }

  /** A giant candy cane: a red-and-white striped staff with a hook (shooting up out of the floor). */
  private cane(x: number, z: number, ry: number): void {
    // Red bands that wind round the staff: one diagonal band per tile, the tile repeated along the
    // length (u) and once round it (v), so the bands join up into a spiral.
    const stripes = canvasTex(64, 64, (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#d0021b';
      for (const o of [-64, 0, 64]) {
        g.beginPath();
        g.moveTo(o, 0);
        g.lineTo(o + 24, 0);
        g.lineTo(o + 88, 64);
        g.lineTo(o + 64, 64);
        g.fill();
      }
    });
    stripes.wrapS = stripes.wrapT = THREE.RepeatWrapping;
    stripes.repeat.set(9, 1);
    const pts: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.4, 0)];
    for (let a = 0; a <= 180; a += 15) {
      const r = (a * Math.PI) / 180;
      pts.push(new THREE.Vector3(0.28 - Math.cos(r) * 0.28, 1.6 + Math.sin(r) * 0.3, 0));
    }
    pts.push(new THREE.Vector3(0.56, 1.45, 0));
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.09, 12, false);
    const mat = this.k.std(0xffffff, 0.35, 0, 0xffffff);
    mat.map = stripes;
    this.piece(new THREE.Vector3(x, 0, z), 'grow', 0.3, () => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, 0, z);
      m.rotation.y = ry;
      m.scale.setScalar(1.3);
      this.add(m);
      this.shadow(x, z, 0.5, 0.5);
    });
  }

  /** Gold stars hanging from the roof on thin wires (let down from the roof, swinging). */
  private buildStars(): void {
    const wire = new THREE.LineBasicMaterial({ color: 0x9aa0a8 });
    for (const s of this.L.stars) {
      this.piece(
        new THREE.Vector3(s.x, s.y, s.z),
        'lower',
        0.2,
        () => {
          const m = new THREE.Mesh(starGeo(s.r, s.r * 0.25), this.stars);
          m.position.set(s.x, s.y, s.z);
          this.add(m);
          // (The wire runs on up past the roof, so it is never too short while the star comes down.)
          const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(s.x, s.y + s.r, s.z), new THREE.Vector3(s.x, this.L.hh + 6, s.z)]);
          this.add(new THREE.LineSegments(g, wire));
        },
        this.L.hh - s.y + 1,
      );
    }
  }

  /** Snowflakes projected on the floor, turning slowly (they fade in, and pop open). */
  private buildSnow(): void {
    for (const s of this.L.snow) {
      this.piece(new THREE.Vector3(s.x, 0.02, s.z), 'pop', 0.1, () => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), this.flakeMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(s.x, 0.02, s.z);
        m.userData.noInk = true;
        this.add(m);
        this.flakes.push(m);
      });
    }
  }

  /** A hot-chocolate stall with a striped awning, and a little nativity stable, in the break area. */
  private buildMarket(): void {
    const { x, z } = this.L.market;
    // The stall and the stable come up out of the floor together; then their lights come on.
    this.piece(new THREE.Vector3(x + 1.8, 0, z), 'grow', 0.2, () => this.marketBody(x, z));
    this.bulbs(Array.from({ length: 14 }, (_, i) => new THREE.Vector3(x - 1.4 + i * 0.215, 2.15 - Math.sin((i / 13) * Math.PI) * 0.12, z - 0.86)), 0.04, (i) => 1.0 + i * 0.05);
  }

  private marketBody(x: number, z: number): void {
    const k = this.k;
    const list: Parameters<Xmas['boxes']>[0] = [];
    const box = (_key: string, mat: THREE.Material, bx: number, by: number, bz: number, sx: number, sy: number, sz: number) => list.push({ mat, x: bx, y: by, z: bz, sx, sy, sz });
    const wood = k.std(0x6b4a2a, 0.85, 0, 0xb5835a);
    const dark = k.std(0x3a2a1a, 0.9, 0, 0x6b4a2a);
    // Stall: back, sides, counter, posts and a sloping awning.
    box('stall', wood, x, 1.1, z + 0.6, 2.6, 2.2, 0.08);
    for (const sx of [-1.3, 1.3]) box('stall', wood, x + sx, 1.1, z, 0.08, 2.2, 1.2);
    box('stall', wood, x, 0.55, z - 0.55, 2.6, 1.1, 0.1);
    box('stall', dark, x, 1.13, z - 0.55, 2.7, 0.06, 0.5);
    for (const sx of [-1.28, 1.28]) box('stall', dark, x + sx, 1.6, z - 0.6, 0.08, 1.0, 0.08);
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
    this.add(aw);
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
    this.add(sm);
    // Mugs and a big pot on the counter.
    for (let i = 0; i < 6; i++) box('mug', k.std(0x888888, 0.5, 0, [RED, 0xffffff, GREEN][i % 3]!), x - 1.0 + i * 0.22, 1.21, z - 0.55, 0.08, 0.1, 0.08);
    box('pot', k.std(0x50545b, 0.3, 0.8, 0xb9c0c8), x + 0.85, 1.32, z - 0.5, 0.36, 0.32, 0.36);
    // Nativity stable, east of the stall: a lean-to roof, straw, a manger and a star.
    const sx = x + 3.6;
    box('stable', dark, sx, 1.0, z + 0.6, 2.2, 2.0, 0.08);
    for (const dx of [-1.1, 1.1]) box('stable', dark, sx + dx, 0.9, z, 0.08, 1.8, 1.2);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.6), wood);
    roof.position.set(sx, 2.05, z - 0.05);
    roof.rotation.x = -0.35;
    this.add(roof);
    box('straw', k.std(0x8a7020, 0.95, 0, 0xe2c25a), sx, 0.03, z, 2.1, 0.06, 1.1);
    box('manger', wood, sx, 0.3, z, 0.6, 0.3, 0.35);
    box('straw', k.std(0x8a7020, 0.95, 0, 0xe2c25a), sx, 0.46, z, 0.55, 0.05, 0.3);
    // Figures: simple robed shapes.
    const robe = (fx: number, fz: number, h: number, col: number) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.18, h, 10).translate(0, h / 2, 0), k.std(0x444444, 0.8, 0, col));
      m.position.set(fx, 0, fz);
      this.add(m);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), k.std(0x7a5a40, 0.8, 0, 0xe0b48a));
      head.position.set(fx, h + 0.07, fz);
      this.add(head);
    };
    robe(sx - 0.6, z + 0.05, 0.85, 0x1755fe);
    robe(sx + 0.6, z + 0.05, 0.95, 0x8a5a2a);
    robe(sx - 0.95, z - 0.4, 0.75, 0x6b3fd1);
    robe(sx + 0.95, z - 0.4, 0.8, 0x2fa58f);
    const star = new THREE.Mesh(starGeo(0.25, 0.06), this.stars);
    star.position.set(sx, 2.55, z - 0.3);
    this.add(star);
    this.boxes(list, null);
  }
}
