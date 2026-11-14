// The briefing of one level: the orders on a small time line, what is open
// tonight, the prices that matter, the profit needed per star and the extra goal.
import { PRICES, type City, type Level } from '../../../shifts/contract';
import { button, h, stars, tag, topBar } from '../dom';
import { cityColor, cityName, clock, firstParcel, hours, lastParcel, num, plural, price, robotForShift, starTargets, totalParcels, wage } from '../format';
import { levelById, type Ctx } from './context';

/** What the short labels in `notes.setForYou` mean for the player. */
const SET_FOR_YOU: Record<string, string> = {
  Unloading: 'Runs by itself',
  'Robots are off': 'Out of use tonight',
  Doors: 'The hall picks them for you',
};

/** Hour marks over the time lines: every hour, or every two in a long shift. */
function hourMarks(level: Level): HTMLElement {
  const step = level.shiftMinutes > 300 ? 120 : 60;
  const marks: HTMLElement[] = [];
  for (let m = 0; m <= level.shiftMinutes; m += step) {
    const edge = m === 0 ? ' sh-hour--first' : m === level.shiftMinutes ? ' sh-hour--last' : '';
    marks.push(h('span', { class: `sh-hour${edge}`, text: clock(m), attrs: { style: `left:${(m / level.shiftMinutes) * 100}%` } }));
  }
  return h('div', { class: 'sh-hours', attrs: { 'aria-hidden': 'true' } }, ...marks);
}

/** One city's night: a bar while its parcels arrive (taller where more arrive a minute) and a mark at its truck time. */
function lane(level: Level, city: City, i: number): HTMLElement {
  const pct = (m: number) => `${(Math.max(0, Math.min(level.shiftMinutes, m)) / level.shiftMinutes) * 100}%`;
  const peak = city.arrivals.reduce((m, a) => Math.max(m, a.perMinute), 0) || 1;
  const bars = city.arrivals.map((a) =>
    h('div', {
      class: 'sh-lane-bar',
      attrs: { style: `left:${pct(a.from)};width:${((a.to - a.from) / level.shiftMinutes) * 100}%;height:${Math.round(40 + 60 * (a.perMinute / peak))}%;background:${cityColor(i)}` },
    }),
  );
  const at = city.truck / level.shiftMinutes;
  return h(
    'div',
    { class: 'sh-lane', attrs: { 'aria-hidden': 'true' } },
    ...bars,
    h('div', { class: 'sh-lane-truck', attrs: { style: `left:${pct(city.truck)}` } }),
    h('div', { class: `sh-lane-label${at < 0.3 ? ' sh-lane-label--after' : ''}`, text: `truck ${clock(city.truck)}`, attrs: { style: `left:${pct(city.truck)}` } }),
  );
}

