import { describe, expect, it } from 'vitest';
import type { Level, Timeline } from '../src/shifts/contract';
import { CAGE_PARCELS, TRAILER_PARCELS, arrivedAt, bufferAt, buildSchedule, doorAt, doorsUsed, inHall, parcelFactor, peakPerMinute, robotRate, robotsAt, sample } from '../src/sim/shiftSchedule';
import { LEVELS } from '../src/shifts/levels';
import { Fleet, PARK_COLS, sorterFloor } from '../src/sim/robotFleet';
import { Rng } from '../src/sim/rng';
import fixture from './fixtures/shifts/level4.json';

const level = fixture.level as unknown as Level;
const timeline = fixture.timeline as unknown as Timeline;

/** A small level and timeline written out by hand: `loaded[i]` is city i's parcels per step. */
function made(o: { cities: { volume: number; truck: number }[]; steps: number; loaded: (k: number) => number[]; blocks: Timeline['blocks']; departures: Timeline['departures']; robots?: (k: number) => number; shift?: number }): { level: Level; timeline: Timeline } {
  const lv: Level = {
    id: 99,
    name: 'made',
    shiftMinutes: o.shift ?? o.steps * 5,
    cities: o.cities.map((c) => ({ ...c, arrivals: [] })),
    docks: 4,
    robotsMax: 10,
    bufferCap: 400,
    wageFactor: 1,
    notes: { fresh: '', setForYou: [] },
    par: 1,
    badge: { id: 'x', text: '' },
  };
  const ks = Array.from({ length: o.steps + 1 }, (_, k) => k);
  const tl: Timeline = { stepMinutes: 5, cityLoaded: ks.map(o.loaded), buffer: ks.map((k) => k * 4), blocks: o.blocks, robotsActive: ks.map((k) => o.robots?.(k) ?? 0), departures: o.departures };
  return { level: lv, timeline: tl };
}

