// Ten Shifts: what lies over the hall while the shift plays. A bar on top (level, clock, speed)
// and a card per city with the money so far; the middle of the screen stays free for the hall.
// It only shows what the timeline says: it does not count anything itself.
import { PRICES, type Level, type Plan, type Timeline, type TruckStatus } from '../../../shifts/contract';
import { cityColour, cityName, clock, count, h, mark, money } from './dom';
import { fixedCosts } from './rules';

export interface HudOptions {
  level: Level;
  cityNames: string[];
  plan: Plan;
  onSpeed(minutesPerSecond: number): void;
  onSkip(): void;
}

export interface ShiftHud {
  root: HTMLElement;
  setClock(minute: number): void;
  setTimeline(t: Timeline): void;
  done(): void;
}

/** The speed buttons: shift minutes per real second. */
const SPEEDS = [
  { label: 'Pause', value: 0 },
  { label: '1×', value: 2 },
  { label: '4×', value: 8 },
  { label: '16×', value: 32 },
] as const;
const STATUS: Record<TruckStatus, string> = { onTime: 'On time', late: 'Late', incomplete: 'Not complete' };

/** Parcels of a city on its trucks at this minute, between the timeline's 5-minute samples. */
export function loadedAt(t: Timeline, city: number, minute: number): number {
  const rows = t.cityLoaded;
  if (!rows.length) return 0;
  const pos = Math.max(0, Math.min(rows.length - 1, minute / t.stepMinutes));
  const k = Math.floor(pos);
  const a = rows[k]?.[city] ?? 0;
  const b = rows[Math.min(rows.length - 1, k + 1)]?.[city] ?? a;
  return a + (b - a) * (pos - k);
}

/** Money for the trucks that have left by this minute: § 1.50 per loaded parcel, § 0.30 more when on time. */
export function earnedBy(t: Timeline, minute: number): number {
  let sum = 0;
  for (const d of t.departures) {
    if (d.at > minute) continue;
    sum += loadedAt(t, d.city, d.at) * (PRICES.parcel + (d.status === 'onTime' ? PRICES.onTime : 0));
  }
  return sum;
}

