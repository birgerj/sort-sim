// The game's own small settings panel: look, picture quality, sound and country,
// so a player need not leave for the free simulation to change them.
import { button, h } from './dom';

export type GameLook = 'minimal' | 'real';
export type GameQuality = 'low' | 'normal' | 'high';

/** What the panel reads and changes; main.ts ties it to the hall's own settings. */
export interface GameSettings {
  look(): GameLook;
  setLook(v: GameLook): void;
  quality(): GameQuality;
  setQuality(v: GameQuality): void;
  sound(): boolean;
  setSound(on: boolean): void;
  country(): string;
  countries(): { id: string; name: string }[];
  setCountry(id: string): void;
}

/**
 * Opens the panel over `root`. `withCountry` is false while a shift plays: the
 * city names must not change halfway. Night is not offered: it is the reward at
 * three stars. `onCountry` is called after the country changed.
 */
export function openSettings(root: HTMLElement, s: GameSettings, withCountry: boolean, onCountry: () => void): void {
  root.querySelector('.sh-settings')?.remove();
  const back = document.activeElement as HTMLElement | null;
  const close = (): void => {
    wrap.remove();
    back?.focus?.({ preventScroll: true });
  };

  function choice<T extends string>(label: string, options: [T, string][], current: () => T, set: (v: T) => void): HTMLElement {
    const keys = options.map(([v, text]) => {
      const key = button(text, () => {
        set(v);
        for (const [i, k] of keys.entries()) k.setAttribute('aria-pressed', String(options[i]![0] === current()));
      });
      key.classList.add('sh-settings-key');
      key.setAttribute('aria-pressed', String(v === current()));
      return key;
    });
    return h('div', { class: 'sh-settings-row' }, h('span', { class: 'sh-settings-label', text: label }), h('div', { class: 'sh-settings-keys', attrs: { role: 'group', 'aria-label': label } }, ...keys));
  }

  const rows: HTMLElement[] = [
    choice<GameLook>('Look', [['minimal', 'Minimal'], ['real', 'Day']], s.look, s.setLook),
    choice<GameQuality>('Quality', [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']], s.quality, s.setQuality),
    choice<'on' | 'off'>('Sound', [['on', 'On'], ['off', 'Off']], () => (s.sound() ? 'on' : 'off'), (v) => s.setSound(v === 'on')),
  ];
  if (withCountry) {
    const select = h('select', { class: 'sh-settings-select', attrs: { 'aria-label': 'Country' } });
    for (const c of s.countries()) {
      const o = h('option', { text: c.name });
      o.value = c.id;
      o.selected = c.id === s.country();
      select.append(o);
    }
    select.addEventListener('change', () => {
      s.setCountry(select.value);
      onCountry();
    });
    rows.push(h('div', { class: 'sh-settings-row' }, h('span', { class: 'sh-settings-label', text: 'Country' }), select));
  }

  const done = button('Done', close, 'primary');
  const panel = h('div', { class: 'sh-settings-panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' } }, h('h2', { text: 'Settings' }), ...rows, h('div', { class: 'sh-settings-foot' }, done));
  const wrap = h('div', { class: 'sh-settings' }, panel);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  root.append(wrap);
  done.focus({ preventScroll: true });
}
