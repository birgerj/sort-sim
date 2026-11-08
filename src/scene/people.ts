// People: dock workers (hi-vis vest, helmet) and staff (shirt, cap). Jointed at
// hips, waist and shoulders, so they can walk, carry, bend and dance. Facing +z.
import * as THREE from 'three';

import type { FloorKit } from './floor';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { hiVis } from './textures';
import { XMAS } from '../sim/season';

export interface Human {
  root: THREE.Group;
  torso: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
}

export interface HumanLook {
  shirt: number;
  trousers: number;
  /** Hi-vis vest colour (workers). */
  vest?: number;
  /** Helmet colour (workers), or a cap. */
  helmet?: number;
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
    // Leg (hip joint at the top): a tapering thigh, the knee, a calf with a bit of shape.
    leg: lathe([[0, 0.02], [0.082, 0.0], [0.084, -0.08], [0.074, -0.25], [0.06, -0.42], [0.056, -0.46], [0.06, -0.55], [0.057, -0.66], [0.044, -0.8], [0.042, -0.84], [0, -0.84]], 0.95, 0, 14),
    // Safety boot: rounded upper, toe cap, and a thick dark sole (the sole is its own part).
    boot: merge(new RoundedBoxGeometry(0.11, 0.1, 0.24, 2, 0.04).translate(0, -0.85, 0.035), ell(0.054, 0.042, 0.06, 0, -0.865, 0.11, 10)),
    sole: box(0.12, 0.03, 0.27, 0, -0.905, 0.04),
    // Pelvis and torso (waist joint at the bottom): hips, a waist, the chest and sloping shoulders.
    // Hips (in the trousers' colour) and the torso: a waist, the chest and sloping shoulders.
    hips: ell(0.152, 0.1, 0.104, 0, 0.0, 0),
    torso: lathe([[0, 0.02], [0.148, 0.02], [0.142, 0.12], [0.15, 0.25], [0.166, 0.36], [0.172, 0.43], [0.16, 0.49], [0.118, 0.535], [0.06, 0.56], [0, 0.565]], 0.64),
    collar: new THREE.TorusGeometry(0.058, 0.014, 6, 16).rotateX(Math.PI / 2).scale(1, 1, 0.9).translate(0, 0.555, 0.008),
    belt: lathe([[0.152, -0.03], [0.152, 0.03]], 0.66, 0.06),
    buckle: box(0.05, 0.035, 0.015, 0, 0.06, 0.1),
    vest: lathe([[0.158, 0.08], [0.152, 0.14], [0.16, 0.25], [0.178, 0.38], [0.182, 0.45], [0.168, 0.51], [0.13, 0.545]], 0.68),
    // Two reflective bands round the vest.
    bands: merge(...[0.22, 0.36].map((y) => new THREE.CylinderGeometry(0.168, 0.164 + (y > 0.3 ? 0.012 : 0), 0.035, 18, 1, true).scale(1.0, 1, 0.7).translate(0, y, 0))),
    // Arm (shoulder joint at the top): upper arm, elbow, forearm, wrist.
    arm: lathe([[0, 0.05], [0.04, 0.045], [0.054, 0.0], [0.048, -0.12], [0.04, -0.28], [0.038, -0.3], [0.041, -0.36], [0.032, -0.52], [0.028, -0.55], [0, -0.555]], 0.9, 0, 12),
    // Hand: a palm and the fingers together, the thumb forward.
    hand: merge(new RoundedBoxGeometry(0.06, 0.1, 0.03, 2, 0.013).translate(0, -0.6, 0), ell(0.014, 0.03, 0.014, 0, -0.585, 0.022, 6)),
    neck: new THREE.CylinderGeometry(0.044, 0.05, 0.11, 12).translate(0, 0.62, 0.005),
    // Head: skull, jaw and chin, ears and a nose.
    head: merge(
      ell(0.092, 0.112, 0.102, 0, 0.75, 0, 18),
      ell(0.072, 0.06, 0.08, 0, 0.69, 0.018, 12),
      ell(0.016, 0.028, 0.012, -0.092, 0.745, -0.005, 6),
      ell(0.016, 0.028, 0.012, 0.092, 0.745, -0.005, 6),
      new THREE.ConeGeometry(0.016, 0.04, 6).rotateX(Math.PI / 2).translate(0, 0.735, 0.105),
    ),
    // Eyes and eyebrows (dark), and the mouth.
    face: merge(
      ell(0.011, 0.008, 0.006, -0.034, 0.76, 0.093, 6),
      ell(0.011, 0.008, 0.006, 0.034, 0.76, 0.093, 6),
      box(0.032, 0.006, 0.008, -0.034, 0.778, 0.094),
      box(0.032, 0.006, 0.008, 0.034, 0.778, 0.094),
      box(0.03, 0.005, 0.006, 0, 0.7, 0.093),
    ),
    // Hair: the back of the head and the crown, down to the ears (the face stays clear).
    hair: new THREE.SphereGeometry(1, 16, 10, Math.PI * 0.95, Math.PI * 1.1, 0, Math.PI * 0.58).scale(0.098, 0.118, 0.108).translate(0, 0.756, -0.004),
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
  return geo;
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
  const legL = joint(root, -0.085, 0.92, 0);
  const legR = joint(root, 0.085, 0.92, 0);
  for (const l of [legL, legR]) {
    add(l, g.leg!, M.cloth, look.trousers);
    add(l, g.boot!, M.boots);
    add(l, g.sole!, M.dark);
  }
  const torso = joint(root, 0, 0.92, 0);
  add(torso, g.hips!, M.cloth, look.trousers);
  add(torso, g.torso!, M.cloth, look.shirt);
  add(torso, g.collar!, M.cloth, look.shirt);
  add(torso, g.belt!, M.dark);
  add(torso, g.buckle!, M.hard, 0xb9c0c8);
  if (look.vest !== undefined) {
    add(torso, g.vest!, M.vest, look.vest);
    add(torso, g.bands!, M.reflect);
  }
  add(torso, g.neck!, M.skin, skin);
  add(torso, g.head!, M.skin, skin);
  add(torso, g.face!, M.dark);
  const hair = look.hair ?? HAIR[(look.shirt * 7 + (look.skin ?? 0)) % HAIR.length]!;
  add(torso, g.hair!, M.cloth, hair);
  if (look.santa) {
    add(torso, g.beard!, M.cloth, 0xffffff);
    add(torso, g.sack!, M.cloth, 0x8a5a2a);
  }
  if (XMAS || look.santa) {
    // Christmas hats for everyone (over the helmet for workers).
    const h = look.helmet !== undefined;
    if (h) add(torso, g.helmet!, M.hard, look.helmet);
    add(torso, h ? g.hatH! : g.hat!, M.cloth, 0xc8102e);
    add(torso, h ? g.brimH! : g.brimS!, M.cloth, 0xffffff);
  } else if (look.helmet !== undefined) {
    add(torso, g.helmet!, M.hard, look.helmet);
    add(torso, g.brim!, M.hard, look.helmet);
  } else {
    const c = look.cap ?? 0x2f3b6b;
    add(torso, g.cap!, M.cloth, c);
    add(torso, g.peak!, M.cloth, c);
  }
  const armL = joint(torso, -0.182, 0.465, 0);
  const armR = joint(torso, 0.182, 0.465, 0);
  // Arms hang a little away from the body.
  armL.rotation.z = -0.07;
  armR.rotation.z = 0.07;
  for (const a of [armL, armR]) {
    add(a, g.arm!, M.cloth, look.shirt);
    // Workers wear gloves; staff go bare-handed.
    add(a, g.hand!, look.vest !== undefined ? M.cloth : M.skin, look.vest !== undefined ? 0x3a3d44 : skin);
  }
  k.blobUnder(root, 0.8, 0.6);
  HUMANS.push(root);
  if (at) {
    root.position.set(at.x, 0, at.z);
    root.rotation.y = at.ry;
    k.put(root);
  }
  return { root, torso, armL, armR, legL, legR };
}
