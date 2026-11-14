import levelsText from '../src/shifts/levels.json?raw';
import fixtureText from './fixtures/shifts/level4.json?raw';
import { describe, expect, it } from 'vitest';
import type { Level, Plan } from '../src/shifts/contract';
import { arrivedBy, firstParcel, nominalFlow, robotLines, roughBuffer } from '../src/shifts/estimate';

const LEVELS = JSON.parse(levelsText) as Level[];
const FIX = JSON.parse(fixtureText) as { level: Level; plan: Plan };
const empty: Plan = { blocks: [], robotCities: [], robots: 0 };
const level = (n: number) => LEVELS[n - 1]!;

describe('rough buffer guess', () => {
  it('reads the arrivals of the briefing', () => {
    for (const l of LEVELS) for (const c of l.cities) expect(arrivedBy(c, l.shiftMinutes)).toBeCloseTo(c.volume, 0);
    expect(firstParcel(level(3).cities[3]!)).toBe(30);
    expect(robotLines(level(1).cities[0]!)).toBe(2);
    expect(robotLines(level(10).cities[1]!)).toBe(4);
  });

  it('gives one step per shift hour', () => {
    for (const l of LEVELS) expect(roughBuffer(l, empty)).toHaveLength(Math.ceil(l.shiftMinutes / 60));
  });

  it('fills up when nothing is planned', () => {
    // Level 1: 150 parcels against 800 places is "some"; level 10 swamps its 400 places at once.
    expect(roughBuffer(level(1), empty)).toEqual([1, 1]);
    expect(roughBuffer(level(10), empty).every((x) => x === 2)).toBe(true);
  });

  it('stays empty when a crew keeps up from the first parcel', () => {
    const l = level(1);
    expect(roughBuffer(l, { blocks: [{ city: 0, start: 0, end: 120, people: 2, docks: 1 }], robotCities: [], robots: 0 })).toEqual([0, 0]);
  });

  it('shows parcels waiting for a block that starts later (the example plan of level 4)', () => {
    // Two cities wait for their dock in the first hours; by the last hour the crews have caught up.
    expect(roughBuffer(FIX.level, FIX.plan)).toEqual([1, 1, 1, 0]);
    const f = nominalFlow(FIX.level, FIX.plan);
    expect(f.waiting[60]).toBeCloseTo(120, 0);
    expect(f.left.every((x) => x < 0.5)).toBe(true);
    expect(f.blocks[0]!.capacity).toBeCloseTo(297.5, 1);
    expect(f.blocks[0]!.loaded).toBeCloseTo(240, 0);
  });

  it('counts robots, and not while they are down', () => {
    const l = level(7);
    const robots: Plan = { blocks: [], robotCities: l.cities.map((_, i) => i), robots: l.robotsMax };
    const withRobots = nominalFlow(l, robots).waiting;
    const without = nominalFlow(l, empty).waiting;
    expect(withRobots[120]!).toBeLessThan(without[120]!);
    const [a, b] = l.robotOutage!;
    // During the outage everything that comes in stays waiting.
    const arrived = l.cities.reduce((s, c) => s + arrivedBy(c, b) - arrivedBy(c, a), 0);
    expect(withRobots[b]! - withRobots[a]!).toBeCloseTo(arrived, 3);
    // A fleet of none does nothing, whatever cities are switched to robots.
    expect(nominalFlow(l, { ...robots, robots: 0 }).waiting[120]).toBeCloseTo(without[120]!, 6);
  });

  it('never lets a crew load more than it can or more than there is', () => {
    const l = level(10);
    const plan: Plan = { blocks: l.cities.map((c, i) => ({ city: i, start: firstParcel(c), end: c.truck, people: 2 as const, docks: 1 })), robotCities: [], robots: 0 };
    const f = nominalFlow(l, plan);
    f.blocks.forEach((b, i) => {
      expect(b.loaded).toBeLessThanOrEqual(b.capacity + 1e-6);
      expect(b.loaded + f.left[i]!).toBeCloseTo(l.cities[i]!.volume, 0);
    });
  });
});