describe('shift schedule: the fixture (level 4, one door for two trucks)', () => {
  const s = buildSchedule(level, timeline);

  it('plays the whole shift and uses two doors', () => {
    expect(s.end).toBe(240);
    expect(doorsUsed(s)).toBe(2);
    expect(s.robotCities).toEqual([]);
  });

  it('opens and closes each door with its block', () => {
    expect(doorAt(s, 0, 0).open).toBe(true);
    expect(doorAt(s, 0, 0).city).toBe(0);
    expect(doorAt(s, 0, 0).people).toBe(2);
    expect(doorAt(s, 1, 30).open).toBe(false);
    expect(doorAt(s, 1, 30).city).toBe(-1);
    expect(doorAt(s, 1, 60).open).toBe(true);
    expect(doorAt(s, 1, 60).people).toBe(1);
    expect(doorAt(s, 1, 180).open).toBe(false);
    // A door that is not in the plan stays bare all night.
    for (const m of [0, 100, 239]) expect(doorAt(s, 5, m)).toMatchObject({ open: false, city: -1, people: 0 });
  });

  it('changes the signs during the 15-minute switch to another city', () => {
    // Door 1 (index 0): city 0 until 105, city 1 from 120.
    expect(doorAt(s, 0, 104).city).toBe(0);
    const during = doorAt(s, 0, 110);
    expect(during).toMatchObject({ open: false, city: 1, people: 0 });
    expect(doorAt(s, 0, 120)).toMatchObject({ open: true, city: 1, people: 2 });
    expect(s.events.filter((e) => e.kind === 'ready')).toEqual([{ at: 105, kind: 'ready', door: 0, city: 1 }]);
  });

  it('gives every door the parcels of its city', () => {
    const last = timeline.cityLoaded.length - 1;
    for (const st of s.stints) expect(st.loaded[last]).toBeCloseTo(timeline.cityLoaded[last]![st.city]!, 3);
    // Halfway through city 0's block: what the timeline says, in roll cages.
    expect(doorAt(s, 0, 50).cageUnits).toBeCloseTo(133.3 / CAGE_PARCELS, 3);
    // Between two samples: a straight line.
    expect(doorAt(s, 0, 52.5).cageUnits).toBeCloseTo((133.3 + 146.7) / 2 / CAGE_PARCELS, 3);
  });

  it('swaps a full trailer and lets the last one leave looking full', () => {
    // City 0 loads 240: one full trailer, then one planned for 20.
    const swap = s.events.filter((e) => e.kind === 'swap' && e.door === 0 && e.city === 0);
    expect(swap).toHaveLength(1);
    expect(swap[0]!.at).toBeGreaterThan(80);
    expect(swap[0]!.at).toBeLessThan(100);
    expect(doorAt(s, 0, 60).swaps).toBe(0);
    expect(doorAt(s, 0, 60).trailerFill).toBeCloseTo(160 / TRAILER_PARCELS, 2);
    expect(doorAt(s, 0, 104.9).swaps).toBe(1);
    expect(doorAt(s, 0, 104.9).trailerFill).toBeGreaterThan(0.95);
    // City 2 loads 150 on door 2: no swap, and its one trailer is planned for 150.
    expect(s.events.some((e) => e.kind === 'swap' && e.door === 1)).toBe(false);
    expect(doorAt(s, 1, 120).trailerFill).toBeCloseTo(90 / 150, 2);
  });

  it('knows how hard a door works', () => {
    // Two people at 160 an hour against 170; one person flat out; city 1 tails off at the end.
    expect(doorAt(s, 0, 30).pressure).toBeGreaterThan(0.9);
    expect(doorAt(s, 1, 90).pressure).toBeGreaterThan(0.95);
    expect(doorAt(s, 0, 200).pressure).toBeLessThan(0.5);
  });

  it('flashes the lamp in the last minutes of a block only', () => {
    expect(doorAt(s, 0, 90).lamp).toBe(false);
    expect(doorAt(s, 0, 102).lamp).toBe(true);
    expect(doorAt(s, 0, 102).late).toBe(false);
  });

  it('lists the trucks leaving on time from their doors', () => {
    const dep = s.events.filter((e) => e.kind === 'depart');
    expect(dep).toEqual([
      { at: 105, kind: 'depart', city: 0, status: 'onTime', doors: [0] },
      { at: 180, kind: 'depart', city: 2, status: 'onTime', doors: [1] },
      { at: 240, kind: 'depart', city: 1, status: 'onTime', doors: [0] },
    ]);
    // In order of time.
    for (let i = 1; i < s.events.length; i++) expect(s.events[i]!.at).toBeGreaterThanOrEqual(s.events[i - 1]!.at);
  });

  it('follows the buffer against the rack size', () => {
    expect(bufferAt(s, 0)).toBe(0);
    expect(bufferAt(s, 60)).toBeCloseTo(120 / 800, 5);
    expect(bufferAt(s, 62.5)).toBeCloseTo(116.25 / 800, 5);
    expect(bufferAt(s, 1000)).toBe(0);
    expect(robotsAt(s, 100)).toBe(0);
  });
});

