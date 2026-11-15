// How to play: two cards, each with a small example made of the game's own parts. (The levels
// teach the rest, one thing at a time.)
// Shown by itself the first time; later it is replayed from the level screen.
import { CURRENCY, PRICES, RATES } from '../../../shifts/contract';
import { button, h, mark, stars, tag } from '../dom';
import { cityColor, cityName, price } from '../format';
import type { Ctx } from './context';

interface Step {
  title: string;
  body: string;
  example(names: string[]): HTMLElement;
}

const row = (a: string, b: string, cls = '') => h('div', { class: `sh-demo-row ${cls}` }, h('span', { text: a }), h('b', { text: b }));

const STEPS: Step[] = [
  {
    title: 'What you plan',
    body: `Every city has parcels coming in and a cut-off: then sorting for its truck stops and the truck leaves 15 minutes later. You plan blocks: from when to when a city gets a dock, and with how many people. One person loads ${RATES.onePerson} parcels an hour, two load ${RATES.twoPeople}.`,
    example: (names) =>
      h(
        'div',
        { class: 'sh-demo' },
        h('div', { class: 'sh-demo-hours' }, h('span', { text: '22:00' }), h('span', { text: '23:00' }), h('span', { text: '00:00' })),
        h(
          'div',
          { class: 'sh-demo-lane' },
          h('div', { class: 'sh-demo-block', attrs: { style: `background:${cityColor(0)}` } }, h('div', { class: 'sh-demo-block-city', text: cityName(names, 0) }), h('div', { class: 'sh-demo-block-sub', text: '22:00–23:30 · 1 person' })),
          h('div', { class: 'sh-demo-truck' }),
        ),
        h('div', { class: 'sh-demo-row' }, h('span', { text: '150 parcels' }), h('span', { text: 'cut-off 00:00' })),
        h('div', { class: 'sh-demo-people' }, h('span', { text: 'People' }), h('span', { class: 'sh-demo-key sh-demo-key--on', text: '1' }), h('span', { class: 'sh-demo-key', text: '2' })),
      ),
  },
  {
    title: 'How you score',
    body: `Every parcel on its truck earns ${CURRENCY} ${PRICES.parcel.toFixed(2)}, and a truck that leaves on time and complete earns a bonus. Docks, people and robots cost money for as long as you use them; parcels left behind cost more. Start the shift, watch the hall play your night, see where the money went, and try again for more stars.`,
    example: () =>
      h(
        'div',
        { class: 'sh-demo' },
        h('div', { class: 'sh-demo-head', text: 'Money in' }),
        row('Parcel shipped', `+ ${price(PRICES.parcel)}`, 'sh-good'),
        row('On time and complete', `+ ${price(PRICES.onTime)}`, 'sh-good'),
        h('div', { class: 'sh-demo-head', text: 'Money out' }),
        row('Dock, an hour', price(PRICES.dockPerHour)),
        row('Person, an hour', price(PRICES.personPerHour)),
        row('Left behind', `− ${price(PRICES.leftBehind)}`, 'sh-bad'),
      ),
  },
];

export function introScreen(ctx: Ctx, from: 'start' | 'levels'): HTMLElement {
  let at = 0;
  const done = () => {
    ctx.progress.markIntroSeen();
    ctx.go({ name: 'levels' });
  };

  const list = h('ol', { class: 'sh-intro-steps' });
  const card = h('section', { class: 'sh-panel sh-intro-card' });
  const root = h(
    'div',
    { class: 'sh-screen sh-intro' },
    h('header', { class: 'sh-intro-top' }, h('div', { class: 'sh-bar-id' }, mark(40), h('div', { class: 'sh-intro-name', text: 'Ten Shifts · how to play' })), button(from === 'levels' ? 'Close' : 'Skip intro', done, 'link')),
    h('div', { class: 'sh-intro-body' }, h('div', { class: 'sh-intro-side' }, list), card),
  );

  const draw = (focus: boolean) => {
    const step = STEPS[at]!;
    list.replaceChildren(
      ...STEPS.map((s, i) =>
        h(
          'li',
          { class: `sh-intro-step${i === at ? ' sh-intro-step--on' : ''}${i <= at ? ' sh-intro-step--seen' : ''}`, attrs: { 'aria-current': i === at ? 'step' : undefined } },
          h('span', { class: 'sh-intro-num', text: String(i + 1) }),
          h('span', { text: s.title }),
        ),
      ),
    );
    const back = button('Back', () => {
      at--;
      draw(true);
    });
    back.disabled = at === 0;
    const last = at === STEPS.length - 1;
    const next = button(
      last ? (from === 'levels' ? 'Done' : 'To the levels') : 'Next',
      () => {
        if (last) return done();
        at++;
        draw(true);
      },
      'primary',
    );
    const title = h('h1', { class: 'sh-intro-title', text: step.title, attrs: { tabindex: -1 } });
    card.replaceChildren(
      h(
        'div',
        { class: 'sh-intro-text' },
        h('div', null, tag(`Step ${at + 1} of ${STEPS.length}`, 'sh-tag--acc')),
        title,
        h('p', { class: 'sh-intro-p', text: step.body }),
        h(
          'div',
          { class: 'sh-intro-nav' },
          h('div', { class: 'sh-dots', attrs: { 'aria-hidden': 'true' } }, ...STEPS.map((_, i) => h('span', { class: `sh-dot${i === at ? ' sh-dot--on' : ''}` }))),
          h('div', { class: 'sh-intro-buttons' }, back, next),
        ),
      ),
      h('div', { class: 'sh-intro-example', attrs: { 'aria-hidden': 'true' } }, step.example(ctx.names)),
    );
    if (focus) title.focus();
  };
  draw(false);
  return root;
}
