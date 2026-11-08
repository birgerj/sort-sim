import { describe, expect, it } from 'vitest';
import { chordOf, Composer, energyOf, FORM_BARS, sectionOf } from '../src/audio/composer';

describe('composer', () => {
  it('plays the same song for the same seed', () => {
    const a = new Composer(42);
    const b = new Composer(42);
    for (let bar = 0; bar < 64; bar++) expect(a.bar(bar)).toEqual(b.bar(bar));
  });

  it('follows the form: kick only in the groove (deep style)', () => {
    const c = new Composer(3);
    c.mood = 1;
    for (let bar = 0; bar < FORM_BARS * 2; bar++) {
      const kicks = c.bar(bar).filter((e) => e.voice === 'kick').length;
      if (sectionOf(bar) === 'groove') expect(kicks).toBe(4);
      else expect(kicks).toBe(0);
      expect(energyOf(bar)).toBeGreaterThan(0);
    }
  });

  it('writes valid notes in order', () => {
    const c = new Composer(9);
    for (let bar = 0; bar < 96; bar++) {
      const ev = c.bar(bar);
      for (let k = 0; k < ev.length; k++) {
        const e = ev[k]!;
        expect(e.step).toBeGreaterThanOrEqual(0);
        expect(e.step).toBeLessThan(16);
        expect(e.vel).toBeGreaterThan(0);
        expect(e.vel).toBeLessThanOrEqual(1);
        if (k) expect(e.step).toBeGreaterThanOrEqual(ev[k - 1]!.step);
        if (e.voice === 'lead' || e.voice === 'bass') expect(e.midi).toBeGreaterThan(20);
        if (e.voice === 'pad') expect(e.chord).toEqual(chordOf(bar));
      }
    }
  });

  it('changes with the style: no kick when ambient, pads only when slow, acid only at the top', () => {
    for (const mood of [0, 1, 2, 3] as const) {
      const c = new Composer(5);
      c.mood = mood;
      let kicks = 0;
      let acid = 0;
      for (let bar = 0; bar < FORM_BARS; bar++) {
        const ev = c.bar(bar);
        kicks += ev.filter((e) => e.voice === 'kick').length;
        acid += ev.filter((e) => e.voice === 'acid').length;
        for (const e of ev) if (e.voice === 'acid') expect(e.midi).toBeGreaterThan(20);
      }
      const pads = (() => {
        const c2 = new Composer(5);
        c2.mood = mood;
        let n = 0;
        for (let bar = 0; bar < FORM_BARS; bar++) n += c2.bar(bar).filter((e) => e.voice === 'pad').length;
        return n;
      })();
      // Pads belong to the slow styles; house and acid have none.
      if (mood >= 2) expect(pads).toBe(0);
      else expect(pads).toBeGreaterThan(0);
      if (mood === 0) expect(kicks).toBe(0);
      else expect(kicks).toBeGreaterThan(0);
      if (mood === 3) expect(acid).toBeGreaterThan(50);
      else expect(acid).toBe(0);
    }
  });
});
