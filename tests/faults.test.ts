import { describe, expect, it } from 'vitest';
import { FaultPlan } from '../src/sim/faults';
import { Rng } from '../src/sim/rng';

const CHUTES = Array.from({ length: 20 }, (_, k) => k);

describe('fault plan', () => {
  it('starts after the first wait, keeps the minimum gap and caps chutes down', () => {
    const rng = new Rng(3);
    const plan = new FaultPlan(CHUTES, () => rng.next(), { first: 10, minGap: 20, meanGap: 40, maxDown: 2 });
    const starts: number[] = [];
    for (let bt = 0; bt < 4000; bt++) {
      for (const f of plan.tick(bt)) starts.push(f.since);
      expect(plan.down.size).toBeLessThanOrEqual(2);
      // Repair each fault 30 beats after it started.
      for (const f of [...plan.down.values()]) if (bt - f.since >= 30) plan.repaired(f.chute, bt);
    }
    expect(starts[0]).toBe(10);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(20);
    // About one per 40 beats (some skipped while two are down).
    expect(starts.length).toBeGreaterThan(50);
    expect(starts.length).toBeLessThan(110);
    expect(plan.downBeats).toBe(30 * (plan.count - plan.down.size));
  });

  it('is the same run for the same seed', () => {
    const run = () => {
      const rng = new Rng(11);
      const plan = new FaultPlan(CHUTES, () => rng.next());
      const out: string[] = [];
      for (let bt = 0; bt < 3000; bt++) {
        for (const f of plan.tick(bt)) out.push(`${f.since}:${f.chute}:${f.kind}`);
        for (const f of [...plan.down.values()]) if (bt - f.since >= 60) plan.repaired(f.chute, bt);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('never takes down a chute that is already down, and stops when switched off', () => {
    const plan = new FaultPlan([4, 5], Math.random, { first: 0, minGap: 1, meanGap: 2, maxDown: 5 });
    expect(plan.trigger(0, 4)).not.toBeNull();
    expect(plan.trigger(0, 4)).toBeNull();
    expect(plan.trigger(0)?.chute).toBe(5);
    expect(plan.trigger(0)).toBeNull();
    plan.repaired(4, 10);
    plan.repaired(5, 10);
    plan.enabled = false;
    for (let bt = 0; bt < 100; bt++) expect(plan.tick(bt)).toEqual([]);
  });
});