export function shiftHud(o: HudOptions): ShiftHud {
  const { level, cityNames, plan } = o;
  const name = (c: number) => cityName(cityNames, c);
  let timeline: Timeline | null = null;
  let minute = 0;
  let speed = 8;
  let over = false;

  const sub = h('p', { text: 'Starting the shift' });
  const time = h('div', { class: 'shp-hud-clock shp-num', role: 'timer', text: clock(0) });
  const fillEl = h('span');
  const progress = h('div', { class: 'shp-hud-progress' },
    h('div', { class: 'shp-hud-meter', role: 'progressbar', 'aria-label': 'Shift played', 'aria-valuemin': '0', 'aria-valuemax': String(level.shiftMinutes), 'aria-valuenow': '0' }, fillEl),
    h('div', { class: 'shp-hud-ends shp-num' }, h('span', { text: clock(0) }), h('span', { text: clock(level.shiftMinutes) })));
  const meter = progress.firstElementChild as HTMLElement;

  const speedButtons = SPEEDS.map((s) =>
    h('button', { class: 'shp-pick', type: 'button', 'aria-pressed': String(s.value === speed), text: s.label, onclick: () => {
      speed = s.value;
      speedButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(SPEEDS[i]!.value === speed)));
      o.onSpeed(s.value);
    } }));
  const skip = h('button', { class: 'shp-pick shp-hud-skip', type: 'button', 'aria-label': 'Skip to result', onclick: () => o.onSkip() }, h('span', { class: 'shp-wide', text: 'Skip to result' }), h('span', { class: 'shp-narrow', text: 'Skip' }));
  const controls = h('div', { class: 'shp-hud-speed', role: 'group', 'aria-label': 'Speed' }, ...speedButtons, skip);

  // Cards in the order the trucks are due.
  const order = level.cities.map((_, i) => i).sort((a, b) => level.cities[a]!.truck - level.cities[b]!.truck || a - b);
  // Many cities: two narrow columns of cards, so the words are kept short.
  const compact = order.length > 8;
  const due = (truck: number) => (compact ? clock(truck) : `truck ${clock(truck)}`);
  const cards = order.map((c) => {
    const city = level.cities[c]!;
    const tag = h('span', { class: 'shp-hud-tag shp-num', title: 'Truck time', text: due(city.truck) });
    const bar = h('span');
    const line = h('div', { class: 'shp-hud-line shp-num', text: `0 of ${count(city.volume)}${compact ? '' : ' loaded'}` });
    const el = h('div', { class: 'shp-hud-card', style: `--c:${cityColour(c)}` },
      h('div', { class: 'shp-hud-card-top' }, h('b', { text: name(c) }), tag),
      h('div', { class: 'shp-hud-bar' }, bar),
      line);
    return { c, city, el, tag, bar, line, shown: '' };
  });
  const earned = h('b', { class: 'shp-num', text: money(0) });
  const spent = h('b', { class: 'shp-num', text: money(0) });
  const balance = h('b', { class: 'shp-num shp-hud-balance', text: money(0) });
  const last = h('div', { class: 'shp-hud-last', 'aria-live': 'polite', text: 'Money arrives when a truck leaves.' });
  const moneyCard = h('div', { class: 'shp-hud-money' },
    h('span', { text: 'Earned so far' }), earned,
    h('span', { text: 'Costs so far' }), spent,
    h('span', { class: 'shp-hud-sum', text: 'Balance' }), balance);
  const list = h('div', { class: `shp-hud-cards${cards.length > 8 ? ' is-many' : ''}`, tabindex: '0', role: 'group', 'aria-label': 'Cities' }, ...cards.map((k) => k.el));

  const root = h('div', { class: `shp-hud${compact ? ' is-many' : ''}` },
    h('header', { class: 'shp-hud-top' },
      h('div', { class: 'shp-title' }, mark(), h('div', {}, h('h1', {}, h('span', { class: 'shp-wide', text: 'Level ' }), `${level.id} · ${level.name}`), sub)),
      h('div', { class: 'shp-hud-right' }, time, progress, controls)),
    h('aside', { class: 'shp-hud-side', 'aria-label': 'Trucks and money' }, list, h('div', { class: 'shp-hud-foot' }, moneyCard, last)),
  );

  function draw(): void {
    const m = Math.max(0, minute);
    time.textContent = clock(Math.min(m, level.shiftMinutes));
    const part = Math.min(1, m / level.shiftMinutes);
    fillEl.style.width = `${part * 100}%`;
    meter.setAttribute('aria-valuenow', String(Math.round(Math.min(m, level.shiftMinutes))));
    const costs = fixedCosts(level, plan, m).total;
    spent.textContent = `− ${money(costs)}`;
    if (!timeline) return;
    let lastLeft: { at: number; text: string } | null = null;
    for (const k of cards) {
      const dep = timeline.departures.find((d) => d.city === k.c);
      const left = dep && dep.at <= m ? dep : null;
      const loaded = Math.min(k.city.volume, loadedAt(timeline, k.c, left ? left.at : m));
      // (Text nodes are only written when they change: this runs every frame.)
      const text = left ? `${count(loaded)} of ${count(k.city.volume)} · left ${clock(left.at)}` : `${count(loaded)} of ${count(k.city.volume)}${compact ? '' : ' loaded'}`;
      if (text !== k.shown) {
        k.shown = text;
        k.line.textContent = text;
        k.bar.style.width = `${k.city.volume > 0 ? Math.min(100, (loaded / k.city.volume) * 100) : 0}%`;
        k.tag.textContent = left ? STATUS[left.status] : due(k.city.truck);
        k.tag.className = `shp-hud-tag shp-num${left ? ` is-${left.status}` : ''}`;
        k.el.classList.toggle('is-gone', !!left);
      }
      if (left && (!lastLeft || left.at >= lastLeft.at)) {
        const got = loaded * (PRICES.parcel + (left.status === 'onTime' ? PRICES.onTime : 0));
        lastLeft = { at: left.at, text: `${clock(left.at)} ${name(k.c)} left${left.status === 'onTime' ? ' on time' : left.status === 'late' ? ' late' : ', not complete'} + ${money(got)}` };
      }
    }
    const got = earnedBy(timeline, m);
    earned.textContent = money(got);
    balance.textContent = money(got - costs);
    const note = lastLeft ? lastLeft.text : 'Money arrives when a truck leaves.';
    if (last.textContent !== note) last.textContent = note;
  }

  draw();
  return {
    root,
    setClock(m: number) {
      minute = m;
      draw();
    },
    setTimeline(t: Timeline) {
      timeline = t;
      if (!over) sub.textContent = 'Plan locked · watch the shift';
      draw();
    },
    done() {
      over = true;
      minute = Math.max(minute, level.shiftMinutes + 30);
      sub.textContent = 'Shift over';
      for (const b of [...speedButtons, skip]) b.disabled = true;
      draw();
    },
  };
}