describe('shift schedule: late, incomplete, robots, several doors', () => {
  it('flashes from the truck time until a late truck leaves, and plays on past the shift', () => {
    const { level: lv, timeline: tl } = made({
      cities: [{ volume: 200, truck: 60 }],
      steps: 18,
      shift: 60,
      loaded: (k) => [Math.min(200, k * 12.5)],
      blocks: [{ city: 0, door: 2, start: 0, end: 80, people: 2 }],
      departures: [{ city: 0, at: 80, status: 'late' }],
    });
    const s = buildSchedule(lv, tl);
    expect(s.end).toBe(80);
    expect(doorAt(s, 2, 50)).toMatchObject({ open: true, lamp: false, late: false });
    expect(doorAt(s, 2, 60)).toMatchObject({ open: true, lamp: true, late: true });
    expect(doorAt(s, 2, 79)).toMatchObject({ open: true, lamp: true, late: true });
    expect(doorAt(s, 2, 80)).toMatchObject({ open: false, lamp: false, city: -1 });
    expect(s.events).toContainEqual({ at: 60, kind: 'late', door: 2, city: 0 });
    expect(s.events).toContainEqual({ at: 80, kind: 'depart', city: 0, status: 'late', doors: [2] });
  });

  it('shows an incomplete truck as not full and leaves the rest standing at the door', () => {
    const { level: lv, timeline: tl } = made({
      cities: [{ volume: 200, truck: 60 }],
      steps: 12,
      loaded: (k) => [Math.min(90, k * 7.5)],
      blocks: [{ city: 0, door: 0, start: 0, end: 60, people: 1 }],
      departures: [{ city: 0, at: 60, status: 'incomplete' }],
    });
    const s = buildSchedule(lv, tl);
    const st = s.stints[0]!;
    expect(st.status).toBe('incomplete');
    expect(st.planned).toBeCloseTo(200, 5);
    // 90 of the 200 planned for this trailer: under half full when it leaves.
    expect(doorAt(s, 0, 59.9).trailerFill).toBeCloseTo(90 / 200, 2);
    const after = doorAt(s, 0, 61);
    expect(after).toMatchObject({ open: false, people: 0, city: 0, leftBehind: 110 });
    expect(after.cageUnits).toBeCloseTo(110 / CAGE_PARCELS, 5);
  });

  it('shares a city over its open doors by what their people can load', () => {
    const { level: lv, timeline: tl } = made({
      cities: [{ volume: 260, truck: 60 }],
      steps: 12,
      loaded: (k) => [k * (260 / 12)],
      blocks: [
        { city: 0, door: 0, start: 0, end: 60, people: 1 },
        { city: 0, door: 1, start: 0, end: 60, people: 2 },
      ],
      departures: [{ city: 0, at: 60, status: 'onTime' }],
    });
    const s = buildSchedule(lv, tl);
    const one = s.stints.find((x) => x.door === 0)!;
    const two = s.stints.find((x) => x.door === 1)!;
    expect(one.loaded[12]).toBeCloseTo(90, 3);
    expect(two.loaded[12]).toBeCloseTo(170, 3);
    expect(one.pressure[3]).toBeCloseTo(1, 3);
    expect(one.departs && two.departs).toBe(true);
    expect(s.events.find((e) => e.kind === 'depart')).toMatchObject({ doors: [0, 1] });
    // Same city straight on at the same door: the signs do not wait for a switch.
    expect(one.signFrom).toBe(0);
  });

  it('gives the robots what a city loads without an open door', () => {
    const { level: lv, timeline: tl } = made({
      cities: [{ volume: 120, truck: 60 }, { volume: 100, truck: 60 }, { volume: 300, truck: 60 }],
      steps: 12,
      // City 0: a door only. City 1: robots only (100 an hour). City 2: a door (90 an hour) and robots on top.
      loaded: (k) => [Math.min(120, k * 7.5), k * (100 / 12), k * 12.5],
      blocks: [
        { city: 0, door: 0, start: 0, end: 60, people: 1 },
        { city: 2, door: 1, start: 30, end: 60, people: 1 },
      ],
      departures: [{ city: 0, at: 60, status: 'onTime' }, { city: 1, at: 70, status: 'late' }, { city: 2, at: 60, status: 'onTime' }],
      robots: (k) => (k < 6 ? 5 : 8),
    });
    const s = buildSchedule(lv, tl);
    expect(s.robotCities.map((r) => r.city)).toEqual([1, 2]);
    expect(robotRate(s, 0, 20)).toBeCloseTo(100, 3);
    // City 2: all robots before its door opens; once it is open the door takes 90 an hour of the 150.
    expect(robotRate(s, 1, 10)).toBeCloseTo(150, 3);
    expect(robotRate(s, 1, 40)).toBeCloseTo(60, 3);
    expect(s.stints.find((x) => x.city === 2)!.loaded[12]).toBeCloseTo(45, 3);
    // City 1 has no door: its truck leaves from the robots' side, late.
    expect(s.robotCities[0]!.departure).toEqual({ at: 70, status: 'late', lateFrom: 60 });
    expect(s.robotCities[1]!.departure).toBeNull();
    expect(s.events).toContainEqual({ at: 70, kind: 'depart', city: 1, status: 'late', doors: [] });
    expect(robotsAt(s, 10)).toBe(5);
    expect(robotsAt(s, 45)).toBe(8);
    expect(s.end).toBe(70);
  });

  it('reads a series between its samples and holds its ends', () => {
    expect(sample([0, 10, 30], -5)).toBe(0);
    expect(sample([0, 10, 30], 2.5)).toBe(5);
    expect(sample([0, 10, 30], 7.5)).toBe(20);
    expect(sample([0, 10, 30], 99)).toBe(30);
    expect(sample([], 3)).toBe(0);
  });
});

