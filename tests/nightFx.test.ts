import { describe, expect, it } from 'vitest';
import { NIGHT_PRESETS, NIGHT_SWITCHES, normalizeNightFx, presetOf } from '../src/scene/nightFx';

describe('night effects', () => {
  it('starts as the full party', () => {
    expect(normalizeNightFx(undefined)).toEqual(NIGHT_PRESETS.party);
    expect(presetOf(normalizeNightFx(null))).toBe('party');
  });

  it('keeps stored switches, clamps the glow and drops junk', () => {
    const fx = normalizeNightFx({ glow: 3, crowd: false, strobe: 'yes', junk: 1 });
    expect(fx.glow).toBe(1);
    expect(fx.crowd).toBe(false);
    expect(fx.strobe).toBe(true);
    expect('junk' in fx).toBe(false);
  });

  it('recognises each preset, and none once a switch differs', () => {
    for (const id of ['party', 'calm', 'dark'] as const) expect(presetOf({ ...NIGHT_PRESETS[id] })).toBe(id);
    expect(presetOf({ ...NIGHT_PRESETS.calm, crowd: true })).toBeNull();
  });

  it('has a switch for every effect but the glow', () => {
    const keys = Object.keys(NIGHT_PRESETS.party).filter((k) => k !== 'glow').sort();
    expect(NIGHT_SWITCHES.map((s) => s.id).sort()).toEqual(keys);
  });
});
