/**
 * The song, as data: a slow ambient piece in D minor with a soft beat.
 * Pure and seeded, so it is testable and the same seed plays the same song.
 *
 * Form, 32 bars, repeating with variations:
 *   bars 0–7    intro      pad and hats, a few lead notes
 *   bars 8–23   groove     soft four-on-the-floor kick, rim on 2 and 4, bass, leads
 *   bars 24–31  breakdown  no kick, pad swells, sparse leads
 * Chords change every 2 bars.
 *
 * The mood follows how busy the hub is (parcels per minute):
 *   0 relaxed  no kick, brushed hats, long bass notes, few leads
 *   1 steady   the song as above
 *   2 driving  kick through intro and groove, 16th hats, pumping 8th bass
 *   3 acid     as driving, plus a squelchy 16th acid line with accents and slides
 */
import { Rng } from '../sim/rng';

export const BPM = 100;
export const STEPS_PER_BAR = 16;
export const FORM_BARS = 32;

export type Voice = 'kick' | 'snare' | 'hat' | 'bass' | 'lead' | 'pad' | 'acid';
export type Mood = 0 | 1 | 2 | 3;
export const MOODS = ['relaxed', 'steady', 'driving', 'acid'] as const;

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
  /** Acid line: a louder, brighter note; and a glide into it from the previous one. */
  accent?: boolean;
  slide?: boolean;
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
  /** How busy the music is (see the top of the file). */
  mood: Mood = 1;

  constructor(private seed = 1) {}

  /** All events in one bar. */
  bar(bar: number): NoteEvent[] {
    const rng = new Rng((this.seed * 7919 + bar * 104729) >>> 0);
    const sec = sectionOf(bar);
    const chord = chordOf(bar);
    const ev: NoteEvent[] = [];
    // Pad: a new chord every 2 bars, held for 2 bars.
    if (bar % 2 === 0) ev.push({ voice: 'pad', step: 0, chord, vel: sec === 'breakdown' ? 0.9 : 0.7, len: 32 });
    const mood = this.mood;
    const busy = mood >= 2;
    // Drums: none when relaxed (a rim now and then); four on the floor, also in the intro, when busy.
    if (mood > 0 && (sec === 'groove' || (busy && sec === 'intro'))) {
      for (let s = 0; s < 16; s += 4) ev.push({ voice: 'kick', step: s, vel: s === 0 ? 1 : 0.85, len: 1 });
      for (const s of [4, 12]) ev.push({ voice: 'snare', step: s, vel: busy ? 0.8 : 0.7, len: 1 });
    }
    if (mood === 0 && sec === 'groove' && bar % 2 === 1) ev.push({ voice: 'snare', step: 12, vel: 0.35, len: 1 });
    if (sec !== 'breakdown' || bar % FORM_BARS >= 28) {
      if (busy && sec !== 'breakdown') {
        // 16th hats, accented on the off-beat.
        for (let s = 0; s < 16; s++) ev.push({ voice: 'hat', step: s, vel: s % 4 === 2 ? 0.75 : 0.3 + rng.next() * 0.2, len: 1 });
      } else {
        for (let s = 2; s < 16; s += 4) ev.push({ voice: 'hat', step: s, vel: (mood === 0 ? 0.25 : 0.5) + rng.next() * 0.3, len: 1 });
        if (sec === 'groove' && mood > 0) for (let s = 0; s < 16; s += 4) if (rng.chance(0.4)) ev.push({ voice: 'hat', step: s + 3, vel: 0.3, len: 1 });
      }
    }
    // Acid line: 16ths over the chord root, minor notes, accents and slides.
    if (mood === 3 && sec !== 'intro') {
      const root = chord[0]! - 12;
      const notes = [0, 0, 0, 12, 3, 7, 10, 0, 12, 5];
      let prev = -1;
      for (let s = 0; s < 16; s++) {
        if (!rng.chance(sec === 'breakdown' ? 0.45 : 0.72)) {
          prev = -1;
          continue;
        }
        const slide = prev >= 0 && rng.chance(0.25);
        const midi = root + notes[Math.floor(rng.next() * notes.length)]!;
        ev.push({ voice: 'acid', step: s, midi, vel: sec === 'breakdown' ? 0.55 : 0.8, len: slide ? 2 : 1, accent: rng.chance(0.3), slide });
        prev = midi;
      }
    }
    // Bass: when busy, pumping 8ths on the root; else root on 1, fifth or octave on the "and" of 2, root on 3.
    if (sec === 'groove' && busy && mood < 3) {
      const root = chord[0]! - 12;
      for (let s = 2; s < 16; s += 4) ev.push({ voice: 'bass', step: s, midi: s === 10 && rng.chance(0.4) ? root + 12 : root, vel: 0.75, len: 2 });
      ev.push({ voice: 'bass', step: 0, midi: root, vel: 0.9, len: 2 });
    } else if (sec === 'groove' && mood === 0) {
      ev.push({ voice: 'bass', step: 0, midi: chord[0]! - 12, vel: 0.7, len: 14 });
    } else if (sec === 'groove' && mood === 1) {
      const root = chord[0]! - 12;
      ev.push({ voice: 'bass', step: 0, midi: root, vel: 0.9, len: 6 });
      ev.push({ voice: 'bass', step: 6, midi: rng.chance(0.5) ? root + 7 : root + 12, vel: 0.6, len: 2 });
      ev.push({ voice: 'bass', step: 8, midi: root, vel: 0.8, len: 6 });
      if (rng.chance(0.5)) ev.push({ voice: 'bass', step: 14, midi: root + 10, vel: 0.5, len: 2 });
    }
    // Lead: a slow random walk over the pentatonic, on 8th notes (fewer when relaxed or with the acid line).
    const p = { intro: 0.18, groove: 0.32, breakdown: 0.14 }[sec] * [0.6, 1, 0.9, 0.5][mood]!;
    for (let s = 0; s < 16; s += 2) {
      if (!rng.chance(p)) continue;
      this.lastLead = Math.max(0, Math.min(LEAD_SCALE.length - 1, this.lastLead + Math.round((rng.next() - 0.5) * 4)));
      ev.push({ voice: 'lead', step: s, midi: LEAD_SCALE[this.lastLead]!, vel: 0.5 + rng.next() * 0.4, len: rng.chance(0.3) ? 4 : 2 });
    }
    return ev.sort((a, b) => a.step - b.step);
  }
}
