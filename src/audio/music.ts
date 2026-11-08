/**
 * Plays the Composer's song with WebAudio and tells the scene what is
 * happening, frame by frame: beat position, drum envelopes and notes.
 *
 * The clock always runs (on performance.now), with or without sound: the
 * hall keeps moving when the music is muted or the browser has not allowed
 * audio yet. Audio is scheduled a little ahead on the AudioContext, and the
 * visual events are released when they are heard (output latency included).
 */
import { BPM, chordOf, Composer, energyOf, STEPS_PER_BAR, type NoteEvent } from './composer';
import type { NoteRole, RGB } from '../scene/types';

const SPB = 60 / BPM; // seconds per beat
const STEP = SPB / 4; // one 16th
const BAR = STEP * STEPS_PER_BAR;
const LOOKAHEAD = 0.35;

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

const now = () => performance.now() / 1000;

export class Music {
  readonly bpm = BPM;
  private composer = new Composer(Math.floor(Math.random() * 1e6));
  private t0 = now();
  private nextBar = 0;
  private queue: { at: number; ev: NoteEvent; bar: number }[] = [];
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
      else {
        if (ev.voice === 'bass' || ev.voice === 'pad') this.last[ev.voice] = at;
        const midi = ev.midi ?? ev.chord?.[0] ?? 60;
        notes.push({
          color: noteColor(midi),
          pitch: Math.max(0, Math.min(1, (midi - 36) / 52)),
          vel: ev.vel,
          dur: ev.len * STEP,
          role: ev.voice,
        });
      }
    }
    const beats = (t - this.t0) / SPB;
    const bar = beats / 4;
    const env = (at: number, rate: number) => Math.exp(-Math.max(0, t - at) * rate);
    const chord = chordOf(Math.floor(bar));
    return {
      beats,
      bar,
      kick: env(this.last.kick, 9),
      snare: env(this.last.snare, 8),
      hat: env(this.last.hat, 14),
      energy: energyOf(Math.floor(bar)),
      bass: env(this.last.bass, 3),
      pad: env(this.last.pad, 0.5),
      cols: [noteColor(chord[0]!), noteColor(chord[1]!), noteColor(chord[2]!)],
      notes,
    };
  }

  // ---------- scheduling ----------

  private schedule(): void {
    const t = now();
    // After a long pause (hidden tab), skip ahead instead of catching up.
    const current = Math.floor((t - this.t0) / BAR);
    if (this.nextBar < current) {
      this.nextBar = current;
      this.queue = this.queue.filter((q) => q.at > t - 0.5);
    }
    while (this.t0 + this.nextBar * BAR < t + LOOKAHEAD) {
      const bar = this.nextBar++;
      for (const ev of this.composer.bar(bar)) {
        const at = this.t0 + bar * BAR + ev.step * STEP;
        if (at < t - 0.02) continue;
        this.queue.push({ at, ev, bar });
        if (this.audible) this.play(ev, this.ctx!.currentTime + (at - t) + 0.02);
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

  private play(ev: NoteEvent, at: number): void {
    const ctx = this.ctx!;
    if (at < ctx.currentTime) return;
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
      case 'snare':
      case 'hat': {
        const s = ctx.createBufferSource();
        s.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        const snare = ev.voice === 'snare';
        f.type = snare ? 'bandpass' : 'highpass';
        f.frequency.value = snare ? 1900 : 7500;
        f.Q.value = snare ? 0.9 : 0.7;
        const peak = (snare ? 0.22 : 0.06) * ev.vel;
        const len = snare ? 0.16 : 0.05;
        g.gain.setValueAtTime(peak, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        s.connect(f).connect(g).connect(this.out!);
        if (snare) g.connect(this.reverb!);
        s.start(at);
        s.stop(at + len + 0.02);
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
        f.frequency.linearRampToValueAtTime(1300, at + dur * 0.5);
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
