// Batches: now and then a big share of the post is for one city for a while (a
// webshop's evening batch, a late trailer from one region). The total stays what
// the parcels-per-minute slider says; only the mix changes. A batch fills that
// city's chutes faster than its doors can take it, so the buffer store fills up
// and empties again once the batch is over.
import type { City } from './countries';
import { NORTH_CITIES, SOUTH_CITIES } from './postcodes';

export interface Batch {
  city: City;
  /** Hub time (minutes since midnight) it starts and ends. */
  start: number;
  end: number;
  /** Share of all parcels for this city while it runs. */
  share: number;
}

export class Batches {
  active: Batch | null = null;
  /** The last few batches, for the figures. */
  readonly past: Batch[] = [];
  private next: number | null = null;
  /** Set by the night-shift game: its own batches instead of random ones. */
  private manual = false;

  constructor(private rnd: () => number = Math.random) {}

  /**
   * The game runs its own batches: a city and share now, or null for none. While the
   * game is on there are no random batches (pass `off` to hand back to random ones).
   */
  set(b: { city: string; share: number } | null, t: number, off = false): void {
    this.manual = !off;
    if (off) return;
    if (!b) {
      if (this.active) this.end(t);
      return;
    }
    if (this.active?.city.name === b.city) return;
    const city = [...NORTH_CITIES, ...SOUTH_CITIES].find((c) => c.name === b.city);
    if (!city) return;
    if (this.active) this.end(t);
    this.active = { city, start: t, end: Infinity, share: b.share };
  }

  private end(t: number): void {
    this.past.push({ ...this.active!, end: t });
    if (this.past.length > 12) this.past.shift();
    this.active = null;
  }

  /** Call often with the hub time. */
  tick(t: number): void {
    if (this.manual) return;
    if (this.active && t >= this.active.end) this.end(this.active.end);
    if (this.active) return;
    // Random: one every 25–70 minutes of hub time, for 12–30 minutes, 25–45% of the post.
    if (this.next === null) this.next = t + 10 + this.rnd() * 40;
    if (t < this.next) return;
    const all = [...NORTH_CITIES, ...SOUTH_CITIES];
    let x = this.rnd() * all.reduce((a, c) => a + c.pop, 0);
    let i = 0;
    while (i < all.length - 1 && (x -= all[i]!.pop) > 0) i++;
    const minutes = 12 + this.rnd() * 18;
    this.active = { city: all[i]!, start: t, end: t + minutes, share: 0.25 + this.rnd() * 0.2 };
    this.next = t + minutes + 25 + this.rnd() * 45;
  }

  /** The country changed: the batches are for the cities of the same rank in the new one. */
  rename(was: City[], now: City[]): void {
    const to = (c: City) => now[was.indexOf(c)] ?? c;
    if (this.active) this.active.city = to(this.active.city);
    for (const b of this.past) b.city = to(b.city);
  }

  /** For a new parcel: the batch's city if this parcel is part of the batch. */
  pick(): City | null {
    return this.active && this.rnd() < this.active.share ? this.active.city : null;
  }
}
