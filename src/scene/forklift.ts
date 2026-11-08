// A counterbalance forklift with a driver, shared by the store forklift and the
// box forklifts. The forks point to local +z; `forks.position.y` lifts the
// carriage (0.15 is on the floor). Parts are merged per material to keep the
// draw calls down.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { FloorKit } from './floor';
import { buildHuman } from './people';
import { XMAS } from '../sim/season';

export interface ForkliftModel {
  g: THREE.Group;
  forks: THREE.Group;
  beacon: THREE.MeshBasicMaterial;
}

/** Fork tips reach this far in front of the forklift centre (where a carried pallet sits). */
export const FORK_REACH = 1.75;

type G = THREE.BufferGeometry;
const box = (w: number, h: number, d: number, x: number, y: number, z: number): G => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
const cyl = (r: number, h: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', seg = 12): G => {
  const c = new THREE.CylinderGeometry(r, r, h, seg);
  if (axis === 'x') c.rotateZ(Math.PI / 2);
  if (axis === 'z') c.rotateX(Math.PI / 2);
  return c.translate(x, y, z).toNonIndexed();
};
const merge = (list: G[]) => mergeGeometries(list)!;

let parts: Record<string, G> | null = null;
function geometry(): Record<string, G> {
  if (parts) return parts;
  const body = [
    new RoundedBoxGeometry(1.2, 0.55, 1.5, 3, 0.08).translate(0, 0.55, 0.15),
    // Counterweight at the back, rounded.
    new RoundedBoxGeometry(1.24, 0.8, 0.55, 3, 0.18).translate(0, 0.72, -0.78),
    // Step and dashboard.
    box(1.1, 0.18, 0.45, 0, 0.92, 0.66),
  ];
  const dark: G[] = [
    // Overhead guard: posts, roof frame and slats.
    ...[-0.52, 0.52].flatMap((sx) => [cyl(0.035, 1.35, sx, 1.52, 0.62), cyl(0.035, 1.35, sx, 1.52, -0.5)]),
    box(1.12, 0.05, 1.2, 0, 2.2, 0.06),
    ...[-0.3, -0.1, 0.1, 0.3].map((z) => box(1.0, 0.04, 0.06, 0, 2.24, z)),
    // Seat.
    new RoundedBoxGeometry(0.5, 0.12, 0.45, 2, 0.04).translate(0, 0.92, -0.2),
    new RoundedBoxGeometry(0.5, 0.5, 0.1, 2, 0.04).translate(0, 1.18, -0.42),
    // Steering column and wheel.
    cyl(0.025, 0.4, 0, 1.15, 0.55),
    new THREE.TorusGeometry(0.13, 0.02, 6, 16).rotateX(Math.PI / 2.6).translate(0, 1.36, 0.5).toNonIndexed(),
    // Mast: two rails, crossbars, lift cylinder.
    ...[-0.36, 0.36].map((sx) => box(0.08, 2.7, 0.12, sx, 1.4, 1.05)),
    box(0.8, 0.08, 0.1, 0, 2.7, 1.05),
    box(0.8, 0.08, 0.1, 0, 0.3, 1.05),
    cyl(0.05, 1.9, 0, 1.2, 1.0),
  ];
  const wheels = [
    ...[-0.58, 0.58].map((sx) => cyl(0.3, 0.26, sx, 0.3, 0.62, 'x', 18)),
    ...[-0.56, 0.56].map((sx) => cyl(0.24, 0.22, sx, 0.24, -0.62, 'x', 18)),
  ];
  const hubs = [...[-0.72, 0.72].map((sx) => cyl(0.13, 0.02, sx, 0.3, 0.62, 'x')), ...[-0.68, 0.68].map((sx) => cyl(0.1, 0.02, sx, 0.24, -0.62, 'x'))];
  const forks = [
    // Carriage plate with a load backrest grille, and two forks.
    box(0.8, 0.45, 0.06, 0, 0.22, 1.16),
    ...[-0.3, -0.15, 0, 0.15, 0.3].map((sx) => box(0.03, 0.55, 0.03, sx, 0.72, 1.16)),
    box(0.8, 0.04, 0.04, 0, 1.0, 1.16),
    ...[-0.25, 0.25].flatMap((sx) => [box(0.12, 0.05, 1.1, sx, 0, FORK_REACH), box(0.12, 0.4, 0.05, sx, 0.2, 1.2)]),
  ];
  const chains = [-0.2, 0.2].map((sx) => box(0.03, 2.3, 0.02, sx, 1.4, 1.12));
  const lights = [...[-0.4, 0.4].map((sx) => cyl(0.06, 0.04, sx, 2.05, 0.66, 'z'))];
  const rear = [...[-0.45, 0.45].map((sx) => box(0.12, 0.08, 0.02, sx, 0.9, -1.06))];
  parts = {
    body: merge(body),
    dark: merge(dark),
    wheels: merge(wheels),
    hubs: merge(hubs),
    forks: merge(forks),
    chains: merge(chains),
    lights: merge(lights),
    rear: merge(rear),
  };
  return parts;
}

