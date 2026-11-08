/**
 * The song, as data: a slow ambient piece in D minor with a soft beat.
 * Pure and seeded, so it is testable and the same seed plays the same song.
 *
 * Form, 32 bars, repeating with variations:
 *   bars 0–7    intro      pad and hats, a few lead notes
 *   bars 8–23   groove     soft four-on-the-floor kick, rim on 2 and 4, bass, leads
 *   bars 24–31  breakdown  no kick, pad swells, sparse leads
 * Chords change every 2 bars.
 */
import { Rng } from '../sim/rng';

export const BPM = 100;
export const STEPS_PER_BAR = 16;
export const FORM_BARS = 32;

export type Voice = 'kick' | 'snare' | 'hat' | 'bass' | 'lead' | 'pad';

export interface NoteEvent {
  voice: Voice;
  /** 16th step in the bar, 0–15. */
  step: number;
  /** MIDI note (melodic voices only). */
  midi?: number;
  /** For pads: the whole chord. */
  chord?: number[];
  vel: number;
  /** Length in 16th steps. */
  len: number;
}

export type Section = 'intro' | 'groove' | 'breakdown';

/** Chords as MIDI notes around middle C, D minor: i – VI – III – VII and a variation. */
const PROGRESSIONS: number[][][] = [
  [
    [50, 53, 57, 60], // Dm7
    [46, 50, 53, 57], // Bbmaj7
    [53, 57, 60, 64], // Fmaj7
    [48, 52, 55, 59], // Cmaj7 (C E G B)
  ],
  [
    [50, 53, 57, 62], // Dm(add oct)
    [55, 58, 62, 65], // Gm7
    [46, 50, 53, 58], // Bb
    [45, 49, 52, 57], // A (dominant colour)
  ],
];

/** D minor pentatonic for the lead, two octaves. */
const LEAD_SCALE = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84];

export function sectionOf(bar: number): Section {
  const b = ((bar % FORM_BARS) + FORM_BARS) % FORM_BARS;
  return b < 8 ? 'intro' : b < 24 ? 'groove' : 'breakdown';
}

/** How busy the music is, 0..1, for the visuals. */
export function energyOf(bar: number): number {
  return { intro: 0.35, groove: 0.85, breakdown: 0.25 }[sectionOf(bar)];
}

export function chordOf(bar: number): number[] {
  const cycle = Math.floor(bar / FORM_BARS);
  const prog = PROGRESSIONS[cycle % PROGRESSIONS.length]!;
  return prog[Math.floor((((bar % 8) + 8) % 8) / 2)]!;
}

export class Composer {
  private lastLead = 4;

  constructor(private seed = 1) {}

  /** All events in one bar. */
  bar(bar: number): NoteEvent[] {
    const rng = new Rng((this.seed * 7919 + bar * 104729) >>> 0);
    const sec = sectionOf(bar);
    const chord = chordOf(bar);
    const ev: NoteEvent[] = [];
    // Pad: a new chord every 2 bars, held for 2 bars.
    if (bar % 2 === 0) ev.push({ voice: 'pad', step: 0, chord, vel: sec === 'breakdown' ? 0.9 : 0.7, len: 32 });
    // Drums.
    if (sec === 'groove') {
      for (let s = 0; s < 16; s += 4) ev.push({ voice: 'kick', step: s, vel: s === 0 ? 1 : 0.85, len: 1 });
      for (const s of [4, 12]) ev.push({ voice: 'snare', step: s, vel: 0.7, len: 1 });
    }
    if (sec !== 'breakdown' || bar % FORM_BARS >= 28) {
      for (let s = 2; s < 16; s += 4) ev.push({ voice: 'hat', step: s, vel: 0.5 + rng.next() * 0.3, len: 1 });
      if (sec === 'groove') for (let s = 0; s < 16; s += 4) if (rng.chance(0.4)) ev.push({ voice: 'hat', step: s + 3, vel: 0.3, len: 1 });
    }
    // Bass: root on 1, fifth or octave on the "and" of 2, root on 3.
    if (sec === 'groove') {
      const root = chord[0]! - 12;
      ev.push({ voice: 'bass', step: 0, midi: root, vel: 0.9, len: 6 });
      ev.push({ voice: 'bass', step: 6, midi: rng.chance(0.5) ? root + 7 : root + 12, vel: 0.6, len: 2 });
      ev.push({ voice: 'bass', step: 8, midi: root, vel: 0.8, len: 6 });
      if (rng.chance(0.5)) ev.push({ voice: 'bass', step: 14, midi: root + 10, vel: 0.5, len: 2 });
    }
    // Lead: a slow random walk over the pentatonic, on 8th notes.
    const p = { intro: 0.18, groove: 0.32, breakdown: 0.14 }[sec];
    for (let s = 0; s < 16; s += 2) {
      if (!rng.chance(p)) continue;
      this.lastLead = Math.max(0, Math.min(LEAD_SCALE.length - 1, this.lastLead + Math.round((rng.next() - 0.5) * 4)));
      ev.push({ voice: 'lead', step: s, midi: LEAD_SCALE[this.lastLead]!, vel: 0.5 + rng.next() * 0.4, len: rng.chance(0.3) ? 4 : 2 });
    }
    return ev.sort((a, b) => a.step - b.step);
  }
}
