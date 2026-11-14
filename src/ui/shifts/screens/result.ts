// The result of one shift: stars, profit against par, the level score, where the
// money went (and what changed since the attempt before), the trucks and the
// buffer as it really filled.
import { PRICES, type Result, type TruckStatus } from '../../../shifts/contract';
import { button, h, stars, tag, topBar } from '../dom';
import { cityColor, cityName, clock, cost, hours, money, num, planTime, plural } from '../format';
import { LEVEL_COUNT } from '../progress';
import type { Ctx, Outcome } from './context';

const STATUS: Record<TruckStatus, [string, string]> = {
  onTime: ['On time', 'sh-pill--good'],
  late: ['Late', 'sh-pill--warn'],
  incomplete: ['Not full', 'sh-pill--bad'],
};

/** "§ 25 better", "§ 9 worse" or "same": `gain` is positive when this attempt did better. */
function change(gain: number): [string, string] {
  const g = Math.round(gain);
  if (g === 0) return ['same', ''];
  return g > 0 ? [`${money(g)} better`, 'sh-good'] : [`${money(-g)} worse`, 'sh-bad'];
}

/** The buffer every five minutes as bars; the stretches it was full in red. */
function bufferChart(result: Result, shiftMinutes: number): HTMLElement {
  const { series, cap, fullRanges } = result.buffer;
  let peak = 0;
  let peakAt = 0;
  series.forEach((v, k) => {
    if (v > peak) {
      peak = v;
      peakAt = k * 5;
    }
  });
  // The chart reaches up to the buffer's size when the night came anywhere near it;
  // otherwise it zooms in on what happened and says so.
  const toCap = peak >= cap * 0.5;
  const top = Math.max(1, toCap ? cap : peak / 0.8);
  const isFull = (m: number) => fullRanges.some(([a, b]) => m >= a && m <= b);
  const bars = series.map((v, k) => h('div', { class: `sh-buf-bar${isFull(k * 5) ? ' sh-buf-bar--full' : ''}`, attrs: { style: `height:${Math.min(100, (v / top) * 100)}%` } }));
  const mid = Math.round(shiftMinutes / 2 / 30) * 30;
  const full = fullRanges.map(([a, b]) => `${clock(a)}–${clock(b)}`);
  const text = full.length
    ? `Full ${full.length === 1 ? 'from' : 'in the stretches'} ${full.join(', ')} (red). Parcels that found no place then had to wait before the sorter.`
    : peak === 0
      ? 'Nothing went to the buffer tonight.'
      : toCap
        ? 'Never full tonight. The dashed line is the size of the buffer.'
        : `Never full tonight: the buffer has ${num(cap)} places, far above this chart.`;
  return h(
    'section',
    { class: 'sh-panel sh-panel--soft' },
    h('div', { class: 'sh-panel-head' }, h('h2', { class: 'sh-h3', text: 'Buffer during the shift' }), h('span', { class: 'sh-dim sh-small', text: peak > 0 ? `peak ${num(peak)} of ${num(cap)} at ${clock(peakAt)}` : `0 of ${num(cap)}` })),
    h(
      'div',
      { class: 'sh-buf', attrs: { role: 'img', 'aria-label': `Buffer during the shift: ${peak > 0 ? `peak ${num(peak)} of ${num(cap)} places at ${clock(peakAt)}` : 'empty all night'}. ${full.length ? `Full ${full.join(', ')}.` : 'Never full.'}` } },
      toCap ? h('div', { class: 'sh-buf-cap' }) : null,
      ...bars,
    ),
    h('div', { class: 'sh-buf-axis', attrs: { 'aria-hidden': 'true' } }, h('span', { text: clock(0) }), h('span', { text: clock(mid) }), h('span', { text: clock(shiftMinutes) })),
    h('p', { class: 'sh-small sh-buf-text', text }),
  );
}

