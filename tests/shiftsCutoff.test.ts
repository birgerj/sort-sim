// Ten Shifts: a city's truck time is its cut-off, followed by a cleardown.
// At the cut-off sorting for the city stops; every door still open for it loads what is on its belt
// at its crew's pace; the truck leaves when the last door is done, on time up to 15 minutes after
// the cut-off, late after that, and at 45 minutes whatever is still on a belt stays behind.
import { describe, expect, it } from 'vitest';
import type { Level, Plan } from '../src/shifts/contract';
import { CLEARDOWN_MINUTES } from '../src/shifts/contract';
import { LEVELS, checkPlan, simulate } from '../src/shifts/model';

const base = LEVELS.find((l) => l.id === 1)!;
const C = 120;
/** One city, 3 parcels a minute from 20 to 120, cut-off at 120: more than any one dock can load,
 *  so a dock that works until the cut-off stands there with a full belt of 40. */
const busy: Level = { ...base, par: 100, shiftMinutes: 120, docks: 2, robotsMax: 6, bufferCap: 800, cities: [{ volume: 300, truck: C, arrivals: [{ from: 20, to: 120, perMinute: 3 }] }] };
/** The same city with 60 parcels in the first hour: any dock is done long before the cut-off. */
const quiet: Level = { ...busy, cities: [{ volume: 60, truck: C, arrivals: [{ from: 0, to: 60, perMinute: 1 }] }] };
const plan = (blocks: Plan['blocks'], robotCities: number[] = [], robots = 0): Plan => ({ blocks, robotCities, robots });
const dock = (start: number, end: number, people: 1 | 2, docks = 1): Plan['blocks'][number] => ({ city: 0, start, end, people, docks });

