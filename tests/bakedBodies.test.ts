// The bodies baked at build time read back as the same meshes as when made in the browser.
import { describe, expect, it } from 'vitest';
import { bodyKey, decodeBodies, encodeBodies, REST_SPREAD } from '../src/scene/bakedBodies';
import { buildBody } from '../src/scene/bodySdf';

describe('baked bodies', () => {
  it('read back like the ones made in place', () => {
    const file = encodeBodies();
    const got = decodeBodies(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
    const want = buildBody(1.02, 0.45, REST_SPREAD, 'coarse');
    const g = got.get(bodyKey(1.02, 0.45, 'coarse'))!;
    expect(g.index!.count).toBe(want.index!.count);
    for (const name of ['position', 'part', 'skinIndex']) {
      const a = g.attributes[name]!;
      const b = want.attributes[name]!;
      expect(a.count).toBe(b.count);
      for (let i = 0; i < a.count; i += 37) expect(a.getX(i)).toBeCloseTo(b.getX(i), 5);
    }
    // Packed to bytes: normals, colours and weights within a byte's step.
    for (const name of ['normal', 'color', 'skinWeight']) {
      const a = g.attributes[name]!;
      const b = want.attributes[name]!;
      for (let i = 0; i < a.count; i += 37) expect(Math.abs(a.getY(i) - b.getY(i))).toBeLessThan(0.01);
    }
  });
});
