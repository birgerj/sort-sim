/**
 * What the night party shows: each effect can be switched off, and the parcels can glow.
 * Only the night look reads these; by day the hall is clean production whatever is set here.
 */
export interface NightFx {
  /** How brightly the parcels glow in their destination colour, 0 (not at all) … 1 (bright). */
  glow: number;
  /** The crowd of dancers and the LED dance floor inside the loop. */
  crowd: boolean;
  /** The DJ booth on the platform. */
  dj: boolean;
  /** Laser fans from the booth and the moving heads on the trusses. */
  lasers: boolean;
  /** The mirror ball and its spots on walls, floor and ceiling. */
  ball: boolean;
  /** Confetti when the groove drops in. */
  confetti: boolean;
  /** The flow projectors' laser show (their working marks stay). */
  projectors: boolean;
  /** Underglow under the robots. */
  robotGlow: boolean;
  /** Parked robots spin and idle dock workers dance. */
  dance: boolean;
  /** Haze in the air and thicker fog. */
  haze: boolean;
  /** The strobes under the roof. */
  strobe: boolean;
  /** Bloom: the soft halo around lights. */
  bloom: boolean;
}

export type NightPreset = 'party' | 'calm' | 'dark';

export const NIGHT_PRESETS: Record<NightPreset, NightFx> = {
  /** Everything: the secret party. */
  party: { glow: 0.6, crowd: true, dj: true, lasers: true, ball: true, confetti: true, projectors: true, robotGlow: true, dance: true, haze: true, strobe: true, bloom: true },
  /** A quiet night shift: glowing parcels and machines, no party. */
  calm: { glow: 0.6, crowd: false, dj: false, lasers: false, ball: false, confetti: false, projectors: false, robotGlow: true, dance: false, haze: false, strobe: false, bloom: true },
  /** Only the working light: no glow, no party. */
  dark: { glow: 0, crowd: false, dj: false, lasers: false, ball: false, confetti: false, projectors: false, robotGlow: false, dance: false, haze: false, strobe: false, bloom: false },
};

/** The on/off switches, in the order the controls show them. */
export const NIGHT_SWITCHES: { id: Exclude<keyof NightFx, 'glow'>; label: string }[] = [
  { id: 'crowd', label: 'Crowd' },
  { id: 'dj', label: 'DJ' },
  { id: 'lasers', label: 'Lasers' },
  { id: 'ball', label: 'Mirror ball' },
  { id: 'confetti', label: 'Confetti' },
  { id: 'projectors', label: 'Projector show' },
  { id: 'robotGlow', label: 'Robot glow' },
  { id: 'dance', label: 'Dancing' },
  { id: 'haze', label: 'Haze' },
  { id: 'strobe', label: 'Strobes' },
  { id: 'bloom', label: 'Bloom' },
];

export const defaultNightFx = (): NightFx => ({ ...NIGHT_PRESETS.party });

/** A complete set from a stored or partial one (unknown keys dropped, missing ones from the party). */
export function normalizeNightFx(x: unknown): NightFx {
  const fx = defaultNightFx();
  if (!x || typeof x !== 'object') return fx;
  const o = x as Record<string, unknown>;
  if (typeof o.glow === 'number' && Number.isFinite(o.glow)) fx.glow = Math.min(1, Math.max(0, o.glow));
  for (const s of NIGHT_SWITCHES) if (typeof o[s.id] === 'boolean') fx[s.id] = o[s.id] as boolean;
  return fx;
}

/** Which preset a set matches exactly, if any. */
export function presetOf(fx: NightFx): NightPreset | null {
  for (const [id, p] of Object.entries(NIGHT_PRESETS) as [NightPreset, NightFx][]) {
    if (Math.abs(p.glow - fx.glow) < 0.005 && NIGHT_SWITCHES.every((s) => p[s.id] === fx[s.id])) return id;
  }
  return null;
}
