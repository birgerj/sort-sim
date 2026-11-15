// The players' ranking, where a server keeps the scores: everyone's total and the best per
// level, with this player's own place and the name they show under.
import type { RankRow, Ranking } from '../../../shifts/contract';
import { button, h, stars, tag, topBar } from '../dom';
import { num } from '../format';
import type { Ctx } from './context';

export function rankingScreen(ctx: Ctx, ranking: Ranking): HTMLElement {
  let view: 'total' | number = 'total';
  const list = h('ol', { class: 'sh-rank-list' });
  const note = h('p', { class: 'sh-dim sh-small sh-rank-note', attrs: { role: 'status' } });
  const picks = h('div', { class: 'sh-rank-picks', attrs: { role: 'group', 'aria-label': 'Which ranking' } });
  const mine = () => ranking.name();

  function row(place: number, r: RankRow, total: boolean): HTMLElement {
    return h(
      'li',
      { class: `sh-rank-row${r.me ? ' is-me' : ''}` },
      h('span', { class: 'sh-rank-place', text: String(place) }),
      h('span', { class: 'sh-rank-name' }, r.name || 'No name', r.me ? h('span', { class: 'sh-rank-country', text: 'you' }) : null, r.country ? h('span', { class: 'sh-rank-country', text: r.country.toUpperCase() }) : null),
      total ? h('span', { class: 'sh-dim sh-small', text: `${r.levels ?? 0}/10 · ${r.stars}★` }) : stars(r.stars, 'sh-stars--small'),
      !total && r.badge ? tag('Badge', 'sh-tag--goal') : null,
      h('b', { class: 'sh-rank-score', text: num(r.score) }),
    );
  }

  let asked = 0;
  async function load(): Promise<void> {
    const mineAsk = ++asked;
    for (const b of picks.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.view === String(view)));
    note.textContent = 'Loading…';
    try {
      if (view === 'total') {
        const { rows, rank } = await ranking.totals();
        if (mineAsk !== asked) return;
        list.replaceChildren(...rows.map((r, i) => row(i + 1, r, true)));
        note.textContent = rows.length === 0 ? 'Nobody has played a shift yet.' : rank > 0 ? `You are number ${num(rank)}.` : 'Play a shift to get on the ranking.';
      } else {
        const rows = await ranking.level(view);
        if (mineAsk !== asked) return;
        list.replaceChildren(...rows.map((r, i) => row(i + 1, r, false)));
        note.textContent = rows.length === 0 ? 'Nobody has played this level yet.' : '';
      }
    } catch (e) {
      if (mineAsk !== asked) return;
      list.replaceChildren();
      note.textContent = e instanceof Error ? e.message : 'The ranking could not be loaded.';
    }
  }

  const pick = (label: string, v: 'total' | number): HTMLButtonElement => {
    const b = button(label, () => {
      view = v;
      void load();
    });
    b.classList.add('sh-rank-pick');
    b.dataset.view = String(v);
    return b;
  };
  picks.append(pick('Total', 'total'), ...ctx.levels.map((l) => pick(String(l.id), l.id)));

  // The name the player shows under; empty until they choose one.
  const input = h('input', { class: 'sh-rank-input', attrs: { type: 'text', maxlength: '20', placeholder: 'Your name', 'aria-label': 'Your name on the ranking', autocomplete: 'nickname' } });
  input.value = mine();
  const saved = h('span', { class: 'sh-dim sh-small', attrs: { role: 'status' } });
  const save = button('Save', () => {
    saved.textContent = '';
    ranking.setName(input.value).then(
      (kept) => {
        input.value = kept;
        saved.textContent = kept ? 'Saved.' : 'Name removed.';
        void load();
      },
      (e: unknown) => (saved.textContent = e instanceof Error ? e.message : 'Not saved.'),
    );
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save.click();
  });

  void load();
  return h(
    'div',
    { class: 'sh-screen sh-rank' },
    topBar('Ten Shifts', 'Ranking', button('All levels', () => ctx.go({ name: 'levels' }))),
    h('section', { class: 'sh-panel sh-panel--soft sh-rank-me' }, h('label', { class: 'sh-rank-label', text: 'Name' }), input, save, saved),
    h('section', { class: 'sh-panel' }, picks, note, list),
  );
}
