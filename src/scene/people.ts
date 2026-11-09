// People: dock workers (hi-vis vest, helmet) and staff (shirt, cap). Jointed like
// a simple skeleton: pelvis, hips, knees, ankles, waist, chest (lower back), neck,
// shoulders, elbows and wrists, and a ponytail that swings. `motion.ts` poses them
// (walking, crouching, reaching, breathing). Facing +z. Each person gets one of a
// few hair styles, and staff wear short sleeves and a badge on a lanyard; workers
// long sleeves, gloves and a radio.
//
// Every part is a proxy in an instanced batch (`kit.batch`), so more joints cost
// no draw calls per person: only a few more matrices to copy each frame.
import * as THREE from 'three';

import type { FloorKit } from './floor';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { hiVis } from './textures';
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
    // Thigh (hip joint at the top), tapering down to the knee.
    thigh: lathe([[0, 0.02], [0.082, 0.0], [0.084, -0.08], [0.074, -0.25], [0.06, -0.42], [0.058, -0.45], [0, -0.45]], 0.95, 0, 14),
    // Shin (knee joint at the top): a round knee, so a bent knee shows no gap, and a calf with a bit of shape.
    shin: merge(
      lathe([[0, -0.4], [0.057, -0.41], [0.056, -0.46], [0.06, -0.55], [0.057, -0.66], [0.044, -0.8], [0.042, -0.84], [0, -0.84]], 0.95, 0, 14),
      ell(0.059, 0.059, 0.056, 0, -0.42, 0, 12),
    ).translate(0, KNEE, 0),
    // Safety boot (ankle joint at the top): rounded upper, toe cap, and a thick dark sole (the sole is its own part).
    boot: merge(new RoundedBoxGeometry(0.11, 0.1, 0.24, 2, 0.04).translate(0, -0.85, 0.035), ell(0.054, 0.042, 0.06, 0, -0.865, 0.11, 10)).translate(0, ANKLE, 0),
    sole: box(0.12, 0.03, 0.27, 0, -0.905, 0.04).translate(0, ANKLE, 0),
    // Pelvis and torso (waist joint at the bottom): hips, a waist, the chest and sloping shoulders.
    // Hips (in the trousers' colour) and the torso: a waist, the chest and sloping shoulders.
    hips: ell(0.152, 0.1, 0.104, 0, 0.0, 0),
    // The torso in two: the belly (waist joint) and the chest (lower-back joint). They
    // overlap a little, the belly just inside, so bending the back shows no gap.
    torso: lathe([[0, 0.02], [0.148, 0.02], [0.142, 0.12], [0.15, 0.25], [0.146, 0.3], [0, 0.3]], 0.64),
    torsoU: lathe([[0, 0.2], [0.147, 0.2], [0.15, 0.25], [0.166, 0.36], [0.172, 0.43], [0.16, 0.49], [0.118, 0.535], [0.06, 0.56], [0, 0.565]], 0.64),
    collar: new THREE.TorusGeometry(0.058, 0.014, 6, 16).rotateX(Math.PI / 2).scale(1, 1, 0.9).translate(0, 0.555, 0.008),
    belt: lathe([[0.152, -0.03], [0.152, 0.03]], 0.66, 0.06),
    buckle: box(0.05, 0.035, 0.015, 0, 0.06, 0.1),
    vest: lathe([[0.158, 0.08], [0.152, 0.14], [0.16, 0.25], [0.155, 0.3]], 0.68),
    vestU: lathe([[0.157, 0.2], [0.16, 0.25], [0.178, 0.38], [0.182, 0.45], [0.168, 0.51], [0.13, 0.545]], 0.68),
    // Two reflective bands round the vest (one on the belly, one on the chest).
    bands: new THREE.CylinderGeometry(0.168, 0.164, 0.035, 18, 1, true).scale(1.0, 1, 0.7).translate(0, 0.22, 0),
    bandsU: new THREE.CylinderGeometry(0.168, 0.176, 0.035, 18, 1, true).scale(1.0, 1, 0.7).translate(0, 0.36, 0),
    // Arm (shoulder joint at the top): upper arm, elbow, forearm, wrist.
    // Upper arm (shoulder joint at the top), down to the elbow; a short sleeve's hem for staff.
    upper: lathe([[0, 0.05], [0.04, 0.045], [0.054, 0.0], [0.05, -0.1], [0.042, -0.24], [0.039, -0.29], [0, -0.3]], 0.9, 0, 12),
    sleeve: lathe([[0.056, -0.1], [0.058, -0.14], [0.05, -0.15]], 0.9, 0, 12),
    // Forearm (elbow joint at the top) and the wrist.
    fore: lathe([[0, 0.03], [0.038, 0.02], [0.04, -0.05], [0.031, -0.22], [0.027, -0.26], [0, -0.265]], 0.88, 0, 12),
    // Hand: palm, four fingers slightly curled, and the thumb forward.
    // (Wrist joint at the top.)
    hand: merge(
      new RoundedBoxGeometry(0.055, 0.065, 0.026, 2, 0.01).translate(0, -0.3, 0),
      ...[-0.019, -0.006, 0.007, 0.019].map((x, i) => new THREE.CapsuleGeometry(0.0068, 0.04 - Math.abs(i - 1.5) * 0.006, 2, 6).rotateX(0.25).translate(x, -0.355, 0.006)),
      new THREE.CapsuleGeometry(0.008, 0.03, 2, 6).rotateZ(0.5).rotateX(-0.4).translate(-0.028, -0.3, 0.016),
    ).translate(0, WRIST, 0),
    // Workers: a cuff where the glove starts; and a radio on the belt.
    cuff: lathe([[0.03, -0.235], [0.033, -0.255], [0.03, -0.27]], 0.88, 0, 10),
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
    crease: box(0.006, 0.35, 0.006, 0, -0.245, 0.072),
    creaseS: box(0.006, 0.35, 0.006, 0, -0.175, 0.056),
    neck: new THREE.CylinderGeometry(0.044, 0.05, 0.11, 12).translate(0, 0.62, 0.005),
    // Head: skull, jaw and chin, cheeks, ears and a nose.
    head: merge(
      ell(0.03, 0.022, 0.02, -0.04, 0.715, 0.078, 8),
      ell(0.03, 0.022, 0.02, 0.04, 0.715, 0.078, 8),
      ell(0.092, 0.112, 0.102, 0, 0.75, 0, 18),
      ell(0.072, 0.06, 0.08, 0, 0.69, 0.018, 12),
      ell(0.016, 0.028, 0.012, -0.092, 0.745, -0.005, 6),
      ell(0.016, 0.028, 0.012, 0.092, 0.745, -0.005, 6),
      new THREE.ConeGeometry(0.016, 0.04, 6).rotateX(Math.PI / 2).translate(0, 0.735, 0.105),
    ),
    // The whites of the eyes.
    eyes: merge(ell(0.014, 0.0095, 0.006, -0.034, 0.76, 0.091, 8), ell(0.014, 0.0095, 0.006, 0.034, 0.76, 0.091, 8)),
    // Pupils and eyebrows (dark), and the mouth.
    face: merge(
      ell(0.0065, 0.0075, 0.004, -0.034, 0.76, 0.0965, 6),
      ell(0.0065, 0.0075, 0.004, 0.034, 0.76, 0.0965, 6),
      box(0.032, 0.006, 0.008, -0.034, 0.778, 0.094),
      box(0.032, 0.006, 0.008, 0.034, 0.778, 0.094),
      box(0.03, 0.005, 0.006, 0, 0.7, 0.093),
    ),
    // Hair: the back of the head and the crown, down to the ears (the face stays clear).
    hair: new THREE.SphereGeometry(1, 16, 10, Math.PI * 0.95, Math.PI * 1.1, 0, Math.PI * 0.58).scale(0.098, 0.118, 0.108).translate(0, 0.756, -0.004),
    // Longer hair: down over the neck at the back, with a side fringe.
    hairLong: merge(
      new THREE.SphereGeometry(1, 16, 10, Math.PI * 0.85, Math.PI * 1.3, 0, Math.PI * 0.75).scale(0.104, 0.13, 0.112).translate(0, 0.745, -0.006),
      ell(0.07, 0.022, 0.03, 0.02, 0.83, 0.07, 8),
    ),
    // A ponytail at the back.
    hairTail: new THREE.SphereGeometry(1, 16, 10, Math.PI * 0.95, Math.PI * 1.1, 0, Math.PI * 0.58).scale(0.1, 0.12, 0.11).translate(0, 0.756, -0.004),
    // The tail itself hangs from its own joint (TAIL), so it can swing.
    tail: new THREE.CapsuleGeometry(0.026, 0.12, 3, 8).rotateX(0.35).translate(0, -0.08, -0.03),
    helmet: merge(new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.122, 0.106, 0.134).translate(0, 0.79, 0), ridge),
    brim: lathe([[0.118, 0.0], [0.15, -0.012], [0.15, -0.024], [0.118, -0.012]], 1.08, 0.795, 20).translate(0, 0, 0.01),
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
  for (const key of ['head', 'eyes', 'face', 'hair', 'hairLong', 'hairTail', 'helmet', 'brim', 'cap', 'peak', 'hat', 'hatH', 'brimS', 'brimH', 'beard']) geo[key]!.translate(0, -NECK_Y, 0);
  // The chest, and everything on it, hangs from the lower back.
  for (const key of ['torsoU', 'collar', 'vestU', 'bandsU', 'neck', 'lanyard', 'badge', 'buttons', 'shirtV', 'lapels', 'tie', 'jacketButtons', 'sack']) geo[key]!.translate(0, -CHEST_Y, 0);
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
/** Hip height (the pelvis above the root). */
export const HIP_Y = 0.92;
/** Where the ponytail hangs from, on the head. */
const TAIL = new THREE.Vector3(0, 0.17, -0.09);

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

