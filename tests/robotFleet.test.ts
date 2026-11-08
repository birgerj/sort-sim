import { describe, expect, it } from 'vitest';
import { Fleet, PARK_COLS, sorterFloor } from '../src/sim/robotFleet';
import { Rng } from '../src/sim/rng';

describe('robot fleet', () => {
  const cols = Array.from({ length: 20 }, (_, k) => PARK_COLS + 2 + 4 * k);

  it('reaches every bin and station along the lanes', () => {
    const { grid, parks, stations, bins } = sorterFloor(cols);
    new Fleet(grid, parks, stations, bins, 0);
    for (const s of stations) for (const b of bins) for (const a of b.access) expect(grid.route(s, a)).not.toBeNull();
    for (const b of bins) for (const a of b.access) for (const p of parks) expect(grid.route(a, p)).not.toBeNull();
  });

  it('keeps delivering without collisions or robots stuck for long', () => {
    const { grid, parks, stations, bins } = sorterFloor(cols);
    const rng = new Rng(7);
    const fleet = new Fleet(grid, parks, stations, bins, 40, () => rng.next());
    const queue = stations.map(() => 0);
    const since = fleet.bots.map(() => 0);
    let delivered = 0;
    for (let beat = 0; beat < 4000; beat++) {
      if (beat % 2 === 0) queue[beat % queue.length]! < 3 && queue[beat % queue.length]!++;
      const ev = fleet.step(beat, (s) => queue[s]! > 0, beat % 4 === 1 || beat % 4 === 3);
      for (const e of ev) {
        if (e.t === 'load') queue[e.station]!--;
        if (e.t === 'dropped') delivered++;
      }
      const seen = new Set<number>();
      for (const b of fleet.bots) {
        const id = grid.id(b.i, b.j);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        const moved = b.i !== b.fi || b.j !== b.fj;
        since[b.k] = moved || b.state === 'idle' || b.state === 'loading' || b.state === 'dropping' ? 0 : since[b.k]! + 1;
        expect(since[b.k]).toBeLessThan(60);
      }
    }
    // (Robots now park together at the west end, so trips are longer than with bays by the boxes.)
    expect(delivered).toBeGreaterThan(800);
  });

  it('takes small parcels to the manual sort drop and drives on', () => {
    const { grid, parks, stations, bins } = sorterFloor(cols);
    const rng = new Rng(3);
    const fleet = new Fleet(grid, parks, stations, bins, 40, () => rng.next());
    const table = bins.findIndex((b) => b.manual);
    fleet.choose = (k) => (k % 5 === 0 ? table : null);
    const queue = stations.map(() => 0);
    let toTable = 0;
    for (let beat = 0; beat < 3000; beat++) {
      if (beat % 2 === 0) queue[beat % queue.length]! < 3 && queue[beat % queue.length]!++;
      for (const e of fleet.step(beat, (s) => queue[s]! > 0, beat % 4 === 1 || beat % 4 === 3)) {
        if (e.t === 'load') queue[e.station]!--;
        if (e.t === 'dropped' && e.bin === table) toTable++;
      }
      for (const b of fleet.bots) if (b.state !== 'idle') expect(b.blocked).toBeLessThan(40);
    }
    expect(toTable).toBeGreaterThan(20);
  });
});
