// The body under the clothes: torso, arms and legs as one continuous skin, built from
// shapes that blend into each other (distance fields with a smooth union) and turned into
// a mesh with surface nets. The head, hands, boots and everything worn are separate rigid
// parts in `people.ts`; this is what goes between them.
//
// Built on the skeleton of `people.ts` at its bind pose (arms out by REST_SPREAD), for a
// given build (width, belly), at three detail levels for drawing by distance. One mesh is
// shared by everyone with the same build and level; clothes are chosen per pixel in the
// shader (`clothes` in people.ts) from where a point is on the body at rest, so their edges
// stay sharp at any level.
import * as THREE from 'three';
import { BODY } from './proportions';

/** Detail levels: the grid the surface is sampled on (metres; finer = more triangles). */
export const BODY_LEVELS = { fine: 0.0125, coarse: 0.032, far: 0.04 } as const;
export type BodyLevel = keyof typeof BODY_LEVELS;

/** The skeleton at rest (bind pose), in metres, feet on the floor, facing +z. */
export interface BodyFrame {
  hipX: number;
  shoulderX: number;
  /** Shoulder, elbow, wrist (left side, x < 0). */
  shoulder: V3;
  elbow: V3;
  wrist: V3;
}
type V3 = [number, number, number];

/** The bones the body is skinned to, in the order of `people.ts`'s skeleton. */
export const BONES = ['pelvis', 'legL', 'kneeL', 'footL', 'legR', 'kneeR', 'footR', 'torso', 'chest', 'head', 'eyes', 'mouth', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR'] as const;
type Bone = (typeof BONES)[number];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<Bone, number>;

// Joint heights (match people.ts).
const HIP_Y = 0.92;
const KNEE_Y = 0.5;
const ANKLE_Y = 0.1;
const CHEST_Y = 1.17;
const NECK_Y = 1.52;
/** Shoulders, armpits and the slope up to the neck sit this much higher (see proportions.ts). */
const L = BODY.lift;
const SL = BODY.slope;
const SHOULDER_Y = 1.385 + L;
const UPPER_ARM = 0.29;
const FORE = 0.265;

/** The joints for a build of this width, with the arms out by `spread` (radians). */
export function bodyFrame(width: number, spread: number): BodyFrame {
  const hipX = 0.085 * (1 + (width - 1) * 0.6);
  const shoulderX = 0.195 * width;
  const shoulder: V3 = [-shoulderX, SHOULDER_Y, 0];
  const elbow: V3 = [shoulder[0] - UPPER_ARM * Math.sin(spread), shoulder[1] - UPPER_ARM * Math.cos(spread), 0];
  const wrist: V3 = [elbow[0] - FORE * Math.sin(spread), elbow[1] - FORE * Math.cos(spread), 0];
  return { hipX, shoulderX, shoulder, elbow, wrist };
}

type Part = 'torso' | 'legL' | 'legR' | 'armL' | 'armR';
interface Prim {
  t: 0 | 1;
  part: Part;
  bone: Bone;
  a: V3;
  b: V3;
  ra: number;
  rb: number;
}

const lerp3 = (a: V3, b: V3, f: number): V3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
const mx = (p: V3): V3 => [-p[0], p[1], p[2]];

// Distance functions (Inigo Quilez's round cone and ellipsoid approximation).
function sdRoundCone(px: number, py: number, pz: number, a: V3, b: V3, r1: number, r2: number): number {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
function sdEll(px: number, py: number, pz: number, c: V3, r: V3): number {
  const x = px - c[0], y = py - c[1], z = pz - c[2];
  const k0 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  const k1 = Math.hypot(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]));
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
}
const smin = (a: number, b: number, k: number) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const prim = (p: Prim, x: number, y: number, z: number) => (p.t === 0 ? sdRoundCone(x, y, z, p.a, p.b, p.ra, p.rb) : sdEll(x, y, z, p.a, p.b));
const BLEND: Record<Part, number> = { torso: 0.06, legL: 0.045, legR: 0.045, armL: 0.04, armR: 0.04 };
const PARTS: Part[] = ['torso', 'legL', 'legR', 'armL', 'armR'];