/** A person standing at the root's origin (feet on the ground). Add the root yourself, or pass `at`. */
/** White materials shared by everyone (colour comes per instance); one set per kit. */
const sharedMats = new WeakMap<FloorKit, Record<'cloth' | 'skin' | 'boots' | 'hard' | 'vest' | 'dark' | 'reflect', THREE.Material>>();

/** Every person built (their root), so a click can pick one to follow. */
export const HUMANS: THREE.Object3D[] = [];

export function buildHuman(k: FloorKit, look: HumanLook, at?: { x: number; z: number; ry: number }): Human {
  const g = shapes();
  let M = sharedMats.get(k);
  if (!M) {
    const vest = k.std(0xffffff, 0.6, 0, 0xffffff);
    vest.map = hiVis();
    M = {
      cloth: k.std(0xffffff, 0.85, 0, 0xffffff),
      skin: k.std(0xffffff, 0.9, 0, 0xffffff),
      boots: k.std(0x2a2522, 0.7, 0, 0x2a2522),
      hard: k.std(0xffffff, 0.4, 0, 0xffffff),
      vest,
      dark: k.std(0x15161a, 0.8, 0, 0x1d1d1f),
      // Reflective tape: light grey by day, it catches the light at night.
      reflect: k.std(0xd8dde3, 0.25, 0.6, 0xe9edf2),
    };
    sharedMats.set(k, M);
  }
  const skin = look.skin ?? 0xf0cfb0;
  const root = new THREE.Group();
  // Every part is instanced across all people, tinted per person.
  const add = (parent: THREE.Object3D, geom: THREE.BufferGeometry, m: THREE.Material, color?: number) => k.batch(geom, m, parent, color);
  const joint = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const j = new THREE.Group();
    j.position.set(x, y, z);
    parent.add(j);
    return j;
  };
  const pelvis = joint(root, 0, HIP_Y, 0);
  const legL = joint(pelvis, -0.085, 0, 0);
  const legR = joint(pelvis, 0.085, 0, 0);
  const knees: THREE.Group[] = [];
  const feet: THREE.Group[] = [];
  for (const l of [legL, legR]) {
    add(l, g.thigh!, M.cloth, look.trousers);
    add(l, g.crease!, M.cloth, look.trousers);
    const kn = joint(l, 0, -KNEE, 0);
    add(kn, g.shin!, M.cloth, look.trousers);
    add(kn, g.creaseS!, M.cloth, look.trousers);
    const f = joint(kn, 0, -ANKLE, 0);
    add(f, g.boot!, M.boots);
    add(f, g.sole!, M.dark);
    knees.push(kn);
    feet.push(f);
  }
  const torso = joint(pelvis, 0, 0, 0);
  const chest = joint(torso, 0, CHEST_Y, 0);
  add(torso, g.hips!, M.cloth, look.trousers);
  add(torso, g.torso!, M.cloth, look.shirt);
  add(chest, g.torsoU!, M.cloth, look.shirt);
  add(chest, g.collar!, M.cloth, look.shirt);
  add(torso, g.belt!, M.dark);
  add(torso, g.buckle!, M.hard, 0xb9c0c8);
  if (look.vest !== undefined) {
    add(torso, g.vest!, M.vest, look.vest);
    add(chest, g.vestU!, M.vest, look.vest);
    add(torso, g.bands!, M.reflect);
    add(chest, g.bandsU!, M.reflect);
  }
  add(chest, g.neck!, M.skin, skin);
  const worker = look.vest !== undefined;
  if (worker) add(torso, g.radio!, M.dark);
  else if (look.suit) {
    add(chest, g.shirtV!, M.cloth, 0xffffff);
    add(chest, g.lapels!, M.cloth, look.shirt);
    add(chest, g.tie!, M.cloth, look.suit.tie);
    add(chest, g.jacketButtons!, M.dark);
  } else {
    add(chest, g.lanyard!, M.cloth, 0x1755fe);
    add(chest, g.badge!, M.cloth, 0xffffff);
    add(chest, g.buttons!, M.cloth, 0xf3f4f6);
  }
  add(torso, g.pockets!, M.cloth, look.trousers);
  const head = joint(chest, 0, NECK_Y - CHEST_Y, 0);
  add(head, g.head!, M.skin, skin);
  add(head, g.eyes!, M.cloth, 0xf6f6f2);
  add(head, g.face!, M.dark);
  const seed = Math.abs((look.shirt * 7 + (look.skin ?? 0) * 13 + HUMANS.length * 31) | 0);
  const hair = look.hair ?? HAIR[seed % HAIR.length]!;
  const style = look.hairStyle ?? Math.floor(seed / 7) % 3;
  add(head, [g.hair!, g.hairLong!, g.hairTail!][style]!, M.cloth, hair);
  let tail: THREE.Group | null = null;
  if (style === 2) {
    tail = joint(head, TAIL.x, TAIL.y, TAIL.z);
    add(tail, g.tail!, M.cloth, hair);
  }
  if (look.santa) {
    add(head, g.beard!, M.cloth, 0xffffff);
    add(chest, g.sack!, M.cloth, 0x8a5a2a);
  }
  if (XMAS || look.santa) {
    // Christmas hats for everyone (over the helmet for workers).
    const h = look.helmet !== undefined;
    if (h) add(head, g.helmet!, M.hard, look.helmet);
    add(head, h ? g.hatH! : g.hat!, M.cloth, 0xc8102e);
    add(head, h ? g.brimH! : g.brimS!, M.cloth, 0xffffff);
  } else if (look.helmet !== undefined) {
    add(head, g.helmet!, M.hard, look.helmet);
    add(head, g.brim!, M.hard, look.helmet);
  } else if (!look.suit) {
    const c = look.cap ?? 0x2f3b6b;
    add(head, g.cap!, M.cloth, c);
    add(head, g.peak!, M.cloth, c);
  }
  const armL = joint(chest, -0.182, 0.465 - CHEST_Y, 0);
  const armR = joint(chest, 0.182, 0.465 - CHEST_Y, 0);
  // Arms hang a little away from the body.
  armL.rotation.z = -0.07;
  armR.rotation.z = 0.07;
  const fores: THREE.Group[] = [];
  const hands: THREE.Group[] = [];
  for (const a of [armL, armR]) {
    add(a, g.upper!, M.cloth, look.shirt);
    if (!worker && !look.suit) add(a, g.sleeve!, M.cloth, look.shirt);
    const f = joint(a, 0, -0.29, 0);
    // A little bend at the elbow when the arm hangs.
    f.rotation.x = -0.12;
    fores.push(f);
    // Workers: long sleeves and gloves; staff: bare forearms and hands.
    // (A suit has long sleeves too, with a white shirt cuff.)
    add(f, g.fore!, worker || look.suit ? M.cloth : M.skin, worker || look.suit ? look.shirt : skin);
    if (look.suit) add(f, g.cuff!, M.cloth, 0xffffff);
    if (worker) add(f, g.cuff!, M.cloth, 0x3a3d44);
    const hd = joint(f, 0, -WRIST, 0);
    add(hd, g.hand!, worker ? M.cloth : M.skin, worker ? 0x3a3d44 : skin);
    hands.push(hd);
  }
  k.blobUnder(root, 0.8, 0.6);
  HUMANS.push(root);
  if (at) {
    root.position.set(at.x, 0, at.z);
    root.rotation.y = at.ry;
    k.put(root);
  }
  const m: MotionState = { t: 0, walk: 0, amp: 0, px: 0, py: 0, pyaw: 0, proll: 0, drop: 0, footL: 0, footR: 0, tx: 0, tvx: 0, tz: 0, tvz: 0, yaw: 0, y: 0, seed: (seed % 997) / 997 };
  return {
    root, pelvis, torso, chest, armL, armR, foreL: fores[0]!, foreR: fores[1]!, head, legL, legR,
    kneeL: knees[0]!, kneeR: knees[1]!, footL: feet[0]!, footR: feet[1]!, handL: hands[0]!, handR: hands[1]!, tail, m,
  };
}
