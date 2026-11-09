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
}

// Shared geometry: built once. Front is +z. Each joint's parts are merged per
// material, so a person stays a handful of instanced parts.
let geo: Record<string, THREE.BufferGeometry> | null = null;
const merge = (...g: THREE.BufferGeometry[]) => mergeGeometries(g.map((x) => (x.index ? x.toNonIndexed() : x)))!;
function shapes(): Record<string, THREE.BufferGeometry> {
  if (geo) return geo;
  const cap = (r: number, len: number, y: number, seg = 10) => new THREE.CapsuleGeometry(r, len, 4, seg).translate(0, y, 0);
  const ball = (r: number, x: number, y: number, z: number, seg = 10) => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)).translate(x, y, z);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  // A body of revolution from a (radius, height) profile, squashed front to back.
  const lathe = (prof: [number, number][], depth: number, y = 0, seg = 18) =>
    new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(r, h)), seg).scale(1, 1, depth).translate(0, y, 0);
  const ell = (rx: number, ry: number, rz: number, x: number, y: number, z: number, seg = 14) => new THREE.SphereGeometry(1, seg, Math.max(8, seg - 4)).scale(rx, ry, rz).translate(x, y, z);
  // An arc over the top of the helmet, front to back, following the dome (the ridge).
  const ridge = new THREE.TorusGeometry(1, 0.11, 6, 20, Math.PI).rotateY(Math.PI / 2).scale(1, 0.84, 1.08).scale(0.128, 0.128, 0.128).translate(0, 0.79, 0);
  geo = {
    // Safety boot (ankle joint at the top): rounded upper, toe cap, and a thick dark sole (the sole is its own part).
    boot: merge(new RoundedBoxGeometry(0.11, 0.1, 0.24, 2, 0.04).translate(0, -0.85, 0.035), ell(0.054, 0.042, 0.06, 0, -0.865, 0.11, 10)).translate(0, KNEE + ANKLE, 0),
    sole: box(0.12, 0.03, 0.27, 0, -0.905, 0.04).translate(0, KNEE + ANKLE, 0),
    collar: new THREE.TorusGeometry(0.058, 0.014, 6, 16).rotateX(Math.PI / 2).scale(1, 1, 0.9).translate(0, 0.555, 0.008),
    belt: lathe([[0.152, -0.03], [0.152, 0.03]], 0.66, 0.06),
    buckle: box(0.05, 0.035, 0.015, 0, 0.06, 0.1),
    vest: lathe([[0.158, 0.08], [0.152, 0.14], [0.16, 0.25], [0.155, 0.3]], 0.68),
    vestU: lathe([[0.157, 0.2], [0.158, 0.25], [0.174, 0.36], [0.18, 0.43], [0.17, 0.49], [0.13, 0.535]], 0.68),
    // Two reflective bands round the vest (one on the belly, one on the chest).
    bands: new THREE.CylinderGeometry(0.168, 0.164, 0.035, 18, 1, true).scale(1.0, 1, 0.7).translate(0, 0.22, 0),
    bandsU: new THREE.CylinderGeometry(0.168, 0.176, 0.035, 18, 1, true).scale(1.0, 1, 0.7).translate(0, 0.36, 0),
    sleeve: lathe([[0.056, -0.1], [0.058, -0.14], [0.05, -0.15]], 0.9, 0, 12),
    // Hand: palm, four fingers slightly curled, and the thumb forward.
    // (Wrist joint at the top.)
    hand: merge(
      new RoundedBoxGeometry(0.055, 0.065, 0.026, 2, 0.01).translate(0, -0.3, 0),
      ...[-0.019, -0.006, 0.007, 0.019].map((x, i) => new THREE.CapsuleGeometry(0.0068, 0.04 - Math.abs(i - 1.5) * 0.006, 2, 6).rotateX(0.25).translate(x, -0.355, 0.006)),
      new THREE.CapsuleGeometry(0.008, 0.03, 2, 6).rotateZ(0.5).rotateX(-0.4).translate(-0.028, -0.3, 0.016),
    ).translate(0, WRIST, 0),
    radio: merge(box(0.05, 0.1, 0.03, 0.12, 0.08, 0.09), box(0.008, 0.06, 0.008, 0.135, 0.16, 0.09)),
    // Staff: a lanyard round the neck and a badge on the chest; a row of shirt buttons.
    lanyard: new THREE.TorusGeometry(0.075, 0.004, 4, 16, Math.PI).rotateZ(Math.PI).scale(0.9, 1.9, 1).translate(0, 0.53, 0.105),
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
    neck: new THREE.CylinderGeometry(0.044, 0.05, 0.11, 12).translate(0, 0.62, 0.005),
    // Head: one smooth sculpted surface (no seams for the ink to find): skull,
    // narrower jaw and chin, brow ridge, eye sockets, cheekbones and a nose.
    // The face atlas goes on its front.
    head: sculptHead(),
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
    hair: hairShell(0, false),
    hairLong: hairShell(1, false),
    hairTail: hairShell(2, false),
    hairT: hairShell(0, true),
    hairLongT: hairShell(1, true),
    hairTailT: hairShell(2, true),
    // The tail itself hangs from its own joint (TAIL), so it can swing.
    tail: new THREE.CapsuleGeometry(0.026, 0.12, 3, 8).rotateX(0.35).translate(0, -0.08, -0.03),
    // Helmet: a dome that reaches a little below its widest point (no gap above the brim), sitting above the brows.
    helmet: merge(new THREE.SphereGeometry(1, 22, 11, 0, Math.PI * 2, 0, Math.PI / 2 + 0.14).scale(0.122, 0.106, 0.134).translate(0, 0.805, 0), ridge.clone().translate(0, 0.015, 0)),
    brim: lathe([[0.118, 0.0], [0.15, -0.012], [0.15, -0.024], [0.118, -0.012]], 1.08, 0.81, 24).translate(0, 0, 0.01),
    cap: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.3).scale(0.104, 0.1, 0.112).translate(0, 0.79, 0),
    peak: new THREE.CylinderGeometry(0.08, 0.08, 0.012, 14, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.15).translate(0, 0.8, 0.09),
    // Christmas: a red hat that flops back (over the helmet for workers), its white brim and bobble.
    hat: santaHat(0.108, 0.8),
    hatH: santaHat(0.135, 0.86),
    brimS: new THREE.TorusGeometry(0.106, 0.026, 6, 18).rotateX(Math.PI / 2).translate(0, 0.805, 0),
    brimH: new THREE.TorusGeometry(0.133, 0.028, 6, 18).rotateX(Math.PI / 2).translate(0, 0.865, 0),
    // Father Christmas: a full white beard and moustache, and a sack over his shoulder.
    beard: merge(ell(0.085, 0.1, 0.06, 0, 0.66, 0.06, 12), ell(0.05, 0.018, 0.02, 0, 0.715, 0.1, 8)),
    sack: ell(0.2, 0.26, 0.17, 0.06, 0.48, -0.24, 12),

  };
  // Everything on the head hangs from the neck joint (at y 0.6 in the torso).
  for (const key of ['head', 'ears', 'eyes', 'pupils', 'lips', 'hair', 'hairLong', 'hairTail', 'hairT', 'hairLongT', 'hairTailT', 'helmet', 'brim', 'cap', 'peak', 'hat', 'hatH', 'brimS', 'brimH', 'beard']) geo[key]!.translate(0, -NECK_Y, 0);
  // Eyes and mouth hang from their own joints on the head.
  for (const key of ['eyes', 'pupils']) geo[key]!.translate(-EYES.x, -EYES.y, -EYES.z);
  for (const key of ['lips']) geo[key]!.translate(-MOUTH.x, -MOUTH.y, -MOUTH.z);
  // The chest, and everything on it, hangs from the lower back.
  for (const key of ['collar', 'vestU', 'bandsU', 'neck', 'lanyard', 'badge', 'buttons', 'shirtV', 'lapels', 'tie', 'jacketButtons', 'sack']) geo[key]!.translate(0, -CHEST_Y, 0);
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
/** How far the hanging arms stand out from the body (radians): just clear of the vest. */
export const REST_SPREAD = 0.1;
/** Hip height (the pelvis above the root). */
export const HIP_Y = 0.92;
/**
 * The head as one surface: an ellipsoid pushed in and out with smooth bumps
 * (jaw, chin, brow ridge, eye sockets, cheekbones, nose). Smooth normals, so
 * the ink pass draws its outline and nothing inside the face.
 */
