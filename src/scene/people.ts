// People: dock workers (hi-vis vest, helmet) and staff (shirt, cap). Jointed at
// hips, waist and shoulders, so they can walk, carry, bend and dance. Facing +z.
import * as THREE from 'three';

import type { FloorKit } from './floor';
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
}

// Shared geometry: built once.
let geo: Record<string, THREE.BufferGeometry> | null = null;
function shapes(): Record<string, THREE.BufferGeometry> {
  if (geo) return geo;
  geo = {
    leg: new THREE.CapsuleGeometry(0.09, 0.62, 4, 10).translate(0, -0.42, 0),
    boot: new THREE.BoxGeometry(0.16, 0.1, 0.28).translate(0, -0.86, 0.04),
    torso: new THREE.CapsuleGeometry(0.21, 0.32, 4, 12).scale(1.18, 1, 0.72).translate(0, 0.38, 0),
    vest: new THREE.CapsuleGeometry(0.215, 0.28, 4, 12).scale(1.2, 1, 0.76).translate(0, 0.4, 0),
    arm: new THREE.CapsuleGeometry(0.06, 0.5, 4, 8).translate(0, -0.3, 0),
    hand: new THREE.SphereGeometry(0.06, 10, 8).translate(0, -0.62, 0),
    neck: new THREE.CylinderGeometry(0.06, 0.07, 0.1, 10).translate(0, 0.78, 0),
    head: new THREE.SphereGeometry(0.15, 16, 12).scale(1, 1.1, 1).translate(0, 0.95, 0),
    helmet: new THREE.SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.0, 0),
    brim: new THREE.CylinderGeometry(0.2, 0.2, 0.02, 16).translate(0, 1.0, 0.02),
    cap: new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.3).translate(0, 1.0, 0),
    peak: new THREE.BoxGeometry(0.2, 0.02, 0.12).translate(0, 1.01, 0.17),
  };
  return geo;
}

/** A person standing at the root's origin (feet on the ground). Add the root yourself, or pass `at`. */
/** White materials shared by everyone (colour comes per instance); one set per kit. */
const sharedMats = new WeakMap<FloorKit, Record<'cloth' | 'skin' | 'boots' | 'hard' | 'vest', THREE.Material>>();

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
  }
  const torso = joint(root, 0, 0.92, 0);
  add(torso, g.torso!, M.cloth, look.shirt);
  if (look.vest !== undefined) add(torso, g.vest!, M.vest, look.vest);
  add(torso, g.neck!, M.skin, skin);
  add(torso, g.head!, M.skin, skin);
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
    add(a, g.hand!, M.skin, skin);
  }
  k.blobUnder(root, 0.8, 0.6);
  if (at) {
    root.position.set(at.x, 0, at.z);
    root.rotation.y = at.ry;
    k.put(root);
  }
  return { root, torso, armL, armR, legL, legR };
}
