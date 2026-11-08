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
  /** Inhabitants, in thousands (about 2024; rounded): post goes out in proportion. */
  pop: number;
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
  { name: 'Amsterdam', pop: 931, pc: r('1011-1098, 1101-1109') },
  { name: 'Rotterdam', pop: 664, pc: r('3011-3089') },
  { name: 'Den Haag', pop: 566, pc: r('2491-2498, 2511-2597') },
  { name: 'Utrecht', pop: 374, pc: r('3451-3455, 3511-3585') },
  { name: 'Eindhoven', pop: 246, pc: r('5611-5658') },
  { name: 'Groningen', pop: 243, pc: r('9711-9756') },
  { name: 'Tilburg', pop: 229, pc: r('5011-5049') },
  { name: 'Almere', pop: 226, pc: r('1309-1364') },
  { name: 'Breda', pop: 186, pc: r('4811-4841') },
  { name: 'Nijmegen', pop: 183, pc: r('6511-6546') },
  { name: 'Apeldoorn', pop: 167, pc: r('7311-7351') },
  { name: 'Arnhem', pop: 166, pc: r('6811-6846') },
  { name: 'Haarlemmermeer', pop: 162, pc: r('2131-2158') },
  { name: 'Haarlem', pop: 168, pc: r('2011-2037') },
  { name: 'Enschede', pop: 162, pc: r('7511-7548') },
  { name: 'Amersfoort', pop: 161, pc: r('3811-3829') },
  { name: 'Zaanstad', pop: 159, pc: r('1501-1509, 1521-1567') },
  { name: "'s-Hertogenbosch", pop: 160, pc: r('5211-5249') },
  { name: 'Zwolle', pop: 133, pc: r('8011-8045') },
  { name: 'Leiden', pop: 128, pc: r('2311-2334') },
  { name: 'Zoetermeer', pop: 127, pc: r('2711-2729') },
  { name: 'Leeuwarden', pop: 126, pc: r('8911-8941, 9001-9089') },
  { name: 'Maastricht', pop: 123, pc: r('6211-6229') },
  { name: 'Ede', pop: 122, pc: r('6711-6745') },
  { name: 'Dordrecht', pop: 121, pc: r('3311-3329') },
  { name: 'Alphen a/d Rijn', pop: 115, pc: r('2391-2409') },
  { name: 'Westland', pop: 115, pc: r('2291-2295, 2671-2694') },
  { name: 'Alkmaar', pop: 110, pc: r('1811-1831, 1841-1847') },
  { name: 'Emmen', pop: 108, pc: r('7811-7895') },
  { name: 'Delft', pop: 105, pc: r('2611-2629') },
  { name: 'Venlo', pop: 103, pc: r('5911-5951') },
  { name: 'Deventer', pop: 102, pc: r('7411-7437') },
  { name: 'Sittard-Geleen', pop: 91, pc: r('6121-6167') },
  { name: 'Helmond', pop: 94, pc: r('5701-5709') },
  { name: 'Oss', pop: 95, pc: r('5341-5398') },
  { name: 'Amstelveen', pop: 92, pc: r('1181-1189') },
  { name: 'Hilversum', pop: 92, pc: r('1211-1223') },
  { name: 'Súdwest-Fryslân', pop: 92, pc: r('8601-8775') },
  { name: 'Heerlen', pop: 87, pc: r('6411-6433') },
  { name: 'Nissewaard', pop: 87, pc: r('3201-3218') },
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
 * A random destination: a share `south` to the cities the robots serve, the
 * rest to the north cities (roll cages). Cities get post in proportion to their inhabitants.
 */
export function randomPostcode(rnd: () => number = Math.random, south = 0.3): { pc: number; city: number; north: boolean } {
  const north = rnd() >= south;
  const list = north ? NORTH_CITIES : SOUTH_CITIES;
  // By inhabitants: a city twice as big gets twice the post.
  const w = list.map((c) => c.pop);
  let x = rnd() * w.reduce((a, b) => a + b, 0);
  let i = 0;
  while (i < w.length - 1 && (x -= w[i]!) > 0) i++;
  const all = areas(list[i]!);
  return { pc: all[Math.floor(rnd() * all.length)]!, city: i, north };
}
