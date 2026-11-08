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
export function buildHuman(k: FloorKit, look: HumanLook, at?: { x: number; z: number; ry: number }): Human {
  const g = shapes();
  const mat = (c: number, rough = 0.85) => k.std(c, rough, 0, c);
  const skin = mat(look.skin ?? 0xf0cfb0, 0.9);
  const shirt = mat(look.shirt);
  const trousers = mat(look.trousers);
  const boots = mat(0x2a2522, 0.7);
  const root = new THREE.Group();
  const add = (parent: THREE.Object3D, geom: THREE.BufferGeometry, m: THREE.Material, outline = true) => {
    const mesh = new THREE.Mesh(geom, m);
    parent.add(mesh);
    if (outline) k.outline(mesh, 0.014);
    return mesh;
  };
  const joint = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const j = new THREE.Group();
    j.position.set(x, y, z);
    parent.add(j);
    return j;
  };
  const legL = joint(root, -0.11, 0.92, 0);
  const legR = joint(root, 0.11, 0.92, 0);
  for (const l of [legL, legR]) {
    add(l, g.leg!, trousers);
    add(l, g.boot!, boots, false);
  }
  const torso = joint(root, 0, 0.92, 0);
  add(torso, g.torso!, shirt);
  if (look.vest !== undefined) {
    const vest = k.std(look.vest, 0.6, 0, look.vest);
    vest.map = hiVis();
    add(torso, g.vest!, vest, false);
  }
  add(torso, g.neck!, skin, false);
  add(torso, g.head!, skin);
  if (look.helmet !== undefined) {
    const h = mat(look.helmet, 0.4);
    add(torso, g.helmet!, h);
    add(torso, g.brim!, h, false);
  } else {
    const c = mat(look.cap ?? 0x2f3b6b);
    add(torso, g.cap!, c);
    add(torso, g.peak!, c, false);
  }
  const armL = joint(torso, -0.3, 0.66, 0);
  const armR = joint(torso, 0.3, 0.66, 0);
  for (const a of [armL, armR]) {
    add(a, g.arm!, shirt);
    add(a, g.hand!, skin, false);
  }
  k.blobUnder(root, 0.8, 0.6);
  if (at) {
    root.position.set(at.x, 0, at.z);
    root.rotation.y = at.ry;
    k.put(root);
  }
  return { root, torso, armL, armR, legL, legR };
}
