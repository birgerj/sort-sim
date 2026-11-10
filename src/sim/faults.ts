/**
 * Faults on the dock chutes, without any drawing: now and then a chute stops taking
 * parcels (a blocked photo eye, a tripped belt drive, a parcel jammed at the chute
 * exit). While it is down the sorter sends nothing down it (parcels go round again or
 * into the buffer store), until the technician has been there and repaired it.
 *
 * All in beats, like the rest of the hall. The random numbers come from outside, so a
 * seeded run (the minigame) gets the same faults every time.
 */

export type FaultKind = 'eye' | 'drive' | 'jam';

/** What the chute's display says while it is down. */
export const FAULT_TEXT: Record<FaultKind, string> = {
  eye: 'Photo eye blocked',
  drive: 'Belt drive tripped',
  jam: 'Parcel jammed',
};

export interface Fault {
  chute: number;
  kind: FaultKind;
  /** Beat it went down. */
  since: number;
  /** The technician is working on it (from this beat). */
  repairFrom?: number;
}

export interface FaultOptions {
  /** Average beats between two faults (each gap is random around it). */
  meanGap: number;
  /** Never sooner than this after the last one. */
  minGap: number;
  /** Beats until the first fault. */
  first: number;
  /** At most this many chutes down at once. */
  maxDown: number;
}

export const FAULT_DEFAULTS: FaultOptions = { meanGap: 240, minGap: 96, first: 48, maxDown: 2 };

export class FaultPlan {
  /** Chutes down now, by chute. */
  readonly down = new Map<number, Fault>();
  /** Off: no new faults (the ones down still get repaired). */
  enabled = true;
  /** Faults so far, and beats of downtime of the ones repaired. */
  count = 0;
  downBeats = 0;
  private next: number;
  private readonly o: FaultOptions;

  constructor(
    private chutes: readonly number[],
    private readonly rnd: () => number = Math.random,
    opts: Partial<FaultOptions> = {},
    start = 0,
  ) {
    this.o = { ...FAULT_DEFAULTS, ...opts };
    this.next = start + this.o.first;
  }

  /** Only these chutes can go down from now on. */
  only(chutes: readonly number[]): void {
    this.chutes = [...chutes];
  }

  isDown(chute: number): boolean {
    return this.down.has(chute);
  }

  /** Call every frame (or beat): returns the faults that start now. */
  tick(bt: number): Fault[] {
    if (bt < this.next) return [];
    // An exponential gap after the minimum: faults come irregularly, as they do.
    this.next = bt + this.o.minGap + -Math.log(1 - this.rnd()) * (this.o.meanGap - this.o.minGap);
    if (!this.enabled || this.down.size >= this.o.maxDown) return [];
    const f = this.trigger(bt);
    return f ? [f] : [];
  }

  /** A fault now: on `chute`, or on a random chute that is still running. Null when none can go down. */
  trigger(bt: number, chute?: number, kind?: FaultKind): Fault | null {
    const up = this.chutes.filter((c) => !this.down.has(c));
    if (chute === undefined) {
      if (!up.length) return null;
      chute = up[Math.floor(this.rnd() * up.length)]!;
    } else if (!up.includes(chute)) return null;
    const kinds: FaultKind[] = ['eye', 'drive', 'jam'];
    const f: Fault = { chute, kind: kind ?? kinds[Math.floor(this.rnd() * kinds.length)]!, since: bt };
    this.down.set(chute, f);
    this.count++;
    return f;
  }

  /** The technician starts working on it. */
  repairing(chute: number, bt: number): void {
    const f = this.down.get(chute);
    if (f && f.repairFrom === undefined) f.repairFrom = bt;
  }

  /** Repaired: the chute runs again. */
  repaired(chute: number, bt: number): void {
    const f = this.down.get(chute);
    if (!f) return;
    this.downBeats += bt - f.since;
    this.down.delete(chute);
  }
}
