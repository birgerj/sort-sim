// Static merging: the hall's fixed meshes drawn in far fewer draw calls.
//
// After the scene is built, plain meshes that stand still are merged per parent, material and
// patch of floor (`CELL` metres): one mesh instead of dozens of rails, posts, signs and panels.
// Each render pass (scene, ink, AO, shadows) draws the scene again, so every call saved here is
// saved several times over. Patches keep it cullable: what lies outside the view is still skipped.
//
// It cannot know for sure that nothing will move or hide one of those meshes later (a door, a
// lamp switched in an update), so it keeps the originals and checks them now and then (`check`):
// when one has been moved, hidden, scaled or given another material, its merged group is taken
// apart again and the originals go back, so they behave exactly as before.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Size of a merge patch on the floor (metres). */
const CELL = 24;

interface Member {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: THREE.Vector3;
  visible: boolean;
  material: THREE.Material;
}

interface Merged {
  parent: THREE.Object3D;
  mesh: THREE.Mesh;
  members: Member[];
}

export interface MergeOptions {
  /** Meshes never to merge (their own code shows, hides or moves them). */
  skip: Set<THREE.Object3D>;
  /** Extra key per mesh (e.g. "hangs above the walking height"); meshes only merge with equal keys. */
  extraKey?: (m: THREE.Mesh) => string;
}

export class StaticMerge {
  private groups: Merged[] = [];
  private nextCheck = 0;
  /** Meshes before and after, for the docs and the measure script. */
  stats = { before: 0, after: 0, undone: 0 };

  merge(scene: THREE.Scene, opt: MergeOptions): void {
    scene.updateMatrixWorld(true);
    const buckets = new Map<string, THREE.Mesh[]>();
    const wp = new THREE.Vector3();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!this.mergeable(m, opt.skip)) return;
      const mat = m.material as THREE.Material;
      const g = m.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      wp.copy(g.boundingSphere!.center).applyMatrix4(m.matrixWorld);
      const cell = `${Math.floor(wp.x / CELL)},${Math.floor(wp.z / CELL)}`;
      const attrs = Object.keys(g.attributes).sort().join(',');
      let ud: string;
      try {
        ud = JSON.stringify(m.userData);
      } catch {
        return; // (userData that points at other objects: something drives this mesh)
      }
      if (ud.includes('{"') && /"(uuid|isObject3D)"/.test(ud)) return;
      const flags = [
        m.castShadow ? 'c' : '',
        m.receiveShadow ? 'r' : '',
        m.layers.mask,
        m.renderOrder,
        m.frustumCulled ? 'f' : '',
        ud,
        g.index ? 'i' : 'n',
        attrs,
        opt.extraKey?.(m) ?? '',
      ].join('|');
      const key = `${m.parent!.uuid}|${mat.uuid}|${cell}|${flags}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(m);
    });
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const parent = list[0]!.parent!;
      const geos: THREE.BufferGeometry[] = [];
      for (const m of list) {
        m.updateMatrix();
        geos.push(m.geometry.clone().applyMatrix4(m.matrix));
      }
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const first = list[0]!;
      const mesh = new THREE.Mesh(merged, first.material);
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = first.receiveShadow;
      mesh.layers.mask = first.layers.mask;
      mesh.renderOrder = first.renderOrder;
      mesh.frustumCulled = first.frustumCulled;
      mesh.userData = { ...first.userData, merged: true };
      mesh.name = 'merged';
      const members: Member[] = list.map((m) => ({
        mesh: m,
        pos: m.position.clone(),
        quat: m.quaternion.clone(),
        scale: m.scale.clone(),
        visible: m.visible,
        material: m.material as THREE.Material,
      }));
      for (const m of list) parent.remove(m);
      parent.add(mesh);
      mesh.updateMatrixWorld(true);
      this.groups.push({ parent, mesh, members });
      this.stats.before += list.length;
      this.stats.after++;
    }
  }

  /** Once a second or so: take apart any merged group one of whose originals has changed. */
  check(time: number): boolean {
    if (time < this.nextCheck) return false;
    this.nextCheck = time + 1;
    let changed = false;
    this.groups = this.groups.filter((g) => {
      const moved = g.members.some(
        (e) =>
          e.mesh.visible !== e.visible ||
          e.mesh.material !== e.material ||
          !e.mesh.position.equals(e.pos) ||
          !e.mesh.quaternion.equals(e.quat) ||
          !e.mesh.scale.equals(e.scale) ||
          e.mesh.parent !== null,
      );
      if (!moved) return true;
      this.undo(g);
      changed = true;
      return false;
    });
    return changed;
  }

  private undo(g: Merged): void {
    g.parent.remove(g.mesh);
    g.mesh.geometry.dispose();
    for (const e of g.members) if (!e.mesh.parent) g.parent.add(e.mesh);
    this.stats.after--;
    this.stats.before -= g.members.length;
    this.stats.undone++;
  }

  private mergeable(m: THREE.Mesh, skip: Set<THREE.Object3D>): boolean {
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return false;
    if (!m.parent || !m.visible || skip.has(m)) return false;
    // (Geometry groups only matter with a list of materials: boxes and cylinders carry them anyway.)
    if (Array.isArray(m.material) || Object.keys(m.geometry.morphAttributes).length) return false;
    if (m.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return false;
    const mat = m.material as THREE.Material;
    // See-through things are drawn back to front one by one: merged they would sort wrongly.
    if (mat.transparent) return false;
    // Lines, points and sprites are not meshes; a mesh with children carries them along when it moves.
    if (m.children.length) return false;
    return true;
  }
}
