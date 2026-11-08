// Instancing for repeated models (robots, people, forklifts, roll cages).
//
// A model is still built as a hierarchy of groups, so it can be animated as
// before (a robot's top, a worker's arms), but its parts are invisible proxy
// objects. Every frame, each proxy's world matrix is copied into one
// InstancedMesh per geometry + material (+ tint): all robot bodies, all wheels,
// all heads... are drawn with a single draw call each.
import * as THREE from 'three';

interface Batch {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  proxies: THREE.Object3D[];
  colors: (THREE.Color | null)[];
  mesh: THREE.InstancedMesh | null;
  noInk: boolean;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class Batcher {
  private batches = new Map<string, Batch>();
  private list: Batch[] = [];

  constructor(private root: THREE.Object3D) {}

  /**
   * Add a part: returns an (invisible) proxy, already attached to `parent`.
   * With `color`, the part is tinted per instance (use a white material).
   */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, color?: THREE.ColorRepresentation, noInk = false): THREE.Object3D {
    const key = `${geo.uuid}|${mat.uuid}|${noInk ? 1 : 0}`;
    let b = this.batches.get(key);
    if (!b) {
      b = { geo, mat, proxies: [], colors: [], mesh: null, noInk };
      this.batches.set(key, b);
      this.list.push(b);
    }
    const p = new THREE.Object3D();
    p.userData.batched = true;
    if (noInk) p.userData.noInk = true;
    parent.add(p);
    b.proxies.push(p);
    b.colors.push(color === undefined ? null : new THREE.Color(color));
    if (b.mesh) throw new Error('Batcher: add() after build()');
    return p;
  }

  /** Create the instanced meshes (once all parts are added). */
  build(): void {
    for (const b of this.list) {
      const m = new THREE.InstancedMesh(b.geo, b.mat, b.proxies.length);
      m.frustumCulled = false;
      if (b.colors.some((c) => c)) {
        b.colors.forEach((c, i) => m.setColorAt(i, c ?? new THREE.Color(1, 1, 1)));
      }
      if (b.noInk) m.userData.noInk = true;
      b.mesh = m;
      this.root.add(m);
    }
  }

  /** Count of draw calls the batches replace (for the docs and checks). */
  stats(): { batches: number; parts: number } {
    return { batches: this.list.length, parts: this.list.reduce((a, b) => a + b.proxies.length, 0) };
  }

  /** Copy the proxies' world matrices (call after the models are posed). */
  update(): void {
    this.root.updateMatrixWorld();
    for (const b of this.list) {
      const m = b.mesh;
      if (!m) continue;
      b.proxies.forEach((p, i) => m.setMatrixAt(i, this.shown(p) ? p.matrixWorld : HIDDEN));
      m.instanceMatrix.needsUpdate = true;
    }
  }

  /** Visible all the way up to the scene (and still attached)? */
  private shown(o: THREE.Object3D): boolean {
    let x: THREE.Object3D | null = o;
    while (x) {
      if (!x.visible) return false;
      if (x === this.root) return true;
      x = x.parent;
    }
    return false;
  }
}
