import { describe, expect, it } from 'vitest';

import { COUNTRIES, COUNTRY, setCountry } from '../src/sim/countries';
import { areas, NORTH_CITIES, rangeOf, SOUTH_CITIES, split, translatePc } from '../src/sim/postcodes';

describe('switching the country while the hall runs', () => {
  it('keeps every parcel in its cage or box', () => {
    const was = COUNTRY;
    const north = NORTH_CITIES.map((c) => ({ c, parts: split(c, 6) }));
    const south = SOUTH_CITIES.map((c) => ({ c, parts: split(c, 2) }));
    const next = COUNTRIES.find((c) => c.id !== was.id)!;
    setCountry(next.id);
    expect(COUNTRY).toBe(next);
    expect(NORTH_CITIES[0]).toBe(next.cities[0]);
    for (const [list, now, n] of [
      [north, NORTH_CITIES, 6],
      [south, SOUTH_CITIES, 2],
    ] as const) {
      list.forEach(({ parts }, i) => {
        const newParts = split(now[i]!, n);
        // (A town with only one area has it in every part: nothing to keep apart.)
        if (areas(now[i]!).length < n) return;
        parts.forEach(([a, b], k) => {
          for (const pc of [a, b]) expect(rangeOf(newParts, translatePc(pc, was, 6, 2))).toBe(k);
        });
      });
    }
    setCountry(was.id);
  });
});
