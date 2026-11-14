// Ten Shifts: two rules of the score model that an audit found broken and that must stay fixed.
// 1. The trailer, its swap and the belt belong to the door and the city, not to the block: cutting a
//    block in two (or writing two blocks that follow each other as one) is the same plan.
// 2. Full is full: a parcel that finds no belt, table or buffer place is refused for the night.
import { describe, expect, it } from 'vitest';
import type { Block, Level, Plan } from '../src/shifts/contract';
import { LEVELS, checkPlan, simulate } from '../src/shifts/model';
import golden from './fixtures/shifts/golden.json';
import best1 from '../tools/balance/best/level1.json';
import best2 from '../tools/balance/best/level2.json';
import best3 from '../tools/balance/best/level3.json';
import best4 from '../tools/balance/best/level4.json';
import best5 from '../tools/balance/best/level5.json';
import best6 from '../tools/balance/best/level6.json';
import best7 from '../tools/balance/best/level7.json';
import best8 from '../tools/balance/best/level8.json';
import best9 from '../tools/balance/best/level9.json';
import best10 from '../tools/balance/best/level10.json';

const level = (id: number): Level => LEVELS.find((l) => l.id === id)!;
const PLANS: { level: number; name: string; plan: Plan }[] = [
  ...(golden as unknown as { level: number; name: string; plan: Plan }[]),
  ...([best1, best2, best3, best4, best5, best6, best7, best8, best9, best10] as unknown as Plan[]).map((plan, i) => ({ level: i + 1, name: 'best', plan })),
];

const sameCrew = (a: Block, b: Block): boolean => a.city === b.city && a.people === b.people;
const twins = (a: Block, b: Block): boolean => sameCrew(a, b) && a.docks === b.docks && a.start === b.start;

/** Every cut of one block on the half hour that leaves no doubt which piece goes on at which door:
 *  no other block of that city with the same crew starts or ends at the cut, and the block has no twin. */
function cuts(plan: Plan): Plan[] {
  const out: Plan[] = [];
  plan.blocks.forEach((b, j) => {
    for (let t = Math.ceil((b.start + 60) / 30) * 30; t <= b.end - 60; t += 30) {
      if (plan.blocks.some((o, k) => k !== j && sameCrew(o, b) && (o.start === t || o.end === t || twins(o, b)))) continue;
      const blocks = plan.blocks.map((x) => ({ ...x }));
      blocks[j]!.end = t;
      blocks.push({ ...b, start: t });
      out.push({ ...plan, blocks });
    }
  });
  return out;
}

/** The same plan with blocks that follow each other (same city, crew and docks) written as one. */
function merged(plan: Plan): Plan {
  const blocks = plan.blocks.map((x) => ({ ...x }));
  for (let again = true; again; ) {
    again = false;
    for (const a of blocks) {
      const next = blocks.filter((b) => b !== a && sameCrew(a, b) && b.start === a.end);
      const ending = blocks.filter((b) => sameCrew(a, b) && b.end === a.end);
      const twin = blocks.some((b) => b !== a && twins(a, b));
      if (next.length === 1 && ending.length === 1 && next[0]!.docks === a.docks && !twin) {
        a.end = next[0]!.end;
        blocks.splice(blocks.indexOf(next[0]!), 1);
        again = true;
        break;
      }
    }
  }
  return { ...plan, blocks };
}

describe('a block cut in two is the same plan', () => {
  for (const { level: id, name, plan } of PLANS) {
    it(`level ${id} ${name}`, () => {
      const lv = level(id);
      const whole = simulate(lv, plan).profit;
      for (const cut of cuts(plan)) {
        expect(checkPlan(lv, cut)).toEqual([]);
        expect(Math.abs(simulate(lv, cut).profit - whole)).toBeLessThan(1e-9);
      }
      expect(Math.abs(simulate(lv, merged(plan)).profit - whole)).toBeLessThan(1e-9);
    });
  }

  it('no trailer swap is skipped by cutting (level 2, one dock all night)', () => {
    const lv = level(2);
    const one: Plan = { blocks: [{ city: 0, start: 0, end: 180, people: 2, docks: 1 }], robotCities: [], robots: 0 };
    const three: Plan = { ...one, blocks: [0, 60, 120].map((start) => ({ city: 0, start, end: start + 60, people: 2 as const, docks: 1 })) };
    expect(simulate(lv, three).profit).toBe(simulate(lv, one).profit);
    // 400 parcels in one trailer of 220: one swap, so the timeline shows ten minutes without loading.
    const loaded = simulate(lv, three).timeline.cityLoaded.map((row) => row[0]!);
    expect(loaded.some((x, k) => k > 0 && x > 200 && x < 400 && x === loaded[k - 1])).toBe(true);
  });

  it('the crew may change at the cut: the trailer and the belt stay', () => {
    const lv = level(2);
    const plan: Plan = { blocks: [{ city: 0, start: 0, end: 90, people: 2, docks: 1 }, { city: 0, start: 90, end: 180, people: 1, docks: 1 }], robotCities: [], robots: 0 };
    const { timeline } = simulate(lv, plan);
    expect(new Set(timeline.blocks.map((b) => b.door)).size).toBe(1);
  });
});

describe('full is full', () => {
  // One city, 20 parcels a minute for an hour, a buffer of 100 and nobody at work until 30.
  const lv: Level = {
    ...level(1),
    par: 100,
    bufferCap: 100,
    cities: [{ volume: 1200, truck: 120, arrivals: [{ from: 0, to: 60, perMinute: 20 }] }],
  };

  it('refuses what finds no place, for good', () => {
    const { result } = simulate(lv, { blocks: [], robotCities: [], robots: 0 });
    expect(result.buffer.refused).toBe(1100);
    expect(result.trucks[0]!.loaded).toBe(0);
    expect(result.lines.left).toBe(1800); // refused or still in the buffer: all 1,200 left behind
    expect(result.lines.buffer).toBe(15); // only the 100 that went in pay the buffer
  });

  it('a refused parcel never comes back', () => {
    const late: Plan = { blocks: [{ city: 0, start: 60, end: 120, people: 2, docks: 2 }], robotCities: [], robots: 0 };
    const { result } = simulate(lv, late);
    expect(result.buffer.refused).toBe(1100);
    expect(result.trucks[0]!.loaded).toBe(100);
    expect(result.trucks[0]!.status).toBe('incomplete');
  });

  it('refuses nothing while there is room', () => {
    for (const g of golden as unknown as { level: number; name: string; plan: Plan }[]) {
      if (g.level > 4) continue;
      expect(simulate(level(g.level), g.plan).result.buffer.refused, `level ${g.level} ${g.name}`).toBe(0);
    }
  });
});
