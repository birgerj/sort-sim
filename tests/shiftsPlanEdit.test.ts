import levelsText from '../src/shifts/levels.json?raw';
import fixtureText from './fixtures/shifts/level4.json?raw';
import goldenText from './fixtures/shifts/golden.json?raw';
import { describe, expect, it } from 'vitest';
import type { Level, Plan, Timeline } from '../src/shifts/contract';
import { addBlock, canStep, moveBlock, removeBlock, setDocks, setEnd, setPeople, setRobotCity, setRobots, setStart, snap, starterBlock, stepEnd, stepStart } from '../src/ui/shifts/planner/edit';
import { allowedTimes, assignDoors, busyDockSteps, checkPlan, fixedCosts, goalStanding, mostToEarn, peak, peopleSteps, unservedCities } from '../src/ui/shifts/planner/rules';

const LEVELS = JSON.parse(levelsText) as Level[];
const FIX = JSON.parse(fixtureText) as { level: Level; plan: Plan; timeline: Timeline; result: { lines: { docks: number; people: number } } };
const GOLDEN = JSON.parse(goldenText) as { level: number; name: string; plan: Plan; lines: { docks: number; people: number; robots: number } }[];
const level = (n: number) => LEVELS[n - 1]!;
const empty = (): Plan => ({ blocks: [], robotCities: [], robots: 0 });

