import { describe, expect, it } from 'vitest';
import { COUNTRIES } from '../src/sim/countries';
import { formatSeed, parseSeed, randomSeed, dailySeed, worldSeed } from '../src/game/seed';
import { makeNight } from '../src/game/night';
import { play, validPlan } from '../src/game/model';
import { par, shown, standingPlan } from '../src/game/par';

describe('night seeds', () => {
  it('round-trips and reads sloppy typing', () => {
    for (const c of COUNTRIES) {
      const s = randomSeed(c);
      const code = formatSeed(s);
      expect(code).toMatch(/^[A-Z]{2}-[0-9A-HJKMNP-TV-Z]{6}$/);
      expect(parseSeed(code)).toEqual(s);
      expect(parseSeed(code.toLowerCase().replace('-', ' '))).toEqual(s);
    }
    expect(parseSeed('NL-7KQ2MO')).toEqual(parseSeed('NL-7KQ2M0'));
    expect(parseSeed('XX-7KQ2M0')).toBeNull();
    expect(parseSeed('NL-7KQ2')).toBeNull();
  });

  it('a seed is the same night for everyone, the country picks the hall', () => {
    const a = makeNight(parseSeed('NL-7KQ2M0')!);
    const b = makeNight(parseSeed('nl7kq2m0')!);
    expect(a).toEqual(b);
    const fi = makeNight(parseSeed('FI-7KQ2M0')!);
    expect(fi.cities[0]!.name).not.toBe(a.cities[0]!.name);
    expect(dailySeed(COUNTRIES[0]!, '2026-11-09')).toEqual(dailySeed(COUNTRIES[0]!, '2026-11-09'));
    expect(worldSeed('2026-11-09')).toEqual(worldSeed('2026-11-09'));
  });
});

describe('scoring', () => {
  it('standing plan is valid and scores 100; par scores 1000', () => {
    const night = makeNight(parseSeed('NL-7KQ2M0')!);
    const p = par(night);
    expect(validPlan(standingPlan(night))).toBe(true);
    expect(validPlan(p.plan)).toBe(true);
    expect(shown(play(night, standingPlan(night)).raw, p)).toBe(100);
    expect(shown(play(night, p.plan, p.moves).raw, p)).toBe(1000);
  });
});
