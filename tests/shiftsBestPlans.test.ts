// Ten Shifts: the best known plan of every level (tools/balance/best) must be startable in the
// game and score about par, and plans a careless player might make must never crash the model.
import { describe, expect, it } from 'vitest';
import type { Plan } from '../src/shifts/contract';
import { LEVELS, checkPlan, simulate } from '../src/shifts/model';
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

const BEST = [best1, best2, best3, best4, best5, best6, best7, best8, best9, best10] as unknown as Plan[];
const best = (id: number): Plan => BEST[id - 1]!;

describe('Ten Shifts, best known plans', () => {
  it('there are ten levels, numbered 1 to 10', () => {
    expect(LEVELS.map((l) => l.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  for (const level of LEVELS) {
    it(`level ${level.id}: the best plan can start and scores about par`, () => {
      const plan = best(level.id);
      expect(checkPlan(level, plan)).toEqual([]);
      const { result } = simulate(level, plan);
      expect(result.score, `score ${result.score}, profit ${result.profit}, par ${level.par}`).toBeGreaterThanOrEqual(900);
      expect(result.score).toBeLessThanOrEqual(1010);
      expect(result.stars).toBe(3);
    });

    it(`level ${level.id}: an empty plan and a poor plan give a score of 0 or more`, () => {
      const empty: Plan = { blocks: [], robotCities: [], robots: 0 };
      // Poor: one person on one dock for the smallest allowed time, for the first city only.
      const first = Math.min(...level.cities[0]!.arrivals.map((a) => a.from));
      const start = Math.ceil(first / 30) * 30;
      const poor: Plan = { blocks: [{ city: 0, start, end: start + 60, people: 1, docks: 1 }], robotCities: [], robots: 0 };
      for (const plan of [empty, poor]) {
        expect(checkPlan(level, plan)).toEqual([]);
        const { result, timeline } = simulate(level, plan);
        expect(Number.isFinite(result.profit)).toBe(true);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.stars).toBe(0);
        expect(result.trucks.length).toBe(level.cities.length);
        expect(timeline.cityLoaded.length).toBeGreaterThan(0);
      }
    });
  }
});
