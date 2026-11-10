// People: three detail levels by distance, each the body under the clothes plus the rigid
// gear, all skinned to one skeleton that follows the joints.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/scene/textures', () => ({ hiVis: () => null, canvasTexture: () => null }));

import { buildHuman, LOD_DIST, REST_SPREAD, type Human } from '../src/scene/people';
import { buildBody } from '../src/scene/bodySdf';
import { settle } from '../src/scene/motion';
import type { FloorKit } from '../src/scene/floor';

const kit = {
  std: () => new THREE.MeshStandardMaterial(),
  blobUnder: () => undefined,
  put: () => undefined,
} as unknown as FloorKit;

/** The LOD, and a level's body and gear meshes (0 close … 2 far). */
const lodOf = (h: Human) => h.root.children.find((o) => (o as THREE.LOD).isLOD) as THREE.LOD;
const level = (h: Human, i: number) => {
  const [body, gear] = lodOf(h).levels[i]!.object.children as THREE.SkinnedMesh[];
  return { body: body!, gear: gear! };
};
const weightsSumToOne = (g: THREE.BufferGeometry) => {
  const w = g.attributes.skinWeight as THREE.BufferAttribute;
  for (let i = 0; i < w.count; i += 37) expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 4);
};
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position!.count) / 3;