const xmasMats = new Map<number, THREE.MeshBasicMaterial>();
/** Lit materials for the Christmas bulbs (shared, so the parts stay instanced). */
function xmasMat(k: FloorKit, i: number, c: THREE.Color): THREE.MeshBasicMaterial {
  void k;
  let m = xmasMats.get(i);
  if (!m) xmasMats.set(i, (m = new THREE.MeshBasicMaterial({ color: c })));
  return m;
}

/** Materials shared by all forklifts (one set per kit), so their parts can be instanced. */
const mats = new WeakMap<FloorKit, Record<'yellow' | 'black' | 'steel' | 'lights' | 'rear' | 'pallet' | 'load', THREE.Material>>();
const loadGeo = {
  pallet: new THREE.BoxGeometry(1.1, 0.12, 1.0).translate(0, 0.1, FORK_REACH),
  box: new THREE.BoxGeometry(1.0, 0.8, 0.9).translate(0, 0.56, FORK_REACH),
};

export function buildForklift(k: FloorKit, load: number | null): ForkliftModel {
  const p = geometry();
  let M = mats.get(k);
  if (!M) {
    M = {
      yellow: k.std(0xe8b400, 0.45, 0.3, 0xf2c200),
      black: k.std(0x1b1c1f, 0.7, 0.3, 0x2a2c31),
      steel: k.std(0x50555e, 0.4, 0.8, 0x9aa0a8),
      lights: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.7, 1.4) }),
      rear: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.1, 0.05) }),
      pallet: k.std(0x8a6a44, 0.9, 0, 0xc49a6c),
      load: k.std(0xffffff, 0.6, 0, 0xffffff),
    };
    mats.set(k, M);
  }
  const g = new THREE.Group();
  // Every part is instanced across all forklifts.
  const add = (geo: G, mat: THREE.Material, parent: THREE.Object3D = g, color?: number) => k.batch(geo, mat, parent, color);
  k.blobUnder(g, 1.9, 3.6);
  add(p.body!, M.yellow);
  add(p.dark!, M.black);
  add(p.wheels!, M.black);
  add(p.hubs!, M.steel);
  add(p.chains!, M.steel);
  add(p.lights!, M.lights);
  add(p.rear!, M.rear);
  const forks = new THREE.Group();
  forks.position.set(0, 0.15, 0);
  g.add(forks);
  add(p.forks!, M.black, forks);
  if (load !== null) {
    add(loadGeo.pallet, M.pallet, forks);
    add(loadGeo.box, M.load, forks, load);
  }
  // The driver, seated.
  const d = buildHuman(k, { shirt: 0x2f3b6b, trousers: 0x22283f, vest: 0xc8ff3a, helmet: 0xffffff });
  d.root.position.set(0, 0.18, -0.2);
  d.legL.rotation.x = d.legR.rotation.x = -1.4;
  d.legL.position.y = d.legR.position.y = 0.82;
  d.armL.rotation.x = d.armR.rotation.x = -0.9;
  // (No floor shadow for someone on a seat.)
  for (const c of [...d.root.children]) if (c.userData.noInk) d.root.remove(c);
  g.add(d.root);
  if (XMAS) {
    // Christmas: bulbs along the overhead guard (red, green, gold) and a red nose on the mast.
    const bulb = (x: number, z: number) => new THREE.SphereGeometry(0.04, 6, 5).translate(x, 2.25, z);
    const cols = [[1.8, 0.15, 0.1], [0.2, 1.6, 0.3], [1.8, 1.3, 0.2]] as const;
    cols.forEach(([r, gg, bb], c) => {
      const pts: THREE.BufferGeometry[] = [];
      let i = 0;
      for (let z = -0.54; z <= 0.66; z += 0.15) for (const x of [-0.56, 0.56]) if (i++ % 3 === c) pts.push(bulb(x, z));
      for (let x = -0.45; x <= 0.46; x += 0.15) for (const z of [-0.54, 0.66]) if (i++ % 3 === c) pts.push(bulb(x, z));
      add(mergeGeometries(pts)!, xmasMat(k, c, new THREE.Color(r, gg, bb)));
    });
    add(new THREE.SphereGeometry(0.1, 10, 8).translate(0, 2.0, 1.14), xmasMat(k, 3, new THREE.Color(2.2, 0.12, 0.08)));
  }
  const beacon = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), beacon);
  b.position.set(0, 2.32, -0.4);
  g.add(b);
  k.put(g);
  return { g, forks, beacon };
}
