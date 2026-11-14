// The end score after level 10: the total, stars, badges and the best score per level.
import { button, h, stars, tag, topBar } from '../dom';
import { num, totalParcels } from '../format';
import { LEVEL_COUNT } from '../progress';
import type { Ctx } from './context';

export function endScreen(ctx: Ctx): HTMLElement {
  const p = ctx.progress;
  const parcels = ctx.levels.reduce((s, l) => s + totalParcels(l), 0);
  const weakest = ctx.levels.reduce((w, l) => ((p.level(l.id)?.best ?? 0) < (p.level(w.id)?.best ?? 0) ? l : w), ctx.levels[0]!);

  const rows = ctx.levels.map((l) => {
    const lp = p.level(l.id);
    const best = lp?.best ?? 0;
    return h(
      'li',
      { class: 'sh-best-row' },
      h('div', { class: 'sh-best-num', text: String(l.id) }),
      h('div', { class: 'sh-best-name', text: l.name }),
      h('div', { class: 'sh-meter', attrs: { 'aria-hidden': 'true' } }, h('div', { class: 'sh-meter-fill', attrs: { style: `width:${Math.max(0, Math.min(100, best / 10))}%` } })),
      h('div', { class: 'sh-best-score', text: num(best) }),
      stars(lp?.stars ?? 0, 'sh-stars--small'),
      h('div', { class: 'sh-best-badge' }, lp?.badge ? tag('Badge', 'sh-tag--goal') : null),
    );
  });

  return h(
    'div',
    { class: 'sh-screen sh-end' },
    topBar('Ten Shifts', 'All ten shifts done', button('All levels', () => ctx.go({ name: 'levels' }))),
    h(
      'div',
      { class: 'sh-end-grid' },
      h(
        'div',
        { class: 'sh-col' },
        h(
          'section',
          { class: 'sh-panel sh-hero' },
          h('div', null, tag('Campaign complete')),
          h('div', { class: 'sh-end-total', text: num(p.total()) }),
          h('div', { class: 'sh-hero-sub', text: `Final score · par ${num(LEVEL_COUNT * 1000)} · ${p.starCount()} of ${LEVEL_COUNT * 3} stars · ${p.badgeCount()} of ${LEVEL_COUNT} badges` }),
        ),
        h('p', { class: 'sh-panel sh-panel--soft sh-note' }, h('b', { text: `Ten shifts, ${num(parcels)} parcels. ` }), `Your weakest shift is level ${weakest.id}. Replaying a level only ever raises your total: the best score per level counts.`),
        h('div', { class: 'sh-sticky' }, h('div', { class: 'sh-actions sh-actions--fill' }, button('Free simulation', () => ctx.free()), button('All levels', () => ctx.go({ name: 'levels' }), 'primary'))),
      ),
      h('section', { class: 'sh-panel' }, h('div', { class: 'sh-panel-head' }, h('h2', { class: 'sh-h2', text: 'Best score per level' }), h('span', { class: 'sh-dim sh-small', text: 'par is 1,000 a level' })), h('ol', { class: 'sh-best-list' }, ...rows)),
    ),
  );
}
