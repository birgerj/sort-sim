// How the game writes money, clock times and durations, and the small sums the
// screens make from a level (totals, star targets). Pure: no DOM.
import { CURRENCY, PRICES, type City, type Level, type Plan } from '../../shifts/contract';

const NBSP = ' ';
const MINUS = '−';

/** Whole numbers with thousands separators: 12,345. */
export function num(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** An amount of money: "§ 1,234", "− § 144". Whole Sorty unless `decimals` is given. */
export function money(n: number, decimals = 0): string {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const zero = Number(Math.abs(n).toFixed(decimals)) === 0;
  return `${n < 0 && !zero ? `${MINUS}${NBSP}` : ''}${CURRENCY}${NBSP}${abs}`;
}

/** A price from the price list: whole amounts without decimals, the rest with two. */
export function price(n: number): string {
  return money(n, Number.isInteger(n) ? 0 : 2);
}

/** A cost as it is written in the profit and loss: "− § 144", and "§ 0" for nothing. */
export function cost(n: number): string {
  return money(-Math.abs(Math.round(n)));
}

/** Minutes since the start of the shift (22:00) as a clock time: 105 → "23:45". */
export function clock(minute: number): string {
  const m = (((22 * 60 + Math.round(minute)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** A length of time in hours: 345 → "5 h 45", 120 → "2 h". */
export function hours(minutes: number): string {
  const m = Math.round(minutes);
  return m % 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m / 60} h`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

/** The name the player sees for city i; a plain fallback when the list is short. */
export function cityName(names: string[], i: number): string {
  return names[i] || `City ${i + 1}`;
}

/** The CSS colour of city i (sixteen of them, then they repeat). */
export function cityColor(i: number): string {
  return `var(--sh-city-${((i % 16) + 16) % 16})`;
}

export function firstParcel(c: City): number {
  return c.arrivals.reduce((m, a) => Math.min(m, a.from), Infinity);
}

export function lastParcel(c: City): number {
  return c.arrivals.reduce((m, a) => Math.max(m, a.to), 0);
}

export function totalParcels(level: Level): number {
  return level.cities.reduce((s, c) => s + c.volume, 0);
}

/** Profit needed for one, two and three stars: half, three quarters and nine tenths of par. */
export function starTargets(level: Level): [number, number, number] {
  return [Math.round(level.par * 0.5), Math.round(level.par * 0.75), Math.round(level.par * 0.9)];
}

/** What a person costs an hour tonight. */
export function wage(level: Level): number {
  return PRICES.personPerHour * level.wageFactor;
}

/** What one robot costs for this whole shift. */
export function robotForShift(level: Level): number {
  return (PRICES.robotPerShiftHour * level.shiftMinutes) / 60;
}

/** Dock time and people time in a plan, in minutes (what the fixed costs are counted over). */
export function planTime(plan: Plan): { dock: number; people: number } {
  let dock = 0;
  let people = 0;
  for (const b of plan.blocks) {
    const len = Math.max(0, b.end - b.start) * b.docks;
    dock += len;
    people += len * b.people;
  }
  return { dock, people };
}