describe('plan rules', () => {
  it('allows the half hours, the first parcel and the truck time', () => {
    // Level 4, city 0: truck at 105, so 105 is allowed and nothing after 135.
    expect(allowedTimes(level(4), 0)).toEqual([0, 30, 60, 90, 105, 120]);
    expect(allowedTimes(level(1), 0).at(-1)).toBe(150);
  });

  it('accepts every plan the score model accepts', () => {
    // (Some fixture plans start blocks 15 minutes after another city's truck, off the planner's grid;
    // the model does not check the grid. Everything else must pass.)
    for (const g of GOLDEN) expect(checkPlan(level(g.level), g.plan).filter((x) => x.kind !== 'grid'), `level ${g.level} ${g.name}`).toEqual([]);
    for (const g of GOLDEN) if (g.name !== 'sensible') expect(checkPlan(level(g.level), g.plan), `level ${g.level} ${g.name}`).toEqual([]);
  });

  it('gives blocks the same doors as the score model', () => {
    const d = assignDoors(FIX.level, FIX.plan.blocks);
    const mine = d.uses.map((u) => [u.city, u.door, u.start, u.end]).sort();
    const theirs = FIX.timeline.blocks.map((b) => [b.city, b.door, b.start, b.end]).sort();
    expect(mine).toEqual(theirs);
    // City 1 follows city 0 on the same door: 15 minutes idle in between.
    expect(d.uses.find((u) => u.city === 1)!.switchFrom).toBe(105);
  });

  it('keeps a city on its own door and takes the door free longest otherwise', () => {
    const l = { ...level(4), docks: 3 };
    const d = assignDoors(l, [
      { city: 0, start: 0, end: 60, people: 1, docks: 1 },
      { city: 1, start: 0, end: 90, people: 1, docks: 1 },
      { city: 0, start: 60, end: 120, people: 1, docks: 1 },
      { city: 2, start: 120, end: 180, people: 1, docks: 1 },
    ]);
    expect(d.uses.map((u) => u.door)).toEqual([0, 1, 0, 2]);
    expect(d.short).toEqual([0, 0, 0, 0]);
  });

  it('finds what is wrong with a plan', () => {
    const l = level(4);
    const kinds = (p: Plan) => checkPlan(l, p).map((x) => x.kind);
    expect(kinds({ ...empty(), blocks: [{ city: 0, start: 10, end: 105, people: 1, docks: 1 }] })).toEqual(['grid']);
    expect(kinds({ ...empty(), blocks: [{ city: 0, start: 60, end: 105, people: 1, docks: 1 }] })).toEqual(['tooShort']);
    expect(kinds({ ...empty(), blocks: [{ city: 0, start: 0, end: 150, people: 1, docks: 1 }] })).toEqual(['afterTruck']);
    expect(kinds({ ...empty(), blocks: [{ city: 0, start: 0, end: 105, people: 1, docks: 3 }] })).toEqual(['noDock']);
    expect(kinds({ ...empty(), robots: 2 })).toEqual(['robotsOff']);
    expect(checkPlan(level(3), { ...empty(), robots: 7 })).toEqual([{ kind: 'tooManyRobots' }]);
    // Two docks, three cities: the third finds a door only 15 minutes after another city left.
    const tight: Plan = { ...empty(), blocks: [
      { city: 0, start: 0, end: 120, people: 1, docks: 1 },
      { city: 2, start: 0, end: 180, people: 1, docks: 1 },
      { city: 1, start: 120, end: 240, people: 1, docks: 1 },
    ] };
    expect(checkPlan(l, tight)).toEqual([{ kind: 'noDock', block: 2 }]);
    tight.blocks[2]!.start = 150;
    expect(checkPlan(l, tight)).toEqual([]);
  });

  it('counts people against the limit, one problem per stretch', () => {
    const l = { ...level(4), peopleCap: 3 };
    const p: Plan = { ...empty(), blocks: [
      { city: 0, start: 0, end: 105, people: 2, docks: 1 },
      { city: 2, start: 30, end: 180, people: 2, docks: 1 },
    ] };
    expect(peak(peopleSteps(p))).toBe(4);
    expect(checkPlan(l, p)).toEqual([{ kind: 'tooManyPeople', at: 30 }]);
    expect(checkPlan(level(9), GOLDEN.find((g) => g.level === 9)!.plan)).toEqual([]);
  });

  it('counts switching docks as taken', () => {
    const d = assignDoors(FIX.level, FIX.plan.blocks);
    const s = busyDockSteps(FIX.plan, d);
    expect(peak(s)).toBe(2);
    expect(s.find((x) => x.from <= 110 && 110 < x.to)!.value).toBe(2);
  });

  it('adds up the fixed costs like the result does', () => {
    const c = fixedCosts(FIX.level, FIX.plan);
    expect(Math.round(c.docks)).toBe(FIX.result.lines.docks);
    expect(Math.round(c.people)).toBe(FIX.result.lines.people);
    for (const g of GOLDEN) {
      const x = fixedCosts(level(g.level), g.plan);
      // (The fixture rounds halves to even, so compare within half a Sorty.)
      expect(Math.abs(x.docks - g.lines.docks), `docks ${g.level} ${g.name}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(x.people - g.lines.people), `people ${g.level} ${g.name}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(x.robots - g.lines.robots), `robots ${g.level} ${g.name}`).toBeLessThanOrEqual(0.5);
    }
    expect(Math.round(mostToEarn(FIX.level))).toBe(1062);
    // Half way through the first block: half its cost, and the robots' share of the night.
    expect(fixedCosts(level(3), { blocks: [{ city: 0, start: 0, end: 240, people: 1, docks: 1 }], robotCities: [1], robots: 2 }, 120)).toEqual({ docks: 50, people: 60, robots: 44, total: 154 });
  });

  it('names cities without dock or robots', () => {
    const l = level(3);
    expect(unservedCities(l, empty())).toEqual([0, 1, 2, 3]);
    const p: Plan = { blocks: [starterBlock(l, 0)], robotCities: [1, 2], robots: 0 };
    expect(unservedCities(l, p)).toEqual([1, 2, 3]); // robot cities without a fleet are not served
    expect(unservedCities(l, { ...p, robots: 3 })).toEqual([3]);
  });

  it('says how the plan stands against the extra goal', () => {
    expect(goalStanding(FIX.level, FIX.plan)).toEqual({ ok: true, text: 'Your plan peaks at 3 people.' });
    expect(goalStanding(level(5), { ...empty(), robots: 6 })!.ok).toBe(true);
    expect(goalStanding(level(3), { ...empty(), blocks: [starterBlock(level(3), 1)] })!.ok).toBe(false);
    expect(goalStanding(level(7), empty())).toBeNull();
  });
});