/** The body's shapes for a build. */
export function bodyField(width: number, belly: number, spread: number) {
  const F = bodyFrame(width, spread);
  const w = width;
  const d = 1 + (w - 1) * 0.6; // deeper with width
  const lw = Math.sqrt(w); // limbs a little fuller
  const P: Prim[] = [];
  const cone = (part: Part, bone: Bone, a: V3, b: V3, ra: number, rb: number) => P.push({ t: 0, part, bone, a, b, ra, rb });
  const ell = (part: Part, bone: Bone, c: V3, r: V3) => P.push({ t: 1, part, bone, a: c, b: r, ra: 0, rb: 0 });
  // Torso: pelvis and seat, belly, ribcage, chest muscles, the slope from neck to shoulders, neck.
  ell('torso', 'pelvis', [0, 0.925, -0.005], [0.155 * w, 0.11, 0.105 * d]);
  for (const s of [-1, 1]) ell('torso', 'pelvis', [0.068 * w * s, 0.895, -0.055], [0.085, 0.09, 0.075]);
  ell('torso', 'torso', [0, 1.07, 0.008], [0.145 * w, 0.12, 0.104 * d]);
  if (belly > 0.02) ell('torso', 'torso', [0, 1.05, 0.035 + 0.035 * belly], [0.125 * w, 0.11, 0.07 + 0.045 * belly]);
  ell('torso', 'chest', [0, 1.25 + L / 2, -0.005], [0.166 * w, 0.16 + L / 2, 0.108 * d]);
  for (const s of [-1, 1]) {
    ell('torso', 'chest', [0.068 * w * s, 1.28 + L / 2, 0.045], [0.072, 0.06, 0.05]);
    // The slope from the neck to the shoulder (the trapezius): high beside the neck and a
    // little behind it, down to the top of the shoulder.
    cone('torso', 'chest', [(0.02 + 0.015 * SL) * s, 1.42 + L + 0.04 * SL, -0.02 - 0.015 * SL], [(F.shoulderX - 0.023 - 0.007 * SL) * s, 1.39 + L - 0.012 * SL, -0.01], 0.056 - 0.008 * SL, 0.047 - 0.004 * SL);
    // The armpit, as on a real body: the chest muscle's lower edge runs up and out to the
    // front of the upper arm, the broad back muscle's edge (lower, further back) to its back,
    // with a hollow between them; the back muscles also widen the back under the shoulder blades.
    cone('torso', 'chest', [0.05 * w * s, 1.28 + L / 2, 0.07], [(F.shoulderX - 0.015) * s, 1.33 + L, 0.03], 0.036, 0.03);
    cone('torso', 'chest', [0.07 * w * s, 1.155, -0.07], [(F.shoulderX - 0.02) * s, 1.31 + L, -0.035], 0.044, 0.031);
    ell('torso', 'chest', [0.1 * w * s, 1.215 + L / 2, -0.04], [0.065, 0.13 + L / 2, 0.055]);
  }
  // The neck: its lower part on the chest, its upper part (into the head) on the head.
  // (Leaning a little forward, as a neck does.)
  cone('torso', 'chest', [0, 1.4 + L, -0.01 - 0.02 * SL], [0, NECK_Y, -0.004], 0.054, 0.05);
  cone('torso', 'head', [0, NECK_Y, -0.004], [0, 1.63, 0.0], 0.05, 0.046);
  for (const [k, s] of [['L', -1], ['R', 1]] as const) {
    const hip: V3 = [F.hipX * s, HIP_Y, 0];
    const knee: V3 = [F.hipX * s, KNEE_Y, 0];
    const ankle: V3 = [F.hipX * s, ANKLE_Y, 0];
    const leg = ('leg' + k) as Part;
    // Leg: thigh, knee cap, calf and shin, down into the boot.
    cone(leg, ('leg' + k) as Bone, hip, knee, 0.088 * lw, 0.057 * lw);
    ell(leg, ('leg' + k) as Bone, lerp3(hip, knee, 0.32), [0.078 * lw, 0.13, 0.078 * lw]);
    ell(leg, ('knee' + k) as Bone, [knee[0], KNEE_Y, 0.042], [0.035, 0.036, 0.025]);
    cone(leg, ('knee' + k) as Bone, knee, ankle, 0.054 * lw, 0.039);
    ell(leg, ('knee' + k) as Bone, [knee[0] + 0.004 * s, 0.37, -0.03], [0.05 * lw, 0.1, 0.05 * lw]);
    // Arm: shoulder cap, upper arm with a bit of biceps, elbow, forearm, to the wrist (the hand is rigid).
    const sh: V3 = s < 0 ? F.shoulder : mx(F.shoulder);
    const el: V3 = s < 0 ? F.elbow : mx(F.elbow);
    const wr: V3 = s < 0 ? F.wrist : mx(F.wrist);
    const arm = ('arm' + k) as Part;
    ell(arm, ('arm' + k) as Bone, [(F.shoulderX - 0.003 + 0.004 * SL) * s, 1.365 + L - 0.012 * SL, -0.002], [0.058 * lw, 0.075, 0.06 * lw]);
    cone(arm, ('arm' + k) as Bone, sh, el, 0.055 * lw, 0.042 * lw);
    const bi = lerp3(sh, el, 0.45);
    ell(arm, ('arm' + k) as Bone, [bi[0], bi[1], bi[2] + 0.012], [0.048 * lw, 0.08, 0.05 * lw]);
    cone(arm, ('fore' + k) as Bone, el, wr, 0.041 * lw, 0.029 * lw);
    ell(arm, ('fore' + k) as Bone, lerp3(el, wr, 0.28), [0.042 * lw, 0.075, 0.04 * lw]);
  }
  const part = (name: Part, x: number, y: number, z: number) => {
    let r = 1e9;
    for (const p of P) if (p.part === name) r = smin(r, prim(p, x, y, z), BLEND[name]);
    return r;
  };
  const near = (x: number, y: number, z: number, j: V3, r: number) => Math.max(0, 1 - Math.hypot(x - j[0], y - j[1], z - j[2]) / r);
  const pits: V3[] = [[-(F.shoulderX - 0.023), 1.295 + L * 0.75, 0], [F.shoulderX - 0.023, 1.295 + L * 0.75, 0]];
  const shoulders: V3[] = [F.shoulder, mx(F.shoulder)];
  const hips: V3[] = [[-F.hipX, HIP_Y, 0], [F.hipX, HIP_Y, 0]];
  // Arms and legs join the torso near their joint only (and softly in the armpit), so an arm
  // hanging by the side never melts into the ribs.
  const body = (x: number, y: number, z: number) => {
    let r = part('torso', x, y, z);
    r = smin(r, part('legL', x, y, z), 0.05 * near(x, y, z, hips[0]!, 0.2));
    r = smin(r, part('legR', x, y, z), 0.05 * near(x, y, z, hips[1]!, 0.2));
    r = smin(r, part('armL', x, y, z), Math.max(0.05 * near(x, y, z, shoulders[0]!, 0.13), 0.04 * near(x, y, z, pits[0]!, 0.1)));
    r = smin(r, part('armR', x, y, z), Math.max(0.05 * near(x, y, z, shoulders[1]!, 0.13), 0.04 * near(x, y, z, pits[1]!, 0.1)));
    return r;
  };
  return { F, P, part, body };
}

