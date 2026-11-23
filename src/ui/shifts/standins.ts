// Stand-ins for the planner and the running-shift panel, used only when
// mountShifts gets no `views`: enough to walk from briefing to result while the
// real ones are built elsewhere. Loaded on demand, so a build that passes the
// real views never fetches this.
import type { Level, Plan } from '../../shifts/contract';
import fixture from '../../../tests/fixtures/shifts/level4.json' with { type: 'json' };
import { button, h, topBar } from './dom';
import { cityColor, cityName, clock, firstParcel, plural } from './format';
import { DEFAULT_SPEED, SPEEDS, type PlannerView, type ShiftHud } from './planner-seam';

/** A plan to start from: the fixture's for its own level, else one person on one dock per city
 *  from its first parcel to its truck time (as many cities as there are docks). */
function starterPlan(level: Level): Plan {
  if (level.id === fixture.level.id) return fixture.plan as Plan;
  return {
    blocks: level.cities.slice(0, level.docks).map((c, city) => ({ city, start: firstParcel(c), end: c.truck, people: 1 as const, docks: 1 })),
    robotCities: [],
    robots: 0,
  };
}

export const stubPlanner: PlannerView = (o) => {
  const plan = o.plan.blocks.length || o.plan.robots ? o.plan : starterPlan(o.level);
  return h(
    'div',
    { class: 'sh-screen sh-stub' },
    topBar(`Level ${o.level.id} · ${o.level.name}`, 'Plan · stand-in for the planner', button('Briefing', o.onBack)),
    h(
      'section',
      { class: 'sh-panel' },
      h('h2', { class: 'sh-h2', text: 'The plan' }),
      h('p', { class: 'sh-dim', text: 'The planner is not in this build. This is the plan that will run: your last one, or a ready-made one.' }),
      h(
        'ul',
        { class: 'sh-stub-list' },
        ...plan.blocks.map((b) =>
          h(
            'li',
            null,
            h('span', { class: 'sh-swatch sh-swatch--small', attrs: { style: `background:${cityColor(b.city)}` } }),
            h('b', { text: cityName(o.cityNames, b.city) }),
            ` ${clock(b.start)}–${clock(b.end)} · ${plural(b.people, 'person', 'people')} · ${plural(b.docks, 'dock')}`,
          ),
        ),
        plan.robots ? h('li', null, `${plural(plan.robots, 'robot')} for ${plan.robotCities.map((c) => cityName(o.cityNames, c)).join(', ') || 'no city'}`) : null,
      ),
      h('div', { class: 'sh-actions' }, button('Start shift', () => o.onStart(plan), 'primary', 'sh-btn--big')),
    ),
  );
};

export const stubHud: ShiftHud = (o) => {
  const time = h('b', { class: 'sh-hud-clock', text: clock(0) });
  const state = h('span', { class: 'sh-hud-state', text: 'The shift is starting…', attrs: { role: 'status' } });
  const speeds: [string, number][] = [
    ['Pause', SPEEDS.pause],
    ['1×', SPEEDS.x1],
    ['4×', SPEEDS.x4],
    ['16×', SPEEDS.x16],
  ];
  const keys: HTMLButtonElement[] = speeds.map(([label, v]) => {
    const key = button(label, () => {
      for (const k of keys) k.setAttribute('aria-pressed', String(k === key));
      o.onSpeed(v);
    });
    key.classList.add('sh-hud-key');
    key.setAttribute('aria-pressed', String(v === DEFAULT_SPEED));
    return key;
  });
  const root = h(
    'div',
    { class: 'sh-hud' },
    h('div', { class: 'sh-hud-id' }, h('b', { text: `Level ${o.level.id} · ${o.level.name}` }), state),
    h('div', { class: 'sh-hud-controls' }, time, h('span', { class: 'sh-dim', text: `of ${clock(o.level.shiftMinutes)}` }), ...keys, button('Skip to result', o.onSkip, 'primary', 'sh-hud-key')),
  );
  return {
    root,
    setClock: (minute) => (time.textContent = clock(Math.min(minute, o.level.shiftMinutes))),
    setTimeline: () => (state.textContent = 'Plan locked · watch the shift'),
    done: () => (state.textContent = 'Shift done'),
  };
};
