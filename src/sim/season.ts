// Christmas: the hall dressed for the holidays (Settings → Christmas, or ?xmas=1 / ?xmas=0).
// The decorations are always built with the hall, and shown or hidden: it can be switched while
// the hall runs (setXmas).

function read(): boolean {
  let on = false;
  try {
    on = !!(JSON.parse(globalThis.localStorage?.getItem('sortsim.settings') ?? '{}') as { xmas?: boolean }).xmas;
  } catch {
    /* no storage */
  }
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('xmas');
    if (q !== null) on = q === '1';
  } catch {
    /* not in a browser */
  }
  return on;
}

/** Christmas on now (a live binding: see setXmas). */
export let XMAS = read();

const xmasListeners: ((on: boolean) => void)[] = [];
/** Be told when Christmas is switched on or off. */
export function onXmas(fn: (on: boolean) => void): void {
  xmasListeners.push(fn);
}
/** Switch Christmas on or off while the hall runs. */
export function setXmas(on: boolean): void {
  if (on === XMAS) return;
  XMAS = on;
  for (const fn of xmasListeners) fn(on);
}

/** Whole days until Christmas Day (0 on the 25th and 26th). */
export function daysToChristmas(d = new Date()): number {
  const y = d.getMonth() === 11 && d.getDate() > 26 ? d.getFullYear() + 1 : d.getFullYear();
  const xmas = new Date(y, 11, 25);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.max(0, Math.round((xmas.getTime() - today.getTime()) / 86400000));
}
