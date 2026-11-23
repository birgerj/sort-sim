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
  /** Per part: where it was last drawn (place and two terms of its turn), and whether it has moved since it was first drawn. */
  last: Float32Array | null;
  moved: Uint8Array | null;
  /** Per part: 1 when it belongs to something that can move (worked out once, see `onlyStill`). */
  mobile: Uint8Array | null;
}

/** The matrix elements compared to see whether a part moved: its place, and two that change with any turn. */
const WATCHED = [12, 13, 14, 0, 10];

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
      b = { geo, mat, proxies: [], colors: [], mesh: null, noInk, last: null, moved: null, mobile: null };
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

  /**
   * Bring the scene graph's world matrices up to date (the one walk per frame: the scene's
   * own automatic update is off) and copy the proxies' world matrices. Call after the models
   * are posed, just before drawing.
   */
  update(): void {
    this.root.updateMatrixWorld();
    for (const b of this.list) {
      const m = b.mesh;
      if (!m) continue;
      const first = !b.last;
      const last = (b.last ??= new Float32Array(b.proxies.length * WATCHED.length));
      const moved = (b.moved ??= new Uint8Array(b.proxies.length));
      b.proxies.forEach((p, i) => {
        const shown = this.shown(p);
        m.setMatrixAt(i, shown ? p.matrixWorld : HIDDEN);
        // Has it moved since it was last in sight? (Being hidden for a while is not moving.)
        if (!shown) return;
        const e = p.matrixWorld.elements;
        let o = i * WATCHED.length;
        let differs = false;
        for (const k of WATCHED) {
          if (Math.abs(last[o]! - e[k]!) > 1e-4) differs = true;
          last[o++] = e[k]!;
        }
        if (differs && !first && !moved[i] && this.frames > 2) {
          moved[i] = 1;
          this.flips++;
        }
      });
      m.instanceMatrix.needsUpdate = true;
    }
    this.frames++;
  }

  /**
   * How many parts have been seen moving for the first time: when this number grows, something
   * that stood still until now turned out to be movable.
   */
  flips = 0;
  private frames = 0;

  /** The instanced meshes the parts are drawn with. */
  meshes(): THREE.InstancedMesh[] {
    return this.list.flatMap((b) => (b.mesh ? [b.mesh] : []));
  }

  /**
   * For a picture of what stands still (the baked shade): hides every part that has moved, and
   * every part of something `mobile` says can move even if it has not yet. Returns the way back.
   */
  onlyStill(mobile: (part: THREE.Object3D) => boolean): () => void {
    for (const b of this.list) {
      const m = b.mesh;
      if (!m) continue;
      const mob = (b.mobile ??= Uint8Array.from(b.proxies, (p) => (mobile(p) ? 1 : 0)));
      b.proxies.forEach((_, i) => {
        if (mob[i] || b.moved?.[i]) m.setMatrixAt(i, HIDDEN);
      });
      m.instanceMatrix.needsUpdate = true;
    }
    return () => {
      for (const b of this.list) {
        const m = b.mesh;
        if (!m) continue;
        b.proxies.forEach((p, i) => m.setMatrixAt(i, this.shown(p) ? p.matrixWorld : HIDDEN));
        m.instanceMatrix.needsUpdate = true;
      }
    };
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
