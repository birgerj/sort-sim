// Hub performance figures, as a real hub would track them: counted as things
// happen, and sampled every few minutes of hub time into a timeline that can
// be shown and exported.

export interface Departure {
  door: number;
  city: string;
  /** Hub time (minutes since midnight) the truck left, and its cutoff. */
  at: number;
  cutoff: number;
  /** Loads on board and room in the trailer. */
  load: number;
  room: number;
  onTime: boolean;
  /** Left because it was full (not at its cutoff). */
  full: boolean;
}

export interface Sample {
  /** Hub time, minutes since midnight. */
  t: number;
  /** Parcels inducted and parcels out (on a truck, or put aside) per hour, over the last sample. */
  inPerHour: number;
  outPerHour: number;
  /** Average minutes from arriving to leaving, of the parcels that left. */
  dwell: number;
  /** Shares of the parcels inducted: went round again, could not be read, put aside to manual sorting. */
  recircPct: number;
  noreadPct: number;
  manualPct: number;
  missorts: number;
  /** Chutes full at the moment of the sample, robots busy, parcels queued at the infeed. */
  chutesFull: number;
  robotsBusyPct: number;
  infeedQueue: number;
  onTimePct: number;
  loadFactorPct: number;
  /** Buffer store: parcels in it (and on their way in) and places, at the sample. */
  storeUsed: number;
  storeSlots: number;
  /** The destination with the most parcels inducted since the last sample, and its share. */
  topCity: string;
  topPct: number;
  /** The batch running at the sample ('' when none). */
  batch: string;
}

/** Counters since the last sample. */
interface Window {
  inducted: number;
  out: number;
  dwellSum: number;
  recirc: number;
  noread: number;
  manual: number;
  missorts: number;
  byCity: Map<string, number>;
}

const empty = (): Window => ({ inducted: 0, out: 0, dwellSum: 0, recirc: 0, noread: 0, manual: 0, missorts: 0, byCity: new Map() });

export class Kpi {
  readonly samples: Sample[] = [];
  readonly departures: Departure[] = [];
  private w = empty();
  private total = empty();
  private lastT: number | null = null;
  /** Minutes of hub time per sample. */
  readonly every = 5;

  inducted(city = ''): void {
    if (city) this.w.byCity.set(city, (this.w.byCity.get(city) ?? 0) + 1);
    this.w.inducted++;
    this.total.inducted++;
  }

  /** A parcel left the hub (on a truck or put aside), after `dwell` minutes. */
  out(dwell: number): void {
    this.w.out++;
    this.w.dwellSum += dwell;
    this.total.out++;
    this.total.dwellSum += dwell;
  }

  recirculated(): void {
    this.w.recirc++;
    this.total.recirc++;
  }

  noread(): void {
    this.w.noread++;
    this.total.noread++;
  }

  toManual(): void {
    this.w.manual++;
    this.total.manual++;
  }

  missort(): void {
    this.w.missorts++;
    this.total.missorts++;
  }

  departed(d: Departure): void {
    this.departures.push(d);
    if (this.departures.length > 400) this.departures.shift();
  }

  /** Call often; takes a sample every `every` minutes of hub time. */
  tick(t: number, state: () => { chutesFull: number; robotsBusyPct: number; infeedQueue: number; storeUsed: number; storeSlots: number; batch: string }): void {
    if (this.lastT === null) this.lastT = t;
    if (t - this.lastT < this.every) return;
    const span = t - this.lastT;
    this.lastT = t;
    const w = this.w;
    const recent = this.departures.slice(-40);
    const st = state();
    let top: [string, number] = ['', 0];
    for (const e of w.byCity) if (e[1] > top[1]) top = e;
    this.samples.push({
      t,
      inPerHour: Math.round((w.inducted * 60) / span),
      outPerHour: Math.round((w.out * 60) / span),
      dwell: w.out ? +(w.dwellSum / w.out).toFixed(1) : 0,
      recircPct: pct(w.recirc, w.inducted),
      noreadPct: pct(w.noread, w.inducted),
      manualPct: pct(w.manual, w.inducted),
      missorts: w.missorts,
      chutesFull: st.chutesFull,
      robotsBusyPct: Math.round(st.robotsBusyPct),
      infeedQueue: st.infeedQueue,
      onTimePct: recent.length ? pct(recent.filter((d) => d.onTime).length, recent.length) : 100,
      loadFactorPct: recent.length ? Math.round((100 * recent.reduce((a, d) => a + d.load / d.room, 0)) / recent.length) : 0,
      storeUsed: st.storeUsed,
      storeSlots: st.storeSlots,
      topCity: top[0],
      topPct: pct(top[1], w.inducted),
      batch: st.batch,
    });
    if (this.samples.length > 600) this.samples.shift();
    this.w = empty();
  }

  /** Totals since the start. */
  totals(): { inducted: number; out: number; dwell: number; recircPct: number; noreadPct: number; manualPct: number; missorts: number; departures: number; onTimePct: number; loadFactorPct: number } {
    const t = this.total;
    const d = this.departures;
    return {
      inducted: t.inducted,
      out: t.out,
      dwell: t.out ? +(t.dwellSum / t.out).toFixed(1) : 0,
      recircPct: pct(t.recirc, t.inducted),
      noreadPct: pct(t.noread, t.inducted),
      manualPct: pct(t.manual, t.inducted),
      missorts: t.missorts,
      departures: d.length,
      onTimePct: d.length ? pct(d.filter((x) => x.onTime).length, d.length) : 100,
      loadFactorPct: d.length ? Math.round((100 * d.reduce((a, x) => a + x.load / x.room, 0)) / d.length) : 0,
    };
  }

  /** The timeline and the departures as CSV (two tables, one after the other). */
  csv(): string {
    const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
    const cols: (keyof Sample)[] = ['t', 'inPerHour', 'outPerHour', 'dwell', 'recircPct', 'noreadPct', 'manualPct', 'missorts', 'chutesFull', 'robotsBusyPct', 'infeedQueue', 'onTimePct', 'loadFactorPct', 'storeUsed', 'storeSlots', 'topCity', 'topPct', 'batch'];
    const lines = [cols.join(',')];
    for (const s of this.samples) lines.push(cols.map((c) => (c === 't' ? hhmm(s.t) : String(s[c]))).join(','));
    lines.push('', 'door,city,departed,cutoff,load,room,onTime,full');
    for (const d of this.departures) lines.push([d.door, `"${d.city}"`, hhmm(d.at), hhmm(d.cutoff), d.load, d.room, d.onTime, d.full].join(','));
    return lines.join('\n');
  }
}

const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);
