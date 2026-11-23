import { describe, expect, it } from 'vitest';
import { TROPHIES, decorationShown } from '../src/shifts/trophies';
import { onDecor, setTrophies, setXmas, shows, trophies } from '../src/sim/season';

describe('trophies', () => {
  it('has one for every level, each a decoration of its own with a plain name', () => {
    expect(TROPHIES.map((t) => t.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(TROPHIES.map((t) => t.id)).size).toBe(10);
    for (const t of TROPHIES) expect(t.name.length).toBeGreaterThan(3);
  });

  it('shows a decoration when Christmas is on or its level is earned', () => {
    expect(decorationShown('lights', false, [])).toBe(false);
    expect(decorationShown('lights', false, [1])).toBe(true);
    expect(decorationShown('trees', false, [1, 2, 3])).toBe(false);
    expect(decorationShown('trees', false, new Set([7]))).toBe(true);
    for (const t of TROPHIES) expect(decorationShown(t.id, true, [])).toBe(true);
    // All ten earned is the whole Christmas hall.
    for (const t of TROPHIES) expect(decorationShown(t.id, false, TROPHIES.map((x) => x.level))).toBe(true);
  });

  it('is live in the hall: earning tells the listeners, and switching Christmas off leaves the trophies', () => {
    let told = 0;
    onDecor(() => told++);
    setXmas(false);
    setTrophies([]);
    const base = told;
    setTrophies([3, 1, 3]);
    expect(told).toBe(base + 1);
    expect(trophies()).toEqual([1, 3]);
    // (The same again changes nothing.)
    setTrophies([1, 3]);
    expect(told).toBe(base + 1);
    expect(shows('lights')).toBe(true);
    expect(shows('canes')).toBe(true);
    expect(shows('market')).toBe(false);
    setXmas(true);
    expect(told).toBe(base + 2);
    expect(shows('market')).toBe(true);
    setXmas(false);
    expect(shows('market')).toBe(false);
    expect(shows('lights')).toBe(true);
    setTrophies([]);
    expect(shows('lights')).toBe(false);
  });
});