// Grid lines along one axis: evenly spaced, or with a spacing that varies (step(t) at t).
function axis(min: number, max: number, step: number | ((t: number) => number)): Float64Array {
  const out = [min];
  const st = typeof step === 'number' ? () => step : step;
  while (out[out.length - 1]! < max) out.push(out[out.length - 1]! + st(out[out.length - 1]!));
  return Float64Array.from(out);
}

// Heights where the body bends (and how much detail each needs): ankles (in the boot),
// knees, hips, wrists, elbows, the lower back, shoulders, neck. Arms and legs hang nearly
// upright, so horizontal grid lines are rings round them: dense at a joint, far apart along
// the long parts (thighs, shins, upper arms, torso).
const BENDS: [number, number][] = [[ANKLE_Y, 0.6], [KNEE_Y, 1], [HIP_Y, 1], [0.835, 1], [1.097, 1], [CHEST_Y, 0.6], [SHOULDER_Y, 1], [NECK_Y, 0.8]];
const bendStep = (h: number) => (y: number) => {
  let w = 0;
  for (const [c, k] of BENDS) w = Math.max(w, k * Math.exp(-(((y - c) / 0.05) ** 2)));
  return h * (2.7 - 2.25 * w);
};

/** Surface nets on a grid with lines at X, Y, Z: one vertex per cell the surface passes through, joined into quads. */
function polygonize(f: (x: number, y: number, z: number) => number, X: Float64Array, Y: Float64Array, Z: Float64Array) {
  const nx = X.length, ny = Y.length, nz = Z.length;
  const Fv = new Float32Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) Fv[at(i, j, k)] = f(X[i]!, Y[j]!, Z[k]!);
  const vid = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  const C = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const;
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) {
      v[c] = Fv[at(i + C[c]![0], j + C[c]![1], k + C[c]![2])]!;
      if (v[c]! < 0) neg++;
    }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if (v[a]! < 0 === v[b]! < 0) continue;
      const t = v[a]! / (v[a]! - v[b]!);
      sx += C[a]![0] + (C[b]![0] - C[a]![0]) * t;
      sy += C[a]![1] + (C[b]![1] - C[a]![1]) * t;
      sz += C[a]![2] + (C[b]![2] - C[a]![2]) * t;
      n++;
    }
    vid[at(i, j, k)] = pos.length / 3;
    pos.push(X[i]! + (X[i + 1]! - X[i]!) * (sx / n), Y[j]! + (Y[j + 1]! - Y[j]!) * (sy / n), Z[k]! + (Z[k + 1]! - Z[k]!) * (sz / n));
  }
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, b, c, a, c, d);
    else idx.push(a, c, b, a, d, c);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const inside = Fv[at(i, j, k)]! < 0;
    if (inside !== Fv[at(i + 1, j, k)]! < 0) quad(vid[at(i, j - 1, k - 1)]!, vid[at(i, j, k - 1)]!, vid[at(i, j, k)]!, vid[at(i, j - 1, k)]!, inside);
    if (inside !== Fv[at(i, j + 1, k)]! < 0) quad(vid[at(i - 1, j, k - 1)]!, vid[at(i - 1, j, k)]!, vid[at(i, j, k)]!, vid[at(i, j, k - 1)]!, inside);
    if (inside !== Fv[at(i, j, k + 1)]! < 0) quad(vid[at(i - 1, j - 1, k)]!, vid[at(i, j - 1, k)]!, vid[at(i, j, k)]!, vid[at(i - 1, j, k)]!, inside);
  }
  return { pos: new Float32Array(pos), idx };
}

