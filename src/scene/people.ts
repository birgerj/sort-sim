// People: dock workers (hi-vis vest, helmet) and staff (shirt, cap). Jointed like
// a simple skeleton: pelvis, hips, knees, ankles, waist, chest (lower back), neck,
// shoulders, elbows and wrists, and a ponytail that swings. `motion.ts` poses them
// (walking, crouching, reaching, breathing). Facing +z. Each person gets one of a
// few hair styles, and staff wear short sleeves and a badge on a lanyard; workers
// long sleeves, gloves and a radio.
//
// Each person is one skinned mesh (one draw call): continuous legs, torso and
// arms that bend at the joints, and rigid boots, hands, head and gear. Colours
// are per vertex, so everyone shares one material.
import * as THREE from 'three';

import type { FloorKit } from './floor';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from './textures';
import { REAL } from './realDay';
import { BODY_LEVELS, bodyField, bodySurfaceZ, buildBody, type BodyLevel } from './bodySdf';

import { XMAS } from '../sim/season';

export interface Human {
  root: THREE.Group;
  /** Pelvis (hip height): walking bob, sway and hip turn; legs and torso hang from it. */
  pelvis: THREE.Group;
  /** Waist: bend forward with positive x. */
  torso: THREE.Group;
  /** Lower back: the chest, shoulders and head hang from it. */
  chest: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  /** Elbows (bend forward with negative x). */
  foreL: THREE.Group;
  foreR: THREE.Group;
  /** Neck: turn (y) and nod (x). */
  head: THREE.Group;
  /** Hips (forward with negative x). */
  legL: THREE.Group;
  legR: THREE.Group;
  /** Knees (bend with positive x). */
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  /** Ankles (toes up with negative x). */
  footL: THREE.Group;
  footR: THREE.Group;
  /** Wrists. */
  handL: THREE.Group;
  handR: THREE.Group;
  /** Ponytail (only with that hair style). */
  tail: THREE.Group | null;
  /** Hair style as built: 0 short, 1 longer, 2 ponytail (staff names follow it). */
  hairStyle: number;
  /** Eyes (scaled flat to blink) and mouth (scaled open to talk). */
  eyes: THREE.Group;
  mouth: THREE.Group;
  /** Motion state, kept by `motion.ts`. */
  m: MotionState;
}

/** What `motion.ts` keeps per person between frames. */
export interface MotionState {
  /** Real seconds (for breathing). */
  t: number;
  /** Walking amount 0…1 and stride (hip swing, radians), eased. */
  walk: number;
  amp: number;
  /** Pelvis offsets from the gait (sideways, up, turn, tilt) and from crouching (down). */
  px: number;
  py: number;
  pyaw: number;
  proll: number;
  drop: number;
  /** Feet's pitch in the world (from the gait), set level at the end. */
  footL: number;
  footR: number;
  /** Ponytail spring: angle and speed (x and z). */
  tx: number;
  tvx: number;
  tz: number;
  tvz: number;
  /** Last yaw and height (for the ponytail). */
  yaw: number;
  y: number;
  /** A per-person seed 0…1 (rhythm of breathing and weight shift). */
  seed: number;
  /** Talking 0…1 (set by the caller), eased; when the next blink comes. */
  talk: number;
  talkE: number;
  blinkAt: number;
}

export interface HumanLook {
  shirt: number;
  trousers: number;
  /** Hi-vis vest colour (workers). */
  vest?: number;
  /** Helmet colour (workers), or a cap. */
  helmet?: number;
  /** A suit: jacket (shirt colour) with lapels, a white shirt and a tie; bare head. */
  suit?: { tie: number };
  /** 0 short, 1 longer, 2 ponytail (default: from a seed). */
  hairStyle?: number;
  /** Father Christmas (beard and sack; the suit is the shirt and trousers). */
  santa?: boolean;
  cap?: number;
  skin?: number;
  hair?: number;
  /** Build (default: from a seed): height and width factors (about 0.9…1.1) and a belly 0…1. */
  build?: { height?: number; width?: number; belly?: number };
  /** Over-ear headphones in this colour (someone who dances a little while working). */
  headphones?: number;
}

/**
 * Detail levels, drawn by distance from the camera (`LOD_DIST`, metres): the body's grid
 * (`bodySdf.ts`), and the segments of the head, the hair and the helmet. Small parts
 * (eyes, hands, boots, badge) are the same at every level.
 */
const LEVELS: Record<BodyLevel, { head: [number, number]; hair: [number, number]; helmet: [number, number, number] }> = {
  fine: { head: [60, 44], hair: [96, 26], helmet: [56, 16, 4] },
  coarse: { head: [30, 22], hair: [44, 12], helmet: [32, 9, 2] },
  far: { head: [18, 13], hair: [24, 7], helmet: [20, 6, 1] },
};
export const LOD_DIST: Record<BodyLevel, number> = { fine: 0, coarse: 6, far: 20 };
/** Every person's LOD, so the quality setting can move the switch distances (`setPeopleLod`). */
const ALL_LODS: THREE.LOD[] = [];
let lodScale = 1;

/** Scale the people's detail switch distances (quality: low switches to simpler people sooner). */
export function setPeopleLod(scale: number): void {
  lodScale = scale;
  for (const lod of ALL_LODS) applyLod(lod);
}

function applyLod(lod: THREE.LOD): void {
  for (const l of lod.levels) l.distance = LOD_DIST[l.object.userData.level as BodyLevel] * lodScale;
}
const LEVEL_NAMES: BodyLevel[] = ['fine', 'coarse', 'far'];

/**
 * A work helmet (hard hat), not a ball: a shell a little longer than wide and flatter on
 * top, a raised rib from front to back with a lower rib either side, a short peak at the
 * front, a narrow rim at the sides that flares out a little at the back. Origin: the
 * middle of the crown; facing +z.
 */