describe('plan editing', () => {
  const l = level(4);

  it('makes a starter block from first parcel to truck time', () => {
    expect(starterBlock(l, 0)).toEqual({ city: 0, start: 0, end: 105, people: 1, docks: 1 });
    expect(starterBlock(level(3), 3)).toEqual({ city: 3, start: 30, end: 240, people: 1, docks: 1 });
  });

  it('never changes the plan it was given', () => {
    const p = addBlock(l, empty(), 0).plan;
    const before = JSON.stringify(p);
    const all = [stepStart(l, p, 0, 1), stepEnd(l, p, 0, 1), setStart(l, p, 0, 30), setEnd(l, p, 0, 90), moveBlock(l, p, 0, 30), setPeople(p, 0, 2), setDocks(l, p, 0, 2), removeBlock(p, 0), setRobotCity(level(3), p, 1, true), setRobots(level(3), p, 3), addBlock(l, p, 1).plan];
    expect(JSON.stringify(p)).toBe(before);
    for (const q of all) {
      expect(q).not.toBe(p);
      expect(q.blocks).not.toBe(p.blocks);
    }
  });

  it('steps over the half hours and the truck time', () => {
    let p = addBlock(l, empty(), 0).plan; // 0–105
    p = stepEnd(l, p, 0, 1);
    expect(p.blocks[0]!.end).toBe(120);
    p = stepEnd(l, p, 0, 1);
    expect(p.blocks[0]!.end).toBe(135 > 120 ? 120 : 0); // 135 is not on the grid: 120 is the last
    expect(canStep(l, p, 0, 'end', 1)).toBe(false);
    p = stepEnd(l, p, 0, -1);
    expect(p.blocks[0]!.end).toBe(105);
    p = stepEnd(l, p, 0, -1);
    expect(p.blocks[0]!.end).toBe(90);
    p = stepEnd(l, p, 0, -1);
    p = stepEnd(l, p, 0, -1);
    expect(p.blocks[0]!.end).toBe(60); // an hour at least
    p = stepStart(l, p, 0, 1);
    expect(p.blocks[0]!.start).toBe(0);
    expect(canStep(l, p, 0, 'start', -1)).toBe(false);
  });

  it('steps a start onto the first parcel', () => {
    const l5 = { ...level(5), cities: level(5).cities.map((c, i) => (i === 0 ? { ...c, arrivals: [{ from: 45, to: 240, perMinute: 1 }] } : c)) };
    let p: Plan = { ...empty(), blocks: [{ city: 0, start: 0, end: 270, people: 1, docks: 1 }] };
    p = stepStart(l5, p, 0, 1);
    p = stepStart(l5, p, 0, 1);
    expect(p.blocks[0]!.start).toBe(45);
    expect(checkPlan(l5, p)).toEqual([]);
  });

  it('snaps dragged times and keeps every edit within the rules', () => {
    expect(snap(l, 0, 100)).toBe(105);
    expect(snap(l, 0, 80)).toBe(90);
    let p = addBlock(l, empty(), 1).plan; // 0–240
    p = setStart(l, p, 0, 233);
    expect(p.blocks[0]).toMatchObject({ start: 180, end: 240 });
    p = setEnd(l, p, 0, 999);
    expect(p.blocks[0]!.end).toBe(270);
    p = moveBlock(l, p, 0, -50);
    expect(p.blocks[0]).toMatchObject({ start: 0, end: 90 });
    p = moveBlock(l, p, 0, 400);
    expect(p.blocks[0]).toMatchObject({ start: 180, end: 270 });
    expect(checkPlan(l, p)).toEqual([]);
  });

  it('keeps the length of a block that is moved', () => {
    const p = moveBlock(l, { ...empty(), blocks: [{ city: 1, start: 0, end: 120, people: 2, docks: 1 }] }, 0, 44);
    expect(p.blocks[0]).toEqual({ city: 1, start: 30, end: 150, people: 2, docks: 1 });
  });

  it('adds another block after the last one, or a full one when no hour is left', () => {
    let { plan: p } = addBlock(l, empty(), 1);
    p = setEnd(l, p, 0, 120);
    const second = addBlock(l, p, 1);
    expect(second.index).toBe(1);
    expect(second.plan.blocks[1]).toEqual({ city: 1, start: 120, end: 240, people: 1, docks: 1 });
    const third = addBlock(l, second.plan, 1);
    expect(third.plan.blocks[2]).toEqual({ city: 1, start: 0, end: 240, people: 1, docks: 1 });
  });

  it('keeps people, docks and the fleet in range', () => {
    let p = addBlock(l, empty(), 0).plan;
    expect(setDocks(l, p, 0, 9).blocks[0]!.docks).toBe(2);
    expect(setDocks(l, p, 0, 0).blocks[0]!.docks).toBe(1);
    expect(setPeople(p, 0, 2).blocks[0]!.people).toBe(2);
    expect(setRobots(level(3), p, 99).robots).toBe(6);
    expect(setRobots(l, p, 3).robots).toBe(0); // no robots in level 4
    p = setRobotCity(level(3), setRobotCity(level(3), p, 2, true), 1, true);
    expect(p.robotCities).toEqual([1, 2]);
    expect(setRobotCity(level(3), p, 2, false).robotCities).toEqual([1]);
    expect(setRobotCity(l, empty(), 0, true).robotCities).toEqual([]);
    expect(removeBlock(p, 0).blocks).toEqual([]);
  });
});
