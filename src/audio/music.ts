/**
 * Plays the Composer's song with WebAudio and tells the scene what is
 * happening, frame by frame: beat position, drum envelopes and notes.
 *
 * The clock always runs (on performance.now), with or without sound: the
 * hall keeps moving when the music is muted or the browser has not allowed
 * audio yet. Audio is scheduled a little ahead on the AudioContext, and the
 * visual events are released when they are heard (output latency included).
 */
import { BPM, chordOf, Composer, energyOf, STEPS_PER_BAR, type Mood, type NoteEvent } from './composer';
import type { NoteRole, RGB } from '../scene/types';
import { XMAS } from '../sim/season';

const SPB = 60 / BPM; // seconds per beat at the starting tempo
const STEP = SPB / 4; // one 16th at the starting tempo
const LOOKAHEAD = 0.35;
/** Tempo range, and how far it may move per bar (so changes are gradual). */
export const MIN_BPM = 60;
export const MAX_BPM = 160;
const BPM_PER_BAR = 3;

export interface MusicNote {
  color: RGB;
  pitch: number;
  vel: number;
  dur: number;
  role: NoteRole;
}

export interface MusicFrame {
  beats: number;
  bar: number;
  kick: number;
  snare: number;
  hat: number;
  energy: number;
  bass: number;
  pad: number;
  cols: RGB[];
  notes: MusicNote[];
}

