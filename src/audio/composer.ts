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
 * The style follows how busy the hub is (parcels per minute), four of them:
 *   0 ambient     warm pads, long bass notes, a few bell notes, no drums
 *   1 deep        a thin pad now and then, soft kick and rim, a syncopated bass, leads
 *   2 house       no pads: a pounding four-on-the-floor kick, claps, open hats on the
 *                 off-beat, an off-beat octave bass and short chord stabs
 *   3 acid techno no pads or leads: hard kick, rolling hats, an acid line from written 303-style patterns
 */
import { Rng } from '../sim/rng';

export const BPM = 100;
export const STEPS_PER_BAR = 16;
export const FORM_BARS = 32;

export type Voice = 'kick' | 'snare' | 'clap' | 'hat' | 'bass' | 'lead' | 'pad' | 'stab' | 'acid';
export type Mood = 0 | 1 | 2 | 3;
export const MOODS = ['ambient', 'deep', 'house', 'acid techno'] as const;

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
  /** Hats: an open hat (longer). */
  open?: boolean;
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

/**
 * Acid lines: written patterns in the way 303 lines are made, not random notes. One step per
 * 16th, separated by spaces (the bars' quarters by "|", for reading only):
 *   a number   a note, in semitones above the chord's root (12: the octave up, 1: the flat
 *              second, the "phrygian" squelch; 3, 5, 7, 10: the minor scale's colours)
 *   A          accented (louder, the filter opens wider)
 *   S          slides into the next note (no new attack, the pitch glides; best into an octave)
 *   -          a rest      _  a tie: the note before goes on
 * What makes them work, as the 303's own sequencer teaches: mostly the root, one or two
 * flourishes, rests to leave room for the kick, accents in pairs now and then, slides into an
 * octave jump, and a pattern that repeats. Two of them are shorter than a bar (12 and 3 steps),
 * so they turn against the four-on-the-floor kick, the classic acid trick.
 */
const ACID_PATTERNS = [
  '0A 0 12S 0 | 0 3 0 0A | 12 0 10S 12 | 0 0 7 0',
  '0A - 0 12 | - 0 3S 5 | 0A - 0 10 | 12S 0 - 7',
  '0 0A 1S 0 | 0 12 0 1 | 0A 0 12S 13 | 0 7 0 3',
  '0A 0 0 12 | 0 _ 3 0 | 0 0A 12 _ | 10 0 7S 12',
  '0 3 7 10A | 12 10S 7 3 | 0 0 12A 0 | 7S 5 3 0',
  '0A 0A - 12 | 0 - 0 3 | 0A 0A - 15 | 12S 10 7 5',
  '0 12 0 12A | 0 12S 0 10 | 0 12 0 12A | 3S 5 7 12',
  '0A 0 12 0 3 0 0A 12S 10 0 7 0',
  '0A 12 0',
  '0A - - 0 | - - 12S 0 | 0 - 3 - | 7S 5 - 0',
].map(parseAcid);
/** Last beat of the 4th and 8th bar of a pattern: a flourish instead. */
const ACID_FILLS = ['12S 15 12S 10', '0 12A 0 12A', '7S 10 12S 15', '3S 5 7S 12', '0A 1S 0 -'].map(parseAcid);

interface AcidStep {
  /** Semitones above the root; null: a rest; 'tie': the note before goes on. */
  n: number | null | 'tie';
  accent: boolean;
  slide: boolean;
}

