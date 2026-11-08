/** What the app hands the scene every frame, and what the scene offers back. */
export type RGB = [number, number, number];
export type NoteRole = 'lead' | 'bass' | 'pad';

export interface SceneInput {
  /** Seconds since the last frame. */
  dt: number;
  /** Continuous beat count (quarter notes) of the music. */
  beats: number;
  playing: boolean;
  /** Drum envelopes, 0..1, jumping to ~1 on a hit and decaying. */
  kick: number;
  snare: number;
  hat: number;
  /** How busy the music is now, 0..1. */
  energy: number;
  bass: number;
  pad: number;
  /** Colours of the current chord (root, third, fifth), 0..1. */
  cols: RGB[];
  /** Camera travel speed; 0.4 is the default. */
  travelSpeed: number;
  /** Continuous bar position. */
  bar?: number;
  /** Time of day: 0 day, 1 night (values between crossfade). */
  tod?: number;
}

/** A control the scene offers: an on/off switch, a choice, or a one-shot action. */
export type SceneControl =
  | { kind: 'toggle'; id: string; label: string; title: string; value: boolean }
  | { kind: 'choice'; id: string; label: string; title: string; value: string; options: { value: string; label: string }[] }
  | { kind: 'action'; id: string; label: string; title: string };

export interface Scene3D {
  readonly canvas: HTMLCanvasElement;
  /** True when the scene also wants bass notes. */
  readonly bass?: boolean;
  /** Size in CSS pixels; ratio is device pixels per CSS pixel. */
  resize(w: number, h: number, ratio: number): void;
  render(input: SceneInput): void;
  /** A note from the music, placed in the world in its colour. pitch 0..1. */
  note(color: RGB, pitch: number, vel: number, durS: number, role?: NoteRole): void;
  /** Overlay text the scene wants shown, or empty. */
  caption?(): string;
  controls?(): SceneControl[];
  setControl?(id: string, value: boolean | string): void;
}
