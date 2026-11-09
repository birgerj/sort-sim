// People: one skinned mesh per person that follows the joints.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/scene/textures', () => ({ hiVis: () => null, canvasTexture: () => null }));

import { buildHuman } from '../src/scene/people';
import { settle } from '../src/scene/motion';
import type { FloorKit } from '../src/scene/floor';

const kit = {
  std: () => new THREE.MeshStandardMaterial(),
  blobUnder: () => undefined,
  put: () => undefined,
} as unknown as FloorKit;

describe('people', () => {
  it('is one skinned mesh with weights that add up to one', () => {
    const h = buildHuman(kit, { shirt: 0x2f3b6b, trousers: 0x22283f, vest: 0xc8ff3a, helmet: 0xffffff, hairStyle: 2 });
    const meshes = h.root.children.filter((o) => (o as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh[];
    expect(meshes.length).toBe(1);
    const w = meshes[0]!.geometry.attributes.skinWeight as THREE.BufferAttribute;
    for (let i = 0; i < w.count; i += 97) expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 4);
    expect(meshes[0]!.skeleton.bones.length).toBe(19);
  });

  it('a bent knee takes the shin and boot with it, and bends the skin smoothly', () => {
    const h = buildHuman(kit, { shirt: 0x2f3b6b, trousers: 0x22283f });
    const body = h.root.children.find((o) => (o as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
    const pos = body.geometry.attributes.position as THREE.BufferAttribute;
    // Left leg points: one at the ankle, one on the knee, one up the thigh.
    const pick = (y: number) => {
      let best = -1;
      let d = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const dd = Math.abs(pos.getY(i) - y) + Math.abs(pos.getX(i) + 0.085) * 0.3 + Math.abs(pos.getZ(i) - 0.06);
        if (pos.getX(i) < -0.02 && dd < d) [best, d] = [i, dd];
      }
      return best;
    };
    const ankle = pick(0.12);
    const knee = pick(0.5);
    const thigh = pick(0.75);
    const rest = [ankle, knee, thigh].map((i) => new THREE.Vector3().fromBufferAttribute(pos, i));
    h.kneeL.rotation.x = 1.4;
    h.root.updateMatrixWorld(true);
    body.skeleton.update();
    const bent = [ankle, knee, thigh].map((i) => body.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(pos, i)));
    expect(bent[0]!.z).toBeLessThan(rest[0]!.z - 0.25);
    expect(bent[0]!.y).toBeGreaterThan(rest[0]!.y + 0.2);
    expect(bent[2]!.distanceTo(rest[2]!)).toBeLessThan(0.005);
    // The knee moves, but less than the ankle: no crease, no gap.
    const kd = bent[1]!.distanceTo(rest[1]!);
    expect(kd).toBeLessThan(bent[0]!.distanceTo(rest[0]!));
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
    const depth = (h: typeof a) => {
      const body = h.root.children.find((o) => (o as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
      // The front of the belly (the cap's peak and the boots stick out further).
      const pos = body.geometry.attributes.position as THREE.BufferAttribute;
      let z = 0;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.98 && pos.getY(i) < 1.12 && Math.abs(pos.getX(i)) < 0.05) z = Math.max(z, pos.getZ(i));
      return z;
    };
    expect(depth(a)).toBeGreaterThan(depth(b));
  });

  it('stands on its boots: the soles touch the floor', () => {
    const h = buildHuman(kit, { shirt: 0x2f3b6b, trousers: 0x22283f, build: { height: 1, width: 1, belly: 0 } });
    const body = h.root.children.find((o) => (o as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
    body.geometry.computeBoundingBox();
    expect(body.geometry.boundingBox!.min.y).toBeGreaterThan(-0.01);
    expect(body.geometry.boundingBox!.min.y).toBeLessThan(0.01);
    // The boots reach forward of the shins (toes).
    expect(body.geometry.boundingBox!.max.z).toBeGreaterThan(0.17);
  });
});
