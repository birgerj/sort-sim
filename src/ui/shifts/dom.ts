// A small helper to build DOM without a framework, as the rest of the UI does.

type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  /** Plain attributes (aria-*, role, href, type, style …). */
  attrs?: Record<string, string | number | boolean | undefined>;
  on?: { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props?.class) el.className = props.class;
  if (props?.text != null) el.textContent = props.text;
  for (const [k, v] of Object.entries(props?.attrs ?? {})) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const [k, fn] of Object.entries(props?.on ?? {})) el.addEventListener(k, fn as EventListener);
  add(el, children);
  return el;
}

export function add(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

/** A real button. `kind`: primary (the blue action), plain, or link (text only). */
export function button(label: string, onClick: () => void, kind: 'primary' | 'plain' | 'link' = 'plain', extra = ''): HTMLButtonElement {
  const cls = kind === 'link' ? 'sh-link' : `sh-btn${kind === 'primary' ? ' sh-btn--primary' : ''}`;
  return h('button', { class: `${cls}${extra ? ` ${extra}` : ''}`, text: label, attrs: { type: 'button' }, on: { click: onClick } });
}

/** The small mark next to the title: a blue square with three lines of a list. */
export function mark(size = 34): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.classList.add('sh-mark');
  const r = document.createElementNS(ns, 'rect');
  for (const [k, v] of Object.entries({ x: 2, y: 2, width: 36, height: 36, rx: 8 })) r.setAttribute(k, String(v));
  r.setAttribute('class', 'sh-mark-bg');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M11 14h18M11 20h12M11 26h18');
  p.setAttribute('class', 'sh-mark-ink');
  svg.append(r, p);
  return svg;
}

/** Stars as text, the earned ones in gold and the rest in grey, with a spoken label. */
export function stars(n: number, extra = ''): HTMLElement {
  const got = Math.max(0, Math.min(3, Math.round(n)));
  return h(
    'span',
    { class: `sh-stars${extra ? ` ${extra}` : ''}`, attrs: { role: 'img', 'aria-label': `${got} of 3 stars` } },
    h('span', { class: 'sh-stars-on', text: '★'.repeat(got), attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'sh-stars-off', text: '★'.repeat(3 - got), attrs: { 'aria-hidden': 'true' } }),
  );
}

/** A small rounded label ("Play", "New in this level"). */
export function tag(text: string, extra = ''): HTMLElement {
  return h('span', { class: `sh-tag${extra ? ` ${extra}` : ''}`, text });
}

/** The bar at the top of most screens: mark, title, a line under it, and things on the right. */
export function topBar(title: string, sub: string, ...right: Child[]): HTMLElement {
  return h(
    'header',
    { class: 'sh-bar' },
    h('div', { class: 'sh-bar-id' }, mark(), h('div', { class: 'sh-bar-text' }, h('h1', { class: 'sh-bar-title', text: title, attrs: { tabindex: -1 } }), h('div', { class: 'sh-bar-sub', text: sub }))),
    h('div', { class: 'sh-bar-right' }, ...right),
  );
}
