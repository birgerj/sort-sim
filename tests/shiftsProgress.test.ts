import { describe, expect, it } from 'vitest';
import type { Plan, Result } from '../src/shifts/contract';
import { createProgress, PROGRESS_KEY, type StorageLike } from '../src/ui/shifts/progress';
import { clock, cost, hours, money, num, planTime, price, starTargets } from '../src/ui/shifts/format';
import fixture from './fixtures/shifts/level4.json' with { type: 'json' };

/** A storage object like the browser's, kept in a map. */
function memory(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string>; writes: number } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    writes: 0,
    getItem: (k) => map.get(k) ?? null,
    setItem(k, v) {
      this.writes++;
      map.set(k, v);
    },
  };
}

const plan: Plan = { blocks: [{ city: 0, start: 0, end: 105, people: 2, docks: 1 }], robotCities: [], robots: 0 };

function result(score: number, stars: 0 | 1 | 2 | 3, badge = false, profit = score): Result {
  return {
    profit,
    score,
    stars,
    badge,
    lines: { revenue: 900, bonus: 100, late: 0, left: 0, docks: 150, people: 300, robots: 0, buffer: 10 },
    trucks: [],
    buffer: { series: [0, 5, 0], cap: 800, fullRanges: [] },
  };
}

describe('shift progress', () => {
  it('starts empty: intro not seen, only level 1 open', () => {
    const p = createProgress(memory());
    expect(p.introSeen()).toBe(false);
    expect(p.unlocked(1)).toBe(true);
    expect(p.unlocked(2)).toBe(false);
    expect(p.unlocked(11)).toBe(false);
    expect(p.nextLevel()).toBe(1);
    expect(p.total()).toBe(0);
    expect(p.level(1)).toBeUndefined();
  });

  it('remembers the intro under the agreed key', () => {
    const s = memory();
    createProgress(s).markIntroSeen();
    expect(JSON.parse(s.map.get(PROGRESS_KEY)!).introSeen).toBe(true);
    expect(createProgress(s).introSeen()).toBe(true);
  });

  it('one star opens the next level; none does not', () => {
    const p = createProgress(memory());
    p.record(1, plan, result(300, 0));
    expect(p.unlocked(2)).toBe(false);
    expect(p.nextLevel()).toBe(1);
    p.record(1, plan, result(620, 1));
    expect(p.unlocked(2)).toBe(true);
    expect(p.unlocked(3)).toBe(false);
    expect(p.nextLevel()).toBe(2);
    expect(p.doneCount()).toBe(1);
  });

  it('keeps the best score, most stars and the badge; a worse replay lowers nothing', () => {
    const s = memory();
    const p = createProgress(s);
    expect(p.record(1, plan, result(920, 3, true)).newBest).toBe(true);
    const again = p.record(1, plan, result(610, 1, false));
    expect(again.newBest).toBe(false);
    expect(again.attempt).toBe(2);
    const l = createProgress(s).level(1)!;
    expect(l).toMatchObject({ best: 920, stars: 3, badge: true, attempts: 2 });
    expect(p.total()).toBe(920);
    expect(p.starCount()).toBe(3);
    expect(p.badgeCount()).toBe(1);
  });

  it('hands back the attempt before this one to compare with', () => {
    const p = createProgress(memory());
    expect(p.record(4, plan, result(800, 2, false, 560)).previous).toBeUndefined();
    const second = p.record(4, plan, result(906, 3, false, 606));
    expect(second.previous?.profit).toBe(560);
    expect(second.previous?.lines.docks).toBe(150);
    expect(p.level(4)!.previous!.profit).toBe(606);
  });

  it('stores the last plan as a copy, also without a result', () => {
    const s = memory();
    const p = createProgress(s);
    const mine: Plan = { blocks: [{ ...plan.blocks[0]! }], robotCities: [1], robots: 3 };
    p.savePlan(3, mine);
    mine.blocks[0]!.end = 999;
    mine.robots = 0;
    expect(createProgress(s).level(3)!.lastPlan).toEqual({ blocks: [plan.blocks[0]], robotCities: [1], robots: 3 });
    expect(p.level(3)!.attempts).toBe(0);
    expect(p.unlocked(4)).toBe(false);
  });

  it('adds the best score of every level into the total and never counts a negative one', () => {
    const p = createProgress(memory());
    p.record(1, plan, result(1000, 3));
    p.record(2, plan, result(857, 2));
    p.record(3, plan, result(-40, 0));
    expect(p.total()).toBe(1857);
    expect(p.level(3)!.best).toBe(0);
  });

  it('takes a whole fixture result', () => {
    const p = createProgress(memory());
    const r = p.record(4, fixture.plan as Plan, fixture.result as Result);
    expect(r.attempt).toBe(1);
    expect(p.level(4)).toMatchObject({ best: 906, stars: 3, badge: true });
    expect(p.level(4)!.lastPlan!.blocks).toHaveLength(3);
  });

  it('works without storage', () => {
    const p = createProgress(null);
    p.markIntroSeen();
    p.record(1, plan, result(700, 1));
    expect(p.introSeen()).toBe(true);
    expect(p.unlocked(2)).toBe(true);
  });

  it('works when storage throws on reading and on writing', () => {
    const broken: StorageLike = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('full');
      },
    };
    const p = createProgress(broken);
    expect(() => p.record(1, plan, result(700, 1))).not.toThrow();
    expect(() => p.savePlan(2, plan)).not.toThrow();
    expect(p.total()).toBe(700);
  });

  it('drops junk that was stored', () => {
    for (const junk of ['not json', '42', '[]', '{"levels":"x"}']) {
      const p = createProgress(memory({ [PROGRESS_KEY]: junk }));
      expect(p.total()).toBe(0);
      expect(p.introSeen()).toBe(false);
    }
    const p = createProgress(
      memory({
        [PROGRESS_KEY]: JSON.stringify({
          introSeen: 'yes',
          levels: {
            1: { best: 'high', stars: 9, badge: 1, attempts: 2, lastPlan: { blocks: [{ city: 0, start: 0, end: 60, people: 5, docks: 0 }, 'x', { city: 'a' }] }, previous: { profit: 'x' } },
            0: { best: 500, stars: 3 },
            12: { best: 500, stars: 3 },
            abc: {},
            2: null,
          },
        }),
      }),
    );
    expect(p.introSeen()).toBe(false);
    expect(Object.keys(p.data().levels)).toEqual(['1']);
    const l = p.level(1)!;
    expect(l.best).toBe(0);
    expect(l.stars).toBe(3);
    expect(l.badge).toBe(false);
    expect(l.lastPlan).toEqual({ blocks: [{ city: 0, start: 0, end: 60, people: 1, docks: 1 }], robotCities: [], robots: 0 });
    expect(l.previous).toBeUndefined();
  });

  it('reset wipes everything', () => {
    const s = memory();
    const p = createProgress(s);
    p.markIntroSeen();
    p.record(1, plan, result(700, 1));
    p.reset();
    expect(p.introSeen()).toBe(false);
    expect(createProgress(s).total()).toBe(0);
  });

  it('all ten done: the next level stays the last one', () => {
    const p = createProgress(memory());
    for (let id = 1; id <= 10; id++) p.record(id, plan, result(900, 3));
    expect(p.nextLevel()).toBe(10);
    expect(p.doneCount()).toBe(10);
    expect(p.total()).toBe(9000);
  });
});

describe('how the screens write figures', () => {
  it('money has the sign, a space and thousands separators', () => {
    expect(money(606)).toBe('§ 606');
    expect(money(23762)).toBe('§ 23,762');
    expect(money(-144)).toBe('− § 144');
    expect(money(-0.2)).toBe('§ 0');
    expect(cost(144)).toBe('− § 144');
    expect(cost(0)).toBe('§ 0');
    expect(price(1.5)).toBe('§ 1.50');
    expect(price(25)).toBe('§ 25');
    expect(num(59480)).toBe('59,480');
  });

  it('the clock starts at 22:00 and passes midnight', () => {
    expect(clock(0)).toBe('22:00');
    expect(clock(105)).toBe('23:45');
    expect(clock(120)).toBe('00:00');
    expect(clock(480)).toBe('06:00');
  });

  it('durations and plan time', () => {
    expect(hours(345)).toBe('5 h 45');
    expect(hours(120)).toBe('2 h');
    expect(planTime(fixture.plan as Plan)).toEqual({ dock: 345, people: 570 });
  });

  it('star targets are half, three quarters and nine tenths of par', () => {
    expect(starTargets({ par: 669 } as never)).toEqual([335, 502, 602]);
  });
});