function helmetGeometry([U, V, RIM]: [number, number, number]): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  // (Tall enough to leave room over the crown for the headband, as a real one does.)
  const A = 0.104 * 1.08, B = 0.1, C = 0.124 * 1.08;
  const shell = (th: number, ph: number): [number, number, number] => {
    // th: 0 at the crown … 1 at the rim; ph: round the head, 0 at the front.
    const a = th * (Math.PI / 2 + 0.06);
    const sx = Math.sin(a) * Math.sin(ph), sz = Math.sin(a) * Math.cos(ph), sy = Math.cos(a);
    let x = A * sx, y = B * sy * (1 - 0.12 * sy * sy), z = C * sz;
    const ax = Math.abs(sx);
    const rib = 0.0075 * Math.exp(-((ax / 0.07) ** 2)) + 0.0045 * Math.exp(-(((ax - 0.36) / 0.06) ** 2));
    const k = rib * Math.min(1, th * 4) * (1 - 0.5 * th);
    const n = Math.hypot(x / A ** 2, y / B ** 2, z / C ** 2) || 1;
    x += (k * x) / A ** 2 / n;
    y += (k * y) / B ** 2 / n;
    z += (k * z) / C ** 2 / n;
    return [x, y, z];
  };
  const grid = (f: (u: number, ph: number) => [number, number, number], u: number, v: number, flip: boolean) => {
    const base = pos.length / 3;
    for (let j = 0; j <= u; j++) for (let i = 0; i <= v; i++) pos.push(...f(i / v, (j / u) * Math.PI * 2));
    for (let j = 0; j < u; j++) for (let i = 0; i < v; i++) {
      const a = base + j * (v + 1) + i, b = a + v + 1;
      if (flip) idx.push(a, a + 1, b, b, a + 1, b + 1);
      else idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  };
  // (Wound so its outside faces out: the other way round only its inside showed, and the hair poked through.)
  grid(shell, U, V, true);
  // The rim: a peak in front, narrow at the sides, a little flare at the back.
  const reach = (ph: number) => 0.009 + 0.056 * Math.max(0, Math.cos(ph)) ** 3 + 0.02 * Math.max(0, -Math.cos(ph)) ** 2;
  const rimAt = (t: number, ph: number, dy: number): [number, number, number] => {
    const [x0, y0, z0] = shell(1, ph);
    const r = Math.hypot(x0, z0);
    const e = reach(ph) * t;
    const drop = (0.015 * Math.max(0, Math.cos(ph)) ** 2 - 0.0065 * Math.max(0, -Math.cos(ph)) ** 2) * t * t;
    return [(x0 * (r + e)) / r, y0 - drop + dy, (z0 * (r + e)) / r];
  };
  grid((t, ph) => rimAt(t, ph, 0), U, RIM, false);
  grid((t, ph) => rimAt(t, ph, -0.0075), U, RIM, true);
  grid((t, ph) => rimAt(1, ph, -0.0075 * t), U, 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // In the torso frame (like the other head parts): over the skull, tipped a little back.
  return g.rotateX(-0.1).translate(0, 0.8, -0.006);
}

// Shared geometry, per detail level: built once. Front is +z.
const geoCache: Partial<Record<BodyLevel, Record<string, THREE.BufferGeometry>>> = {};
const merge = (...g: THREE.BufferGeometry[]) => mergeGeometries(g.map((x) => (x.index ? x.toNonIndexed() : x)))!;
function shapes(level: BodyLevel): Record<string, THREE.BufferGeometry> {
  const cached = geoCache[level];
  if (cached) return cached;
  const L = LEVELS[level];
  // Far away (> LOD_DIST.far, a person a few dozen pixels tall) the small parts get half
  // their segments: they were the bulk of a far person's triangles.
  const far = level === 'far';
  const sg = (n: number, min = 3) => (far ? Math.max(min, Math.round(n / 2)) : n);
  const cap = (r: number, len: number, y: number, seg = 10) => new THREE.CapsuleGeometry(r, len, sg(4, 2), sg(seg)).translate(0, y, 0);
  const ball = (r: number, x: number, y: number, z: number, seg = 10) => new THREE.SphereGeometry(r, sg(seg, 4), sg(Math.max(6, seg - 2))).translate(x, y, z);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  // A body of revolution from a (radius, height) profile, squashed front to back.
  const lathe = (prof: [number, number][], depth: number, y = 0, seg = 18) =>
    new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(r, h)), sg(seg)).scale(1, 1, depth).translate(0, y, 0);
  const ell = (rx: number, ry: number, rz: number, x: number, y: number, z: number, seg = 14) => new THREE.SphereGeometry(1, sg(seg, 4), sg(Math.max(8, seg - 4))).scale(rx, ry, rz).translate(x, y, z);
  const geo: Record<string, THREE.BufferGeometry> = {
    // Safety boot (ankle joint at the top): rounded upper, toe cap, and a thick dark sole (the sole is its own part).
    boot: merge(new RoundedBoxGeometry(0.11, 0.1, 0.24, far ? 1 : 2, 0.04).translate(0, -0.85, 0.035), ell(0.054, 0.042, 0.06, 0, -0.865, 0.11, 10)).translate(0, KNEE + ANKLE, 0),
    sole: box(0.12, 0.03, 0.27, 0, -0.905, 0.04).translate(0, KNEE + ANKLE, 0),
    // A collar round the base of the neck (where the neck skin meets the shirt).
    collar: new THREE.TorusGeometry(0.06, 0.013, sg(6), sg(18)).rotateX(Math.PI / 2).scale(1, 1, 0.92).translate(0, 0.548, 0.006),
    buckle: box(0.05, 0.035, 0.015, 0, 0.06, 0.1),
    // Hand: palm, four fingers slightly curled, and the thumb forward.
    // (Wrist joint at the top.)
    hand: far ? merge(
      box(0.055, 0.065, 0.026, 0, -0.3, 0),
      box(0.05, 0.04, 0.018, 0, -0.35, 0.006),
      box(0.014, 0.03, 0.014, -0.028, -0.3, 0.016),
    ).translate(0, WRIST, 0) : merge(
      new RoundedBoxGeometry(0.055, 0.065, 0.026, 2, 0.01).translate(0, -0.3, 0),
      ...[-0.019, -0.006, 0.007, 0.019].map((x, i) => new THREE.CapsuleGeometry(0.0068, 0.04 - Math.abs(i - 1.5) * 0.006, 2, 6).rotateX(0.25).translate(x, -0.355, 0.006)),
      new THREE.CapsuleGeometry(0.008, 0.03, 2, 6).rotateZ(0.5).rotateX(-0.4).translate(-0.028, -0.3, 0.016),
    ).translate(0, WRIST, 0),
    radio: merge(box(0.05, 0.1, 0.03, 0.12, 0.08, 0.09), box(0.008, 0.06, 0.008, 0.135, 0.16, 0.09)),
    // Staff: a lanyard round the neck and a badge on the chest; a row of shirt buttons.
    lanyard: new THREE.TorusGeometry(0.075, 0.004, sg(4), sg(16), Math.PI).rotateZ(Math.PI).scale(0.9, 1.9, 1).translate(0, 0.53, 0.105),
    badge: box(0.05, 0.07, 0.006, 0, 0.375, 0.112),
    buttons: merge(...[0.27, 0.34, 0.41, 0.48].map((y) => ball(0.006, 0, y, 0.106 - (y - 0.27) * 0.05, 5))),
    // Suit: the white shirt front showing in the jacket's V, lapels, a tie, and jacket buttons.
    shirtV: new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.055, 0.55), new THREE.Vector2(0.055, 0.55), new THREE.Vector2(0, 0.36)])).translate(0, 0, 0.104),
    lapels: merge(
      new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.058, 0.552), new THREE.Vector2(-0.085, 0.47), new THREE.Vector2(-0.006, 0.355), new THREE.Vector2(-0.03, 0.48)])).translate(0, 0, 0.107),
      new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0.058, 0.552), new THREE.Vector2(0.03, 0.48), new THREE.Vector2(0.006, 0.355), new THREE.Vector2(0.085, 0.47)])).translate(0, 0, 0.107),
    ),
    tie: merge(box(0.022, 0.018, 0.01, 0, 0.535, 0.108), new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.012, 0.527), new THREE.Vector2(0.012, 0.527), new THREE.Vector2(0.02, 0.4), new THREE.Vector2(0, 0.38), new THREE.Vector2(-0.02, 0.4)])).translate(0, 0, 0.108)),
    jacketButtons: merge(ball(0.007, 0, 0.3, 0.104, 5), ball(0.007, 0, 0.24, 0.1, 5)),
    // Trousers: back pockets and a crease down the front of each leg.
    pockets: merge(box(0.075, 0.08, 0.008, -0.075, -0.03, -0.1), box(0.075, 0.08, 0.008, 0.075, -0.03, -0.1)),
    // Head: one smooth sculpted surface (no seams for the ink to find): skull,
    // narrower jaw and chin, brow ridge, eye sockets, cheekbones and a nose.
    // The face atlas goes on its front.
    head: sculptHead(L.head),
    // Ears, with a rim.
    ears: merge(
      ell(0.016, 0.028, 0.012, -0.092, 0.745, -0.005, 8),
      ell(0.016, 0.028, 0.012, 0.092, 0.745, -0.005, 8),
      ell(0.006, 0.02, 0.006, -0.099, 0.745, -0.004, 6),
      ell(0.006, 0.02, 0.006, 0.099, 0.745, -0.004, 6),
    ),
    // The eyes: whites and pupils (on their own joint, to blink).
    eyes: merge(ell(0.014, 0.0095, 0.006, -0.034, 0.76, 0.091, 10), ell(0.014, 0.0095, 0.006, 0.034, 0.76, 0.091, 10)),
    pupils: merge(ell(0.0065, 0.0075, 0.004, -0.034, 0.76, 0.0965, 8), ell(0.0065, 0.0075, 0.004, 0.034, 0.76, 0.0965, 8)),
    // The mouth (on its own joint, to talk): a slim pair of lips.
    lips: ell(0.017, 0.0042, 0.005, 0, 0.7, 0.096, 12),
    // Hair (see hairShell): short, long, combed back for a ponytail; and thin versions to wear under a cap.
    hair: hairShell(0, false, L.hair),
    hairLong: hairShell(1, false, L.hair),
    hairTail: hairShell(2, false, L.hair),
    hairT: hairShell(0, true, L.hair),
    hairLongT: hairShell(1, true, L.hair),
    hairTailT: hairShell(2, true, L.hair),
    // The tail itself hangs from its own joint (TAIL), so it can swing.
    tail: new THREE.CapsuleGeometry(0.026, 0.12, sg(3, 1), sg(8)).rotateX(0.35).translate(0, -0.08, -0.03),
    helmet: helmetGeometry(L.helmet),
    // The helmet's headband, seen under the rim.
    band: new THREE.CylinderGeometry(0.097, 0.097, 0.011, sg(24), 1, true).scale(1, 1, 1.13).translate(0, 0.8, -0.006),
    cap: new THREE.SphereGeometry(1, sg(16), sg(8), 0, Math.PI * 2, 0, Math.PI / 2.3).scale(0.104, 0.1, 0.112).translate(0, 0.79, 0),
    peak: new THREE.CylinderGeometry(0.08, 0.08, 0.012, sg(14), 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.15).translate(0, 0.8, 0.09),
    // Christmas: a red hat that flops back (over the helmet for workers), its white brim and bobble.
    hat: santaHat(0.108, 0.8),
    hatH: santaHat(0.135, 0.86),
    brimS: new THREE.TorusGeometry(0.106, 0.026, sg(6), sg(18)).rotateX(Math.PI / 2).translate(0, 0.805, 0),
    brimH: new THREE.TorusGeometry(0.133, 0.028, sg(6), sg(18)).rotateX(Math.PI / 2).translate(0, 0.865, 0),
    // Father Christmas: a full white beard and moustache, and a sack over his shoulder.
    beard: merge(ell(0.085, 0.1, 0.06, 0, 0.66, 0.06, 12), ell(0.05, 0.018, 0.02, 0, 0.715, 0.1, 8)),
    // Headphones: a band from ear to ear over the head (wider over a helmet) and the ear cups.
    phonesBand: new THREE.TorusGeometry(0.112, 0.012, sg(6), sg(18), Math.PI).translate(0, 0.75, 0),
    phonesBandH: new THREE.TorusGeometry(0.152, 0.012, sg(6), sg(18), Math.PI).translate(0, 0.75, 0),
    phonesCups: merge(ell(0.03, 0.045, 0.04, -0.11, 0.745, 0, 10), ell(0.03, 0.045, 0.04, 0.11, 0.745, 0, 10)),
    phonesCupsH: merge(ell(0.03, 0.045, 0.04, -0.125, 0.745, 0, 10), ell(0.03, 0.045, 0.04, 0.125, 0.745, 0, 10)),
    sack: ell(0.2, 0.26, 0.17, 0.06, 0.48, -0.24, 12),

  };
  // Everything on the head hangs from the neck joint (at y 0.6 in the torso).
  for (const key of ['head', 'ears', 'eyes', 'pupils', 'lips', 'hair', 'hairLong', 'hairTail', 'hairT', 'hairLongT', 'hairTailT', 'helmet', 'band', 'cap', 'peak', 'hat', 'hatH', 'brimS', 'brimH', 'beard', 'phonesBand', 'phonesBandH', 'phonesCups', 'phonesCupsH']) geo[key]!.translate(0, -NECK_Y, 0);
  // Eyes and mouth hang from their own joints on the head.
  for (const key of ['eyes', 'pupils']) geo[key]!.translate(-EYES.x, -EYES.y, -EYES.z);
  for (const key of ['lips']) geo[key]!.translate(-MOUTH.x, -MOUTH.y, -MOUTH.z);
  // The chest, and everything on it, hangs from the lower back.
  for (const key of ['collar', 'lanyard', 'badge', 'buttons', 'shirtV', 'lapels', 'tie', 'jacketButtons', 'sack']) geo[key]!.translate(0, -CHEST_Y, 0);
  geoCache[level] = geo;
  return geo;
}

