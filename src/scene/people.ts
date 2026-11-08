// People: dock workers (hi-vis vest, helmet) and staff (shirt, cap). Jointed at
// hips, waist and shoulders, so they can walk, carry, bend and dance. Facing +z.
import * as THREE from 'three';

import type { FloorKit } from './floor';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { hiVis } from './textures';

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
  geo = {
    // Trouser leg: thigh and calf, a knee in between.
    leg: merge(cap(0.095, 0.28, -0.2), ball(0.085, 0, -0.42, 0.01), cap(0.075, 0.3, -0.62)),
    // Safety boot: rounded upper, toe cap, and a thick dark sole (the sole is its own part).
    boot: merge(new RoundedBoxGeometry(0.15, 0.12, 0.27, 2, 0.04).translate(0, -0.84, 0.04), ball(0.075, 0, -0.85, 0.15)),
    sole: box(0.165, 0.035, 0.3, 0, -0.9, 0.045),
    torso: new THREE.CapsuleGeometry(0.21, 0.32, 4, 14).scale(1.18, 1, 0.72).translate(0, 0.38, 0),
    // Collar, breast pocket flaps and the belt.
    collar: new THREE.TorusGeometry(0.085, 0.022, 6, 14).rotateX(Math.PI / 2).translate(0, 0.74, 0.01),
    belt: new THREE.CylinderGeometry(0.235, 0.235, 0.06, 18).scale(1.12, 1, 0.74).translate(0, 0.07, 0),
    buckle: box(0.07, 0.05, 0.02, 0, 0.07, 0.175),
    vest: new THREE.CapsuleGeometry(0.215, 0.28, 4, 14).scale(1.2, 1, 0.76).translate(0, 0.4, 0),
    // Two reflective bands round the vest.
    bands: merge(...[0.28, 0.46].map((y) => new THREE.CylinderGeometry(0.262, 0.262, 0.045, 18, 1, true).scale(1.0, 1, 0.64).translate(0, y, 0))),
    // Upper arm with a shoulder, elbow, forearm; the hand is a mitten with a thumb.
    arm: merge(ball(0.066, 0, 0, 0), cap(0.064, 0.22, -0.16), ball(0.058, 0, -0.32, 0), cap(0.054, 0.2, -0.45)),
    hand: new RoundedBoxGeometry(0.07, 0.12, 0.05, 2, 0.022).translate(0, -0.62, 0.005),
    neck: new THREE.CylinderGeometry(0.058, 0.066, 0.12, 12).translate(0, 0.79, 0),
    head: merge(new THREE.SphereGeometry(0.15, 18, 14).scale(0.95, 1.1, 1).translate(0, 0.96, 0), ball(0.032, -0.142, 0.95, 0, 8), ball(0.032, 0.142, 0.95, 0, 8), ball(0.024, 0, 0.94, 0.15, 8)),
    // Eyes and eyebrows (dark), and the mouth.
    face: merge(ball(0.017, -0.05, 0.985, 0.132, 6), ball(0.017, 0.05, 0.985, 0.132, 6), box(0.045, 0.01, 0.01, -0.05, 1.02, 0.135), box(0.045, 0.01, 0.01, 0.05, 1.02, 0.135), box(0.05, 0.008, 0.01, 0, 0.895, 0.135)),
    // Hair: the back of the head and the crown (the face stays clear).
    hair: new THREE.SphereGeometry(0.156, 16, 10, Math.PI, Math.PI, 0, Math.PI * 0.6).scale(0.97, 1.1, 1.02).translate(0, 0.965, -0.008),
    helmet: merge(new THREE.SphereGeometry(0.172, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.95, 1.05).translate(0, 1.0, 0), box(0.03, 0.03, 0.34, 0, 1.165, 0)),
    brim: new THREE.CylinderGeometry(0.2, 0.2, 0.018, 20).scale(1, 1, 1.12).translate(0, 1.0, 0.025),
    cap: new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.3).translate(0, 1.0, 0),
    peak: new THREE.CylinderGeometry(0.11, 0.11, 0.015, 14, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.1).translate(0, 1.01, 0.12),
  };
  return geo;
}

const HAIR = [0x2a1d14, 0x4a3221, 0x7a5a3a, 0xc9a26a, 0x1b1b1d, 0x8f8f8f];

/** A person standing at the root's origin (feet on the ground). Add the root yourself, or pass `at`. */
/** White materials shared by everyone (colour comes per instance); one set per kit. */
const sharedMats = new WeakMap<FloorKit, Record<'cloth' | 'skin' | 'boots' | 'hard' | 'vest' | 'dark' | 'reflect', THREE.Material>>();

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
  const legL = joint(root, -0.11, 0.92, 0);
  const legR = joint(root, 0.11, 0.92, 0);
  for (const l of [legL, legR]) {
    add(l, g.leg!, M.cloth, look.trousers);
    add(l, g.boot!, M.boots);
    add(l, g.sole!, M.dark);
  }
  const torso = joint(root, 0, 0.92, 0);
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
  if (look.helmet !== undefined) {
    add(torso, g.helmet!, M.hard, look.helmet);
    add(torso, g.brim!, M.hard, look.helmet);
  } else {
    const c = look.cap ?? 0x2f3b6b;
    add(torso, g.cap!, M.cloth, c);
    add(torso, g.peak!, M.cloth, c);
  }
  const armL = joint(torso, -0.3, 0.66, 0);
  const armR = joint(torso, 0.3, 0.66, 0);
  for (const a of [armL, armR]) {
    add(a, g.arm!, M.cloth, look.shirt);
    // Workers wear gloves; staff go bare-handed.
    add(a, g.hand!, look.vest !== undefined ? M.cloth : M.skin, look.vest !== undefined ? 0x3a3d44 : skin);
  }
  k.blobUnder(root, 0.8, 0.6);
  if (at) {
    root.position.set(at.x, 0, at.z);
    root.rotation.y = at.ry;
    k.put(root);
  }
  return { root, torso, armL, armR, legL, legR };
}
