// The start card, shown at once while the hall is built behind it, so the choices can be made
// in the meantime: sound on or off, the country the hub serves (the one the browser points to by
// default), and then the free simulation or the planning game. Either goes straight in when the
// hall is ready; before that, the loading screen shows until it is.
import { COUNTRIES, COUNTRY, setCountry, type CountryId } from '../sim/countries';
import { loadSettings, saveSettings } from './hud';
import { updateOnCard } from './pwa';

const SPEAKER_ON =
  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const REFRESH =
  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
const SPEAKER_OFF =
  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 6 6"/><path d="m22 9-6 6"/></svg>';

/** Show the card at once (the hall builds behind it). Start can be pressed straight away. */
export function startCard(onStart: (sound: boolean, mode: 'free' | 'game') => void): void {
  const settings = loadSettings();
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const wrap = el('div', 'start loading-start');
  const card = el('div', 'card');
  card.append(
    el('h1', '', 'Sort sim'),
    el('p', '', 'A parcel sorting hub that moves to its own ambient music. By day it is clean production; at night the hall throws a secret party.'),
  );

  // Sound: a toggle with a speaker icon.
  let sound = !settings.muted;
  const snd = el('button', 'sound-toggle');
  snd.type = 'button';
  const showSound = () => {
    // (Icons are this file's own constant SVG markup.)
    snd.innerHTML = `${sound ? SPEAKER_ON : SPEAKER_OFF}<span>${sound ? 'Sound on' : 'Sound off'}</span>`;
    snd.setAttribute('aria-pressed', String(sound));
    snd.classList.toggle('on', sound);
  };
  snd.onclick = () => {
    sound = !sound;
    settings.muted = !sound;
    saveSettings(settings);
    showSound();
  };
  showSound();

  // Country: the destinations, names and postcodes follow it.
  const country = el('select', 'country');
  country.setAttribute('aria-label', 'Country the hub serves');
  for (const k of COUNTRIES) {
    const o = el('option', '', k.native === k.name ? k.name : `${k.name} · ${k.native}`);
    o.value = k.id;
    o.selected = k.id === COUNTRY.id;
    country.append(o);
  }
  country.onchange = () => {
    const id = country.value as CountryId;
    if (id === COUNTRY.id) return;
    settings.country = id;
    saveSettings(settings);
    // (Live: the hall takes the new names, also when it is still being built.)
    setCountry(id);
  };

  // Update: only when a new version is waiting. It is then the first choice, at the top of the
  // card (and has the focus); it reloads into the new version.
  const upd = el('button', 'primary update');
  upd.type = 'button';
  upd.hidden = true;
  upd.title = 'A new version of Sort sim is ready';
  // (Icons are this file's own constant SVG markup.)
  upd.innerHTML = `${REFRESH}<span>Update to the new version</span>`;
  const release = updateOnCard((apply) => {
    upd.hidden = false;
    upd.onclick = () => {
      upd.disabled = true;
      apply();
    };
    upd.focus({ preventScroll: true });
  });

  // Two ways in: the hall as a free simulation, or the planning game.
  const enter = (mode: 'free' | 'game') => () => {
    wrap.remove();
    release();
    onStart(sound, mode);
  };
  const go = el('button', 'primary', 'Simulation');
  go.type = 'button';
  go.onclick = enter('free');
  const play = el('button', 'primary', 'Play');
  play.type = 'button';
  play.title = 'Ten Shifts: plan the night shift in ten levels';
  play.onclick = enter('game');
  const ways = el('div', 'row ways');
  ways.append(go, play);

  const row = el('div', 'row');
  row.append(snd, country);
  card.prepend(upd);
  card.append(row, ways);
  wrap.append(card);
  document.body.append(wrap);
  if (upd.hidden) go.focus({ preventScroll: true });
}
