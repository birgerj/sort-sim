// The level screen: ten tiles (done, next, locked), the total, and the way back
// to the intro and the free simulation.
import { button, h, stars, tag, topBar } from '../dom';
import { num } from '../format';
import { LEVEL_COUNT } from '../progress';
import type { Ctx } from './context';

export function levelsScreen(ctx: Ctx): HTMLElement {
  const p = ctx.progress;
  const next = p.nextLevel();
  const allDone = p.doneCount() >= LEVEL_COUNT;

  const tiles = ctx.levels.map((level) => {
    const lp = p.level(level.id);
    const open = p.unlocked(level.id);
    const done = (lp?.stars ?? 0) >= 1;
    const number = h('div', { class: 'sh-tile-num', text: String(level.id) });
    const name = h('div', { class: 'sh-tile-name', text: level.name });
    if (!open) {
      return h('li', null, h('div', { class: 'sh-tile sh-tile--locked', attrs: { 'aria-label': `Level ${level.id}, ${level.name}, locked` } }, h('div', { class: 'sh-tile-top' }, number), name, h('div', { class: 'sh-tile-sub', text: 'Locked' })));
    }
    const play = () => ctx.go({ name: 'briefing', id: level.id });
    if (done) {
      return h(
        'li',
        null,
        h(
          'button',
          { class: 'sh-tile sh-tile--done', attrs: { type: 'button', 'aria-label': `Level ${level.id}, ${level.name}, ${lp!.stars} of 3 stars, best score ${num(lp!.best)}${lp!.badge ? ', badge earned' : ''}. Play again` }, on: { click: play } },
          h('div', { class: 'sh-tile-top' }, number, lp!.badge ? tag('Badge', 'sh-tag--goal') : null),
          name,
          h('div', { class: 'sh-tile-foot' }, stars(lp!.stars), h('span', { class: 'sh-tile-score', text: num(lp!.best) })),
        ),
      );
    }
    // Open but without a star yet: the one to play (or to try again).
    const tried = (lp?.attempts ?? 0) > 0;
    return h(
      'li',
      null,
      h(
        'button',
        { class: `sh-tile sh-tile--next${level.id === next ? ' sh-tile--focus' : ''}`, attrs: { type: 'button', 'aria-label': `Level ${level.id}, ${level.name}. Play` }, on: { click: play } },
        h('div', { class: 'sh-tile-top' }, number, tag(tried ? 'Try again' : 'Play')),
        name,
        h('div', { class: 'sh-tile-sub sh-tile-new', text: tried ? `Best so far ${num(lp!.best)}. One star opens the next level.` : `New: ${level.notes.fresh}` }),
      ),
    );
  });

  const actions = [button('How to play', () => ctx.go({ name: 'intro', from: 'levels' })), button('Free simulation', () => ctx.free())];
  if (allDone) actions.unshift(button('End score', () => ctx.go({ name: 'end' }), 'primary'));

  return h(
    'div',
    { class: 'sh-screen sh-levels' },
    topBar(
      'Ten Shifts',
      `${p.doneCount()} of ${LEVEL_COUNT} shifts done · ${p.starCount()} of ${LEVEL_COUNT * 3} stars · par is ${num(LEVEL_COUNT * 1000)}`,
      h('div', { class: 'sh-total' }, h('div', { class: 'sh-total-label', text: 'Total' }), h('div', { class: 'sh-total-value', text: num(p.total()) })),
    ),
    h('ol', { class: 'sh-tiles' }, ...tiles),
    h(
      'div',
      { class: 'sh-levels-foot' },
      h('p', { class: 'sh-panel sh-panel--soft sh-note' }, h('b', { text: 'Stars. ' }), 'One star opens the next level. Three stars need a plan close to par. Every level also has one extra goal that earns a badge.'),
      h('p', { class: 'sh-panel sh-panel--soft sh-note' }, h('b', { text: 'Same for everyone. ' }), 'The ten shifts never change. Only the city names follow your country.'),
      h('div', { class: 'sh-actions' }, ...actions),
    ),
  );
}
