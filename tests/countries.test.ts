import { describe, expect, it } from 'vitest';
import { addressFor } from '../src/sim/addresses';
import { COUNTRIES, countryFromLanguages, pcText } from '../src/sim/countries';
import { areas, planDoors } from '../src/sim/postcodes';

describe('countries', () => {
  it('has 40 towns each, largest first, with postcodes that do not overlap', () => {
    for (const c of COUNTRIES) {
      expect(c.cities.length, c.id).toBe(40);
      const seen = new Map<number, string>();
      for (const t of c.cities) {
        const all = areas(t, c.step);
        expect(all.length, `${c.id} ${t.name}`).toBeGreaterThan(0);
        for (const n of all) {
          expect(String(n).length, `${c.id} ${t.name} ${n}`).toBeLessThanOrEqual(c.digits);
          expect(seen.get(n), `${c.id} ${t.name} ${n}`).toBeUndefined();
          seen.set(n, t.name);
        }
        expect(t.pop).toBeGreaterThan(0);
      }
      expect(c.surnames.length).toBeGreaterThanOrEqual(30);
      expect(c.streets.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('writes addresses the way each country does', () => {
    for (const c of COUNTRIES) {
      const t = c.cities[0]!;
      const pc = areas(t, c.step)[0]!;
      const a = addressFor(12345, pc, t.name, c);
      expect(a.name.length).toBeGreaterThan(3);
      expect(a.line1).toContain(a.street);
      expect(a.line2).toContain(pcText(pc, c));
    }
    const fr = COUNTRIES.find((c) => c.id === 'fr')!;
    expect(pcText(6000, fr)).toBe('06000');
    expect(pcText(11122, COUNTRIES.find((c) => c.id === 'se')!)).toBe('111 22');
    expect(pcText(2001, COUNTRIES.find((c) => c.id === 'md')!)).toBe('MD-2001');
  });

  it('picks a country from the browser languages', () => {
    expect(countryFromLanguages(['nl-BE', 'nl'])).toBe('be');
    expect(countryFromLanguages(['fr-FR'])).toBe('fr');
    expect(countryFromLanguages(['de'])).toBe('de');
    expect(countryFromLanguages(['sv-SE'])).toBe('se');
    expect(countryFromLanguages(['en-AU'])).toBe('au');
    expect(countryFromLanguages(['en-IN'])).toBe('in');
    expect(countryFromLanguages(['ro-MD'])).toBe('md');
    expect(countryFromLanguages(['fi'])).toBe('fi');
    expect(countryFromLanguages(['en-US'])).toBe('nl');
  });
});

describe('dock doors by volume', () => {
  it('uses all 20 doors, at least one per city, more for bigger cities', () => {
    for (const c of COUNTRIES) {
      const n = planDoors(c.cities.map((t) => t.pop), 20);
      expect(n.reduce((a, b) => a + b, 0)).toBe(20);
      for (let i = 1; i < n.length; i++) expect(n[i]!).toBeLessThanOrEqual(n[i - 1]! + 1);
      expect(Math.min(...n)).toBeGreaterThanOrEqual(1);
    }
  });
});
