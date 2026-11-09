// People's motion: the IK puts hands and feet where they should go.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/scene/textures', () => ({ hiVis: () => null, canvasTexture: () => null }));

import { buildHuman, type Human } from '../src/scene/people';
import { crouch, gait, reach, settle } from '../src/scene/motion';
import type { FloorKit } from '../src/scene/floor';

// A kit that only builds the joints (no batches, no scene).
const kit = {
  std: () => new THREE.MeshBasicMaterial(),
  batch: (_g: THREE.BufferGeometry, _m: THREE.Material, parent: THREE.Object3D) => {
    const o = new THREE.Object3D();
    parent.add(o);
    return o;
  },
  blobUnder: () => undefined,
  put: () => undefined,
} as unknown as FloorKit;

const person = (): Human => {
  const h = buildHuman(kit, { shirt: 0x2f3b6b, trousers: 0x22283f, vest: 0xc8ff3a, helmet: 0xffffff });
  h.root.updateMatrixWorld(true);
  return h;
};

/** Middle of the palm, and the ankle, in the world. */
const palm = (h: Human, side: 'L' | 'R') => (side === 'L' ? h.handL : h.handR).localToWorld(new THREE.Vector3(0, -0.035, 0));
const ankle = (h: Human, side: 'L' | 'R') => (side === 'L' ? h.footL : h.footR).getWorldPosition(new THREE.Vector3());

describe('motion', () => {
  it('reach puts the palm on the target', () => {
    for (const [x, y, z] of [
      [0.15, 1.0, 0.4],
      [-0.2, 1.1, 0.35],
      [0.3, 0.95, 0.2],
      [0.0, 1.3, 0.45],
    ] as const) {
      const h = person();
      h.root.rotation.y = 0.8;
      h.root.position.set(3, 0, -2);
      h.root.updateMatrixWorld(true);
      const t = h.root.localToWorld(new THREE.Vector3(x, y, z));
      for (const side of ['L', 'R'] as const) {
        // (Only where the arm is long enough.)
        if ((side === 'L' ? h.armL : h.armR).getWorldPosition(new THREE.Vector3()).distanceTo(t) > 0.58) continue;
        reach(h, side, t, 1);
        h.root.updateMatrixWorld(true);
        expect(palm(h, side).distanceTo(t)).toBeLessThan(0.01);
      }
    }
  });

  it('elbows bend outwards and down, never up through the chest', () => {
    const h = person();
    const t = new THREE.Vector3(0.12, 1.0, 0.35);
    reach(h, 'R', t, 1);
    h.root.updateMatrixWorld(true);
    const elbow = h.foreR.getWorldPosition(new THREE.Vector3());
    const shoulder = h.armR.getWorldPosition(new THREE.Vector3());
    expect(elbow.y).toBeLessThan(shoulder.y);
    expect(elbow.x).toBeGreaterThan(0.12);
  });

  it('crouching keeps the feet where they were', () => {
    const h = person();
    gait(h, 0.016, 0, 0);
    settle(h, 0.016, { idle: 0 });
    h.root.updateMatrixWorld(true);
    const before = ankle(h, 'L');
    gait(h, 0.016, 0, 0);
    crouch(h, 0.6);
    settle(h, 0.016, { idle: 0 });
    h.root.updateMatrixWorld(true);
    expect(ankle(h, 'L').distanceTo(before)).toBeLessThan(0.01);
    expect(h.pelvis.position.y).toBeLessThan(0.92 - 0.15);
    expect(h.kneeL.rotation.x).toBeGreaterThan(0.5);
  });

  it('feet stay flat while walking (apart from the roll from heel to toe)', () => {
    const h = person();
    for (let i = 0; i < 120; i++) {
      gait(h, 0.016, i * 0.05, 0.7);
      settle(h, 0.016);
    }
    h.root.updateMatrixWorld(true);
    const pitch = h.legL.rotation.x + h.kneeL.rotation.x + h.footL.rotation.x;
    expect(Math.abs(pitch)).toBeLessThan(0.45);
  });

  it('standing still keeps both feet on the floor (no stepping in place)', () => {
    const h = person();
    let lo = Infinity;
    let hi = -Infinity;
    for (let f = 0; f < 240; f++) {
      const bt = f / 30;
      gait(h, 1 / 60, Math.PI * bt, 0);
      settle(h, 1 / 60);
      if (f < 120) continue;
      h.root.updateMatrixWorld(true);
      for (const s of ['L', 'R'] as const) {
        const y = ankle(h, s).y;
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
    expect(hi - lo).toBeLessThan(0.01);
  });

  it('a fast walk takes more steps, never the splits', () => {
    const h = person();
    let most = 0;
    for (let f = 0; f < 600; f++) {
      const bt = f / 60;
      gait(h, 1 / 60, Math.PI * bt, 2.4);
      settle(h, 1 / 60);
      if (f < 120) continue;
      h.root.updateMatrixWorld(true);
      most = Math.max(most, Math.abs(ankle(h, 'L').z - ankle(h, 'R').z));
    }
    // Two steps' worth at most, well short of a split.
    expect(most).toBeLessThan(1.0);
  });
});