/** Height of the neck joint in the torso. */
const NECK_Y = 0.6;
/** Height of the lower-back joint in the torso. */
const CHEST_Y = 0.25;
/** Hip to knee, knee to ankle, elbow to wrist (the joints' offsets). */
export const KNEE = 0.42;
export const ANKLE = 0.4;
export const WRIST = 0.265;
/** Shoulder to elbow, and elbow to the middle of the palm (for reaching). */
export const UPPER_ARM = 0.29;
export const FOREARM = 0.3;
export { REST_SPREAD } from './bakedBodies';
/** Hip height (the pelvis above the root). */
export const HIP_Y = 0.92;
/**
 * The head as one surface: an ellipsoid pushed in and out with smooth bumps
 * (jaw, chin, brow ridge, eye sockets, cheekbones, nose). Smooth normals, so
 * the ink pass draws its outline and nothing inside the face.
 */
function sculptHead(seg: [number, number]): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg[0], seg[1]);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const q = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    skull(pos.getX(i), pos.getY(i), pos.getZ(i), q);
    pos.setXYZ(i, q.x, q.y, q.z);
  }
  g.computeVertexNormals();
  return g;
}

const bump = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A point of the sculpted head (torso frame) in the direction (dx, dy, dz) from its centre. */
function skull(dx: number, dy: number, dz: number, out: THREE.Vector3): THREE.Vector3 {
  {
    let x = dx * 0.092;
    const y = 0.75 + dy * 0.112;
    let z = dz * 0.102;
    const front = Math.max(0, dz);
    // Jaw: narrower towards the chin, the lower face a little forward.
    const jaw = Math.min(1, Math.max(0, (0.725 - y) / 0.07));
    x *= 1 - 0.22 * jaw * jaw;
    z += 0.01 * jaw * front;
    const ax = Math.abs(x);
    z += front * (
      0.022 * bump(x, y, 0, 0.733, 0.012, 0.02) + // nose
      0.008 * bump(x, y, 0, 0.722, 0.016, 0.008) + // nose tip and wings
      0.006 * bump(0, y, 0, 0.783, 1, 0.008) * Math.exp(-((ax / 0.055) ** 4)) + // brow ridge
      0.005 * bump(ax, y, 0.046, 0.73, 0.018, 0.012) + // cheekbones
      0.009 * bump(x, y, 0, 0.664, 0.02, 0.014) - // chin
      0.006 * bump(ax, y, 0.034, 0.762, 0.015, 0.009) // eye sockets
    );
    return out.set(x, y, z);
  }
}

