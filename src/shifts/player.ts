// Who is playing, for the server's ranking: a key made once on this device (no account), a
// name the player may choose, and the country whose city names they play with.
export interface Player {
  key: string;
  name: string;
  country: string;
}

const STORE = 'sortsim.player';

interface Stored {
  key: string;
  name: string;
}

function read(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Stored> | null;
    if (raw && typeof raw.key === 'string' && raw.key.length >= 16) return { key: raw.key, name: typeof raw.name === 'string' ? raw.name : '' };
  } catch {
    /* no storage: a key for this visit only */
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const made: Stored = { key: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''), name: '' };
  write(made);
  return made;
}

function write(s: Stored): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* no storage */
  }
}

let country = '';
/** main.ts tells which country is chosen, so this file need not know the hall. */
export function setPlayerCountry(id: string): void {
  country = id;
}

export function player(): Player {
  return { ...read(), country };
}

/** Names are short and plain: letters, digits, spaces and a few marks. */
export function cleanName(name: string): string {
  return name.replace(/[^\p{L}\p{N} ._\-']/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

export function setPlayerName(name: string): void {
  write({ ...read(), name: cleanName(name) });
}