/** Hue for a pitch class: the circle of colours runs with the notes. */
export function noteColor(midi: number, light = 0.58): RGB {
  const h = (((midi % 12) + 12) % 12) / 12;
  const s = 0.8;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return light - s * Math.min(light, 1 - light) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Music time in seconds: it stands still while paused. */
let pausedAt: number | null = null;
let pausedTotal = 0;
const now = () => (pausedAt ?? performance.now() / 1000) - pausedTotal;

export class Music {
  private composer = new Composer(Math.floor(Math.random() * 1e6));
  private t0 = now();
  private nextBar = 0;
  /** Start time and tempo of each scheduled bar (recent ones kept): the tempo can change bar by bar. */
  private bars = new Map<number, { at: number; bpm: number }>();
  private target = BPM;
  private queue: { at: number; ev: NoteEvent; bar: number; step: number }[] = [];

  /** Pauses the music and its clock (everything in the hall runs on it), or carries on. */
  setPaused(p: boolean): void {
    if (p === this.paused) return;
    const real = performance.now() / 1000;
    if (p) pausedAt = real;
    else if (pausedAt !== null) {
      pausedTotal += real - pausedAt;
      pausedAt = null;
    }
    if (this.ctx) void (p ? this.ctx.suspend() : this.ctx.resume());
  }

  get paused(): boolean {
    return pausedAt !== null;
  }

  /** The tempo now (of the bar playing). */
  get bpm(): number {
    const t = now();
    let best = BPM;
    for (const [, b] of this.bars) if (b.at <= t) best = b.bpm;
    return best;
  }

  /** Where the tempo should go (60–160 BPM); it moves there a few BPM per bar. */
  setTempo(bpm: number): void {
    this.target = Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
  }

  /** Beats since the start at time t, through the bars' own tempos. */
  private beatsAt(t: number): number {
    let bar = -1;
    let b: { at: number; bpm: number } | undefined;
    for (const [n, x] of this.bars) if (x.at <= t && n > bar) {
      bar = n;
      b = x;
    }
    if (!b) return (t - this.t0) / SPB;
    return bar * 4 + (t - b.at) / (60 / b.bpm);
  }
  private last = { kick: -99, snare: -99, hat: -99, bass: -99, pad: -99 };
  private timer: ReturnType<typeof setInterval>;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private reverb: GainNode | null = null;
  private delay: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private volume = 0.8;

  constructor() {
    this.timer = setInterval(() => this.schedule(), 40);
  }

  /** Starts the sound (call from a click or key press: browsers require one). */
  async start(): Promise<void> {
    if (!this.ctx) this.buildGraph();
    await this.ctx!.resume();
  }

  get audible(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.out && this.ctx && !this.muted) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** A sound effect from the hall, now: a forklift horn, a reverse beeper, a cleardown buzzer. */
  sfx(kind: 'horn' | 'beep' | 'buzz', vol = 1): void {
    if (!this.audible || !this.ctx || !this.out) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const g = ctx.createGain();
    g.connect(this.out);
    if (this.reverb) g.connect(this.reverb);
    const tone = (type: OscillatorType, f: number, len: number, level: number, start = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, t + start);
      og.gain.linearRampToValueAtTime(level, t + start + 0.01);
      og.gain.setValueAtTime(level, t + start + len - 0.03);
      og.gain.linearRampToValueAtTime(0, t + start + len);
      o.connect(og);
      og.connect(g);
      o.start(t + start);
      o.stop(t + start + len + 0.02);
    };
    g.gain.value = 0.18 * vol;
    if (kind === 'horn') {
      // Two short honks, a slightly sour pair of tones.
      for (const st of [0, 0.22]) {
        tone('square', 392, 0.14, 0.25, st);
        tone('square', 466, 0.14, 0.2, st);
      }
    } else if (kind === 'beep') tone('sine', 1250, 0.18, 0.35);
    else tone('sawtooth', 220, 0.3, 0.25);
  }

  /** How busy the music is (from the hub's parcels per minute); it changes from the next bar. */
  setMood(m: Mood): void {
    this.composer.mood = m;
  }

  get mood(): Mood {
    return this.composer.mood;
  }

  /** The hall's background: belts and rollers humming, 0 (silent) to 1. */
  setHum(level: number): void {
    if (!this.ctx || !this.out) return;
    if (!this.hum) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 140;
      bp.Q.value = 0.8;
      const motor = ctx.createOscillator();
      motor.type = 'triangle';
      motor.frequency.value = 50;
      const mg = ctx.createGain();
      mg.gain.value = 0.25;
      this.hum = ctx.createGain();
      this.hum.gain.value = 0;
      src.connect(bp);
      bp.connect(this.hum);
      motor.connect(mg);
      mg.connect(this.hum);
      this.hum.connect(this.out);
      src.start();
      motor.start();
    }
    this.hum.gain.setTargetAtTime(0.06 * level, this.ctx.currentTime, 0.5);
  }

  private hum: GainNode | null = null;
  private acidLast = 0;

  dispose(): void {
    clearInterval(this.timer);
    void this.ctx?.close();
  }

  /** Where the music is now, and the notes that have just sounded. */
  frame(): MusicFrame {
    const latency = this.ctx ? (this.ctx.outputLatency || this.ctx.baseLatency || 0) + 0.05 : 0;
    const t = now() - latency;
    const notes: MusicNote[] = [];
    while (this.queue.length && this.queue[0]!.at <= t) {
      const { ev, at } = this.queue.shift()!;
      if (t - at > 0.25) continue; // stale (tab was hidden)
      if (ev.voice === 'kick' || ev.voice === 'snare' || ev.voice === 'hat') this.last[ev.voice] = at;
      else if (ev.voice === 'clap') this.last.snare = at;
      else if (ev.voice === 'acid') {
        // The acid line pulses the bass light on its accents (it brings no parcels of its own).
        if (ev.accent) this.last.bass = at;
      } else {
        if (ev.voice === 'bass' || ev.voice === 'pad') this.last[ev.voice] = at;
        const midi = ev.midi ?? ev.chord?.[0] ?? 60;
        notes.push({
          color: noteColor(midi),
          pitch: Math.max(0, Math.min(1, (midi - 36) / 52)),
          vel: ev.vel,
          dur: ev.len * this.stepOf(at),
          role: ev.voice === 'stab' ? 'lead' : ev.voice,
        });
      }
    }
    const beats = this.beatsAt(t);
    const bar = beats / 4;
    const env = (at: number, rate: number) => Math.exp(-Math.max(0, t - at) * rate);
    const chord = chordOf(Math.floor(bar));
    return {
      beats,
      bar,
      kick: env(this.last.kick, 9),
      snare: env(this.last.snare, 8),
      hat: env(this.last.hat, 14),
      energy: Math.min(1, energyOf(Math.floor(bar)) * (0.75 + this.composer.mood * 0.15)),
      bass: env(this.last.bass, 3),
      pad: env(this.last.pad, 0.5),
      cols: [noteColor(chord[0]!), noteColor(chord[1]!), noteColor(chord[2]!)],
      notes,
    };
  }

  // ---------- scheduling ----------

  /** A 16th note's length at time t. */
  private stepOf(t: number): number {
    let s = STEP;
    for (const [, b] of this.bars) if (b.at <= t) s = 60 / b.bpm / 4;
    return s;
  }

  /** When bar n starts and its tempo (each bar starts where the last one ended). */
  private barStart(n: number): { at: number; bpm: number } {
    const known = this.bars.get(n);
    if (known) return known;
    const prev = this.bars.get(n - 1);
    const at = prev ? prev.at + (4 * 60) / prev.bpm : this.t0 + n * 4 * SPB;
    const from = prev?.bpm ?? BPM;
    const bpm = from + Math.max(-BPM_PER_BAR, Math.min(BPM_PER_BAR, this.target - from));
    const b = { at, bpm };
    this.bars.set(n, b);
    // Keep only the last few bars.
    for (const k of this.bars.keys()) if (k < n - 8) this.bars.delete(k);
    return b;
  }

  private schedule(): void {
    const t = now();
    // After a long pause (hidden tab), skip ahead instead of catching up: the next bar starts now.
    const nb = this.barStart(this.nextBar);
    if (nb.at + (4 * 60) / nb.bpm < t - 0.5) {
      this.bars.set(this.nextBar, { at: t, bpm: nb.bpm });
      this.queue = this.queue.filter((q) => q.at > t - 0.5);
    }
    while (this.barStart(this.nextBar).at < t + LOOKAHEAD) {
      const bar = this.nextBar++;
      const { at: start, bpm } = this.barStart(bar);
      const step = 60 / bpm / 4;
      // The mood follows the tempo: ambient when slow, techno and then acid when fast.
      this.composer.mood = bpm < 82 ? 0 : bpm < 112 ? 1 : bpm < 136 ? 2 : 3;
      if (this.ctx && this.delayLine) this.delayLine.delayTime.setTargetAtTime(step * 3, this.ctx.currentTime + Math.max(0, start - t), 0.2);
      for (const ev of this.composer.bar(bar)) {
        const at = start + ev.step * step;
        if (at < t - 0.02) continue;
        this.queue.push({ at, ev, bar, step });
        if (this.audible) this.play(ev, this.ctx!.currentTime + (at - t) + 0.02, step);
      }
      this.queue.sort((a, b) => a.at - b.at);
    }
  }

  // ---------- sound ----------

  private buildGraph(): void {
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : this.volume;
    this.out.connect(comp);
    // Reverb: a generated hall impulse.
    const len = Math.floor(ctx.sampleRate * 3.5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    this.reverb = ctx.createGain();
    this.reverb.gain.value = 0.45;
    this.reverb.connect(conv);
    conv.connect(this.out);
    // Dotted-eighth delay, darkened in the feedback.
    this.delay = ctx.createGain();
    const dl = ctx.createDelay(2);
    dl.delayTime.value = SPB * 0.75;
    this.delayLine = dl;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.delay.connect(dl);
    dl.connect(lp);
    lp.connect(fb);
    fb.connect(dl);
    const dOut = ctx.createGain();
    dOut.gain.value = 0.35;
    lp.connect(dOut);
    dOut.connect(this.out);
    dOut.connect(this.reverb);
    // White noise for the drums.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  private delayLine: DelayNode | null = null;

  /** Christmas: sleigh bells instead of the closed hat (a few bright, quickly dying pings). */
  private jingle(ctx: AudioContext, at: number, vel: number): void {
    for (const [f, d] of [[2637, 0], [3951, 0.006], [5274, 0.011], [3322, 0.017]] as const) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.02);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at + d);
      g.gain.exponentialRampToValueAtTime(0.03 * vel, at + d + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, at + d + 0.11);
      o.connect(g).connect(this.out!);
      o.start(at + d);
      o.stop(at + d + 0.13);
    }
  }

  /** Christmas: a bell (inharmonic partials, a long ring) instead of the lead. */
  private bell(ctx: AudioContext, at: number, f: number, vel: number): void {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.09 * vel, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.2);
    g.connect(this.out!);
    g.connect(this.reverb!);
    for (const [mul, lvl] of [[1, 1], [2.76, 0.4], [5.4, 0.18], [8.9, 0.08]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f * mul;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(g);
      o.start(at);
      o.stop(at + 2.3);
    }
  }

  private play(ev: NoteEvent, at: number, step = STEP): void {
    const ctx = this.ctx!;
    if (at < ctx.currentTime) return;
    const STEP = step;
    const dur = ev.len * STEP;
    switch (ev.voice) {
      case 'kick': {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(130, at);
        o.frequency.exponentialRampToValueAtTime(42, at + 0.14);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.75 * ev.vel, at + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
        o.connect(g).connect(this.out!);
        o.start(at);
        o.stop(at + 0.5);
        break;
      }
      case 'clap': {
        // Three quick noise bursts and a tail, band-passed: a hand clap.
        const s = ctx.createBufferSource();
        s.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1300;
        f.Q.value = 1.2;
        const g = ctx.createGain();
        const peak = 0.26 * ev.vel;
        g.gain.setValueAtTime(0.0001, at);
        for (const d of [0, 0.012, 0.024]) {
          g.gain.setValueAtTime(peak, at + d);
          g.gain.exponentialRampToValueAtTime(peak * 0.2, at + d + 0.01);
        }
        g.gain.setValueAtTime(peak * 0.8, at + 0.034);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
        s.connect(f).connect(g).connect(this.out!);
        g.connect(this.reverb!);
        s.start(at);
        s.stop(at + 0.25);
        break;
      }
      case 'stab': {
        // A house chord stab: detuned saws, a filter that snaps shut, into the delay.
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = 3;
        f.frequency.setValueAtTime(3800, at);
        f.frequency.exponentialRampToValueAtTime(500, at + 0.16);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.03 * ev.vel, at + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
        f.connect(g);
        g.connect(this.out!);
        g.connect(this.delay!);
        for (const midi of ev.chord ?? []) {
          for (const det of [-9, 9]) {
            const o = ctx.createOscillator();
            o.type = 'sawtooth';
            o.frequency.value = mtof(midi);
            o.detune.value = det;
            o.connect(f);
            o.start(at);
            o.stop(at + 0.24);
          }
        }
        break;
      }
      case 'snare':
      case 'hat': {
        if (ev.voice === 'hat' && XMAS && !ev.open) {
          this.jingle(ctx, at, ev.vel);
          break;
        }
        const s = ctx.createBufferSource();
        s.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        const snare = ev.voice === 'snare';
        f.type = snare ? 'bandpass' : 'highpass';
        f.frequency.value = snare ? 1900 : ev.open ? 6500 : 7500;
        f.Q.value = snare ? 0.9 : 0.7;
        const peak = (snare ? 0.22 : ev.open ? 0.07 : 0.06) * ev.vel;
        const len = snare ? 0.16 : ev.open ? 0.24 : 0.05;
        g.gain.setValueAtTime(peak, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        s.connect(f).connect(g).connect(this.out!);
        if (snare) g.connect(this.reverb!);
        s.start(at);
        s.stop(at + len + 0.02);
        break;
      }
      case 'acid': {
        // A 303-style line: sawtooth into a resonant low-pass whose envelope opens on each note;
        // accents open it further and louder, slides glide in from the last note.
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        const f = mtof(ev.midi!);
        if (ev.slide && this.acidLast) {
          o.frequency.setValueAtTime(this.acidLast, at);
          o.frequency.exponentialRampToValueAtTime(f, at + STEP * 0.6);
        } else o.frequency.setValueAtTime(f, at);
        this.acidLast = f;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 14;
        const top = ev.accent ? 3200 : 1500;
        lp.frequency.setValueAtTime(top, at);
        lp.frequency.exponentialRampToValueAtTime(260, at + (ev.accent ? 0.22 : 0.14));
        const g = ctx.createGain();
        const lvl = (ev.accent ? 0.13 : 0.085) * ev.vel;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(lvl, at + 0.005);
        g.gain.setValueAtTime(lvl, at + dur * 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.04);
        o.connect(lp).connect(g).connect(this.out!);
        g.connect(this.delay!);
        o.start(at);
        o.stop(at + dur + 0.08);
        break;
      }
      case 'bass': {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 520;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.32 * ev.vel, at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.18 * ev.vel, at + 0.2);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.15);
        f.connect(g).connect(this.out!);
        for (const [type, midi, lvl] of [['triangle', ev.midi!, 1], ['sine', ev.midi! - 12, 0.8]] as const) {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = mtof(midi);
          const og = ctx.createGain();
          og.gain.value = lvl;
          o.connect(og).connect(f);
          o.start(at);
          o.stop(at + dur + 0.2);
        }
        break;
      }
      case 'lead': {
        if (XMAS) {
          this.bell(ctx, at, mtof(ev.midi!), ev.vel);
          break;
        }
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.1 * ev.vel, at + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
        g.connect(this.out!);
        g.connect(this.delay!);
        g.connect(this.reverb!);
        for (const [type, mul, lvl] of [['sine', 1, 1], ['triangle', 2, 0.25]] as const) {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = mtof(ev.midi!) * mul;
          const og = ctx.createGain();
          og.gain.value = lvl;
          o.connect(og).connect(g);
          o.start(at);
          o.stop(at + 1.2);
        }
        break;
      }
      case 'pad': {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = 0.6;
        f.frequency.setValueAtTime(380, at);
        f.frequency.linearRampToValueAtTime(XMAS ? 900 : 1300, at + dur * 0.5);
        f.frequency.linearRampToValueAtTime(600, at + dur + 2);
        const g = ctx.createGain();
        const peak = 0.035 * ev.vel;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(peak, at + 1.6);
        g.gain.setValueAtTime(peak, at + dur);
        g.gain.linearRampToValueAtTime(0.0001, at + dur + 2.5);
        f.connect(g);
        g.connect(this.out!);
        g.connect(this.reverb!);
        for (const midi of ev.chord ?? []) {
          for (const det of [-7, 7]) {
            const o = ctx.createOscillator();
            o.type = 'sawtooth';
            o.frequency.value = mtof(midi);
            o.detune.value = det;
            o.connect(f);
            o.start(at);
            o.stop(at + dur + 2.6);
          }
        }
        break;
      }
    }
  }
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