function parseAcid(text: string): AcidStep[] {
  return text
    .split(/\s+/)
    .filter((t) => t && t !== '|')
    .map((t) => (t === '-' ? { n: null, accent: false, slide: false } : t === '_' ? { n: 'tie' as const, accent: false, slide: false } : { n: parseInt(t, 10), accent: t.includes('A'), slide: t.includes('S') }));
}

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
  /** The bar being written (for the acid patterns that run across bars). */
  private barNo = 0;
  /** How busy the music is (see the top of the file). */
  mood: Mood = 1;

  constructor(private seed = 1) {}

  /** All events in one bar. */
  bar(bar: number): NoteEvent[] {
    const rng = new Rng((this.seed * 7919 + bar * 104729) >>> 0);
    const sec = sectionOf(bar);
    const chord = chordOf(bar);
    const ev: NoteEvent[] = [];
    const inForm = ((bar % FORM_BARS) + FORM_BARS) % FORM_BARS;
    const root = chord[0]! - 12;
    switch (this.mood) {
      case 0:
        this.ambient(bar, sec, chord, root, rng, ev);
        break;
      case 1:
        this.deep(bar, sec, chord, root, rng, ev);
        break;
      case 2:
        this.house(inForm, sec, chord, root, rng, ev);
        break;
      default:
        this.barNo = bar;
        this.acid(inForm, sec, root, rng, ev);
    }
    return ev.sort((a, b) => a.step - b.step);
  }

  /** Lead: a slow random walk over the pentatonic, on 8th notes, with chance p per 8th. */
  private lead(p: number, rng: Rng, ev: NoteEvent[], long = 0.3): void {
    for (let s = 0; s < 16; s += 2) {
      if (!rng.chance(p)) continue;
      this.lastLead = Math.max(0, Math.min(LEAD_SCALE.length - 1, this.lastLead + Math.round((rng.next() - 0.5) * 4)));
      ev.push({ voice: 'lead', step: s, midi: LEAD_SCALE[this.lastLead]!, vel: 0.5 + rng.next() * 0.4, len: rng.chance(long) ? 4 : 2 });
    }
  }

  /** 0: pads carry it; soft shaker hats in the groove, a long bass note, a few bell notes. */
  private ambient(bar: number, sec: Section, chord: number[], root: number, rng: Rng, ev: NoteEvent[]): void {
    if (bar % 2 === 0) ev.push({ voice: 'pad', step: 0, chord, vel: sec === 'breakdown' ? 0.95 : 0.8, len: 32 });
    if (sec === 'groove') {
      for (let s = 2; s < 16; s += 4) ev.push({ voice: 'hat', step: s, vel: 0.18 + rng.next() * 0.15, len: 1 });
      if (bar % 2 === 0) ev.push({ voice: 'bass', step: 0, midi: root, vel: 0.65, len: 28 });
      if (bar % 4 === 3) ev.push({ voice: 'snare', step: 12, vel: 0.25, len: 1 });
    }
    this.lead({ intro: 0.1, groove: 0.16, breakdown: 0.08 }[sec], rng, ev, 0.6);
  }

  /** 1: deep and laid back; a thin pad every 4 bars, kick and rim in the groove, a moving bass. */
  private deep(bar: number, sec: Section, chord: number[], root: number, rng: Rng, ev: NoteEvent[]): void {
    if (bar % 4 === 0) ev.push({ voice: 'pad', step: 0, chord, vel: 0.45, len: 48 });
    if (sec === 'groove') {
      for (let s = 0; s < 16; s += 4) ev.push({ voice: 'kick', step: s, vel: s === 0 ? 0.8 : 0.65, len: 1 });
      for (const s of [4, 12]) ev.push({ voice: 'snare', step: s, vel: 0.55, len: 1 });
      ev.push({ voice: 'bass', step: 0, midi: root, vel: 0.9, len: 6 });
      ev.push({ voice: 'bass', step: 6, midi: rng.chance(0.5) ? root + 7 : root + 12, vel: 0.6, len: 2 });
      ev.push({ voice: 'bass', step: 8, midi: root, vel: 0.8, len: 6 });
      if (rng.chance(0.5)) ev.push({ voice: 'bass', step: 14, midi: root + 10, vel: 0.5, len: 2 });
    }
    if (sec !== 'breakdown' || bar % FORM_BARS >= 28) {
      for (let s = 2; s < 16; s += 4) ev.push({ voice: 'hat', step: s, vel: 0.45 + rng.next() * 0.3, len: 1 });
      if (sec === 'groove') for (let s = 0; s < 16; s += 4) if (rng.chance(0.4)) ev.push({ voice: 'hat', step: s + 3, vel: 0.3, len: 1 });
    }
    this.lead({ intro: 0.18, groove: 0.3, breakdown: 0.14 }[sec], rng, ev);
  }

  /** 2: pounding house; kick on every beat, claps, open hats off the beat, octave bass, stabs. */
  private house(b: number, sec: Section, chord: number[], root: number, rng: Rng, ev: NoteEvent[]): void {
    const drop = sec === 'breakdown' && b < 28;
    if (!drop) for (let s = 0; s < 16; s += 4) ev.push({ voice: 'kick', step: s, vel: 1, len: 1 });
    if (sec !== 'intro' || b >= 4) for (const s of [4, 12]) ev.push({ voice: 'clap', step: s, vel: 0.9, len: 1 });
    if (b === 27 || b === 31) for (let s = 8; s < 16; s++) ev.push({ voice: 'clap', step: s, vel: 0.35 + (s - 8) * 0.08, len: 1 });
    for (let s = 2; s < 16; s += 4) ev.push({ voice: 'hat', step: s, vel: 0.8, len: 2, open: true });
    if (!drop) for (let s = 0; s < 16; s++) if (s % 4 !== 2) ev.push({ voice: 'hat', step: s, vel: s % 2 ? 0.25 + rng.next() * 0.15 : 0.4, len: 1 });
    if (!drop && sec !== 'intro') {
      // The classic off-beat bass, jumping the octave now and then.
      for (let s = 2; s < 16; s += 4) ev.push({ voice: 'bass', step: s, midi: rng.chance(0.3) ? root + 12 : root, vel: 0.85, len: 2 });
    }
    // Chord stabs on a syncopated pattern that changes every 8 bars.
    const pats = [
      [3, 6, 10],
      [0, 3, 6, 11, 14],
      [2, 7, 10, 13],
    ];
    const pat = pats[Math.floor(b / 8) % pats.length]!;
    if (sec !== 'intro' || b >= 4) for (const s of pat) ev.push({ voice: 'stab', step: s, chord: chord.map((m) => m + 12), vel: drop ? 0.6 : 0.8, len: 1 });
  }

  /** 3: acid techno; hard kick, rolling hats, claps, the 303 line, nothing soft. */
  private acid(b: number, sec: Section, root: number, rng: Rng, ev: NoteEvent[]): void {
    const drop = sec === 'breakdown' && b < 28;
    if (!drop) for (let s = 0; s < 16; s += 4) ev.push({ voice: 'kick', step: s, vel: 1, len: 1 });
    if (sec !== 'intro') for (const s of [4, 12]) ev.push({ voice: 'clap', step: s, vel: 0.6, len: 1 });
    for (let s = 2; s < 16; s += 4) ev.push({ voice: 'hat', step: s, vel: 0.7, len: 2, open: true });
    for (let s = 0; s < 16; s++) if (s % 4 !== 2) ev.push({ voice: 'hat', step: s, vel: 0.3 + rng.next() * 0.3, len: 1 });
    if (!drop) for (const s of [3, 7, 11, 15]) if (rng.chance(0.5)) ev.push({ voice: 'bass', step: s, midi: root, vel: 0.5, len: 1 });
    // A written pattern (see ACID_PATTERNS), a new one every 8 bars, played over the chord's root;
    // a flourish on the last beat of every 4th bar. Short patterns run on across the bars.
    const cycle = Math.floor(this.barNo / 8);
    const pat = ACID_PATTERNS[(cycle * 3 + this.seed) % ACID_PATTERNS.length]!;
    const fill = this.barNo % 4 === 3 ? ACID_FILLS[(cycle + Math.floor(this.barNo / 4)) % ACID_FILLS.length]! : null;
    const steps: AcidStep[] = [];
    for (let s = 0; s < 16; s++) steps.push(fill && s >= 12 ? fill[s - 12]! : pat[(this.barNo * 16 + s) % pat.length]!);
    let last: NoteEvent | null = null;
    let slideIn = false;
    steps.forEach((st, s) => {
      if (st.n === 'tie') {
        if (last) last.len++;
        return;
      }
      if (st.n === null || (sec === 'intro' && !st.accent && s % 4 !== 0)) {
        // (The intro keeps only the downbeats and the accents: the line comes in thin.)
        last = null;
        slideIn = false;
        return;
      }
      const e: NoteEvent = { voice: 'acid', step: s, midi: root + st.n, vel: drop ? 0.6 : 0.85, len: 1, accent: st.accent, slide: slideIn };
      // A slide holds the note into the next one (no gap, no new attack).
      if (st.slide) e.len = 2;
      ev.push(e);
      last = e;
      slideIn = st.slide;
    });
  }
}