export function briefingScreen(ctx: Ctx, id: number): HTMLElement {
  const level = levelById(ctx.levels, id);
  if (!level) return h('div', { class: 'sh-screen' }, topBar('Ten Shifts', 'This level does not exist'), button('All levels', () => ctx.go({ name: 'levels' })));

  const end = clock(level.shiftMinutes);
  const peaks = level.cities.some((c) => new Set(c.arrivals.map((a) => a.perMinute)).size > 1);

  const orders = h(
    'section',
    { class: 'sh-panel sh-orders' },
    h('div', { class: 'sh-panel-head' }, h('h2', { class: 'sh-h2', text: "Tonight's orders" }), h('span', { class: 'sh-dim', text: `${plural(level.cities.length, 'city', 'cities')} · ${num(totalParcels(level))} parcels` })),
    h('div', { class: 'sh-order sh-order--head', attrs: { 'aria-hidden': 'true' } }, h('div', { text: 'City' }), h('div', { class: 'sh-order-n', text: 'Parcels' }), hourMarks(level)),
    h(
      'ul',
      { class: 'sh-order-list' },
      ...level.cities.map((c, i) =>
        h(
          'li',
          { class: 'sh-order' },
          h('div', { class: 'sh-order-city' }, h('span', { class: 'sh-swatch', attrs: { style: `background:${cityColor(i)}` } }), h('div', null, h('b', { text: cityName(ctx.names, i) }), h('div', { class: 'sh-order-sub', text: `arrives ${clock(firstParcel(c))}–${clock(lastParcel(c))}` }))),
          h('div', { class: 'sh-order-n' }, h('b', { text: num(c.volume) }), h('div', { class: 'sh-order-sub', text: `truck ${clock(c.truck)}` })),
          lane(level, c, i),
        ),
      ),
    ),
    h('p', { class: 'sh-dim sh-orders-key', text: `The coloured bar is when a city's parcels arrive${peaks ? ' (taller where more arrive)' : ''}; the dark line is when its truck leaves.` }),
  );

  const fresh = h('section', { class: 'sh-panel sh-fresh' }, h('div', null, tag('New in this level')), h('p', { class: 'sh-fresh-text', text: level.notes.fresh }));

  const setForYou = h(
    'section',
    { class: 'sh-panel sh-panel--soft' },
    h('h2', { class: 'sh-h3', text: 'Set for you tonight' }),
    level.notes.setForYou.length
      ? h('dl', { class: 'sh-pairs' }, ...level.notes.setForYou.flatMap((s) => [h('dt', { text: s }), h('dd', { text: SET_FOR_YOU[s] ?? '' })]))
      : h('p', { class: 'sh-dim', text: 'Nothing: tonight everything is yours to plan.' }),
  );

  const open: [string, string][] = [
    ['Docks', String(level.docks)],
    ['Robots', level.robotsMax > 0 ? `Up to ${level.robotsMax}` : 'Out of use'],
    ['Buffer', `${num(level.bufferCap)} places`],
  ];
  if (level.peopleCap != null) open.push(['People', `At most ${level.peopleCap} at work at once`]);
  if (level.robotOutage && level.robotsMax > 0) open.push(['Robots stand still', `${clock(level.robotOutage[0])}–${clock(level.robotOutage[1])}`]);
  const openTonight = h('section', { class: 'sh-panel sh-panel--soft' }, h('h2', { class: 'sh-h3', text: 'Open tonight' }), h('dl', { class: 'sh-pairs' }, ...open.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])));

  // Only the prices that play a part tonight.
  const prices: [string, string, string][] = [
    ['Parcel shipped', `+ ${price(PRICES.parcel)}`, 'sh-good'],
    ['On time and complete', `+ ${price(PRICES.onTime)} a parcel`, 'sh-good'],
    ['Late, per 10 minutes', `− ${price(PRICES.latePer10Min)} a parcel`, 'sh-bad'],
    ['Left behind', `− ${price(PRICES.leftBehind)} a parcel`, 'sh-bad'],
    ['Dock', `${price(PRICES.dockPerHour)} an hour`, ''],
    [level.wageFactor !== 1 ? `Person (${Math.round(level.wageFactor * 100)}% pay tonight)` : 'Person', `${price(wage(level))} an hour`, ''],
  ];
  if (level.robotsMax > 0) prices.push([`Robot, whole shift (${hours(level.shiftMinutes)})`, `${price(robotForShift(level))} each`, '']);
  prices.push(['Buffer', `${price(PRICES.bufferPerParcel)} a parcel`, '']);
  const priceList = h(
    'section',
    { class: 'sh-panel sh-panel--soft' },
    h('h2', { class: 'sh-h3', text: 'Price list' }),
    h('dl', { class: 'sh-pairs sh-pairs--tight' }, ...prices.flatMap(([k, v, cls]) => [h('dt', { class: 'sh-plain', text: k }), h('dd', { class: `sh-strong ${cls}`, text: v })])),
  );

  const targets = starTargets(level);
  const goal = level.badge.text;
  const toBeat = h(
    'section',
    { class: 'sh-panel sh-panel--soft' },
    h('h2', { class: 'sh-h3', text: 'Profit to beat' }),
    h('ul', { class: 'sh-targets' }, ...targets.map((t, i) => h('li', null, stars(i + 1), h('b', { text: price(t) })))),
    h('p', { class: 'sh-goal', text: `Extra goal: ${/^[A-Z][a-z]/.test(goal) ? goal[0]!.toLowerCase() + goal.slice(1) : goal}` }),
  );

  const best = ctx.progress.level(level.id);
  return h(
    'div',
    { class: 'sh-screen sh-briefing' },
    topBar(`Level ${level.id} · ${level.name}`, `Shift 22:00–${end} · briefing`, button('All levels', () => ctx.go({ name: 'levels' }))),
    h(
      'div',
      { class: 'sh-briefing-grid' },
      h('div', { class: 'sh-col' }, orders, h('div', { class: 'sh-pair' }, fresh, h('div', { class: 'sh-col' }, setForYou, openTonight))),
      h(
        'div',
        { class: 'sh-col' },
        priceList,
        toBeat,
        best && best.attempts > 0 ? h('p', { class: 'sh-dim sh-best', text: `Your best so far: ${num(best.best)} points in ${plural(best.attempts, 'attempt')}.` }) : null,
        h('div', { class: 'sh-sticky' }, button('Plan the shift', () => ctx.go({ name: 'planner', id: level.id }), 'primary', 'sh-btn--big')),
      ),
    ),
  );
}