describe('robot fleet during a shift', () => {
  const cols = Array.from({ length: 20 }, (_, k) => PARK_COLS + 2 + 4 * k);
  /** Run a fleet with parcels always waiting at every station; `limit(beat)` robots may be out. */
  function run(beats: number, limit: (beat: number) => number): { most: number[]; delivered: number; out: () => number } {
    const { grid, parks, stations, bins } = sorterFloor(cols);
    const rng = new Rng(11);
    const fleet = new Fleet(grid, parks, stations, bins, 40, () => rng.next());
    const out = () => fleet.bots.filter((b) => b.state !== 'idle').length;
    const most: number[] = [];
    let delivered = 0;
    for (let beat = 0; beat < beats; beat++) {
      fleet.limit = limit(beat);
      const before = out();
      for (const e of fleet.step(beat, () => true, beat % 4 === 1 || beat % 4 === 3)) if (e.t === 'dropped') delivered++;
      // Never more out than the plan has, unless they were out already (those finish their trip).
      expect(out()).toBeLessThanOrEqual(Math.max(before, fleet.limit));
      most.push(out());
    }
    return { most, delivered, out };
  }

  it('keeps all but the plan\'s robots parked', () => {
    const r = run(600, () => 6);
    expect(Math.max(...r.most)).toBe(6);
    expect(r.delivered).toBeGreaterThan(20);
  });

  it('sends nobody out with no robots in the plan, and brings them home in an outage', () => {
    expect(Math.max(...run(200, () => 0).most)).toBe(0);
    const r = run(700, (beat) => (beat < 300 ? 12 : 0));
    expect(Math.max(...r.most.slice(0, 300))).toBe(12);
    // Those out when the outage began finish and park; nobody leaves after that.
    expect(r.out()).toBe(0);
  });

  it('changes nothing when no shift sets a limit', () => {
    expect(Math.max(...run(400, () => Infinity).most)).toBeGreaterThan(12);
  });
});

describe('the plan\'s parcels in the hall', () => {
  it('brings each city in as the level says', () => {
    // Level 4, city 0: 240 parcels between 0 and 90.
    expect(arrivedAt(level, 0, 0)).toBe(0);
    expect(arrivedAt(level, 0, 45)).toBeCloseTo(120, 2);
    expect(arrivedAt(level, 0, 500)).toBe(240);
    expect(arrivedAt(level, 9, 60)).toBe(0);
    expect(peakPerMinute(level)).toBeCloseTo(4.67, 1);
  });

  it('shows every parcel in levels 1 to 6 and one for a fixed few after that', () => {
    const f = LEVELS.map(parcelFactor);
    expect(f.slice(0, 6)).toEqual([1, 1, 1, 1, 1, 1]);
    for (const [i, lv] of LEVELS.entries()) {
      // What comes in per beat fits on the loop, and a smaller factor would not.
      expect(peakPerMinute(lv) / 4 / f[i]!).toBeLessThanOrEqual(3.05);
      if (f[i]! > 1) expect(peakPerMinute(lv) / 4).toBeGreaterThan(3.05);
    }
    expect(f.slice(6)).toEqual([3, 8, 4, 8]);
  });

  it('counts whole parcels that never go back', () => {
    let last = 0;
    for (let n = 0; n <= 100; n += 0.7) {
      const v = inHall(n, 3);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(inHall(220, 1)).toBe(220);
    expect(inHall(220, 8)).toBe(28);
  });
});
