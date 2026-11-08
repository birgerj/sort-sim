// A forklift model, shared by the roaming store forklift and the box forklifts.
// The forks point to local +z; `forks.position.y` lifts them (0.15 is on the floor).
import * as THREE from 'three';

import type { FloorKit } from './floor';

export interface ForkliftModel {
  g: THREE.Group;
  forks: THREE.Group;
  beacon: THREE.MeshBasicMaterial;
}

/** Fork tips reach this far in front of the forklift centre (where a carried pallet sits). */
export const FORK_REACH = 1.75;

export function buildForklift(k: FloorKit, load: number | null): ForkliftModel {
  const yellow = k.std(0xe8b400, 0.45, 0.3);
  const black = k.std(0x1b1c1f, 0.7, 0.3);
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    if (!(geo instanceof THREE.SphereGeometry)) k.inkify(m, 35);
    return m;
  };
  add(new THREE.BoxGeometry(1.2, 1, 2.2), yellow, 0, 0.8, 0);
  add(new THREE.BoxGeometry(1.1, 0.08, 1.2), black, 0, 2.2, -0.2);
  for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) add(new THREE.BoxGeometry(0.06, 1.4, 0.06), black, sx, 1.55, sz - 0.2);
  for (const sx of [-0.35, 0.35]) add(new THREE.BoxGeometry(0.1, 2.6, 0.1), black, sx, 1.3, 1.2);
  const forks = new THREE.Group();
  forks.position.set(0, 0.15, 0);
  g.add(forks);
  for (const sx of [-0.25, 0.25]) add(new THREE.BoxGeometry(0.12, 0.05, 1.1), black, sx, 0, FORK_REACH, forks);
  add(new THREE.BoxGeometry(0.8, 0.5, 0.06), black, 0, 0.3, 1.22, forks);
  if (load !== null) {
    add(new THREE.BoxGeometry(1.1, 0.12, 1.0), k.std(0x8a6a44, 0.9, 0), 0, 0.1, FORK_REACH, forks);
    add(new THREE.BoxGeometry(1.0, 0.8, 0.9), k.std(load, 0.6, 0), 0, 0.56, FORK_REACH, forks);
  }
  const wg = new THREE.CylinderGeometry(0.3, 0.3, 0.25, 16);
  for (const sx of [-0.6, 0.6]) for (const sz of [-0.7, 0.7]) add(wg, black, sx, 0.3, sz).rotation.z = Math.PI / 2;
  const beacon = new THREE.MeshBasicMaterial({ color: 0x000000 });
  add(new THREE.SphereGeometry(0.09, 8, 8), beacon, 0, 2.32, -0.2);
  k.put(g);
  return { g, forks, beacon };
}
