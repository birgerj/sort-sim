// The hub's staff: a name that fits the chosen country for everyone with a job in the
// hall (pickers, loaders, the technician, the manual sorter, forklift drivers), and how
// their shift is spent: working or waiting for work. Times are in hub minutes (the
// clock on the wall boards), counted by `tick` from what each owner says the person is
// doing. Pure and seeded, so it is testable without a scene.
import type { Country } from './countries';
import { COUNTRY } from './countries';

export type Role = 'picker' | 'loader' | 'technician' | 'manual' | 'driver';

export const ROLE_TEXT: Record<Role, string> = {
  picker: 'Picker',
  loader: 'Loader',
  technician: 'Technician',
  manual: 'Manual sorting',
  driver: 'Forklift driver',
};

/** Women's names among the countries' first names (the rest are men's). */
const WOMEN = new Set(
  (
    'Sofie, An, Els, Lien, Marie, Nathalie, Isabelle, Julie, Emma, Olivia, Elise, Lotte, Nina, Sophie, Sylvie, Céline, Camille, Léa, Chloé, Manon, Jade, Louise, Alice, Inès, ' +
    'Sabine, Petra, Andrea, Claudia, Monika, Susanne, Birgit, Julia, Anna, Laura, Lena, Lea, Hannah, Mia, Anne, Tuula, Päivi, Maria, Sanna, Johanna, Riitta, Aino, Helmi, Emilia, Venla, Aada, ' +
    'Eva, Karin, Kristina, Sara, Ingrid, Elsa, Maja, Astrid, Wilma, Elena, Ana, Natalia, Tatiana, Svetlana, Olga, Cristina, Ecaterina, Valentina, Sofia, Alexandra, Irina, Nicoleta, Lilia, ' +
    'Priya, Anjali, Pooja, Neha, Sneha, Kavita, Sunita, Lakshmi, Diya, Ananya, Isha, Meera, Divya, Ayesha, Charlotte, Amelia, Isla, Ava, Grace, Chloe, Emily, Sarah, Jessica, Ruby, Zoe, Ella'
  ).split(', '),
);

/** Dutch labels carry initials only, so the Netherlands has its own list of first names. */
const NL_MEN = 'Jan, Pieter, Kees, Mark, Dennis, Erik, Sander, Bas, Thijs, Daan, Jeroen, Ruud, Mohamed, Stijn, Niels, Tim, Lars, Bram, Joost, Rick, Martijn, Henk'.split(', ');
const NL_WOMEN = 'Anna, Linda, Sanne, Marieke, Esther, Lisa, Femke, Ingrid, Petra, Fleur, Eva, Iris, Kim, Saskia, Yvonne, Anouk, Fatima, Lotte, Noor, Monique, Laura, Sophie'.split(', ');

/** First names for men and for women in this country. */
export function firstNames(c: Country): { men: string[]; women: string[] } {
  if (!c.first.length) return { men: NL_MEN, women: NL_WOMEN };
  return { men: c.first.filter((n) => !WOMEN.has(n)), women: c.first.filter((n) => WOMEN.has(n)) };
}

/** A name for someone of this country, from a seed; `taken` keeps names unique in the hall. */
export function staffName(c: Country, woman: boolean, seed: number, taken: Set<string> = new Set()): string {
  const { men, women } = firstNames(c);
  const firsts = woman ? women : men;
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
  let name = '';
  for (let tries = 0; tries < 50; tries++) {
    // Common surnames come up more often (the lists are most common first).
    const last = c.surnames[Math.floor(next() ** 1.4 * c.surnames.length)]!;
    name = `${firsts[Math.floor(next() * firsts.length)]!} ${last}`;
    if (!taken.has(name)) break;
  }
  taken.add(name);
  return name;
}

export interface StaffMember {
  id: number;
  name: string;
  role: Role;
  /** Where they work ("Door 4 · Utrecht"). */
  place: string;
  /** Hub minutes at the start of the shift (when they were counted first). */
  since: number;
  /** Hub minutes spent working and waiting. */
  work: number;
  wait: number;
  /** Working now; since when (hub minutes). */
  working: boolean;
  changed: number;
  /** Times they started on a job (a wait that ended in work). */
  jobs: number;
  /** What the scene shows them as (the person's root, or the forklift they drive). */
  obj: unknown;
  /** Asked every tick: are they working now? */
  busy: () => boolean;
}

export class Staff {
  readonly list: StaffMember[] = [];
  private readonly taken = new Set<string>();
  private last: number | null = null;

  constructor(private readonly country: Country = COUNTRY) {}

  /** Someone with a job: named from the seed, counted from hub time `now`. */
  add(role: Role, place: string, woman: boolean, seed: number, obj: unknown, busy: () => boolean, now: number): StaffMember {
    const m: StaffMember = {
      id: this.list.length + 1,
      name: staffName(this.country, woman, seed + this.list.length * 7919, this.taken),
      role,
      place,
      since: now,
      work: 0,
      wait: 0,
      working: false,
      changed: now,
      jobs: 0,
      obj,
      busy,
    };
    this.list.push(m);
    return m;
  }

  /** Count the minutes since the last tick for everyone, by what they are doing now. */
  tick(now: number): void {
    // (A jump, such as a hidden tab, counts no more than a few minutes; time never runs back.)
    const dt = this.last === null ? 0 : Math.min(5, Math.max(0, now - this.last));
    this.last = now;
    for (const m of this.list) {
      const b = m.busy();
      if (b) m.work += dt;
      else m.wait += dt;
      if (b !== m.working) {
        if (b) m.jobs++;
        m.working = b;
        m.changed = now;
      }
    }
  }

  /** Who this is (the object a tap found, or a parent of it). */
  find(obj: unknown): StaffMember | undefined {
    return this.list.find((m) => m.obj === obj);
  }

  /** Share of the counted time spent working, 0…100. */
  static workPct(m: Pick<StaffMember, 'work' | 'wait'>): number {
    const all = m.work + m.wait;
    return all > 0 ? Math.round((100 * m.work) / all) : 0;
  }

  /** The whole team: work and wait minutes added up. */
  totals(): { work: number; wait: number } {
    return this.list.reduce((a, m) => ({ work: a.work + m.work, wait: a.wait + m.wait }), { work: 0, wait: 0 });
  }
}

/** Minutes as "1 h 05 min" or "12 min". */
export function duration(min: number): string {
  const m = Math.floor(min);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}
