// Product-info overlay (demo): while the tour camera hovers at a stop that has an
// entry in STOP_INFO, a card in the top-right corner describes the product behind it.
// The card tells the scene how long to stay (reading time), shows how much of that
// time is left, and can pause the tour or move on to the next stop.
import type { Sorter } from '../scene/sorter';
import { STOP_INFO, readSeconds, type StopInfo } from './productInfo';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const svg = (d: string, w = 2.4) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_PAUSE = svg('<path d="M9 5v14M15 5v14"/>');
const ICON_PLAY = svg('<path d="M8 5l11 7-11 7z"/>', 2);
const ICON_NEXT = svg('<path d="M9 6l6 6-6 6"/>', 2.6);
const ICON_CLOSE = svg('<path d="M6 6l12 12M18 6L6 18"/>', 2.2);
const ICON_CHECK = svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.6);

export class InfoPanel {
  readonly el = el('aside', 'info-panel');
  private body = el('div', 'ip-body');
  private bar = el('div', 'ip-fill');
  private left = el('span', 'ip-left');
  private pause = el('button', 'ip-icon');
  private stop: string | null = null;
  /** Stop whose card was closed (it comes back at the next stop). */
  private closed: string | null = null;
  private on = true;

  constructor(private scene: Sorter) {
    this.el.setAttribute('aria-live', 'polite');
    const close = el('button', 'ip-icon ip-close');
    close.innerHTML = ICON_CLOSE;
    close.setAttribute('aria-label', 'Close');
    close.onclick = () => {
      this.closed = this.stop;
      this.scene.holdTour(false);
    };
    this.pause.onclick = () => {
      const s = this.scene.tourStop();
      if (s) this.scene.holdTour(!s.held);
    };
    const next = el('button', 'ip-next');
    next.innerHTML = `Next stop ${ICON_NEXT}`;
    next.onclick = () => this.scene.nextStop();
    const track = el('div', 'ip-track');
    track.append(this.bar);
    const foot = el('div', 'ip-foot');
    foot.append(track, this.left, this.pause, next);
    this.el.append(close, this.body, foot);
    this.setOn(true);
  }

  /** Cards on or off; off also lets the tour keep its own pace. */
  setOn(on: boolean): void {
    this.on = on;
    this.scene.dwellFor = on ? (name) => (STOP_INFO[name] ? readSeconds(STOP_INFO[name]) : undefined) : null;
    if (!on) this.scene.holdTour(false);
  }

  /** Call every frame. */
  update(bpm: number): void {
    const s = this.on && !document.body.classList.contains('gaming') ? this.scene.tourStop() : null;
    const info = s ? STOP_INFO[s.name] : undefined;
    const show = !!s && !!info && this.closed !== s.name;
    if (s?.name !== this.closed) this.closed = null;
    this.el.classList.toggle('show', show);
    if (!show || !s || !info) {
      if (!s) this.stop = null;
      return;
    }
    if (this.stop !== s.name) {
      this.stop = s.name;
      this.fill(info);
      this.body.scrollTop = 0;
    }
    const timed = Number.isFinite(s.dwell);
    this.el.classList.toggle('untimed', !timed);
    if (timed) {
      const f = Math.min(1, s.since / Math.max(1, s.dwell));
      this.bar.style.width = `${(f * 100).toFixed(1)}%`;
      const secs = Math.max(0, Math.ceil(((s.dwell - s.since) * 60) / bpm));
      const txt = s.held ? 'paused' : `next in ${secs} s`;
      if (this.left.textContent !== txt) this.left.textContent = txt;
    }
    const icon = s.held ? ICON_PLAY : ICON_PAUSE;
    if (this.pause.dataset.icon !== (s.held ? 'play' : 'pause')) {
      this.pause.dataset.icon = s.held ? 'play' : 'pause';
      this.pause.innerHTML = icon;
      this.pause.setAttribute('aria-label', s.held ? 'Resume tour' : 'Pause tour');
    }
  }

  private fill(info: StopInfo): void {
    const b = this.body;
    b.replaceChildren();
    b.append(el('div', 'ip-family', info.family), el('h2', 'ip-title', info.title));
    for (const p of info.intro) b.append(el('p', 'ip-intro', p));
    if (info.products.length) {
      const list = el('div', 'ip-products');
      for (const p of info.products) {
        const row = el('div', 'ip-product');
        row.append(el('strong', '', p.name), el('span', '', p.text));
        list.append(row);
      }
      b.append(list);
    }
    if (info.points.length) {
      const ul = el('ul', 'ip-points');
      for (const p of info.points) {
        const li = el('li');
        li.innerHTML = ICON_CHECK;
        li.append(el('span', '', p));
        ul.append(li);
      }
      b.append(ul);
    }
    const sim = el('div', 'ip-sim');
    sim.append(el('span', 'ip-sim-label', 'In this hall'), el('span', '', info.sim));
    b.append(sim);
  }
}
