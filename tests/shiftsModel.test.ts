import { describe, expect, it } from 'vitest';
import type { Level, Plan, Result, Timeline } from '../src/shifts/contract';
import { LEVELS, LocalScoreService, checkPlan, simulate } from '../src/shifts/model';
import { assignDoors, linesFor } from '../src/shifts/model/doors';
import { roundHalfEven, roundTenth } from '../src/shifts/model/simulate';
import goldenJson from './fixtures/shifts/golden.json';
import level4Json from './fixtures/shifts/level4.json';

interface Golden {
  level: number;
  name: string;
  plan: Plan;
  profit: number;
  lines: Result['lines'];
  trucks: Result['trucks'];
}
const golden = goldenJson as Golden[];
const level4 = level4Json as unknown as { level: Level; plan: Plan; result: Result; timeline: Timeline };

const level = (id: number): Level => LEVELS.find((l) => l.id === id)!;
const block = (city: number, start: number, end: number, people: 1 | 2 = 1, docks = 1): Plan['blocks'][number] => ({ city, start, end, people, docks });
const plan = (blocks: Plan['blocks'], robotCities: number[] = [], robots = 0): Plan => ({ blocks, robotCities, robots });

/** Every number in `got` within `within` of the one at the same place in `want`; everything else equal. */
function expectClose(got: unknown, want: unknown, within: number, path = ''): void {
  if (typeof want === 'number') {
    expect(typeof got, path).toBe('number');
    expect(Math.abs((got as number) - want), `${path}: ${String(got)} against ${want}`).toBeLessThanOrEqual(within);
  } else if (Array.isArray(want)) {
    expect(Array.isArray(got), path).toBe(true);
    expect((got as unknown[]).length, `${path}.length`).toBe(want.length);
    want.forEach((w, i) => expectClose((got as unknown[])[i], w, within, `${path}[${i}]`));
  } else if (want !== null && typeof want === 'object') {
    expect(Object.keys(got as object).sort(), path).toEqual(Object.keys(want).sort());
    for (const [k, w] of Object.entries(want)) expectClose((got as Record<string, unknown>)[k], w, within, `${path}.${k}`);
  } else {
    expect(got, path).toEqual(want);
  }
}