/**
 * Hair as a shell over the skull, bounded by a hairline: a grid whose rows run
 * from the crown (top) to the hairline, so the edge follows the hairline
 * smoothly (forehead, temples, sideburns, round the ears, the nape). Thicker on
 * top, thin at the edge (a small step there gives the ink a hairline), with
 * shallow grooves from the crown that the ink picks up as strands.
 * Styles: 0 short, 1 long (down to the shoulders, a side fringe, over the
 * ears), 2 combed back for a ponytail. `thin`: flat on top, to fit under a cap.
 */
function hairShell(style: 0 | 1 | 2, thin: boolean, [U, V]: [number, number]): THREE.BufferGeometry {
  // The hairline: degrees from the crown, by degrees round from the front (0) to the back (180).
  const LINE: Record<0 | 1 | 2, [number, number][]> = {
    0: [[0, 50], [30, 54], [55, 64], [70, 76], [76, 97], [84, 97], [90, 76], [101, 76], [110, 104], [140, 113], [180, 116]],
    1: [[0, 60], [30, 64], [50, 76], [70, 104], [90, 128], [130, 150], [180, 156]],
    2: [[0, 48], [30, 52], [55, 62], [70, 74], [76, 94], [84, 94], [90, 75], [101, 75], [110, 102], [140, 110], [180, 112]],
  };
  const line = (a: number) => {
    const t = LINE[style];
    for (let i = 1; i < t.length; i++) {
      const [a0, h0] = t[i - 1]!;
      const [a1, h1] = t[i]!;
      if (a <= a1) {
        const f = smoothstep(0, 1, (a - a0) / (a1 - a0));
        return h0 + (h1 - h0) * f;
      }
    }
    return t[t.length - 1]![1];
  };
  const top = thin ? 0.006 : style === 1 ? 0.016 : style === 2 ? 0.009 : 0.013;
  const pts: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const c = new THREE.Vector3(0, 0.75, 0);
  const deg = Math.PI / 180;
  for (let j = 0; j <= U; j++) {
    const phi = (j / U) * Math.PI * 2;
    let a = (phi / deg) % 360;
    if (a > 180) a = 360 - a;
    // A side fringe on long hair: lower over one eye.
    const fringe = style === 1 ? 9 * Math.max(0, Math.sin(phi)) * Math.exp(-(((a - 25) / 25) ** 2)) : 0;
    const h = (line(a) + fringe) * deg;
    for (let i = 0; i <= V; i++) {
      const v = i / V;
      // Long hair hangs straight down below the widest part of the head.
      const hang = style === 1 ? 102 * deg : Math.PI;
      const theta = Math.min(v * h, hang);
      skull(Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi), p);
      const strands = (thin ? 0.0015 : 0.003) * smoothstep(0.15, 0.45, v) * Math.sin(phi * 18 + v * 2 + style);
      const t = top * (0.35 + 0.65 * (1 - smoothstep(0.7, 1, v))) + strands;
      const n = p.clone().sub(c).normalize();
      p.addScaledVector(n, t);
      if (v * h > hang) {
        // Below that: straight down, flaring out a little at the ends.
        const k = (v * h - hang) / (h - hang);
        const drop = (v * h - hang) * 0.12;
        p.y -= drop;
        p.x *= 1 + 0.12 * k;
        p.z = p.z * (1 + 0.12 * k) - 0.01 * k;
      }
      pts.push(p.x, p.y, p.z);
      if (j < U && i < V) {
        const a0 = j * (V + 1) + i;
        const b0 = (j + 1) * (V + 1) + i;
        idx.push(a0, a0 + 1, b0, b0, a0 + 1, b0 + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Where the ponytail hangs from, on the head. */
const TAIL = new THREE.Vector3(0, 0.17, -0.09);
/** The eyes' and the mouth's joints, on the head. */
const EYES = new THREE.Vector3(0, 0.76 - NECK_Y, 0.094);
const MOUTH = new THREE.Vector3(0, 0.7 - NECK_Y, 0.094);

/**
 * How the face atlas lies on the head (torso frame, before the head's offset):
 * a cell spans ±57° across the front of the skull, from the forehead to below
 * the chin. The back of the head maps to the cell's white corner.
 */
const FACE = { rx: 0.092, ry: 0.112, cy: 0.75, phi0: Math.PI / 2 - 1, phiLen: 2, theta0: 0.45, thetaLen: 1.95 };
/** The atlas: 4 × 4 cells of 128 px; 15 faces and one plain white cell (for the rest of the body). */
const CELLS = 4;
const FACES = 15;
const CELL_PX = 128;
const WHITE_UV = [(3 + 0.5) / CELLS, (0 + 0.5) / CELLS] as const;

/** Where a point of the face (x, y in the torso frame, at the front) falls on the atlas cell (0…1, v up). */
function faceUV(x: number, y: number): [number, number] {
  const theta = Math.acos(Math.max(-1, Math.min(1, (y - FACE.cy) / FACE.ry)));
  const phi = Math.acos(Math.max(-1, Math.min(1, -x / (FACE.rx * Math.sin(theta)))));
  return [(phi - FACE.phi0) / FACE.phiLen, 1 - (theta - FACE.theta0) / FACE.thetaLen];
}

/**
 * The face atlas: drawn once, white where the skin shows through (the material
 * multiplies it with the skin colour), with brows, lashes and some of
 * freckles, stubble, blush, smile lines and crow's feet per face.
 */
function faceAtlas(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const t = canvasTexture('faces', CELLS * CELL_PX, CELLS * CELL_PX, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, CELLS * CELL_PX, CELLS * CELL_PX);
    let s = 7;
    const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let f = 0; f < FACES; f++) {
      const cx = (f % CELLS) * CELL_PX;
      const cy = Math.floor(f / CELLS) * CELL_PX;
      const at = (x: number, y: number): [number, number] => {
        const [u, v] = faceUV(x, y);
        return [cx + u * CELL_PX, cy + (1 - v) * CELL_PX];
      };
      const old = f % 5 === 4;
      const brow = ['#3b2b22', '#5a4030', '#2a2626', '#8a6a48', '#4a3a30'][f % 5]!;
      const thick = 2 + rnd() * 2.5;
      const arch = (rnd() - 0.3) * 0.006;
      const tilt = (rnd() - 0.5) * 0.008;
      g.lineCap = 'round';
      for (const side of [-1, 1]) {
        // Brows: a curve over each eye, inner end a little lower or higher.
        g.strokeStyle = old ? '#8a8580' : brow;
        g.lineWidth = thick;
        g.beginPath();
        g.moveTo(...at(side * 0.017, 0.776 + tilt));
        g.quadraticCurveTo(...at(side * 0.034, 0.783 + arch), ...at(side * 0.052, 0.776 - tilt * 0.5));
        g.stroke();
        // Lashes: a short dark line along the top of the eye.
        g.strokeStyle = '#2a2222';
        g.lineWidth = f % 3 === 0 ? 2 : 1.2;
        g.beginPath();
        g.moveTo(...at(side * 0.022, 0.765));
        g.quadraticCurveTo(...at(side * 0.034, 0.7705), ...at(side * 0.048, 0.765));
        g.stroke();
        if (old) {
          // Crow's feet and smile lines.
          g.strokeStyle = 'rgba(120,90,80,0.55)';
          g.lineWidth = 1;
          for (const dy of [-0.004, 0, 0.004]) {
            g.beginPath();
            g.moveTo(...at(side * 0.052, 0.76 + dy));
            g.lineTo(...at(side * 0.062, 0.76 + dy * 1.8));
            g.stroke();
          }
          g.beginPath();
          g.moveTo(...at(side * 0.016, 0.722));
          g.quadraticCurveTo(...at(side * 0.03, 0.712), ...at(side * 0.026, 0.696));
          g.stroke();
        }
      }
      // The corners of the mouth turned up a little (most of the time a friendly face).
      g.strokeStyle = 'rgba(110,55,50,0.6)';
      g.lineWidth = 1.3;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(...at(side * 0.016, 0.7));
        g.quadraticCurveTo(...at(side * 0.021, 0.7), ...at(side * 0.024, 0.704 + (f % 4 === 3 ? 0 : 0.002)));
        g.stroke();
      }
      if (f % 3 === 1) {
        // Freckles over the nose and cheeks.
        g.fillStyle = 'rgba(170,105,70,0.55)';
        for (let i = 0; i < 26; i++) {
          const [x, y] = at((rnd() - 0.5) * 0.11, 0.728 + rnd() * 0.022);
          g.beginPath();
          g.arc(x, y, 0.8 + rnd() * 0.9, 0, Math.PI * 2);
          g.fill();
        }
      }
      if (f % 4 === 2) {
        // Blush on the cheeks.
        for (const side of [-1, 1]) {
          const [x, y] = at(side * 0.048, 0.728);
          const gr = g.createRadialGradient(x, y, 0, x, y, 12);
          gr.addColorStop(0, 'rgba(235,120,120,0.45)');
          gr.addColorStop(1, 'rgba(235,120,120,0)');
          g.fillStyle = gr;
          g.fillRect(x - 12, y - 12, 24, 24);
        }
      }
      if (f % 5 === 3 || f === 8) {
        // Stubble: a soft grey shadow over the chin, jaw and upper lip.
        g.fillStyle = 'rgba(95,85,80,0.32)';
        const [x0, y0] = at(-0.07, 0.716);
        const [x1, y1] = at(0.07, 0.683);
        g.beginPath();
        g.ellipse((x0 + x1) / 2, y1, (x1 - x0) / 2, (y1 - y0) * 1.1, 0, Math.PI, 0, true);
        g.fill();
      }
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

/** A floppy hat: a cone that bends back, the tip lower down behind. */
function santaHat(r: number, y: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, r * 2.4, 14, 6).translate(0, r * 1.2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const h = p.getY(i) / (r * 2.4);
    p.setZ(i, p.getZ(i) - h * h * r * 1.6);
    p.setY(i, p.getY(i) - h * h * r * 0.7);
  }
  g.computeVertexNormals();
  const bob = new THREE.SphereGeometry(r * 0.32, 10, 8).translate(0, r * 1.7, -r * 1.6);
  return mergeGeometries([g.toNonIndexed(), bob.toNonIndexed()])!.translate(0, y, 0);
}

const HAIR = [0x2a1d14, 0x4a3221, 0x7a5a3a, 0xc9a26a, 0x1b1b1d, 0x8f8f8f];

/** One white, vertex-coloured material per kit, shared by every person (one shader). */
const bodyMats = new WeakMap<FloorKit, THREE.MeshStandardMaterial>();

/** Every person built (their root), so a click can pick one to follow. */
export const HUMANS: THREE.Object3D[] = [];
/** The joints of every person, by their root (for gestures played on top of their own animation). */
export const RIGS = new Map<THREE.Object3D, Human>();

/** 0 below a, 1 above b (or the other way round when b < a), smooth in between. */
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The body under the clothes is shared by everyone of a build (width and belly, rounded to a
// few steps) and detail level; built once each. The fine level is built a little later, in
// spare moments (it takes longest); until then the close level shows the coarse body.
import { BELLIES, BODIES_FILE, bodyKey, decodeBodies, REST_SPREAD, WIDTHS } from './bakedBodies';

/**
 * Load the bodies made at build time (call before people are built; see bakedBodies.ts).
 * Without them, each body is made in the browser when first needed.
 */
export async function loadBakedBodies(): Promise<void> {
  try {
    const res = await fetch(new URL(BODIES_FILE, document.baseURI));
    if (!res.ok) return;
    for (const [k, g] of decodeBodies(await res.arrayBuffer())) bodies.set(k, g);
  } catch {
    /* made in the browser instead */
  }
}
const nearest = (list: number[], v: number) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
const bodies = new Map<string, THREE.BufferGeometry>();
/** People's body meshes waiting for their build's fine level. */
const waiting = new Map<string, THREE.SkinnedMesh[]>();
function bodyGeo(w: number, b: number, level: BodyLevel): THREE.BufferGeometry {
  const key = bodyKey(w, b, level);
  let g = bodies.get(key);
  if (!g) {
    g = buildBody(w, b, REST_SPREAD, level);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.3);
    bodies.set(key, g);
  }
  return g;
}
/** Work for spare moments after load (fine detail only seen up close), one job at a time. */
const jobs: (() => void)[] = [];
let jobsRunning = false;
/** Spare-moment work waits until the hall is on screen (`startLaterWork`): not during load. */
let laterOpen = false;
function runJobs(): void {
  if (jobsRunning || !laterOpen || !jobs.length) return;
  jobsRunning = true;
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  const next = () => {
    const t0 = performance.now();
    // A few jobs per spare moment, up to about 8 ms (a fine body is one longer job).
    while (jobs.length && performance.now() - t0 < 8) jobs.shift()!();
    if (!jobs.length) {
      jobsRunning = false;
      return;
    }
    if (idle) idle(next, { timeout: 500 });
    else setTimeout(next, 30);
  };
  setTimeout(next, 300);
}
function later(job: () => void): void {
  if (typeof window === 'undefined') return job();
  jobs.push(job);
  runJobs();
}
/** The hall is on screen: start making the fine detail in spare moments. */
export function startLaterWork(): void {
  laterOpen = true;
  runJobs();
}

function queueFine(w: number, b: number, mesh: THREE.SkinnedMesh): void {
  const key = bodyKey(w, b, 'fine');
  const done = bodies.get(key);
  if (done) {
    mesh.geometry = done;
    return;
  }
  if (typeof window === 'undefined') return; // (tests: no spare moments)
  const list = waiting.get(key);
  if (list) {
    list.push(mesh);
    return;
  }
  waiting.set(key, [mesh]);
  later(() => {
    const [ws, bs] = key.split('|').map(Number) as [number, number];
    const g = bodyGeo(ws, bs, 'fine');
    for (const m of waiting.get(key)!) m.geometry = g;
    waiting.delete(key);
  });
}

/**
 * The body's material: one per person (each wears their own colours), all sharing one
 * shader. Clothes are chosen per pixel from where the point is on the body at rest:
 * trousers, belt, shirt or jacket, a hi-vis vest with reflective bands (round armholes, a V
 * at the neck), long sleeves with gloves, short sleeves with bare forearms, or white cuffs;
 * bare skin above the collar.
 */
interface Clothes {
  shirt: number;
  trousers: number;
  vest?: number;
  skin: number;
  /** 0 long sleeves and gloves, 1 short sleeves, 2 long sleeves with white cuffs. */
  sleeves: 0 | 1 | 2;
  shoulderX: number;
}
/**
 * Clothes in the realistic day (uReal 0 elsewhere): woven cloth with a fine weave and soft
 * creases, a little less saturated than the drawing; skin with a soft sheen; reflective bands
 * that catch the light (metal-like, smooth); hi-vis fabric a touch glossy; leather and rubber.
 */
const REAL_CLOTH_GLSL = /* glsl */ `
uniform float uReal;
vec3 realCloth(vec3 c, float kind) {
  if (uReal < 0.001) return c;
  vec3 r = c;
  if (kind == 0.0 || kind == 3.0) {
    // Soft creases round the limbs and across the body (no fine weave: it would shimmer).
    float crease = 0.5 + 0.5 * sin(vRest.y * 55.0 + sin(vRest.x * 40.0 + vRest.z * 30.0) * 2.2);
    r *= 0.92 + 0.1 * crease;
    if (kind == 0.0) r = mix(vec3(dot(r, vec3(0.299, 0.587, 0.114))), r, 0.85);
  }
  if (kind == 2.0) r = vec3(0.78, 0.8, 0.82);
  return mix(c, r, uReal);
}
void realClothSurface(float kind, inout float rough, inout float metal) {
  if (uReal < 0.001) return;
  float rr = kind == 1.0 ? 0.5 : kind == 2.0 ? 0.18 : kind == 3.0 ? 0.6 : kind == 4.0 ? 0.55 : 0.92;
  float mm = kind == 2.0 ? 0.85 : 0.0;
  rough = mix(rough, rr, uReal);
  metal = mix(metal, mm, uReal);
}
`;
const CLOTHES_GLSL = /* glsl */ `
uniform vec3 cShirt, cTrousers, cVest, cSkin, cGlove, cBelt, cBand, cCuff;
uniform vec4 uCloth; // vest (0/1), sleeves (0/1/2), shoulder x, wrist y
varying vec3 vRest;
varying vec3 vPart;
vec3 clothes(vec3 p, vec3 w) {
  float y = p.y, ax = abs(p.x), z = p.z;
  float m = max(w.x, max(w.y, w.z));
  if (w.y == m) return cTrousers;
  if (w.z == m) {
    if (uCloth.y > 0.5 && uCloth.y < 1.5) return y > 1.24 ? cShirt : cSkin;
    if (y < uCloth.w + 0.035) return uCloth.y > 1.5 ? cCuff : cGlove;
    return cShirt;
  }
  if (y < 0.95) return cTrousers;
  if (y < 1.01) return cBelt;
  if (y > 1.455 && ax < 0.07) return cSkin;
  if (uCloth.x > 0.5) {
    float sx = uCloth.z;
    bool armhole = length(vec2((ax - (sx + 0.01)) / 0.07, (y - 1.335) / 0.12)) < 1.0 || ax > sx - 0.023;
    bool vNeck = z > 0.0 && y > 1.325 + 1.4 * ax;
    if (!(y > 1.42 || armhole || vNeck)) {
      if ((y > 1.11 && y < 1.14) || (y > 1.25 && y < 1.28)) return cBand;
      return cVest;
    }
  }
  return cShirt;
}
`;
function clothesMaterial(k: FloorKit, c: Clothes, wristY: number): THREE.MeshStandardMaterial {
  const m = k.std(0xffffff, 0.8, 0, 0xffffff);
  m.vertexColors = true;
  m.userData.toonK = 0.45;
  const col = (hex: number) => ({ value: new THREE.Color(hex) });
  const u = {
    cShirt: col(c.shirt), cTrousers: col(c.trousers), cVest: col(c.vest ?? c.shirt), cSkin: col(c.skin), cGlove: col(0x3a3d44),
    cBelt: col(0x1d1d1f), cBand: col(0xd8dde3), cCuff: col(0xf4f4f2),
    uCloth: { value: new THREE.Vector4(c.vest !== undefined ? 1 : 0, c.sleeves, c.shoulderX, wristY) },
  };
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 part;\nvarying vec3 vRest;\nvarying vec3 vPart;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;\nvPart = part;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CLOTHES_GLSL + REAL_CLOTH_GLSL)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 cloth = clothes(vRest, vPart);
        // What it is made of, for the realistic day (0 cloth, 1 skin, 2 reflective band, 3 hi-vis, 4 leather or rubber).
        float kind = cloth == cBand ? 2.0 : cloth == cSkin ? 1.0 : (uCloth.x > 0.5 && cloth == cVest) ? 3.0 : (cloth == cBelt || cloth == cGlove) ? 4.0 : 0.0;
        diffuseColor.rgb *= realCloth(cloth, kind);`,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nrealClothSurface(kind, roughnessFactor, metalnessFactor);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n// Hi-vis: fluorescent, so a little brighter than the light alone makes it.\nif (kind == 3.0) totalEmissiveRadiance += cVest * 0.1 * uReal;');
    sh.uniforms.uReal = REAL;
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => key() + '|clothes';
  return m;
}

/** Which bones move a point of a rigid part. */
type Weights = [THREE.Object3D, number][];

/**
 * A person standing at the root's origin (feet on the ground). Add the root yourself, or pass `at`.
 *
 * Drawn at three detail levels by distance (a `THREE.LOD`; `LOD_DIST`), each two skinned
 * meshes on one skeleton (the joints of `Human`): the body under the clothes (`bodySdf.ts`,
 * shared by a build; clothes in its shader) and everything else (head and face, hair,
 * hands, boots, helmet or cap, badge, tie...), rigid on their joints, colours per vertex.
 * The skeleton is bound with the arms out by REST_SPREAD (its resting pose), so the arms
 * are built clear of the body.
 */
export function buildHuman(k: FloorKit, look: HumanLook, at?: { x: number; z: number; ry: number }): Human {
  let mat = bodyMats.get(k);
  if (!mat) {
    mat = k.std(0xffffff, 0.8, 0, 0xffffff);
    mat.vertexColors = true;
    mat.map = faceAtlas();
    // By day people keep about half of their smooth shading under the toon
    // steps, so faces and limbs read as round.
    mat.userData.toonK = 0.45;
    realGear(mat);
    bodyMats.set(k, mat);
  }
  const skin = look.skin ?? 0xf0cfb0;
  const worker = look.vest !== undefined;
  const seed = Math.abs((look.shirt * 7 + (look.skin ?? 0) * 13 + HUMANS.length * 31) | 0);
  const hair = look.hair ?? HAIR[seed % HAIR.length]!;
  const style = look.hairStyle ?? Math.floor(seed / 7) % 3;
  const glove = 0x3a3d44;
  // Build: a little taller or shorter, slimmer or broader, some with a belly (rounded to the
  // builds the bodies are made for).
  const r = (n: number) => (((seed * 2654435761 + n * 40503) >>> 0) % 1000) / 1000;
  const height = look.build?.height ?? 0.93 + r(1) * 0.14;
  const width = nearest(WIDTHS, look.build?.width ?? 0.9 + r(2) * 0.24);
  const belly = nearest(BELLIES, look.build?.belly ?? (look.santa ? 1 : Math.max(0, r(3) - 0.6) * 2.2));
  const face = seed % FACES;
  // Lips: the skin, darker and a little red.
  const lip = new THREE.Color(skin).lerp(new THREE.Color(0x8a3a3a), 0.45).getHex();

  // The skeleton, at rest: straight, the arms out by REST_SPREAD.
  const root = new THREE.Group();
  const joint = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const j = new THREE.Group();
    j.position.set(x, y, z);
    parent.add(j);
    return j;
  };
  const pelvis = joint(root, 0, HIP_Y, 0);
  const hipX = 0.085 * (1 + (width - 1) * 0.6);
  // The arms hang outside the chest: the chest is narrower under the arms than across the shoulders.
  const shoulderX = 0.195 * width;
  const legL = joint(pelvis, -hipX, 0, 0);
  const legR = joint(pelvis, hipX, 0, 0);
  const kneeL = joint(legL, 0, -KNEE, 0);
  const kneeR = joint(legR, 0, -KNEE, 0);
  const footL = joint(kneeL, 0, -ANKLE, 0);
  const footR = joint(kneeR, 0, -ANKLE, 0);
  const torso = joint(pelvis, 0, 0, 0);
  const chest = joint(torso, 0, CHEST_Y, 0);
  const head = joint(chest, 0, NECK_Y - CHEST_Y, 0);
  const tail = style === 2 ? joint(head, TAIL.x, TAIL.y, TAIL.z) : null;
  const eyes = joint(head, EYES.x, EYES.y, EYES.z);
  const mouth = joint(head, MOUTH.x, MOUTH.y, MOUTH.z);
  const armL = joint(chest, -shoulderX, 0.465 - CHEST_Y, 0);
  const armR = joint(chest, shoulderX, 0.465 - CHEST_Y, 0);
  const foreL = joint(armL, 0, -UPPER_ARM, 0);
  const foreR = joint(armR, 0, -UPPER_ARM, 0);
  const handL = joint(foreL, 0, -WRIST, 0);
  const handR = joint(foreR, 0, -WRIST, 0);
  armL.rotation.z = -REST_SPREAD;
  armR.rotation.z = REST_SPREAD;

  interface Part {
    geo: THREE.BufferGeometry;
    j: THREE.Object3D;
    c: number;
    w?: Weights;
    /** Face shell: UVs into this person's atlas cell. */
    face?: boolean;
    /** Hair: strands painted into the colour. */
    hair?: boolean;
    /** Laid on the front (1) or back (−1) of the body. */
    on?: 1 | -1;
  }
  const field = bodyField(width, belly, REST_SPREAD);
  // Rigid parts per level (same list, finer or coarser shapes).
  const gearAt = (g: Record<string, THREE.BufferGeometry>): Part[] => {
    const parts: Part[] = [];
    const add = (j: THREE.Object3D, geo: THREE.BufferGeometry, c: number, extra: Partial<Part> = {}) => parts.push({ geo, j, c, ...extra });
    for (const ft of [footL, footR]) {
      add(ft, g.boot!, 0x2a2522);
      add(ft, g.sole!, 0x1d1d1f);
    }
    add(chest, g.collar!, worker ? look.shirt : look.shirt, { w: [[chest, 0.6], [head, 0.4]] });
    add(torso, g.buckle!, 0xb9c0c8, { on: 1 });
    add(torso, g.pockets!, look.trousers, { on: -1, w: [[pelvis, 1]] });
    if (worker) add(torso, g.radio!, 0x1d1d1f, { on: 1 });
    else if (look.suit) {
      add(chest, g.shirtV!, 0xffffff, { on: 1 });
      add(chest, g.lapels!, look.shirt, { on: 1 });
      add(chest, g.tie!, look.suit.tie, { on: 1 });
      add(chest, g.jacketButtons!, 0x1d1d1f, { on: 1 });
    } else {
      add(chest, g.lanyard!, 0x1755fe, { on: 1 });
      add(chest, g.badge!, 0xffffff, { on: 1 });
      add(chest, g.buttons!, 0xf3f4f6, { on: 1 });
    }
    for (const hd of [handL, handR]) add(hd, g.hand!, worker ? glove : skin);
    // Head: face, hair, and a helmet, cap or hat.
    add(head, g.head!, skin, { face: true });
    add(head, g.ears!, skin);
    add(eyes, g.eyes!, 0xf6f6f2);
    add(eyes, g.pupils!, 0x1d1d1f);
    add(mouth, g.lips!, lip);
    // Under a helmet, a cap or a Christmas hat the hair lies flat on top.
    const flat = look.helmet !== undefined || XMAS || !look.suit;
    add(head, (flat ? [g.hairT!, g.hairLongT!, g.hairTailT!] : [g.hair!, g.hairLong!, g.hairTail!])[style]!, hair, { hair: true });
    if (tail) add(tail, g.tail!, hair);
    if (look.santa) {
      add(head, g.beard!, 0xffffff);
      add(chest, g.sack!, 0x8a5a2a);
    }
    if (XMAS || look.santa) {
      // Christmas hats for everyone (over the helmet for workers).
      const h = look.helmet !== undefined;
      if (h) add(head, g.helmet!, look.helmet!);
      add(head, h ? g.hatH! : g.hat!, 0xc8102e);
      add(head, h ? g.brimH! : g.brimS!, 0xffffff);
    } else if (look.helmet !== undefined) {
      add(head, g.helmet!, look.helmet);
      add(head, g.band!, 0x2a2d33);
    } else if (!look.suit) {
      const c = look.cap ?? 0x2f3b6b;
      add(head, g.cap!, c);
      add(head, g.peak!, c);
    }
    if (look.headphones !== undefined) {
      // Over-ear headphones: a band over the head (over the helmet for workers) and two cups.
      const h = look.helmet !== undefined;
      add(head, h ? g.phonesBandH! : g.phonesBand!, 0x1d1d1f);
      add(head, h ? g.phonesCupsH! : g.phonesCups!, look.headphones);
    }
    return parts;
  };

  root.updateMatrixWorld(true);
  const bones: THREE.Object3D[] = [pelvis, legL, kneeL, footL, legR, kneeR, footR, torso, chest, head, eyes, mouth, armL, foreL, handL, armR, foreR, handR];
  if (tail) bones.push(tail);
  const index = new Map(bones.map((b, i) => [b, i]));
  const col = new THREE.Color();
  const nv = new THREE.Vector3();
  /**
   * Shadow painted into the colours (as an illustrator would): undersides a
   * little darker, and the places light hardly reaches: eye sockets, under the
   * nose, beside it, under the chin.
   */
  const bump = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
  const shade = (part: Part, q: THREE.Vector3, n: THREE.Vector3): number => {
    const y = q.y - HIP_Y;
    let f = 1 - 0.16 * Math.max(0, -n.y);
    if (part.hair) {
      // Strands from the crown: lighter and darker bands round the head, and darker at the roots near the hairline.
      const phi = Math.atan2(q.x, q.z);
      f *= 0.86 + 0.14 * (0.5 + 0.5 * Math.sin(phi * 18 + (y - 0.75) * 40)) ** 2;
      f *= 1 - 0.12 * smooth(0.79, 0.72, y);
    } else if (part.face) {
      const ax = Math.abs(q.x);
      const front = Math.max(0, n.z);
      f *= 1 - front * (0.2 * bump(ax, y, 0.034, 0.765, 0.018, 0.012) + 0.18 * bump(q.x, y, 0, 0.713, 0.014, 0.006) + 0.1 * bump(ax, y, 0.017, 0.738, 0.006, 0.018));
      f *= 1 - 0.15 * Math.min(1, Math.max(0, 0.68 - y) / 0.04) * Math.min(1, Math.max(0, 0.3 - n.y));
    }
    return Math.max(0.62, f);
  };
  const p = new THREE.Vector3();
  const fu = face % CELLS;
  const fv = CELLS - 1 - Math.floor(face / CELLS);
  // The joints at rest, kept: a level baked later (the fine one, in spare moments) must be
  // built in the same pose as the others, not in whatever pose the person is in by then.
  const rest = new Map<THREE.Object3D, THREE.Matrix4>();
  const restOf = (j: THREE.Object3D) => {
    let m = rest.get(j);
    if (!m) rest.set(j, (m = j.matrixWorld.clone()));
    return m;
  };
  const bakeGear = (parts: Part[]): THREE.BufferGeometry => {
    const geos = parts.map((part) => {
      // Kept indexed (merging vertices afterwards was most of the load time).
      const geo = part.geo.clone().applyMatrix4(restOf(part.j));
      if (!geo.index) geo.setIndex([...Array(geo.attributes.position!.count).keys()]);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const n = pos.count;
      if (part.on) {
        // Lay it on the body: each point as far out from the skin as it was from the part's own front (or back).
        let ref = part.on > 0 ? -1e9 : 1e9;
        for (let i = 0; i < n; i++) ref = part.on > 0 ? Math.max(ref, pos.getZ(i)) : Math.min(ref, pos.getZ(i));
        for (let i = 0; i < n; i++) {
          const z = bodySurfaceZ(field, pos.getX(i), pos.getY(i), part.on);
          pos.setZ(i, z + (pos.getZ(i) - ref) + 0.004 * part.on);
        }
        geo.computeVertexNormals();
      }
      // UVs: the face shell into this person's cell of the atlas, everything else on the white cell.
      const uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        if (part.face) {
          p.fromBufferAttribute(pos, i);
          let [u, v] = p.z > 0.01 ? faceUV(p.x, p.y - HIP_Y) : [0.02, 0.02];
          u = Math.min(0.98, Math.max(0.02, u));
          v = Math.min(0.98, Math.max(0.02, v));
          uv.set([(fu + u) / CELLS, (fv + v) / CELLS], i * 2);
        } else uv.set(WHITE_UV, i * 2);
      }
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const colors = new Float32Array(n * 3);
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      const nrm = geo.attributes.normal as THREE.BufferAttribute;
      const ws = (part.w ?? [[part.j, 1]]).filter(([, w]) => w > 1e-3);
      const sum = ws.reduce((a, [, w]) => a + w, 0) || 1;
      for (let i = 0; i < n; i++) {
        p.fromBufferAttribute(pos, i);
        col.setHex(part.c).multiplyScalar(shade(part, p, nv.fromBufferAttribute(nrm, i)));
        colors.set([col.r, col.g, col.b], i * 3);
        ws.slice(0, 4).forEach(([b, w], kk) => {
          si[i * 4 + kk] = index.get(b) ?? index.get(part.j)!;
          sw[i * 4 + kk] = w / sum;
        });
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      return geo;
    });
    const g = mergeGeometries(geos)!;
    geos.forEach((x) => x.dispose());
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.3);
    return g;
  };

  // The levels: body and gear, both on one skeleton.
  const wristY = HIP_Y + 0.465 - (UPPER_ARM + WRIST) * Math.cos(REST_SPREAD);
  const clothesMat = clothesMaterial(k, {
    shirt: look.shirt, trousers: look.trousers, vest: look.vest, skin, shoulderX,
    sleeves: worker ? 0 : look.suit || look.santa ? 2 : 1,
  }, wristY);
  const skeleton = new THREE.Skeleton(bones as THREE.Bone[]);
  const lod = new THREE.LOD();
  root.add(lod);
  ALL_LODS.push(lod);
  const meshes: THREE.SkinnedMesh[] = [];
  for (const b of bones) restOf(b);
  let coarseGear: THREE.BufferGeometry | null = null;
  for (const level of ['coarse', 'far', 'fine'] as BodyLevel[]) {
    const group = new THREE.Group();
    const bodyMesh = new THREE.SkinnedMesh(level === 'fine' ? bodyGeo(width, belly, 'coarse') : bodyGeo(width, belly, level), clothesMat);
    // The fine gear (only seen up close) is baked in spare moments after load; until then the
    // coarse one stands in.
    const gearGeo: THREE.BufferGeometry = level === 'fine' ? coarseGear! : bakeGear(gearAt(shapes(level)));
    if (level === 'coarse') coarseGear = gearGeo;
    const gearMesh = new THREE.SkinnedMesh(gearGeo, mat);
    if (level === 'fine') later(() => (gearMesh.geometry = bakeGear(gearAt(shapes('fine')))));
    group.add(bodyMesh, gearMesh);
    for (const m of [bodyMesh, gearMesh]) {
      // People get no ink lines; the ink pass draws them as a mask (see `InkPass`).
      m.userData.inkMask = true;
      m.layers.enable(INK_MASK_LAYER);
      meshes.push(m);
    }
    group.userData.level = level;
    lod.addLevel(group, LOD_DIST[level] * lodScale, 0.1);
    lod.levels.sort((a, b) => a.distance - b.distance);
    if (level === 'fine') queueFine(width, belly, bodyMesh);
  }
  root.updateMatrixWorld(true);
  // (The joints are Groups, not Bones; the skeleton only needs their world matrices.)
  for (const m of meshes) m.bind(skeleton, new THREE.Matrix4());

  // The resting pose: elbows a little bent.
  foreL.rotation.x = foreR.rotation.x = -0.12;
  root.scale.setScalar(height);

  k.blobUnder(root, 0.8, 0.6);
  HUMANS.push(root);
  if (at) {
    root.position.set(at.x, 0, at.z);
    root.rotation.y = at.ry;
    k.put(root);
  }
  const m: MotionState = { t: 0, walk: 0, amp: 0, px: 0, py: 0, pyaw: 0, proll: 0, drop: 0, footL: 0, footR: 0, tx: 0, tvx: 0, tz: 0, tvz: 0, yaw: 0, y: 0, seed: (seed % 997) / 997, talk: 0, talkE: 0, blinkAt: 1 + r(4) * 4 };
  return { root, pelvis, torso, chest, armL, armR, foreL, foreR, head, legL, legR, kneeL, kneeR, footL, footR, handL, handR, tail, hairStyle: style, eyes, mouth, m };
}

/** Layer the people's meshes are also on, so the ink pass can draw them on their own. */
export const INK_MASK_LAYER = 3;
/** The levels' grids (for the record and the tests). */
export { BODY_LEVELS };

/**
 * Heads, hair, hands, boots and helmets in the realistic day: a little less saturated (the
 * drawing's colours are bright), and a surface between skin and plastic instead of matte paper.
 */
function realGear(m: THREE.MeshStandardMaterial): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uReal = REAL;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReal;')
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        if (uReal > 0.001) {
          float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(l), diffuseColor.rgb, 0.85), uReal);
          roughnessFactor = mix(roughnessFactor, 0.55, uReal);
        }`,
      );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => key() + '|realgear';
}