/**
 * The body mesh for a build at a level: positions and normals at rest, skin weights for
 * the bones of `BONES`, a grey shade painted in (undersides and armpits a little darker),
 * and `part` (one channel each for torso, leg, arm) for the clothes shader.
 */
export function buildBody(width: number, belly: number, spread: number, level: BodyLevel): THREE.BufferGeometry {
  const { F, P, part, body } = bodyField(width, belly, spread);
  const h = BODY_LEVELS[level];
  const across = Math.min(h * 1.3, 0.042);
  const xr = F.shoulderX + 0.14;
  const { pos, idx } = polygonize(body, axis(-xr, xr, across), axis(0.06, 1.66, bendStep(h)), axis(-0.2, 0.24, across));
  const n = pos.length / 3;
  const allowed: Record<Part, Bone[]> = {
    // (The torso follows the limbs only through the rule below, which fades away from the joint.)
    torso: ['pelvis', 'torso', 'chest', 'head'],
    legL: ['pelvis', 'legL', 'kneeL'],
    legR: ['pelvis', 'legR', 'kneeR'],
    armL: ['chest', 'armL', 'foreL'],
    armR: ['chest', 'armR', 'foreR'],
  };
  const nrm = new Float32Array(n * 3), col = new Float32Array(n * 3), prt = new Float32Array(n * 4);
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const e = 0.002;
  const pits: V3[] = [[-(F.shoulderX - 0.02), 1.3 + L * 0.75, 0], [F.shoulderX - 0.02, 1.3 + L * 0.75, 0]];
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    let gx = body(x + e, y, z) - body(x - e, y, z), gy = body(x, y + e, z) - body(x, y - e, z), gz = body(x, y, z + e) - body(x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    gx /= gl;
    gy /= gl;
    gz /= gl;
    nrm.set([gx, gy, gz], i * 3);
    // The part this point belongs to: the nearest.
    let best: Part = 'torso', bd = 1e9;
    for (const pn of PARTS) {
      const dd = part(pn, x, y, z);
      if (dd < bd) [bd, best] = [dd, pn];
    }
    // Skin weights: a soft minimum over the bones' shapes, so joints bend smoothly.
    const per: Partial<Record<Bone, number>> = {};
    for (const p of P) if (allowed[best].includes(p.bone)) per[p.bone] = Math.min(per[p.bone] ?? 1e9, prim(p, x, y, z));
    if (best === 'torso') {
      // The torso's skin near a hip or a shoulder follows that limb a little; only near the
      // joint (further down the flank, it stays with the ribs, however close the arm hangs).
      for (const [k, sg] of [['L', -1], ['R', 1]] as const) {
        const hipD = Math.hypot(x - F.hipX * sg, y - 0.92, z);
        const shD = Math.hypot(x - F.shoulderX * sg, y - SHOULDER_Y, z);
        per[('leg' + k) as Bone] = Math.min(per[('leg' + k) as Bone] ?? 1e9, part(('leg' + k) as Part, x, y, z) + 0.035 + 0.6 * Math.max(0, hipD - 0.14));
        per[('arm' + k) as Bone] = Math.min(per[('arm' + k) as Bone] ?? 1e9, part(('arm' + k) as Part, x, y, z) + 0.03 + 0.6 * Math.max(0, shD - 0.1));
      }
    }
    const list = Object.entries(per) as [Bone, number][];
    const dmin = Math.min(...list.map((l) => l[1]));
    const ws = list.map(([b, dd]) => [b, Math.exp(-(dd - dmin) / 0.016)] as [Bone, number]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = ws.reduce((a, w) => a + w[1], 0);
    ws.forEach(([b, w], k) => {
      si[i * 4 + k] = BI[b];
      sw[i * 4 + k] = w / sum;
    });
    prt[i * 4 + (best === 'torso' ? 0 : best.startsWith('leg') ? 1 : 2)] = 1;
    // Shade painted in: undersides, and the hollow of the armpit.
    let f = 1 - 0.16 * Math.max(0, -gy);
    for (const pt of pits) f *= 1 - 0.18 * Math.exp(-(((x - pt[0]) / 0.04) ** 2 + ((y - pt[1]) / 0.06) ** 2 + ((z - pt[2]) / 0.05) ** 2));
    col.set([f, f, f], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('part', new THREE.BufferAttribute(prt, 4));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.setIndex(idx);
  return geo;
}

/**
 * Where the front (+1) or back (−1) of the body is at (x, y): for laying flat things on it
 * (a badge, a tie, pockets). Marches in from outside along z.
 */
export function bodySurfaceZ(field: ReturnType<typeof bodyField>, x: number, y: number, side: 1 | -1): number {
  let z = 0.32 * side;
  for (let i = 0; i < 40; i++) {
    const d = field.body(x, y, z);
    if (d < 1e-4) break;
    z -= d * side;
    if (Math.abs(z) < 0.01) break;
  }
  return z;
}
