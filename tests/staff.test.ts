import { describe, expect, it } from 'vitest';
import { COUNTRIES } from '../src/sim/countries';
import { duration, firstNames, Staff, staffName } from '../src/sim/staff';

describe('staff', () => {
  it('has first names for men and women in every country', () => {
    for (const c of COUNTRIES) {
      const { men, women } = firstNames(c);
      expect(men.length, c.id).toBeGreaterThanOrEqual(8);
      expect(women.length, c.id).toBeGreaterThanOrEqual(8);
    }
  });

  it('gives 50 different names, the same every time', () => {
    for (const c of COUNTRIES) {
      const taken = new Set<string>();
      const names = Array.from({ length: 50 }, (_, i) => staffName(c, i % 3 === 0, i * 31, taken));
      expect(new Set(names).size, c.id).toBe(50);
      expect(staffName(c, false, 62)).toBe(staffName(c, false, 62));
      for (const n of names) expect(n.split(' ').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('counts working and waiting time, and jobs started', () => {
    const s = new Staff(COUNTRIES[0]);
    let busy = false;
    const m = s.add('picker', 'Door 1', false, 1, {}, () => busy, 0);
    for (let t = 0; t <= 10; t++) s.tick(t); // waiting 10
    busy = true;
    for (let t = 11; t <= 40; t++) s.tick(t); // working 30
    s.tick(1000); // a jump: counts at most 5
    expect(m.wait).toBe(10);
    expect(m.work).toBe(35);
    expect(m.jobs).toBe(1);
    expect(Staff.workPct(m)).toBe(78);
    expect(s.find(m.obj)).toBe(m);
    expect(duration(65)).toBe('1 h 05 min');
    expect(duration(7.9)).toBe('7 min');
  });
});