describe('levels', () => {
  it('are the ten shifts, in order', () => {
    expect(LEVELS.map((l) => l.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const l of LEVELS) {
      expect(l.par).toBeGreaterThan(0);
      for (const c of l.cities) {
        const sum = c.arrivals.reduce((s, a) => s + (a.to - a.from) * a.perMinute, 0);
        expect(Math.abs(sum - c.volume)).toBeLessThan(0.01);
      }
    }
  });
});

describe('the reference model', () => {
  it('has plans for every level', () => {
    expect(new Set(golden.map((g) => g.level)).size).toBe(10);
  });

  for (const g of golden) {
    it(`level ${g.level} ${g.name}: profit to the cent, same lines and trucks`, () => {
      const out = simulate(level(g.level), g.plan);
      expect(Math.abs(out.profit - g.profit)).toBeLessThanOrEqual(0.01);
      expect(out.result.trucks).toEqual(g.trucks);
      for (const key of Object.keys(g.lines) as (keyof Result['lines'])[]) {
        // The levels file holds arrival rates to six decimals, so an amount can differ from the
        // reference by a ten-thousandth. Where that amount lies on a half, the whole number may
        // fall to the other side; anywhere else it must be the same.
        const onAHalf = Math.abs(Math.abs(out.amounts[key] % 1) - 0.5) < 0.001;
        expect(Math.abs(out.result.lines[key] - g.lines[key]), `${key}: ${out.amounts[key]} against ${g.lines[key]}`).toBeLessThanOrEqual(onAHalf ? 1 : 0);
      }
    });
  }

  it('finds nothing wrong with those plans but quarter-hour starts and robots where there are none', () => {
    // The search behind the reference plans also starts blocks a quarter of an hour after another
    // city (levels 7 to 10) and once names a robot city in a level without robots.
    for (const g of golden) {
      const kinds = checkPlan(level(g.level), g.plan).map((x) => x.kind);
      expect(kinds.filter((k) => k !== 'grid' && k !== 'robotsOff'), `level ${g.level} ${g.name}`).toEqual([]);
      if (g.name === 'safe' && g.level !== 4) expect(kinds).toEqual([]);
    }
  });

  it('gives the worked example of level 4: result and timeline', () => {
    expect(level4.level).toEqual(level(4));
    const out = simulate(level4.level, level4.plan);
    // The fixture leaves the badge out (always false); it has its own tests below.
    const { badge: _mine, ...result } = out.result;
    const { badge: _theirs, ...want } = level4.result;
    expectClose(result, want, 0.1, 'result');
    expectClose(out.timeline, level4.timeline, 0.1, 'timeline');
    expect(out.result.score).toBe(906);
    expect(out.result.stars).toBe(3);
  });

  it('samples every 5 minutes over the shift and half an hour after it', () => {
    for (const g of golden) {
      const lv = level(g.level);
      const { result, timeline } = simulate(lv, g.plan);
      const samples = (lv.shiftMinutes + 30) / 5 + 1;
      expect(timeline.cityLoaded.length).toBe(samples);
      expect(timeline.buffer.length).toBe(samples);
      expect(timeline.robotsActive.length).toBe(samples);
      expect(result.buffer.series).toEqual(timeline.buffer);
      expect(timeline.cityLoaded[0]).toEqual(lv.cities.map(() => 0));
      // Trucks only fill up, and never beyond what there is for the city.
      timeline.cityLoaded.forEach((row, k) => row.forEach((x, i) => {
        expect(x).toBeGreaterThanOrEqual(k > 0 ? timeline.cityLoaded[k - 1]![i]! : 0);
        expect(x).toBeLessThanOrEqual(lv.cities[i]!.volume + 0.1);
      }));
      for (const x of timeline.buffer) expect(x).toBeLessThanOrEqual(lv.bufferCap + 0.05);
    }
  });

  it('is the same every time', () => {
    const g = golden[golden.length - 2]!;
    expect(simulate(level(g.level), g.plan)).toEqual(simulate(level(g.level), g.plan));
  });

  it('rounds as the reference does: halves to the even side', () => {
    expect([0.5, 1.5, 2.5, 362.5, -0.5, -1.5, 2.4999, 2.5001].map(roundHalfEven)).toEqual([0, 2, 2, 362, 0, -2, 2, 3]);
    expect([0.25, 0.75, 12.25, 0.35, 0.05, 1.45, 7].map(roundTenth)).toEqual([0.2, 0.8, 12.2, 0.3, 0.1, 1.4, 7]);
  });
});

describe('the shift', () => {
  it('stops the robots during an outage', () => {
    const lv = level(7);
    const [from, to] = lv.robotOutage!;
    const p = plan([], [8], 6);
    expect(checkPlan(lv, p)).toEqual([]);
    const { timeline } = simulate(lv, p);
    timeline.robotsActive.forEach((r, k) => expect(r).toBe(from <= k * 5 && k * 5 < to ? 0 : 6));
    expect(timeline.cityLoaded[to / 5]![8]).toBe(timeline.cityLoaded[from / 5]![8]);
    expect(timeline.cityLoaded[to / 5 + 2]![8]).toBeGreaterThan(timeline.cityLoaded[to / 5]![8]!);
  });

  it('opens enough robot lines for a city’s busiest minute, at most 4', () => {
    for (const lv of LEVELS) {
      lv.cities.forEach((c, i) => {
        const busiest = Math.max(...c.arrivals.map((a) => a.perMinute));
        expect(linesFor(lv, i)).toBe(Math.max(1, Math.min(4, Math.ceil(busiest - 1e-9))));
      });
    }
    expect(linesFor(level(3), 1)).toBe(1);
    expect(linesFor(level(3), 0)).toBe(3);
  });

  it('leaves behind what nobody loads, and sends a late truck late', () => {
    const lv = level(1);
    const none = simulate(lv, plan([]));
    expect(none.result.trucks[0]).toEqual({ city: 0, loaded: 0, planned: 120, left: 120, status: 'incomplete' });
    expect(none.result.lines.left).toBe(375);
    expect(none.result.score).toBe(0);
    expect(none.result.stars).toBe(0);
    expect(none.result.badge).toBe(false);

    const late = simulate(lv, plan([block(0, 30, 150, 2)]));
    expect(late.result.trucks[0]).toMatchObject({ loaded: 150, left: 150, status: 'late' });
    expect(late.timeline.departures[0]).toEqual({ city: 0, at: 150, status: 'late' });
    expect(late.result.lines.bonus).toBe(0);
    expect(late.result.lines.late).toBe(135); // 150 parcels, 30 minutes, 0.03 a minute
  });

  it('marks the stretches in which the buffer was full', () => {
    const lv = level(6);
    const { result } = simulate(lv, plan([]));
    expect(result.buffer.cap).toBe(lv.bufferCap);
    expect(result.buffer.fullRanges.length).toBe(1);
    const [from, to] = result.buffer.fullRanges[0]!;
    expect(to).toBe(lv.shiftMinutes + 30);
    expect(result.buffer.series[from / 5]).toBeGreaterThanOrEqual(lv.bufferCap - 0.5);
    expect(result.buffer.series[from / 5 - 1]).toBeLessThan(lv.bufferCap - 0.5);
  });
});

describe('doors', () => {
  it('keeps a city on its door and gives another city the door free longest', () => {
    const lv = level(4);
    const { placed, unplaced } = assignDoors(lv, level4.plan);
    expect(unplaced).toEqual([]);
    expect(placed.map((b) => [b.city, b.door])).toEqual([[0, 0], [2, 1], [1, 0]]);
    const back = assignDoors(lv, plan([block(0, 0, 60), block(1, 0, 60), block(1, 90, 150), block(0, 90, 150)]));
    expect(back.placed.map((b) => [b.city, b.door, b.start])).toEqual([[0, 0, 0], [1, 1, 0], [0, 0, 90], [1, 1, 90]]);
  });
});

describe('checkPlan', () => {
  const kinds = (lv: Level, p: Plan): string[] => checkPlan(lv, p).map((x) => x.kind);

  it('accepts the half hour, the first parcel and the truck time', () => {
    const lv = level(4); // city 0: truck at 105
    expect(checkPlan(lv, plan([block(0, 0, 105)]))).toEqual([]);
    expect(checkPlan(lv, plan([block(0, 30, 120)]))).toEqual([]);
    expect(checkPlan(level(3), plan([block(3, 30, 240)]))).toEqual([]);
    const l6 = level(6); // city 7: first parcel at 100
    expect(checkPlan(l6, plan([block(7, 100, 330)]))).toEqual([]);
  });

  it('refuses other moments', () => {
    const lv = level(4);
    expect(checkPlan(lv, plan([block(0, 15, 90)]))).toEqual([{ kind: 'grid', block: 0 }]);
    expect(checkPlan(lv, plan([block(1, 0, 60), block(1, 60, 165)]))).toEqual([{ kind: 'grid', block: 1 }]); // 105 is another city's truck
    expect(checkPlan(level(6), plan([block(0, 100, 330)]))).toEqual([{ kind: 'grid', block: 0 }]); // 100 is another city's first parcel
    expect(kinds(lv, plan([block(0, -30, 60)]))).toContain('grid');
    expect(kinds(lv, plan([block(5, 0, 60)]))).toEqual(['grid']);
    expect(kinds(lv, plan([{ city: 0, start: 0, end: 60, people: 3 as 2, docks: 1 }]))).toEqual(['grid']);
    expect(kinds(lv, plan([block(0, 0, 60, 1, 0)]))).toEqual(['grid']);
  });

  it('wants at least an hour, and an end within 30 minutes of the truck', () => {
    const lv = level(4);
    expect(checkPlan(lv, plan([block(0, 60, 105)]))).toEqual([{ kind: 'tooShort', block: 0 }]);
    expect(checkPlan(lv, plan([block(1, 0, 30)]))).toEqual([{ kind: 'tooShort', block: 0 }]);
    expect(checkPlan(lv, plan([block(0, 0, 120)]))).toEqual([]); // 15 minutes late is allowed
    expect(checkPlan(lv, plan([block(0, 0, 150)]))).toEqual([{ kind: 'afterTruck', block: 0 }]);
    expect(checkPlan(lv, plan([block(1, 180, 270)]))).toEqual([]);
    expect(checkPlan(level(1), plan([block(0, 60, 180)]))).toEqual([{ kind: 'afterTruck', block: 0 }]);
  });

  it('counts docks, with 15 minutes to switch city', () => {
    const lv = level(4); // 2 docks
    expect(checkPlan(lv, plan([block(0, 0, 60, 1, 2), block(1, 0, 60)]))).toEqual([{ kind: 'noDock', block: 1 }]);
    expect(checkPlan(lv, plan([block(1, 0, 60, 1, 3)]))).toEqual([{ kind: 'noDock', block: 0 }]);
    // The same city can follow at once; another city has to wait a quarter of an hour.
    expect(checkPlan(lv, plan([block(1, 0, 60, 1, 2), block(1, 60, 120, 2, 2)]))).toEqual([]);
    expect(checkPlan(lv, plan([block(1, 0, 60, 1, 2), block(2, 60, 120)]))).toEqual([{ kind: 'noDock', block: 1 }]);
    expect(checkPlan(lv, plan([block(1, 0, 60, 1, 2), block(2, 90, 150)]))).toEqual([]);
    expect(checkPlan(lv, plan([block(0, 0, 105, 1, 2), block(1, 120, 180, 1, 2)]))).toEqual([]); // exactly 15 minutes
    // The problem names the block as the plan lists it, not as the doors are handed out.
    expect(checkPlan(lv, plan([block(2, 60, 120), block(1, 0, 60, 1, 2)]))).toEqual([{ kind: 'noDock', block: 0 }]);
  });

  it('keeps to the limit on people', () => {
    const lv = level(9); // 16 people at most
    expect(lv.peopleCap).toBe(16);
    expect(checkPlan(lv, plan([block(0, 0, 60, 2, 8)]))).toEqual([]);
    expect(checkPlan(lv, plan([block(0, 0, 60, 2, 8), block(1, 30, 90)]))).toEqual([{ kind: 'tooManyPeople', at: 30 }]);
    expect(checkPlan(lv, plan([block(0, 0, 60, 2, 8), block(1, 60, 120)]))).toEqual([]); // one crew leaves as the next starts
    expect(checkPlan(level(8), plan([block(0, 0, 60, 2, 12)]))).toEqual([]); // no limit there
  });

  it('checks the fleet, and robots only where there are any', () => {
    expect(checkPlan(level(3), plan([], [1, 2], 6))).toEqual([]);
    expect(checkPlan(level(3), plan([], [1], 7))).toEqual([{ kind: 'tooManyRobots' }]);
    expect(checkPlan(level(3), plan([], [1], -1))).toEqual([{ kind: 'tooManyRobots' }]);
    expect(checkPlan(level(3), plan([], [9], 2))).toEqual([{ kind: 'robotsOff' }]);
    expect(checkPlan(level(1), plan([block(0, 0, 120)], [0], 0))).toEqual([{ kind: 'robotsOff' }]);
    expect(kinds(level(1), plan([block(0, 0, 120)], [0], 2)).sort()).toEqual(['robotsOff', 'tooManyRobots']);
  });
});

describe('badges', () => {
  const run = (id: number, p: Plan): Result => {
    expect(checkPlan(level(id), p)).toEqual([]);
    return simulate(level(id), p).result;
  };
  const named = (id: number, name: string): Plan => golden.find((g) => g.level === id && g.name === name)!.plan;

  it('every level has a badge the model knows', () => {
    expect(LEVELS.map((l) => l.badge.id)).toEqual(['lean', 'oneDock', 'noDockSmall', 'lean3', 'smallFleet', 'halfBuffer', 'allOnTime', 'allOnTime', 'lean12', 'allOnTime']);
  });

  it('lean: one person is enough', () => {
    const one = run(1, plan([block(0, 0, 120, 1)]));
    expect(one.score).toBeGreaterThanOrEqual(500);
    expect(one.badge).toBe(true);
    expect(run(1, plan([block(0, 0, 120, 2)])).badge).toBe(false);
  });

  it('needs one star as well', () => {
    const r = run(1, plan([block(0, 0, 60, 1)])); // one person, but most parcels stay behind
    expect(r.score).toBeLessThan(500);
    expect(r.badge).toBe(false);
  });

  it('oneDock: never more than 2 docks open at once', () => {
    const two = run(2, plan([block(0, 0, 180, 2), block(1, 0, 120, 1)]));
    expect(two.score).toBeGreaterThanOrEqual(500);
    expect(two.badge).toBe(true);
    const three = run(2, plan([block(0, 0, 180, 1, 2), block(1, 0, 120, 1)]));
    expect(three.score).toBeGreaterThanOrEqual(500);
    expect(three.badge).toBe(false);
  });

  it('noDockSmall: only the biggest city on a dock', () => {
    const robots = run(3, plan([block(0, 0, 240, 2)], [1, 2, 3], 6));
    expect(robots.score).toBeGreaterThanOrEqual(500);
    expect(robots.badge).toBe(true);
    const mixed = run(3, plan([block(0, 0, 240, 2), block(3, 30, 240, 1)], [1, 2], 5));
    expect(mixed.score).toBeGreaterThanOrEqual(500);
    expect(mixed.badge).toBe(false);
  });

  it('lean3: never more than 3 people at work', () => {
    const three = run(4, level4.plan);
    expect(three.badge).toBe(true);
    const four = run(4, plan([block(0, 0, 105, 2), block(2, 60, 180, 2), block(1, 120, 240, 2)]));
    expect(four.score).toBeGreaterThanOrEqual(500);
    expect(four.badge).toBe(false);
  });

  it('follows the goal of the other levels when the score is there', () => {
    for (const g of golden.filter((x) => x.level >= 5)) {
      const lv = level(g.level);
      const out = simulate(lv, g.plan);
      const r = out.result;
      const people = Math.max(0, ...[...new Set(g.plan.blocks.flatMap((b) => [b.start, b.end - 1]))].map((t) => g.plan.blocks.reduce((s, b) => s + (b.start <= t && t < b.end ? b.people * b.docks : 0), 0)));
      const goal =
        lv.badge.id === 'smallFleet' ? g.plan.robots <= 6
        : lv.badge.id === 'halfBuffer' ? out.bufferPeak <= lv.bufferCap / 2
        : lv.badge.id === 'allOnTime' ? r.trucks.every((t) => t.status === 'onTime')
        : people <= 12;
      expect(r.badge, `level ${g.level} ${g.name}`).toBe(goal && r.score >= 500);
    }
  });

  // The goals of the later levels, tried on small made-up nights where a star is easy to reach.
  const night = (id: string, change: Partial<Level> = {}): Level => ({ ...level(3), par: 100, robotsMax: 10, ...change, badge: { id, text: '' } });
  const robotsPlan = (robots: number, start = 0, end = 240): Plan => plan([block(0, start, end, 2)], [1, 2, 3], robots);
  const star = (lv: Level, p: Plan): Result => {
    expect(checkPlan(lv, p)).toEqual([]);
    const r = simulate(lv, p).result;
    expect(r.score).toBeGreaterThanOrEqual(500);
    return r;
  };

  it('smallFleet: at most 6 robots', () => {
    expect(star(night('smallFleet'), robotsPlan(6)).badge).toBe(true);
    expect(star(night('smallFleet'), robotsPlan(7)).badge).toBe(false);
  });

  it('allOnTime: every truck on time', () => {
    const onTime = star(night('allOnTime'), robotsPlan(6));
    expect(onTime.trucks.map((t) => t.status)).toEqual(['onTime', 'onTime', 'onTime', 'onTime']);
    expect(onTime.badge).toBe(true);
    const late = star(night('allOnTime'), plan([block(0, 0, 240, 2), block(3, 30, 270)], [1, 2], 6));
    expect(late.trucks[3]!.status).toBe('late');
    expect(late.badge).toBe(false);
    const short = star(night('allOnTime'), plan([block(0, 0, 240, 2)], [1, 2], 6));
    expect(short.trucks[3]!.status).toBe('incomplete');
    expect(short.badge).toBe(false);
  });

  it('halfBuffer: buffer never over half full', () => {
    const lv = night('halfBuffer', { bufferCap: 100 });
    const early = simulate(lv, robotsPlan(6));
    expect(early.bufferPeak).toBeLessThanOrEqual(50);
    expect(star(lv, robotsPlan(6)).badge).toBe(true);
    const waiting = simulate(lv, robotsPlan(6, 30));
    expect(waiting.bufferPeak).toBeGreaterThan(50);
    expect(star(lv, robotsPlan(6, 30)).badge).toBe(false);
  });

  it('lean12: never more than 12 people at work', () => {
    const busy: Level = { ...night('lean12', { docks: 8, robotsMax: 0 }), cities: [{ volume: 4000, truck: 240, arrivals: [{ from: 0, to: 200, perMinute: 20 }] }] };
    expect(star(busy, plan([block(0, 0, 240, 2, 6)])).badge).toBe(true);
    expect(star(busy, plan([block(0, 0, 240, 2, 4), block(0, 0, 120, 2, 2)])).badge).toBe(true);
    expect(star(busy, plan([block(0, 0, 240, 2, 7)])).badge).toBe(false);
    expect(star(busy, plan([block(0, 0, 240, 2, 6), block(0, 60, 120, 1)])).badge).toBe(false);
  });

  it('an unknown goal is never met', () => {
    expect(star(night('somethingElse'), robotsPlan(6)).badge).toBe(false);
  });
});

describe('LocalScoreService', () => {
  it('answers with the result and the timeline', async () => {
    const service = new LocalScoreService({ delayMs: 0 });
    const { result, timeline } = await service.run(4, level4.plan);
    expect(result.profit).toBe(level4.result.profit);
    expect(timeline.blocks).toEqual(level4.timeline.blocks);
  });

  it('waits before it answers', async () => {
    const service = new LocalScoreService({ delayMs: 40 });
    const t0 = Date.now();
    await service.run(4, level4.plan);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });

  it('refuses a plan that cannot start, with the list of problems', async () => {
    const service = new LocalScoreService({ delayMs: 0 });
    await expect(service.run(4, plan([block(0, 0, 150)]))).rejects.toEqual([{ kind: 'afterTruck', block: 0 }]);
    await expect(service.run(11, plan([]))).rejects.toThrow();
  });
});