describe('cut-off and cleardown', () => {
  it('no block may end after the cut-off', () => {
    expect(checkPlan(busy, plan([dock(0, C, 1)]))).toEqual([]);
    expect(checkPlan({ ...busy, shiftMinutes: 180 }, plan([dock(0, 150, 1)]))).toEqual([{ kind: 'afterTruck', block: 0 }]);
  });

  it('one person with a full belt at the cut-off leaves late', () => {
    const { result, timeline } = simulate(busy, plan([dock(0, C, 1)]));
    // 40 parcels at 1.5 a minute: 27 minutes, 12 past the planned leaving time.
    expect(timeline.cleardowns).toEqual([{ city: 0, door: 0, from: C, to: C + 27 }]);
    expect(timeline.departures[0]!.at).toBe(C + 27);
    expect(result.trucks[0]).toMatchObject({ planned: C + CLEARDOWN_MINUTES, left: C + 27 });
    expect(result.lines.late).toBeGreaterThan(0);
    expect(result.lines.bonus).toBe(0);
    // The belt was loaded all the same: 150 in the block (100 minutes at 1.5), 40 in the cleardown.
    expect(result.trucks[0]!.loaded).toBe(190);
    // Dock and person are paid until the door is done: 147 minutes.
    expect(result.lines.docks).toBe(Math.round((147 / 60) * 25));
    expect(result.lines.people).toBe(Math.round((147 / 60) * 30));
  });

  it('two people clear the same belt within the 15 minutes: on time', () => {
    const { result, timeline } = simulate(busy, plan([dock(0, C, 2)]));
    expect(timeline.cleardowns).toEqual([{ city: 0, door: 0, from: C, to: C + 15 }]);
    expect(timeline.departures[0]!.at).toBe(C + 15);
    expect(result.lines.late).toBe(0);
    // On time, but not complete: what was in the buffer at the cut-off stays behind.
    expect(result.trucks[0]!.status).toBe('incomplete');
    expect(result.lines.left).toBeGreaterThan(0);
  });

  it('no door open at the cut-off: the truck leaves on time with what it has', () => {
    const { result, timeline } = simulate(busy, plan([dock(0, 90, 2)]));
    expect(timeline.cleardowns).toEqual([]);
    expect(timeline.departures[0]!.at).toBe(C + 15);
    expect(result.lines.late).toBe(0);
    expect(result.trucks[0]!.loaded).toBeLessThan(300);
    // Nothing is paid after the block.
    expect(result.lines.docks).toBe(Math.round((90 / 60) * 25));
  });

  it('at the cut-off what is in the buffer is left behind and its places come free', () => {
    const { result } = simulate(busy, plan([dock(0, C, 1)]));
    const k = C / 5;
    expect(result.buffer.series[k - 1]!).toBeGreaterThan(50);
    expect(result.buffer.series[k + 1]!).toBe(0);
    // 300 came in, 190 left with the truck: 110 at 1.50.
    expect(result.lines.left).toBe(165);
    expect(result.buffer.refused).toBe(0);
  });

  it('a truck that is complete and done within 15 minutes gets its bonus; the cleardown costs at least 15 minutes', () => {
    const { result, timeline } = simulate(quiet, plan([dock(0, C, 1)]));
    expect(result.trucks[0]).toEqual({ city: 0, loaded: 60, planned: C + 15, left: C + 15, status: 'onTime' });
    expect(result.lines.bonus).toBe(18);
    expect(timeline.cleardowns).toEqual([{ city: 0, door: 0, from: C, to: C + 15 }]);
    expect(result.lines.docks).toBe(Math.round((135 / 60) * 25));
    // Ending the block before the cut-off saves the cleardown and changes nothing else.
    const early = simulate(quiet, plan([dock(0, 90, 1)]));
    expect(early.result.trucks[0]!.status).toBe('onTime');
    expect(early.timeline.cleardowns).toEqual([]);
    expect(early.result.lines.docks).toBe(Math.round((90 / 60) * 25));
  });

  it('after 45 minutes the truck leaves anyway and the belt stays behind', () => {
    // Two docks with one person each and a trailer swap in the cleardown cannot empty their belts... one
    // person, 40 on the belt and a swap of 10 minutes still fits; so make the belt useless: a crew that
    // stands at a door whose trailer swap falls in the cleardown is the slowest case there is.
    const { result, timeline } = simulate(busy, plan([dock(0, C, 1)]));
    expect(timeline.departures[0]!.at).toBeLessThanOrEqual(C + 45);
    for (const lv of LEVELS) {
      const all: Plan = plan(lv.cities.map((c, city) => ({ city, start: Math.max(0, c.truck - 60), end: c.truck, people: 1 as const, docks: 1 })).slice(0, lv.docks));
      if (checkPlan(lv, all).length) continue;
      const out = simulate(lv, all);
      out.timeline.departures.forEach((d) => {
        expect(d.at).toBeGreaterThanOrEqual(lv.cities[d.city]!.truck + 15);
        expect(d.at).toBeLessThanOrEqual(lv.cities[d.city]!.truck + 45);
      });
      for (const c of out.timeline.cleardowns ?? []) expect(c.to).toBeGreaterThanOrEqual(c.from + 15);
    }
    expect(result.trucks[0]!.left).toBe(timeline.departures[0]!.at);
  });

  it('robot lines clear their tables at the fleet\'s pace', () => {
    // 3 a minute against one robot line: the tables are full at the cut-off.
    const slow = simulate(busy, plan([], [0], 1));
    const fast = simulate(busy, plan([], [0], 6));
    expect(fast.timeline.departures[0]!.at).toBeLessThan(slow.timeline.departures[0]!.at);
    expect(slow.timeline.departures[0]!.at).toBe(C + 45); // one robot, 17 an hour: not done in 45 minutes
    expect(slow.result.lines.late).toBeGreaterThan(0);
  });

  it('the timeline covers the last departure', () => {
    const { timeline } = simulate(busy, plan([dock(0, C, 1)]));
    expect((timeline.cityLoaded.length - 1) * timeline.stepMinutes).toBeGreaterThanOrEqual(Math.max(...timeline.departures.map((d) => d.at)));
    const row = timeline.cityLoaded[(C + 30) / 5]!;
    expect(row[0]).toBe(190); // loading went on after the cut-off
  });
});
