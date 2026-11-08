// Made-up recipients for the shipping labels: a common surname of the chosen
// country with a first name (or random initials, as on Dutch labels), at a street
// in the parcel's town (in the Netherlands a real one in that municipality, not
// necessarily in that exact postcode area; elsewhere a common street name), a
// house number, and the postcode, all written the way that country writes them.
// Seeded by the parcel number, so a parcel always shows the same label.
import { COUNTRY, pcText, type Country } from './countries';
import { Rng } from './rng';

/** Dutch postcode letters: some pairs are not used (SA, SD, SS); and no F, I, O, Q, U, Y. */
const LETTERS = 'ABCDEGHJKLMNPRSTVWXZ';

export interface Address {
  name: string;
  street: string;
  number: string;
  postcode: string;
  city: string;
  /** The address as written: street line, and postcode and town line. */
  line1: string;
  line2: string;
}

export function addressFor(id: number, pc: number, city: string, c: Country = COUNTRY): Address {
  const r = new Rng((id * 2654435761) >>> 0);
  const pick = <T>(a: T[]): T => a[Math.floor(r.next() * a.length)]!;
  // Surnames weighted towards the common ones.
  const surname = c.surnames[Math.floor(r.next() ** 1.6 * c.surnames.length)]!;
  let name: string;
  if (c.first.length) name = `${pick(c.first)} ${surname}`;
  else {
    // Initials: one to three, mostly one or two. (After initials a prefix stays lower case: J. van Dijk.)
    const n = r.next() < 0.45 ? 1 : r.next() < 0.85 ? 2 : 3;
    let initials = '';
    for (let i = 0; i < n; i++) initials += 'ABCDEFGHIJKLMNPRSTW'[Math.floor(r.next() * 19)]! + '.';
    name = `${initials} ${surname}`;
  }
  const town = c.cities.find((t) => t.name === city);
  const street = pick(c.townStreets?.[city] ?? (town?.alt && c.streets2 ? c.streets2 : c.streets));
  let number = String(1 + Math.floor(r.next() ** 1.8 * 240));
  let postcode = pcText(pc, c);
  let line1: string;
  let line2: string;
  switch (c.id) {
    case 'nl': {
      if (r.next() < 0.18) number += pick(['A', 'B', '-1', '-2', ' bis']);
      let letters = '';
      do letters = pick([...LETTERS]) + pick([...LETTERS]);
      while (['SA', 'SD', 'SS'].includes(letters));
      postcode = `${postcode} ${letters}`;
      line1 = `${street} ${number}`;
      line2 = `${postcode}  ${city.toUpperCase()}`;
      break;
    }
    case 'fr':
      if (r.next() < 0.1) number += ' bis';
      line1 = `${number} ${street}`;
      line2 = `${postcode} ${city.toUpperCase()}`;
      break;
    case 'fi':
      if (r.next() < 0.5) number += ` ${pick(['A', 'B', 'C'])} ${1 + Math.floor(r.next() * 30)}`;
      line1 = `${street} ${number}`;
      line2 = `${postcode} ${city.toUpperCase()}`;
      break;
    case 'md':
      if (r.next() < 0.5) number += `, ap. ${1 + Math.floor(r.next() * 120)}`;
      line1 = `${street} ${number}`;
      line2 = `${postcode}, ${city}`;
      break;
    case 'in':
      line1 = `${r.next() < 0.5 ? `Flat ${1 + Math.floor(r.next() * 40)}${pick(['A', 'B', 'C'])}, ` : ''}${number}, ${street}`;
      line2 = `${city} - ${postcode}`;
      break;
    case 'au':
      if (r.next() < 0.3) number = `${1 + Math.floor(r.next() * 20)}/${number}`;
      line1 = `${number} ${street}`;
      line2 = `${city.toUpperCase()} ${town?.region ?? ''} ${postcode}`.replace('  ', ' ');
      break;
    default:
      // Belgium, Germany, Sweden: street and number, then postcode and town.
      if (c.id === 'be' && r.next() < 0.15) number += pick([' bus 1', ' bus 2', 'A']);
      line1 = `${street} ${number}`;
      line2 = `${postcode} ${city}`;
  }
  return { name, street, number, postcode, city, line1, line2 };
}
