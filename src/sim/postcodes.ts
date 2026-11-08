// Destinations: the 40 largest municipalities of the Netherlands, each with its
// four-digit postcode areas (from public postcode tables; a range a–b means
// every area number from a to b that exists in that municipality).
//
// The 20 largest each get a dock door on the north side, where parcels go into
// roll cages (five per door, each for a part of the city's postcodes). The next
// 20 get a door on the south side, fed by the robots' boxes (two per door).
// Parcels carry a postcode; the sorter sends them by it.

export interface City {
  name: string;
  /** Postcode areas, as [from, to] ranges (inclusive). */
  pc: [number, number][];
}

const r = (s: string): [number, number][] =>
  s.split(',').map((p) => {
    const [a, b] = p.trim().split('-').map(Number);
    return [a!, b ?? a!];
  });

/** Largest first. */
export const CITIES: City[] = [
  { name: 'Amsterdam', pc: r('1011-1098, 1101-1109') },
  { name: 'Rotterdam', pc: r('3011-3089') },
  { name: 'Den Haag', pc: r('2491-2498, 2511-2597') },
  { name: 'Utrecht', pc: r('3451-3455, 3511-3585') },
  { name: 'Eindhoven', pc: r('5611-5658') },
  { name: 'Groningen', pc: r('9711-9756') },
  { name: 'Tilburg', pc: r('5011-5049') },
  { name: 'Almere', pc: r('1309-1364') },
  { name: 'Breda', pc: r('4811-4841') },
  { name: 'Nijmegen', pc: r('6511-6546') },
  { name: 'Apeldoorn', pc: r('7311-7351') },
  { name: 'Arnhem', pc: r('6811-6846') },
  { name: 'Haarlemmermeer', pc: r('2131-2158') },
  { name: 'Haarlem', pc: r('2011-2037') },
  { name: 'Enschede', pc: r('7511-7548') },
  { name: 'Amersfoort', pc: r('3811-3829') },
  { name: 'Zaanstad', pc: r('1501-1509, 1521-1567') },
  { name: "'s-Hertogenbosch", pc: r('5211-5249') },
  { name: 'Zwolle', pc: r('8011-8045') },
  { name: 'Leiden', pc: r('2311-2334') },
  { name: 'Zoetermeer', pc: r('2711-2729') },
  { name: 'Leeuwarden', pc: r('8911-8941, 9001-9089') },
  { name: 'Maastricht', pc: r('6211-6229') },
  { name: 'Ede', pc: r('6711-6745') },
  { name: 'Dordrecht', pc: r('3311-3329') },
  { name: 'Alphen a/d Rijn', pc: r('2391-2409') },
  { name: 'Westland', pc: r('2291-2295, 2671-2694') },
  { name: 'Alkmaar', pc: r('1811-1831, 1841-1847') },
  { name: 'Emmen', pc: r('7811-7895') },
  { name: 'Delft', pc: r('2611-2629') },
  { name: 'Venlo', pc: r('5911-5951') },
  { name: 'Deventer', pc: r('7411-7437') },
  { name: 'Sittard-Geleen', pc: r('6121-6167') },
  { name: 'Helmond', pc: r('5701-5709') },
  { name: 'Oss', pc: r('5341-5398') },
  { name: 'Amstelveen', pc: r('1181-1189') },
  { name: 'Hilversum', pc: r('1211-1223') },
  { name: 'Súdwest-Fryslân', pc: r('8601-8775') },
  { name: 'Heerlen', pc: r('6411-6433') },
  { name: 'Nissewaard', pc: r('3201-3218') },
];

/** Cities at the north doors (roll cages) and at the south doors (robot boxes). */
export const NORTH_CITIES = CITIES.slice(0, 20);
export const SOUTH_CITIES = CITIES.slice(20, 40);

/** All area numbers of a city, low to high. */
export function areas(c: City): number[] {
  const out: number[] = [];
  for (const [a, b] of c.pc) for (let n = a; n <= b; n++) out.push(n);
  return out;
}

/** Split a city's postcodes into `parts` consecutive ranges (for cages or boxes). */
export function split(c: City, parts: number): [number, number][] {
  const all = areas(c);
  const out: [number, number][] = [];
  for (let k = 0; k < parts; k++) {
    const a = all[Math.floor((k * all.length) / parts)]!;
    const b = all[Math.floor(((k + 1) * all.length) / parts) - 1]!;
    out.push([a, b]);
  }
  return out;
}

/** "1011–1029" */
export const rangeText = ([a, b]: [number, number]) => (a === b ? String(a) : `${a}–${b}`);

/** Which of the ranges holds postcode pc (−1 if none). */
export const rangeOf = (ranges: [number, number][], pc: number) => ranges.findIndex(([a, b]) => pc >= a && pc <= b);

/**
 * A random destination: 70% to a north city (roll cages), 30% to a south one
 * (robots). Bigger cities get a little more post.
 */
export function randomPostcode(rnd: () => number = Math.random): { pc: number; city: number; north: boolean } {
  const north = rnd() < 0.7;
  const list = north ? NORTH_CITIES : SOUTH_CITIES;
  // Weight by rank: the first city about twice as likely as the last.
  const w = list.map((_, i) => 2 - i / list.length);
  let x = rnd() * w.reduce((a, b) => a + b, 0);
  let i = 0;
  while (i < w.length - 1 && (x -= w[i]!) > 0) i++;
  const all = areas(list[i]!);
  return { pc: all[Math.floor(rnd() * all.length)]!, city: i, north };
}
