// The planner's one diagram: parcels coming in against what the plan can load, per hour.
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/shifts/levels';
import { capacitySteps, influxSteps } from '../src/ui/shifts/planner/rules';

const level = (n: number) => LEVELS[n - 1]!;

describe('inflow against capacity', () => {
  it('reads the inflow from the briefing', () => {
    // Level 1: 150 parcels between 22:00 and 23:30 is 100 an hour, then nothing.
    const steps = influxSteps(level(1));
    expect(steps.map((q) => [q.from, q.to])).toEqual([[0, 90], [90, 120]]);
    expect(steps[0]!.value).toBeCloseTo(100, 2);
    expect(steps[1]!.value).toBe(0);
  });
  it('adds up every city', () => {
    for (const l of LEVELS) {
      const total = influxSteps(l).reduce((s, q) => s + (q.value * (q.to - q.from)) / 60, 0);
      expect(total).toBeCloseTo(l.cities.reduce((s, c) => s + c.volume, 0), 0);
    }
  });
  it('counts crews at 90 and 170 an hour per dock', () => {
    const plan = { blocks: [{ city: 0, start: 30, end: 90, people: 2 as const, docks: 1 }], robotCities: [], robots: 0 };
    expect(capacitySteps(level(1), plan)).toEqual([
      { from: 0, to: 30, value: 0 },
      { from: 30, to: 90, value: 170 },
      { from: 90, to: 120, value: 0 },
    ]);
  });
  it('counts robots only while they drive and a line is open', () => {
    const l = level(7); // the fleet stands still for an hour
    const plan = { blocks: [], robotCities: [0], robots: 5 };
    const [from, to] = l.robotOutage!;
    const steps = capacitySteps(l, plan);
    const at = (m: number) => steps.find((q) => q.from <= m && m < q.to)?.value ?? 0;
    expect(at(from + 10)).toBe(0);
    expect(at(from - 10)).toBe(100);
    expect(at(to + 10)).toBe(100);
  });
});
