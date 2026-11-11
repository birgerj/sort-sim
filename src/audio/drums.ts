// Drum samples, made once at start in an offline audio context (no files to load, nothing to
// license): a short kick and a short snare in a few characters. The music plays them as
// buffers, at the note's velocity.

export type KickKind = 'round' | 'punch' | 'tight';
export type SnareKind = 'classic' | 'crisp' | 'snappy';

const RATE = 44100;

/** A soft clipper: warmth and loudness without hard edges. */
function shaper(ctx: BaseAudioContext, drive: number): WaveShaperNode {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  const w = ctx.createWaveShaper();
  w.curve = curve;
  return w;
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    d[i] = (seed / 4294967296) * 2 - 1;
  }
  return b;
}

/**
 * The kick: a sine that drops fast from a high pitch to the low thump (the drop is the punch),
 * a short click on top for the attack, and a soft clip.
 *   round  909-like: a longer body, warm
 *   punch  808-ish but short: a deep drop and more click
 *   tight  techno: a very fast drop, short and dry
 */
export async function renderKick(kind: KickKind): Promise<AudioBuffer> {
  const p = {
    round: { from: 240, to: 50, drop: 0.07, decay: 0.38, click: 0.25, drive: 1.6, len: 0.45 },
    punch: { from: 320, to: 46, drop: 0.045, decay: 0.3, click: 0.45, drive: 2.2, len: 0.36 },
    tight: { from: 380, to: 56, drop: 0.028, decay: 0.2, click: 0.35, drive: 2.8, len: 0.26 },
  }[kind];
  const ctx = new OfflineAudioContext(1, Math.ceil(RATE * p.len), RATE);
  const out = shaper(ctx, p.drive);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  out.connect(master).connect(ctx.destination);
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(p.from, 0);
  o.frequency.exponentialRampToValueAtTime(p.to, p.drop);
  o.frequency.exponentialRampToValueAtTime(p.to * 0.92, p.decay);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(1, 0.002);
  g.gain.setValueAtTime(1, 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, p.decay);
  o.connect(g).connect(out);
  o.start(0);
  o.stop(p.len);
  // The click: a burst of filtered noise, a few milliseconds.
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 0.02);
  const hp = ctx.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.value = 3200;
  hp.Q.value = 0.7;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(p.click, 0);
  ng.gain.exponentialRampToValueAtTime(0.001, 0.008);
  n.connect(hp).connect(ng).connect(out);
  n.start(0);
  return ctx.startRendering();
}

/**
 * The snare: a tuned body (two tones that drop a little) and a burst of filtered noise for the
 * wires, mixed and softly clipped.
 *   classic  909-like: body round 180/330 Hz, a bright noise tail
 *   crisp    tight and high: a short body, a short bright crack
 *   snappy   more wires, a longer noise tail with a bit of air
 */
export async function renderSnare(kind: SnareKind): Promise<AudioBuffer> {
  const p = {
    classic: { body: [185, 330], bodyDecay: 0.11, bodyLvl: 0.55, noiseLvl: 0.5, noiseDecay: 0.18, hp: 1400, bp: 5000, drive: 1.6, len: 0.3 },
    crisp: { body: [220, 380], bodyDecay: 0.07, bodyLvl: 0.45, noiseLvl: 0.55, noiseDecay: 0.11, hp: 2200, bp: 6500, drive: 2.2, len: 0.2 },
    snappy: { body: [175, 300], bodyDecay: 0.09, bodyLvl: 0.4, noiseLvl: 0.7, noiseDecay: 0.24, hp: 1800, bp: 7500, drive: 1.4, len: 0.34 },
  }[kind];
  const ctx = new OfflineAudioContext(1, Math.ceil(RATE * p.len), RATE);
  const out = shaper(ctx, p.drive);
  const master = ctx.createGain();
  master.gain.value = 0.85;
  out.connect(master).connect(ctx.destination);
  for (const [i, f] of p.body.entries()) {
    const o = ctx.createOscillator();
    o.type = i ? 'sine' : 'triangle';
    o.frequency.setValueAtTime(f * 1.3, 0);
    o.frequency.exponentialRampToValueAtTime(f, 0.02);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(p.bodyLvl * (i ? 0.6 : 1), 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, p.bodyDecay * (i ? 0.7 : 1));
    o.connect(g).connect(out);
    o.start(0);
    o.stop(p.len);
  }
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, p.len);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = p.hp;
  const peak = ctx.createBiquadFilter();
  peak.type = 'peaking';
  peak.frequency.value = p.bp;
  peak.gain.value = 5;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, 0);
  ng.gain.linearRampToValueAtTime(p.noiseLvl, 0.001);
  ng.gain.exponentialRampToValueAtTime(0.001, p.noiseDecay);
  n.connect(hp).connect(peak).connect(ng).connect(out);
  n.start(0);
  return ctx.startRendering();
}
