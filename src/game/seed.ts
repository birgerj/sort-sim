// Night seeds: "NL-7KQ2MX". The country code picks the hall (its cities, doors and
// signs), the six characters pick the night (forecast, drift, events). The same
// seed is the same night for every player, wherever they are: a player in Finland
// who types NL-7KQ2MX plays the Dutch hall, with Dutch cities above the docks.
import { COUNTRIES, type Country, type CountryId } from '../sim/countries';

/** Crockford base32: no I, L, O or U, so a seed reads aloud without mix-ups. */
const ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LEN = 6; // 30 bits: about a billion nights per country

export interface NightSeed {
  country: Country;
  /** 0 … 2^30 − 1 */
  n: number;
}

/** "NL-7KQ2MX" (country in capitals, as players type and say it). */
export function formatSeed(s: NightSeed): string {
  let n = s.n;
  let code = '';
  for (let k = 0; k < LEN; k++) {
    code = ABC[n & 31] + code;
    n >>>= 5;
  }
  return `${s.country.id.toUpperCase()}-${code}`;
}

/**
 * Reads a typed seed: any case, spaces or no dash ("nl 7kq2mx", "NL7KQ2MX"), and
 * the look-alikes O→0, I/L→1. Null when it is not a seed.
 */
export function parseSeed(text: string): NightSeed | null {
  const t = text.toUpperCase().replace(/[\s_-]/g, '');
  const m = /^([A-Z]{2})([0-9A-Z]{6})$/.exec(t);
  if (!m) return null;
  const country = COUNTRIES.find((c) => c.id === (m[1]!.toLowerCase() as CountryId));
  if (!country) return null;
  // Look-alikes only in the code part (the country code keeps its letters: NL, FI).
  const code = m[2]!.replace(/O/g, '0').replace(/[IL]/g, '1');
  let n = 0;
  for (const ch of code) {
    const v = ABC.indexOf(ch);
    if (v < 0) return null;
    n = (n << 5) | v;
  }
  return { country, n: n >>> 0 };
}

/** A fresh random night in the given (default: the player's) country. */
export function randomSeed(country: Country, rnd: () => number = Math.random): NightSeed {
  return { country, n: Math.floor(rnd() * 2 ** 30) };
}

/** FNV-1a: a stable hash for daily seeds. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The night of the day for one country (same for everyone who picks that country). */
export function dailySeed(country: Country, date: string): NightSeed {
  return { country, n: hash(`${date}/${country.id}`) & (2 ** 30 - 1) };
}

/**
 * The world night of the day: one seed for everyone, the country turns daily, so a
 * Dutch and a Finnish player meet in the same hall.
 */
export function worldSeed(date: string): NightSeed {
  const h = hash(`world/${date}`);
  return { country: COUNTRIES[h % COUNTRIES.length]!, n: hash(`${date}/world`) & (2 ** 30 - 1) };
}

/** The number the night's RNG starts from (country and night mixed). */
export const rngSeed = (s: NightSeed) => hash(`${s.country.id}:${s.n}`);
