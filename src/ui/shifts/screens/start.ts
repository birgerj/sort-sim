// The first screen: the free simulation or the game.
import { button, h, mark, tag } from '../dom';
import type { Ctx } from './context';

export function startScreen(ctx: Ctx): HTMLElement {
  const choice = (accent: boolean, label: string, title: string, lead: string, points: string[], action: HTMLElement) =>
    h(
      'section',
      { class: `sh-panel sh-choice${accent ? ' sh-choice--game' : ''}` },
      h('div', null, tag(label)),
      h('h2', { class: 'sh-choice-title', text: title }),
      h('p', { class: 'sh-choice-lead', text: lead }),
      h('ul', { class: 'sh-choice-points' }, ...points.map((p) => h('li', { text: p }))),
      h('div', { class: 'sh-choice-action' }, action),
    );

  return h(
    'div',
    { class: 'sh-screen sh-start' },
    h('div', { class: 'sh-start-id' }, mark(40), h('div', { class: 'sh-start-name', text: 'Sort Sim' })),
    h(
      'div',
      null,
      h('h1', { class: 'sh-start-title', text: 'What do you want to do?', attrs: { tabindex: -1 } }),
      h('p', { class: 'sh-start-lead', text: 'Explore the parcel hub freely, or run it as a planner in ten night shifts.' }),
    ),
    h(
      'div',
      { class: 'sh-start-choices' },
      choice(
        true,
        'The game',
        'Ten Shifts',
        'You plan the night shift: docks, people and robots.',
        ['Ten levels, from one dock to a full hall', 'Profit is your score', 'First time: a two-minute intro'],
        button('Start the game', () => ctx.go(ctx.progress.introSeen() ? { name: 'levels' } : { name: 'intro', from: 'start' }), 'primary'),
      ),
      choice(
        false,
        'Explore',
        'Free simulation',
        'The hall as it runs today. Look around and change the settings.',
        ['Walk or fly through the hall', 'Day, night and pace are yours to set', 'No score, no rules'],
        button('Open the hall', () => ctx.free()),
      ),
    ),
  );
}
