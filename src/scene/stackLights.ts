// Signal towers: the three-colour stack lights on the chutes.
//
// Every chute has one on the loop pillar above its display, and dock chutes one more on the post
// where the chute meets its roller belt. Bottom to top: green (parcels waiting: work to do),
// amber (cleardown: the truck is about to leave), red (a fault: the belt is full). At the
// night party they turn into disco lights, chasing on the beat.
//
// A tower: a round foot and a swivel knuckle, a pale body, three ribbed lens rings and a cap,
// as on a real one. All lens rings of all towers are one instanced mesh (their colours change
// every frame); the pale parts are a second; so all towers together cost two draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** What a tower shows: each lamp on (1), off (0) or in between (fading). */
export interface TowerState {
  green: number;
  amber: number;
  red: number;
}

const LAMPS = [
  new THREE.Color(0.0, 0.85, 0.12), // green, at the bottom
  new THREE.Color(1.0, 0.45, 0.0), // amber
  new THREE.Color(0.95, 0.02, 0.01), // red, at the top
];
/** How a lamp looks when it is off: its coloured lens, unlit. */
const OFF = 0.12;

export class StackLights {
  readonly group = new THREE.Group();
  private readonly lenses: THREE.InstancedMesh;
  private readonly shells: THREE.InstancedMesh;
  private readonly c = new THREE.Color();
  private n = 0;

  /** Room for `max` towers; `shell` is the material of the pale body. */
  constructor(max: number, shell: THREE.Material) {
    // One lens ring: an open cylinder with ribs (vertex colours), 1 unit across, 1 unit high.
    const lens = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 10, true).toNonIndexed();
    const p = lens.attributes.position!;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 0.5;
      const a = Math.atan2(p.getZ(i), p.getX(i));
      // Horizontal ribs, finer vertical facets, and a brighter band in the middle (the bulb).
      const rib = 0.8 + 0.2 * (0.5 + 0.5 * Math.cos(y * Math.PI * 18));
      const facet = 0.92 + 0.08 * Math.cos(a * 24);
      const core = 0.85 + 0.3 * Math.sin(y * Math.PI);
      const v = rib * facet * core;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
    }
    lens.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const lensMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.lenses = new THREE.InstancedMesh(lens, lensMat, max * 3);
    this.lenses.count = 0;
    this.lenses.userData.noInk = true;
    // The pale parts, for a tower 1 unit tall (scaled per tower): foot, knuckle, neck, body
    // below the lamps, the thin white rings between them, and the cap.
    const R = 0.09;
    const parts = [
      new THREE.CylinderGeometry(0.11, 0.12, 0.03, 20).translate(0, 0.015, 0), // foot
      new THREE.CylinderGeometry(0.045, 0.045, 0.06, 12).translate(0, 0.06, 0), // neck
      new THREE.CylinderGeometry(0.06, 0.06, 0.09, 16).rotateZ(Math.PI / 2).translate(0, 0.12, 0), // swivel
      new THREE.CylinderGeometry(R, R, 0.2, 20).translate(0, 0.27, 0), // body
      ...[0.37, 0.56, 0.75].map((y) => new THREE.CylinderGeometry(R + 0.004, R + 0.004, 0.018, 20).translate(0, y + 0.009, 0)),
      new THREE.CylinderGeometry(R + 0.004, R + 0.004, 0.04, 20).translate(0, 0.96, 0), // cap
      new THREE.SphereGeometry(R + 0.004, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.25, 1).translate(0, 0.98, 0),
    ].map((g) => g.toNonIndexed());
    const shellGeo = mergeGeometries(parts)!;
    this.shells = new THREE.InstancedMesh(shellGeo, shell, max);
    this.shells.count = 0;
    this.group.add(this.shells, this.lenses);
  }

  /**
   * Add a tower standing at `at` (the foot), `height` metres tall; returns its number.
   * `tilt` leans it (radians, about the swivel) when it hangs off a wall.
   */
  add(at: THREE.Vector3, height: number, yaw = 0): number {
    const i = this.n++;
    const o = new THREE.Object3D();
    o.position.copy(at);
    o.rotation.y = yaw;
    o.scale.setScalar(height);
    o.updateMatrix();
    this.shells.setMatrixAt(i, o.matrix);
    this.shells.count = this.n;
    // Lens rings: 0.17 tall each, between the white rings (0.388…0.56, 0.578…0.75, 0.768…0.94).
    const R = 0.18;
    [0.388, 0.578, 0.768].forEach((y, k) => {
      const l = new THREE.Object3D();
      l.position.set(0, y + 0.086, 0);
      l.scale.set(R, 0.172, R);
      l.updateMatrix();
      this.lenses.setMatrixAt(i * 3 + k, l.matrix.premultiply(o.matrix));
      this.lenses.setColorAt(i * 3 + k, this.c.copy(LAMPS[k]!).multiplyScalar(OFF));
    });
    this.lenses.count = this.n * 3;
    return i;
  }

  /** Show a tower's state (lamps from 0 off to 1 on; above 1 glows at night). */
  set(i: number, s: TowerState, glow = 1): void {
    const v = [s.green, s.amber, s.red];
    for (let k = 0; k < 3; k++) {
      const on = Math.max(0, Math.min(1.5, v[k]!));
      this.lenses.setColorAt(i * 3 + k, this.c.copy(LAMPS[k]!).multiplyScalar(OFF + on * (1 - OFF) * glow));
    }
  }

  /** At the party: each lamp a colour of its own, chasing up the tower on the beat. */
  disco(i: number, bt: number, kick: number): void {
    for (let k = 0; k < 3; k++) {
      const step = Math.floor(bt * 2) + i;
      const lit = (step % 3) === k ? 1 : 0.15;
      this.c.setHSL(((step * 0.13 + k * 0.33 + i * 0.07) % 1 + 1) % 1, 1, 0.5).multiplyScalar(lit * (1.6 + kick * 1.5));
      this.lenses.setColorAt(i * 3 + k, this.c);
    }
  }

  /** Call once a frame after setting the towers. */
  flush(): void {
    if (this.lenses.instanceColor) this.lenses.instanceColor.needsUpdate = true;
    this.shells.instanceMatrix.needsUpdate = true;
    this.lenses.instanceMatrix.needsUpdate = true;
  }
}