function sculptHead(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 72, 56);
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
function hairShell(style: 0 | 1 | 2, thin: boolean): THREE.BufferGeometry {
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
  const U = 112;
  const V = 30;
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

/** 0 below a, 1 above b (or the other way round when b < a), smooth in between. */
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A profile (radius, height) with points added so no step is longer than `step`: rings that bend smoothly. */
function dense(prof: [number, number][], step = 0.022): [number, number][] {
  const out: [number, number][] = [prof[0]!];
  for (let i = 1; i < prof.length; i++) {
    const [r0, y0] = prof[i - 1]!;
    const [r1, y1] = prof[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(r1 - r0, y1 - y0) / step));
    for (let k = 1; k <= n; k++) out.push([r0 + ((r1 - r0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}
const lathe = (prof: [number, number][], depth: number, seg: number) =>
  new THREE.LatheGeometry(dense(prof).map(([r, h]) => new THREE.Vector2(r, h)), seg).scale(1, 1, depth);

// The skin: continuous shapes over the joints, so they bend instead of showing
// sticks and balls. Built in the joints' own frames, like the parts in shapes().
let skinGeo: Record<'leg' | 'torso' | 'arm', THREE.BufferGeometry> | null = null;
function skins(): Record<'leg' | 'torso' | 'arm', THREE.BufferGeometry> {
  return (skinGeo ??= {
    // Hip to ankle: full thigh, the knee, a calf, a slim ankle (inside the boot).
    leg: lathe([[0, 0.05], [0.06, 0.05], [0.09, 0.02], [0.096, -0.06], [0.09, -0.16], [0.082, -0.28], [0.071, -0.38], [0.066, -0.42], [0.066, -0.46], [0.071, -0.53], [0.069, -0.6], [0.06, -0.7], [0.053, -0.78], [0.052, -0.84], [0, -0.845]], 0.95, 26),
    // Crotch to collar (waist joint at 0): seat and hips, waist, chest, sloping shoulders.
    torso: lathe([[0, -0.11], [0.09, -0.1], [0.142, -0.06], [0.156, 0.0], [0.15, 0.05], [0.143, 0.12], [0.15, 0.25], [0.166, 0.36], [0.174, 0.43], [0.164, 0.49], [0.122, 0.535], [0.06, 0.56], [0, 0.565]], 0.66, 34),
    // Shoulder to wrist: a round shoulder cap, upper arm, elbow, forearm, wrist.
    arm: lathe([[0, 0.075], [0.04, 0.07], [0.061, 0.045], [0.066, 0.01], [0.062, -0.05], [0.056, -0.13], [0.051, -0.22], [0.047, -0.28], [0.046, -0.3], [0.048, -0.34], [0.047, -0.4], [0.041, -0.47], [0.035, -0.53], [0.033, -0.56], [0, -0.565]], 0.92, 22),
  });
}

/** Which bones move a point of the skin, by its height at rest (y above the floor). */
type Weights = [THREE.Object3D, number][];

/**
 * A person standing at the root's origin (feet on the ground). Add the root yourself, or pass `at`.
 *
 * The body is one skinned mesh (one draw call) on the joints of `Human`: the
 * legs, torso and arms are continuous skins that bend at the knees, waist,
 * lower back, neck, shoulders and elbows; boots, hands, head and everything
 * worn ride rigidly on their joint. Colours are per vertex (trousers, shirt,
 * skin, vest...), so all people share one material.
 */
export function buildHuman(k: FloorKit, look: HumanLook, at?: { x: number; z: number; ry: number }): Human {
  const g = shapes();
  const sk = skins();
  let mat = bodyMats.get(k);
  if (!mat) {
    mat = k.std(0xffffff, 0.8, 0, 0xffffff);
    mat.vertexColors = true;
    mat.map = faceAtlas();
    // By day people keep about half of their smooth shading under the toon
    // steps, so faces and limbs read as round.
    mat.userData.toonK = 0.45;
    bodyMats.set(k, mat);
  }
  const skin = look.skin ?? 0xf0cfb0;
  const worker = look.vest !== undefined;
  const seed = Math.abs((look.shirt * 7 + (look.skin ?? 0) * 13 + HUMANS.length * 31) | 0);
  const hair = look.hair ?? HAIR[seed % HAIR.length]!;
  const style = look.hairStyle ?? Math.floor(seed / 7) % 3;
  const glove = 0x3a3d44;
  // Build: a little taller or shorter, slimmer or broader, some with a belly.
  const r = (n: number) => (((seed * 2654435761 + n * 40503) >>> 0) % 1000) / 1000;
  const height = look.build?.height ?? 0.93 + r(1) * 0.14;
  const width = look.build?.width ?? 0.9 + r(2) * 0.24;
  const belly = look.build?.belly ?? (look.santa ? 1 : Math.max(0, r(3) - 0.6) * 2.2);
  const face = seed % FACES;
  // Lips: the skin, darker and a little red.
  const lip = new THREE.Color(skin).lerp(new THREE.Color(0x8a3a3a), 0.45).getHex();

  // The skeleton, at rest: straight, arms hanging down (the pose comes after binding).
  const root = new THREE.Group();
  const joint = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const j = new THREE.Group();
    j.position.set(x, y, z);
    parent.add(j);
    return j;
  };
  const pelvis = joint(root, 0, HIP_Y, 0);
  const hipX = 0.085 * (1 + (width - 1) * 0.6);
  const shoulderX = 0.182 * (1 + (width - 1) * 0.7);
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

  // Skin weights by height at rest. Legs: thigh → shin around the knee, shin → foot at the ankle.
  const legW = (leg: THREE.Object3D, kn: THREE.Object3D, ft: THREE.Object3D) => (p: THREE.Vector3): Weights => {
    const y = p.y - HIP_Y;
    const kw = smooth(-0.35, -0.49, y);
    const fw = smooth(-0.79, -0.845, y);
    return [[leg, 1 - kw], [kn, kw * (1 - fw)], [ft, kw * fw]];
  };
  // Torso: seat on the pelvis, belly on the waist, chest on the lower back, neck into the head.
  const torsoW = (p: THREE.Vector3): Weights => {
    const y = p.y - HIP_Y;
    const pw = 1 - smooth(-0.03, 0.1, y);
    const cw = smooth(0.16, 0.34, y);
    const hw = smooth(0.585, 0.655, y);
    return [[pelvis, pw], [torso, (1 - pw) * (1 - cw)], [chest, cw * (1 - hw)], [head, cw * hw]];
  };
  // Arms: the shoulder cap half on the chest, upper arm → forearm round the elbow, a little hand at the wrist.
  const armW = (arm: THREE.Object3D, fo: THREE.Object3D, hd: THREE.Object3D) => (p: THREE.Vector3): Weights => {
    const y = p.y - (HIP_Y + 0.465);
    const top = 0.5 * smooth(-0.03, 0.07, y);
    const fw = smooth(-0.24, -0.34, y);
    const hw = 0.6 * smooth(-0.52, -0.565, y);
    return [[chest, top], [arm, (1 - top) * (1 - fw)], [fo, fw * (1 - hw)], [hd, fw * hw]];
  };

  interface Part {
    geo: THREE.BufferGeometry;
    j: THREE.Object3D;
    /** A colour, or one by the point (rest, root frame). */
    c: number | ((p: THREE.Vector3) => number);
    w?: (p: THREE.Vector3) => Weights;
    /** Face shell: UVs into this person's atlas cell. */
    face?: boolean;
    /** Hair: strands painted into the colour. */
    hair?: boolean;
  }
  const parts: Part[] = [];
  const add = (j: THREE.Object3D, geo: THREE.BufferGeometry, c: Part['c'], w?: Part['w']) => parts.push({ geo, j, c, w });

  // Legs and boots.
  for (const [leg, kn, ft] of [[legL, kneeL, footL], [legR, kneeR, footR]] as const) {
    add(leg, sk.leg, look.trousers, legW(leg, kn, ft));
    add(ft, g.boot!, 0x2a2522);
    add(ft, g.sole!, 0x1d1d1f);
  }
  // Torso: trousers below the belt, shirt (or jacket) above.
  add(torso, sk.torso, (p) => (p.y - HIP_Y < 0.04 ? look.trousers : look.shirt), torsoW);
  add(chest, g.collar!, look.shirt, torsoW);
  add(chest, g.neck!, skin, torsoW);
  add(torso, g.belt!, 0x1d1d1f, torsoW);
  add(torso, g.buckle!, 0xb9c0c8, torsoW);
  add(torso, g.pockets!, look.trousers, torsoW);
  if (worker) {
    add(torso, g.vest!, look.vest!, torsoW);
    add(chest, g.vestU!, look.vest!, torsoW);
    add(torso, g.bands!, 0xd8dde3, torsoW);
    add(chest, g.bandsU!, 0xd8dde3, torsoW);
    add(torso, g.radio!, 0x1d1d1f, torsoW);
  } else if (look.suit) {
    add(chest, g.shirtV!, 0xffffff, torsoW);
    add(chest, g.lapels!, look.shirt, torsoW);
    add(chest, g.tie!, look.suit.tie, torsoW);
    add(chest, g.jacketButtons!, 0x1d1d1f, torsoW);
  } else {
    add(chest, g.lanyard!, 0x1755fe, torsoW);
    add(chest, g.badge!, 0xffffff, torsoW);
    add(chest, g.buttons!, 0xf3f4f6, torsoW);
  }
  // Arms: workers' long sleeves end in gloves; staff wear short sleeves (bare forearms); a suit has a white cuff.
  for (const [arm, fo, hd] of [[armL, foreL, handL], [armR, foreR, handR]] as const) {
    const sleeve = (p: THREE.Vector3) => {
      const y = p.y - (HIP_Y + 0.465);
      if (worker) return y < -0.525 ? glove : look.shirt;
      if (look.suit) return y < -0.53 ? 0xffffff : look.shirt;
      return y > -0.14 ? look.shirt : skin;
    };
    add(arm, sk.arm, sleeve, armW(arm, fo, hd));
    if (!worker && !look.suit) add(arm, g.sleeve!, look.shirt, armW(arm, fo, hd));
    add(hd, g.hand!, worker ? glove : skin);
  }
  // Head: face, hair, and a helmet, cap or hat.
  parts.push({ geo: g.head!, j: head, c: skin, face: true });
  add(head, g.ears!, skin);
  add(eyes, g.eyes!, 0xf6f6f2);
  add(eyes, g.pupils!, 0x1d1d1f);
  add(mouth, g.lips!, lip);
  // Under a cap or a Christmas hat the hair lies flat on top.
  const flat = look.helmet === undefined && (XMAS || !look.suit);
  parts.push({ geo: (flat ? [g.hairT!, g.hairLongT!, g.hairTailT!] : [g.hair!, g.hairLong!, g.hairTail!])[style]!, j: head, c: hair, hair: true });
  if (tail) add(tail, g.tail!, hair);
  if (look.santa) {
    add(head, g.beard!, 0xffffff);
    add(chest, g.sack!, 0x8a5a2a, torsoW);
  }
  if (XMAS || look.santa) {
    // Christmas hats for everyone (over the helmet for workers).
    const h = look.helmet !== undefined;
    if (h) add(head, g.helmet!, look.helmet!);
    add(head, h ? g.hatH! : g.hat!, 0xc8102e);
    add(head, h ? g.brimH! : g.brimS!, 0xffffff);
  } else if (look.helmet !== undefined) {
    add(head, g.helmet!, look.helmet);
    add(head, g.brim!, look.helmet);
  } else if (!look.suit) {
    const c = look.cap ?? 0x2f3b6b;
    add(head, g.cap!, c);
    add(head, g.peak!, c);
  }

  // Bake the parts into one geometry at rest, with colours and skin weights.
  root.updateMatrixWorld(true);
  const bones: THREE.Object3D[] = [pelvis, legL, kneeL, footL, legR, kneeR, footR, torso, chest, head, eyes, mouth, armL, foreL, handL, armR, foreR, handR];
  if (tail) bones.push(tail);
  const index = new Map(bones.map((b, i) => [b, i]));
  const col = new THREE.Color();
  const nv = new THREE.Vector3();
  /**
   * Shadow painted into the colours (as an illustrator would): undersides a
   * little darker, and the places light hardly reaches: eye sockets, under the
   * nose, beside it, under the chin, the sides under the arms.
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
    } else if (part.geo === g.neck) f *= 1 - 0.3 * smooth(0.59, 0.66, y);
    else if (part.w === torsoW && part.j !== head) f *= 1 - 0.14 * bump(Math.abs(q.x) / width, y, 0.17, 0.38, 0.04, 0.09);
    return Math.max(0.62, f);
  };
  const p = new THREE.Vector3();
  const geos = parts.map((part) => {
    const geo = (part.geo.index ? part.geo.toNonIndexed() : part.geo.clone()).applyMatrix4(part.j.matrixWorld);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    // UVs: the face shell into this person's cell of the atlas, everything else on the white cell.
    const uv = new Float32Array(n * 2);
    const fu = face % CELLS;
    const fv = CELLS - 1 - Math.floor(face / CELLS);
    for (let i = 0; i < n; i++) {
      if (part.face) {
        // By the point's place on the face; clamped inside the cell (its border is white).
        p.fromBufferAttribute(pos, i);
        let [u, v] = p.z > 0.01 ? faceUV(p.x, p.y - HIP_Y) : [0.02, 0.02];
        u = Math.min(0.98, Math.max(0.02, u));
        v = Math.min(0.98, Math.max(0.02, v));
        uv.set([(fu + u) / CELLS, (fv + v) / CELLS], i * 2);
      } else uv.set(WHITE_UV, i * 2);
    }
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    // Build: the torso (and what is worn on it) wider, deeper and with a belly; limbs a little fuller.
    const cx = part.j.getWorldPosition(new THREE.Vector3()).x;
    const kind = part.w === torsoW ? 'torso' : part.w && (part.j === legL || part.j === legR || part.j === armL || part.j === armR) ? 'limb' : null;
    if (kind) {
      const lw = Math.sqrt(width);
      for (let i = 0; i < n; i++) {
        p.fromBufferAttribute(pos, i);
        if (kind === 'torso') {
          const y = p.y - HIP_Y;
          const front = Math.max(0, p.z / (Math.hypot(p.x, p.z) || 1)) ** 1.5;
          p.x *= width;
          p.z *= 1 + (width - 1) * 0.6;
          p.z += belly * 0.055 * Math.exp(-(((y - 0.14) / 0.11) ** 2)) * front;
        } else {
          p.x = cx + (p.x - cx) * lw;
          p.z *= lw;
        }
        pos.setXYZ(i, p.x, p.y, p.z);
      }
    }
    const colors = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      col.setHex(typeof part.c === 'number' ? part.c : part.c(p));
      col.multiplyScalar(shade(part, p, nv.fromBufferAttribute(nrm, i)));
      colors.set([col.r, col.g, col.b], i * 3);
      const ws = part.w ? part.w(p).filter(([, w]) => w > 1e-3) : [[part.j, 1] as [THREE.Object3D, number]];
      const sum = ws.reduce((a, [, w]) => a + w, 0) || 1;
      ws.slice(0, 4).forEach(([b, w], k) => {
        si[i * 4 + k] = index.get(b) ?? index.get(part.j)!;
        sw[i * 4 + k] = w / sum;
      });
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    return geo;
  });
  // Shared corners merged (indexed): about a third of the vertices.
  const body = new THREE.SkinnedMesh(mergeVertices(mergeGeometries(geos)!, 1e-5), mat);
  geos.forEach((x) => x.dispose());
  root.add(body);
  body.updateMatrixWorld(true);
  // (The joints are Groups, not Bones; the skeleton only needs their world matrices.)
  body.bind(new THREE.Skeleton(bones as THREE.Bone[]));
  // A fixed bound for frustum culling, big enough for any pose.
  body.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.3);

  // The resting pose: arms a little away from the body, elbows a little bent.
  armL.rotation.z = -REST_SPREAD;
  armR.rotation.z = REST_SPREAD;
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
  return { root, pelvis, torso, chest, armL, armR, foreL, foreR, head, legL, legR, kneeL, kneeR, footL, footR, handL, handR, tail, eyes, mouth, m };
}