export function resultScreen(ctx: Ctx, o: Outcome): HTMLElement {
  const { level, plan, result, previous, attempt } = o;
  const p = ctx.progress;
  const lines = result.lines;

  // Hero: stars, profit, par, score.
  const sub = [`Profit`, `par is ${money(level.par)}`];
  if (previous) {
    const d = Math.round(result.profit - previous.profit);
    sub.push(d === 0 ? 'the same as last time' : `${money(Math.abs(d))} ${d > 0 ? 'better' : 'worse'} than last time`);
  }
  const hero = h(
    'section',
    { class: 'sh-panel sh-hero' },
    h('div', { class: 'sh-hero-top' }, tag('Shift complete'), h('span', { class: 'sh-hero-attempt', text: `Attempt ${attempt}` })),
    stars(result.stars, 'sh-stars--big'),
    h('div', { class: 'sh-hero-profit', text: money(result.profit) }),
    h('div', { class: 'sh-hero-sub', text: sub.join(' · ') }),
    h('div', { class: 'sh-hero-score' }, h('span', { text: 'Level score' }), h('b', { text: num(result.score) })),
  );

  const badge = result.badge
    ? h('p', { class: 'sh-badge sh-badge--got' }, h('b', { text: 'Badge earned. ' }), `${level.badge.text}.`)
    : h('p', { class: 'sh-badge' }, h('b', { text: p.level(level.id)?.badge ? 'Extra goal not met this time. ' : 'Extra goal not met. ' }), `${level.badge.text}.`);

  // Profit and loss.
  const shipped = result.trucks.reduce((s, t) => s + t.loaded, 0);
  const onTime = result.trucks.filter((t) => t.status === 'onTime').length;
  const lateTrucks = result.trucks.filter((t) => t.status === 'late').length;
  const leftBehind = result.trucks.reduce((s, t) => s + Math.max(0, (level.cities[t.city]?.volume ?? t.loaded) - t.loaded), 0);
  const time = planTime(plan);
  type Row = { label: string; key: keyof Result['lines']; income: boolean };
  const rows: Row[] = [
    { label: `Parcels shipped, ${num(shipped)}`, key: 'revenue', income: true },
    { label: `On-time bonus, ${onTime} of ${plural(result.trucks.length, 'truck')}`, key: 'bonus', income: true },
    { label: lateTrucks ? `Late, ${plural(lateTrucks, 'truck')}` : 'Late', key: 'late', income: false },
    { label: Math.round(leftBehind) ? `Left behind, ${plural(Math.round(leftBehind), 'parcel')}` : 'Left behind', key: 'left', income: false },
    { label: `Docks, ${hours(time.dock)}`, key: 'docks', income: false },
    { label: `People, ${hours(time.people)}`, key: 'people', income: false },
  ];
  if (level.robotsMax > 0 || lines.robots > 0) rows.push({ label: `Robots, ${plan.robots}`, key: 'robots', income: false });
  rows.push({ label: `Buffer, ${plural(Math.round(lines.buffer / PRICES.bufferPerParcel), 'parcel')}`, key: 'buffer', income: false });

  const cells: HTMLElement[] = [h('h2', { class: 'sh-h2', text: 'Profit and loss' }), h('div', { class: 'sh-pl-head', text: 'this shift' })];
  if (previous) cells.push(h('div', { class: 'sh-pl-head', text: `against attempt ${attempt - 1}` }));
  for (const r of rows) {
    const v = lines[r.key];
    cells.push(h('div', { text: r.label }));
    cells.push(h('div', { class: `sh-pl-amount ${v === 0 ? '' : r.income ? 'sh-good' : 'sh-bad'}`, text: r.income ? money(v) : cost(v) }));
    if (previous) {
      const [text, cls] = change(r.income ? v - previous.lines[r.key] : previous.lines[r.key] - v);
      cells.push(h('div', { class: `sh-pl-change ${cls}`, text }));
    }
  }
  cells.push(h('div', { class: 'sh-pl-total', text: 'Profit' }), h('div', { class: 'sh-pl-total sh-pl-amount', text: money(result.profit) }));
  if (previous) {
    const [text, cls] = change(result.profit - previous.profit);
    cells.push(h('div', { class: `sh-pl-total sh-pl-change sh-strong ${cls}`, text }));
  }
  const pl = h('section', { class: 'sh-panel' }, h('div', { class: `sh-pl${previous ? ' sh-pl--3' : ''}` }, ...cells), previous ? null : h('p', { class: 'sh-dim sh-small sh-pl-first', text: 'Your first attempt. Next time you see here what changed.' }));

  // Trucks.
  const trucks = h(
    'section',
    { class: 'sh-panel sh-panel--soft' },
    h('h2', { class: 'sh-h3', text: 'Trucks' }),
    h(
      'table',
      { class: 'sh-trucks' },
      h('thead', null, h('tr', null, ...['City', 'Loaded', 'Planned', 'Left', 'Status'].map((t) => h('th', { text: t, attrs: { scope: 'col' } })))),
      h(
        'tbody',
        null,
        ...result.trucks.map((t) => {
          const volume = level.cities[t.city]?.volume ?? t.loaded;
          const [label, cls] = STATUS[t.status] ?? [t.status, ''];
          return h(
            'tr',
            null,
            h('th', { attrs: { scope: 'row' } }, h('span', { class: 'sh-swatch sh-swatch--small', attrs: { style: `background:${cityColor(t.city)}` } }), cityName(ctx.names, t.city)),
            h('td', { text: `${num(t.loaded)} of ${num(volume)}` }),
            h('td', { text: clock(t.planned) }),
            h('td', { text: clock(t.left) }),
            h('td', null, h('span', { class: `sh-pill ${cls}`, text: label })),
          );
        }),
      ),
    ),
  );

  // Where to next.
  const last = level.id >= LEVEL_COUNT;
  const canGoOn = last ? p.doneCount() >= LEVEL_COUNT : p.unlocked(level.id + 1);
  const adjust = button('Adjust plan', () => ctx.go({ name: 'planner', id: level.id }), canGoOn ? 'plain' : 'primary');
  const onward = button(last ? 'End score' : 'Next level', () => ctx.go(last ? { name: 'end' } : { name: 'briefing', id: level.id + 1 }), canGoOn ? 'primary' : 'plain');
  onward.disabled = !canGoOn;
  const hint = canGoOn ? null : h('p', { class: 'sh-dim sh-small', text: last ? 'The end score opens when every level has a star.' : 'One star opens the next level: adjust the plan and run the shift again.' });

  const done = ctx.levels.filter((l) => (p.level(l.id)?.attempts ?? 0) > 0).length;
  const total = h(
    'section',
    { class: 'sh-panel sh-panel--soft sh-total-row' },
    h('div', null, h('b', { text: 'Campaign total ' }), h('span', { class: 'sh-dim', text: `best score of ${plural(done, 'level')}` })),
    h('div', { class: 'sh-total-value', text: num(p.total()) }),
  );

  return h(
    'div',
    { class: 'sh-screen sh-result' },
    topBar(`Level ${level.id} · ${level.name}`, 'Result', button('All levels', () => ctx.go({ name: 'levels' }))),
    h('div', { class: 'sh-result-grid' }, h('div', { class: 'sh-col' }, hero, badge, h('div', { class: 'sh-sticky sh-col' }, h('div', { class: 'sh-actions sh-actions--fill' }, adjust, onward), hint)), h('div', { class: 'sh-col' }, pl, bufferChart(result, level.shiftMinutes), trucks, total)),
  );
}
