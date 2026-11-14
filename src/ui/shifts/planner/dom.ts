// Ten Shifts planner: small helpers shared by the planner and the shift HUD (plain DOM, no framework).
import { CITY_COLOURS } from '../../../shifts/colours';
import { CURRENCY } from '../../../shifts/contract';

type Child = Node | string | null | undefined | false;

/** Makes an element. `class`, `text` and `style` are set directly; `on…` keys become listeners;
 *  everything else is an attribute (left out when null or false). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'style') el.style.cssText = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Minutes since the start of the shift as a time of day; the shift starts at 22:00. */
export function clock(minute: number): string {
  const m = (((22 * 60 + Math.round(minute)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const count = (n: number): string => Math.round(n).toLocaleString('en-US');
export const money = (n: number): string => `${Math.round(n) < 0 ? '− ' : ''}${CURRENCY} ${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
export const plural = (n: number, one: string, many: string): string => `${count(n)} ${n === 1 ? one : many}`;

export const cityColour = (city: number): string => `var(--sh-city-${((city % 16) + 16) % 16}, ${CITY_COLOURS[((city % 16) + 16) % 16]})`;

export const cityName = (names: readonly string[], city: number): string => names[city] || `City ${city + 1}`;

/** The mark of the game, as in the other screens' headers. */
export function mark(): HTMLElement {
  const el = h('span', { class: 'shp-mark', 'aria-hidden': 'true' });
  el.innerHTML = '<svg width="100%" height="100%" viewBox="0 0 40 40"><rect x="2" y="2" width="36" height="36" rx="8" fill="var(--sh-acc, #2457d6)"></rect><path d="M11 14h18M11 20h12M11 26h18" stroke="#fff" stroke-width="3.5" stroke-linecap="round"></path></svg>';
  return el;
}
