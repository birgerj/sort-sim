/**
 * The controls over the canvas: a start screen (sound needs a click), the
 * caption, department buttons, camera, time of day and music. Settings are
 * remembered in localStorage; URL parameters override them for one visit.
 */
import type { Music } from '../audio/music';
import { BELT_SPEEDS, type Sorter } from '../scene/sorter';

export type TimeMode = 'day' | 'night' | 'cycle';

export interface Settings {
  time: TimeMode;
  /** Belt speed multiple (see BELT_SPEEDS). */
  speed: number;
  muted: boolean;
  volume: number;
}

const KEY = 'sortsim.settings';

export function loadSettings(): Settings {
  const s: Settings = { time: 'day', speed: 1, muted: false, volume: 0.8 };
  try {
    Object.assign(s, JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    /* no storage */
  }
  return s;
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* no storage */
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class Hud {
  readonly root = el('div', 'hud');
  private caption = el('div', 'caption');
  private bar = el('div', 'bar');
  private deptBtns = new Map<string, HTMLButtonElement>();
  private camBtns = new Map<string, HTMLButtonElement>();
  private timeBtns = new Map<TimeMode, HTMLButtonElement>();
  private speedBtns = new Map<number, HTMLButtonElement>();
  private soundBtn!: HTMLButtonElement;
  private hideTimer = 0;
  private hidden = false;

  constructor(
    private scene: Sorter,
    private music: Music,
    readonly settings: Settings,
    opts: { showStart: boolean; showUi: boolean },
  ) {
    this.root.append(this.caption, this.bar);
    if (!opts.showUi) this.root.classList.add('off');
    this.buildBar();
    if (opts.showStart) this.root.append(this.startScreen());
    this.bindKeys();
    const wake = () => this.wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    this.wake();
  }

  /** Refresh the active states and the caption (call every frame; cheap). */
  update(): void {
    const cap = this.scene.caption();
    if (this.caption.textContent !== cap) this.caption.textContent = cap;
    this.caption.classList.toggle('show', !!cap);
    const visiting = this.scene.visiting();
    for (const [id, b] of this.deptBtns) b.classList.toggle('on', id === visiting);
    const mode = this.scene.cameraMode();
    for (const [id, b] of this.camBtns) b.classList.toggle('on', id === mode);
    for (const [id, b] of this.timeBtns) b.classList.toggle('on', id === this.settings.time);
    for (const [v, b] of this.speedBtns) b.classList.toggle('on', v === this.scene.beltSpeed());
    const on = this.music.audible;
    this.soundBtn.textContent = on ? 'Sound on' : 'Sound off';
    this.soundBtn.classList.toggle('on', on);
  }

  private startScreen(): HTMLElement {
    const s = el('div', 'start');
    const card = el('div', 'card');
    card.append(
      el('h1', '', 'Sort sim'),
      el('p', '', 'A parcel sorting hub that moves to its own ambient music. By day it is clean production; at night the hall throws a secret party.'),
    );
    const row = el('div', 'row');
    const go = el('button', 'primary', 'Start with music');
    const quiet = el('button', '', 'Watch without sound');
    go.onclick = () => {
      this.settings.muted = false;
      this.music.setMuted(false);
      void this.music.start();
      saveSettings(this.settings);
      s.remove();
    };
    quiet.onclick = () => s.remove();
    row.append(go, quiet);
    card.append(row, el('p', 'keys', 'Keys: 1–9, 0 departments · A auto · F fly · P follow · [ ] belt speed · D day · N night · C cycle · M sound · H hide'));
    s.append(card);
    return s;
  }

  private group(label: string): HTMLElement {
    const g = el('div', 'group');
    g.append(el('span', 'label', label));
    this.bar.append(g);
    return g;
  }

  private buildBar(): void {
    const depts = this.group('Go to');
    depts.classList.add('depts');
    this.scene.departments().forEach((d, n) => {
      const b = el('button', '', d.label);
      b.title = n < 10 ? `Key ${(n + 1) % 10}` : '';
      b.onclick = () => this.scene.visit(d.id);
      depts.append(b);
      this.deptBtns.set(d.id, b);
    });
    const cam = this.group('Camera');
    for (const [id, label] of [['auto', 'Auto'], ['fly', 'Fly'], ['follow', 'Follow']] as const) {
      const b = el('button', '', label);
      b.onclick = () => this.scene.setControl('cam', id);
      cam.append(b);
      this.camBtns.set(id, b);
    }
    const next = el('button', '', 'Next parcel');
    next.onclick = () => this.scene.setControl('next', true);
    cam.append(next);
    const belt = this.group('Belt speed');
    for (const v of BELT_SPEEDS) {
      // 2 m per beat at the music's tempo.
      const ms = (v * 2 * this.music.bpm) / 60;
      const b = el('button', '', `${ms.toFixed(1)} m/s`);
      b.title = `${v}× · keys [ and ]`;
      b.onclick = () => this.setSpeed(v);
      belt.append(b);
      this.speedBtns.set(v, b);
    }
    const time = this.group('Time');
    for (const [id, label] of [['day', 'Day'], ['night', 'Night'], ['cycle', 'Day ↔ night']] as const) {
      const b = el('button', '', label);
      b.onclick = () => this.setTime(id);
      time.append(b);
      this.timeBtns.set(id, b);
    }
    const music = this.group('Music');
    this.soundBtn = el('button', '', 'Sound');
    this.soundBtn.onclick = () => this.toggleSound();
    const vol = el('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '1';
    vol.step = '0.01';
    vol.value = String(this.settings.volume);
    vol.setAttribute('aria-label', 'Volume');
    vol.oninput = () => {
      this.settings.volume = Number(vol.value);
      this.music.setVolume(this.settings.volume);
      saveSettings(this.settings);
    };
    music.append(this.soundBtn, vol);
  }

  setSpeed(v: number): void {
    this.scene.setBeltSpeed(v);
    this.settings.speed = this.scene.beltSpeed();
    saveSettings(this.settings);
  }

  setTime(t: TimeMode): void {
    this.settings.time = t;
    saveSettings(this.settings);
  }

  private toggleSound(): void {
    if (!this.music.audible) {
      this.settings.muted = false;
      this.music.setMuted(false);
      void this.music.start();
    } else {
      this.settings.muted = true;
      this.music.setMuted(true);
    }
    saveSettings(this.settings);
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const depts = this.scene.departments();
      const k = e.key.toLowerCase();
      if (/^[0-9]$/.test(k)) {
        const d = depts[(Number(k) + 9) % 10];
        if (d) this.scene.visit(d.id);
      } else if (k === 'a') this.scene.setControl('cam', 'auto');
      else if (k === 'f') this.scene.setControl('cam', 'fly');
      else if (k === 'p') this.scene.setControl('next', true);
      else if (k === 'd') this.setTime('day');
      else if (k === 'n') this.setTime('night');
      else if (k === 'c') this.setTime('cycle');
      else if (k === 'm') this.toggleSound();
      else if (k === '[' || k === ']') {
        const i = BELT_SPEEDS.indexOf(this.scene.beltSpeed());
        this.setSpeed(BELT_SPEEDS[Math.max(0, Math.min(BELT_SPEEDS.length - 1, i + (k === ']' ? 1 : -1)))]!);
      }
      else if (k === 'h') {
        this.root.classList.toggle('off');
        return;
      } else return;
      this.wake();
    });
  }

  /** Show the bar, and hide it again after three quiet seconds. */
  private wake(): void {
    if (this.hidden) {
      this.hidden = false;
      this.root.classList.remove('idle');
    }
    clearTimeout(this.hideTimer);
    // Hide after a few quiet seconds, also when the pointer rests on the bar
    // (touch screens keep ':hover' on the last tapped button, so it is not a sign of use).
    // Any movement, tap or key brings it back.
    this.hideTimer = window.setTimeout(() => {
      if (this.bar.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return this.wake();
      this.hidden = true;
      this.root.classList.add('idle');
      (document.activeElement as HTMLElement | null)?.blur?.();
    }, 3000);
  }
}