describe('people', () => {
  it('has three levels by distance, two meshes each, on one skeleton', () => {
    const h = buildHuman(kit, { shirt: 0x2f3b6b, trousers: 0x22283f, vest: 0xc8ff3a, helmet: 0xffffff, hairStyle: 2 });
    const lod = lodOf(h);
    expect(lod.levels.map((l) => l.distance)).toEqual([LOD_DIST.fine, LOD_DIST.coarse, LOD_DIST.far]);
    const skeleton = level(h, 0).body.skeleton;
    expect(skeleton.bones.length).toBe(19);
    for (let i = 0; i < 3; i++) {
      const { body, gear } = level(h, i);
      expect(body.skeleton).toBe(skeleton);
      expect(gear.skeleton).toBe(skeleton);
      weightsSumToOne(body.geometry);
      weightsSumToOne(gear.geometry);
    }
    // Further away, fewer triangles (the close level shows the coarse body until its fine one is built).
    expect(tris(level(h, 2).body.geometry)).toBeLessThan(tris(level(h, 1).body.geometry));
    expect(tris(level(h, 2).gear.geometry)).toBeLessThan(tris(level(h, 1).gear.geometry));
    expect(tris(level(h, 1).gear.geometry)).toBeLessThan(tris(level(h, 0).gear.geometry));
  });

  it('people of one build share their body mesh', () => {
    const a = buildHuman(kit, { shirt: 0x2f3b6b, trousers: 0x22283f, build: { height: 1, width: 1.02, belly: 0 } });
    const b = buildHuman(kit, { shirt: 0x7a2f2f, trousers: 0x22283f, vest: 0xc8ff3a, build: { height: 1.05, width: 1.0, belly: 0.1 } });
    expect(level(a, 1).body.geometry).toBe(level(b, 1).body.geometry);
    // ...but each wears their own clothes.
    expect(level(a, 1).body.material).not.toBe(level(b, 1).body.material);
  });

  it('a bent knee takes the shin with it, and bends the skin smoothly', () => {
    const h = buildHuman(kit, { shirt: 0x2f3b6b, trousers: 0x22283f, build: { height: 1, width: 1.02, belly: 0 } });
    const { body } = level(h, 1);
    const pos = body.geometry.attributes.position as THREE.BufferAttribute;
    // Left leg points: at the front of the shin, of the knee, of the thigh.
    const hipX = h.legL.position.x;
    const pick = (y: number) => {
      let best = -1;
      let d = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const dd = Math.abs(pos.getY(i) - y) + Math.abs(pos.getX(i) - hipX) * 0.5 - pos.getZ(i) * 0.5;
        if (pos.getX(i) < -0.02 && dd < d) [best, d] = [i, dd];
      }
      return best;
    };
    const ids = [pick(0.2), pick(0.5), pick(0.78)];
    const rest = ids.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i));
    h.kneeL.rotation.x = 1.4;
    h.root.updateMatrixWorld(true);
    body.skeleton.update();
    const bent = ids.map((i) => body.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(pos, i)));
    expect(bent[0]!.z).toBeLessThan(rest[0]!.z - 0.2);
    expect(bent[0]!.y).toBeGreaterThan(rest[0]!.y + 0.15);
    expect(bent[2]!.distanceTo(rest[2]!)).toBeLessThan(0.01);
    // The knee moves, but less than the shin: no crease, no gap.
    expect(bent[1]!.distanceTo(rest[1]!)).toBeLessThan(bent[0]!.distanceTo(rest[0]!));
  });

  it('the arms are built clear of the body below the armpit (close level)', () => {
    const pos = buildBody(1.02, 0, REST_SPREAD, 'fine').attributes.position as THREE.BufferAttribute;
    // At elbow height, there is a gap between the arm and the waist: no surface near |x| 0.17 at the front.
    let inGap = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), ax = Math.abs(pos.getX(i)), z = pos.getZ(i);
      if (y > 1.05 && y < 1.12 && ax > 0.163 && ax < 0.173 && Math.abs(z) < 0.02) inGap++;
    }
    expect(inGap).toBe(0);
  });

  it('blinks now and then, and opens its mouth when talking', () => {
    const h = buildHuman(kit, { shirt: 0x2f3b6b, trousers: 0x22283f });
    let lid = 1;
    let open = 0;
    for (let i = 0; i < 600; i++) {
      h.m.talk = i > 300 ? 1 : 0;
      settle(h, 1 / 60);
      lid = Math.min(lid, h.eyes.scale.y);
      if (i < 300) expect(h.mouth.scale.y).toBeCloseTo(1, 3);
      else open = Math.max(open, h.mouth.scale.y);
    }
    expect(lid).toBeLessThan(0.3);
    expect(open).toBeGreaterThan(1.8);
  });

  it('people differ in build, and a given build is kept', () => {
    const a = buildHuman(kit, { shirt: 0x2f3b6b, trousers: 0x22283f, build: { height: 1.08, width: 1.15, belly: 1 } });
    const b = buildHuman(kit, { shirt: 0x2f3b6b, trousers: 0x22283f, build: { height: 0.94, width: 0.9, belly: 0 } });
    expect(a.root.scale.y).toBeCloseTo(1.08);
    expect(b.root.scale.y).toBeCloseTo(0.94);
    expect(a.armR.position.x).toBeGreaterThan(b.armR.position.x);
    const belly = (h: Human) => {
      const pos = level(h, 1).body.geometry.attributes.position as THREE.BufferAttribute;
      let z = 0;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 1.0 && pos.getY(i) < 1.12 && Math.abs(pos.getX(i)) < 0.05) z = Math.max(z, pos.getZ(i));
      return z;
    };
    expect(belly(a)).toBeGreaterThan(belly(b) + 0.02);
  });

  it('stands on its boots: the soles touch the floor', () => {
    const h = buildHuman(kit, { shirt: 0x2f3b6b, trousers: 0x22283f, build: { height: 1, width: 1, belly: 0 } });
    const g = level(h, 0).gear.geometry;
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeGreaterThan(-0.01);
    expect(g.boundingBox!.min.y).toBeLessThan(0.01);
  });

  it('a badge lies on the chest, not inside it or floating', () => {
    const h = buildHuman(kit, { shirt: 0x2f3b6b, trousers: 0x22283f, build: { height: 1, width: 1.02, belly: 0 } });
    const body = level(h, 1).body.geometry.attributes.position as THREE.BufferAttribute;
    const gear = level(h, 1).gear.geometry.attributes.position as THREE.BufferAttribute;
    // The badge: the front-most gear points at chest height near the middle.
    let badge = -1;
    for (let i = 0; i < gear.count; i++) if (gear.getY(i) > 1.27 && gear.getY(i) < 1.33 && Math.abs(gear.getX(i)) < 0.02) badge = Math.max(badge, gear.getZ(i));
    let chest = -1;
    for (let i = 0; i < body.count; i++) if (body.getY(i) > 1.27 && body.getY(i) < 1.33 && Math.abs(body.getX(i)) < 0.03) chest = Math.max(chest, body.getZ(i));
    expect(badge).toBeGreaterThan(chest - 0.01);
    expect(badge).toBeLessThan(chest + 0.03);
  });

  it('raising the arms leaves the flanks below the armpit in place', () => {
    const h = buildHuman(kit, { shirt: 0x2f3b6b, trousers: 0x22283f, vest: 0xc8ff3a, build: { height: 1, width: 1.02, belly: 0 } });
    const { body } = level(h, 1);
    h.armL.rotation.x = h.armR.rotation.x = -1.2;
    h.root.updateMatrixWorld(true);
    body.skeleton.update();
    const pos = body.geometry.attributes.position as THREE.BufferAttribute;
    let worst = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = new THREE.Vector3().fromBufferAttribute(pos, i);
      if (r.y > 1.18 || Math.abs(r.x) > 0.17) continue;
      worst = Math.max(worst, body.applyBoneTransform(i, r.clone()).distanceTo(r));
    }
    expect(worst).toBeLessThan(0.03);
  });

  it('the helmet sits over the head and hair, with room to spare (no head through the shell)', () => {
    for (const style of [0, 1, 2]) {
      const h = buildHuman(kit, { shirt: 0x555555, trousers: 0x22283f, vest: 0xc8ff3a, helmet: 0xfafafa, hairStyle: style, hair: 0x6a4a2a, skin: 0xd09a7a, build: { width: 1.02, belly: 0, height: 1 } });
      const g = level(h, 0).gear.geometry;
      const pos = g.attributes.position as THREE.BufferAttribute, col = g.attributes.color as THREE.BufferAttribute;
      const white = (i: number) => col.getX(i) > 0.8 && col.getY(i) > 0.8 && col.getZ(i) > 0.8;
      const dark = (i: number) => col.getX(i) < 0.2 && col.getY(i) < 0.2 && col.getZ(i) < 0.25;
      // Per direction from the middle of the crown: the furthest head or hair point, the nearest helmet point.
      const o = new THREE.Vector3(0, 0.92 + 0.8, -0.006);
      const head = new Map<string, number>(), shell = new Map<string, number>();
      const key = (v: THREE.Vector3) => Math.round(Math.atan2(v.x, v.z) / 0.09) + ',' + Math.round(Math.asin(v.y / v.length()) / 0.09);
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).sub(o);
        if (v.y < 0.02) continue;
        const k = key(v);
        if (white(i)) shell.set(k, Math.min(shell.get(k) ?? 9, v.length()));
        else if (!dark(i)) head.set(k, Math.max(head.get(k) ?? 0, v.length()));
      }
      let margin = 9;
      for (const [k, r] of head) if (shell.has(k)) margin = Math.min(margin, shell.get(k)! - r);
      expect(margin).toBeGreaterThan(0.01);
    }
  });
});
