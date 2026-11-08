/**
 * The controls over the canvas: a start screen (sound needs a click), the
 * caption, department buttons, camera, time of day and music. Settings are
 * remembered in localStorage; URL parameters override them for one visit.
 */
import { MOODS } from '../audio/composer';
import type { Music } from '../audio/music';
import { BELT_SPEEDS, Sorter, type Parcel, type Quality } from '../scene/sorter';
import { COUNTRIES, COUNTRY, type CountryId } from '../sim/countries';

export type TimeMode = 'day' | 'night' | 'cycle';

export interface Settings {
  time: TimeMode;
  /** Belt speed multiple (see BELT_SPEEDS). */
  speed: number;
  /** Parcels per minute into the hub. */
  rate: number;
  quality: Quality;
  /** Country the hub serves (unset: from the browser's language). */
  country?: CountryId;
  muted: boolean;
  volume: number;
}

const KEY = 'sortsim.settings';

export function loadSettings(): Settings {
  const s: Settings = { time: 'day', speed: 1, rate: 150, quality: 'normal', muted: false, volume: 0.8 };
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

const el_ = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => el(tag, cls, text);
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
  private qualityBtns = new Map<Quality, HTMLButtonElement>();
  private soundBtn!: HTMLButtonElement;
  private rateOut!: HTMLElement;
  private panel: HTMLElement | null = null;
  private stats: { el: HTMLElement; body: HTMLElement; last: number } | null = null;
  /** The shipping label of a clicked parcel. */
  private card: { el: HTMLElement; p: Parcel; where: HTMLElement } | null = null;
  private hideTimer = 0;
  private menuBtn!: HTMLButtonElement;
  /** Group for the app buttons (install, full screen). */
  appGroup!: HTMLElement;
  private hidden = false;

  constructor(
    private scene: Sorter,
    private music: Music,
    readonly settings: Settings,
    private opts: { showStart: boolean; showUi: boolean; onQuality: () => void },
  ) {
    // A menu button (top right): on touch screens the bar only comes up with it, so swiping to
    // look around does not bring the menu up by accident.
    this.menuBtn = el('button', 'menu', '☰ Menu');
    this.menuBtn.onclick = () => {
      if (this.hidden) this.wake(true);
      else this.hide();
    };
    this.root.append(this.caption, this.bar, this.menuBtn);
    if (!opts.showUi) this.root.classList.add('off');
    this.buildBar();
    if (opts.showStart) this.root.append(this.startScreen());
    this.bindKeys();
    // Mouse movement brings the bar back; touches on the hall do not (use the menu button).
    const wake = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && !this.bar.contains(e.target as Node)) return;
      this.wake();
    };
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    this.wake();
    this.bindLook();
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
    for (const [v, b] of this.speedBtns) {
      b.classList.toggle('on', v === this.scene.beltSpeed());
      // 2 m per beat at the music's tempo now.
      const ms = `${((v * 2 * this.music.bpm) / 60).toFixed(1)} m/s`;
      if (b.textContent !== ms) b.textContent = ms;
    }
    for (const [v, b] of this.qualityBtns) b.classList.toggle('on', v === this.settings.quality);
    const most = this.scene.infeedCapacity();
    const q = this.scene.backlog;
    const txt = `${this.settings.rate}/min · ${Math.round(this.music.bpm)} BPM ${MOODS[this.music.mood]}${this.settings.rate > most ? ` · infeed takes ${most}` : ''}${q > 0 ? ` · queue ${q}` : ''}`;
    if (this.rateOut.textContent !== txt) this.rateOut.textContent = txt;
    if (this.card) {
      const w = this.scene.parcelInfo(this.card.p).where;
      if (this.card.where.textContent !== w) this.card.where.textContent = w;
    }
    if (this.stats && performance.now() - this.stats.last > 1000) this.drawStats();
    for (const pn of [this.panel, this.stats?.el, this.settingsPanel]) {
      if (!pn) continue;
      // Stay clear of the control bar below.
      const h = `${Math.max(160, window.innerHeight - this.bar.offsetHeight - 48)}px`;
      if (pn.style.maxHeight !== h) pn.style.maxHeight = h;
    }
    if (this.panel) {
      this.refreshPanel();
    }
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
    card.append(row, el('p', 'keys', 'Keys: 1–9, 0 departments · A auto · F fly · P follow · V walk (WASD, drag to look, Shift run, Esc stop) · [ ] belt speed · D day · N night · C cycle · M sound · H hide'));
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
    for (const [id, label] of [['auto', 'Auto'], ['fly', 'Fly'], ['follow', 'Follow'], ['walk', 'Walk']] as const) {
      const b = el('button', '', label);
      b.onclick = () => this.scene.setControl('cam', id);
      cam.append(b);
      this.camBtns.set(id, b);
    }
    const next = el('button', '', 'Next parcel');
    next.onclick = () => this.scene.setControl('next', true);
    cam.append(next);
    const hub = this.group('Hub');
    const clear = el('button', '', 'Cleardown…');
    clear.title = 'Choose dock doors whose trucks should leave now';
    clear.onclick = () => this.togglePanel();
    const rate = el('input');
    rate.type = 'range';
    rate.min = '20';
    rate.max = String(Sorter.MAX_RATE);
    rate.step = '10';
    rate.value = String(this.settings.rate);
    rate.setAttribute('aria-label', 'Parcels per minute');
    this.rateOut = el('span', 'rate');
    rate.oninput = () => {
      this.settings.rate = Number(rate.value);
      this.scene.setRate(this.settings.rate);
      saveSettings(this.settings);
    };
    this.scene.setRate(this.settings.rate);
    const stats = el('button', '', 'Figures');
    stats.title = 'Hub figures: throughput, dwell time, recirculation, departures (and a CSV download)';
    stats.onclick = () => this.toggleStats();
    hub.append(clear, stats, rate, this.rateOut);
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
    // The app: settings, install, full screen (from the PWA helper).
    this.appGroup = this.group('App');
    const set = el('button', '', 'Settings…');
    set.title = 'Graphics quality and the country the hub serves';
    set.onclick = () => this.toggleSettings();
    this.appGroup.append(set);
  }

  /** The cleardown panel: doors 1–40 with their destinations; pick some and start. */
  private togglePanel(): void {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      return;
    }
    if (this.stats) this.toggleStats();
    if (this.settingsPanel) this.toggleSettings();
    const p = el('div', 'panel');
    const head = el('div', 'head');
    head.append(el('h2', '', 'Cleardown'), el('p', '', 'Pick dock doors: their trucks leave with what they have, and new empty ones come. 1–20 roll cages, 21–40 robot boxes.'));
    const grid = el('div', 'doors');
    for (const d of this.scene.doors()) {
      const b = el('button', 'door');
      b.dataset.n = String(d.number);
      b.append(el('b', '', String(d.number)), el('span', 'city', d.city), el('span', 'pc', d.pc), el('span', 'st'));
      b.onclick = () => {
        if (b.classList.contains('busy')) return;
        b.classList.toggle('on');
        this.panelCount();
      };
      grid.append(b);
    }
    const row = el('div', 'row');
    const all = el('button', '', 'All');
    all.onclick = () => {
      grid.querySelectorAll<HTMLButtonElement>('.door:not(.busy)').forEach((b) => b.classList.add('on'));
      this.panelCount();
    };
    const none = el('button', '', 'None');
    none.onclick = () => {
      grid.querySelectorAll('.door').forEach((b) => b.classList.remove('on'));
      this.panelCount();
    };
    const go = el('button', 'primary go', 'Start cleardown');
    go.onclick = () => {
      const n = [...grid.querySelectorAll<HTMLButtonElement>('.door.on')].map((b) => Number(b.dataset.n));
      if (!n.length) return;
      this.scene.cleardown(n);
      this.togglePanel();
    };
    const close = el('button', '', 'Close');
    close.onclick = () => this.togglePanel();
    row.append(all, none, go, close);
    p.append(head, grid, row);
    this.root.append(p);
    this.panel = p;
    this.refreshPanel();
    this.panelCount();
  }

  /** The settings panel: graphics quality, and the country (names, towns, postcodes). */
  private toggleSettings(): void {
    if (this.settingsPanel) {
      this.settingsPanel.remove();
      this.settingsPanel = null;
      this.qualityBtns.clear();
      return;
    }
    if (this.panel) this.togglePanel();
    if (this.stats) this.toggleStats();
    const p = el('div', 'panel settings');
    const head = el('div', 'head');
    head.append(el('h2', '', 'Settings'));
    const q = el('div', 'set-row');
    q.append(el('span', 'set-label', 'Graphics quality'));
    const qb = el('div', 'set-opts');
    for (const [id, label, title] of [
      ['low', 'Low', 'Fastest: pixel ratio 1'],
      ['normal', 'Normal', 'Outlines, flat shading, contact shadows'],
      ['high', 'High', 'Also ambient occlusion, sun shadows, glossy night floor, depth of field'],
      ['ultra', 'Ultra', 'For laptops and desktops: 2× supersampling, finer and wider shadows, more ambient occlusion'],
    ] as const) {
      const b = el('button', '', label);
      b.title = title;
      b.onclick = () => {
        this.settings.quality = id;
        saveSettings(this.settings);
        this.opts.onQuality();
      };
      qb.append(b);
      this.qualityBtns.set(id, b);
    }
    q.append(qb, el('span', 'set-help', 'Low is fastest; High and Ultra add shadows, ambient occlusion and sharper lines.'));
    const c = el('div', 'set-row');
    c.append(el('span', 'set-label', 'Country'));
    const cb = el('div', 'set-opts');
    for (const k of COUNTRIES) {
      const b = el('button', k.id === COUNTRY.id ? 'on' : '', k.native === k.name ? k.name : `${k.name} · ${k.native}`);
      b.onclick = () => {
        if (k.id === COUNTRY.id) return;
        this.settings.country = k.id;
        saveSettings(this.settings);
        // Docks, cages, boxes and signs are labelled when the hall is built: start again.
        location.reload();
      };
      cb.append(b);
    }
    c.append(cb, el('span', 'set-help', 'Recipients, towns, streets and postcodes of that country: its 40 largest towns get the 40 dock doors. Changing it restarts the hall.'));
    const row = el('div', 'row');
    const close = el('button', '', 'Close');
    close.onclick = () => this.toggleSettings();
    row.append(close);
    p.append(head, q, c, row);
    this.root.append(p);
    this.settingsPanel = p;
  }

  private settingsPanel: HTMLElement | null = null;

  /** The figures panel: KPI tiles, a throughput chart, recent departures, CSV download. */
  private toggleStats(): void {
    if (this.stats) {
      this.stats.el.remove();
      this.stats = null;
      return;
    }
    if (this.panel) this.togglePanel();
    if (this.settingsPanel) this.toggleSettings();
    const p = el('div', 'panel stats');
    const head = el('div', 'head');
    head.append(el('h2', '', 'Hub figures'));
    const body = el('div', 'stats-body');
    const row = el('div', 'row');
    const csv = el('button', 'primary', 'Download CSV');
    csv.onclick = () => {
      const blob = new Blob([this.scene.kpi.csv()], { type: 'text/csv' });
      const a = el('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'hub-figures.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const close = el('button', '', 'Close');
    close.onclick = () => this.toggleStats();
    row.append(csv, close);
    p.append(head, body, row);
    this.root.append(p);
    this.stats = { el: p, body, last: 0 };
    this.drawStats();
  }

  private drawStats(): void {
    if (!this.stats) return;
    this.stats.last = performance.now();
    const k = this.scene.kpi;
    const t = k.totals();
    const s = k.samples[k.samples.length - 1];
    const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
    const tiles: [string, string, string?][] = [
      ['Hub time', hhmm(this.scene.hubTime())],
      ['In / hour', s ? String(s.inPerHour) : '–'],
      ['Out / hour', s ? String(s.outPerHour) : '–'],
      ['Dwell time', `${s?.dwell ?? t.dwell} min`, `avg ${t.dwell}`],
      ['Recirculation', `${s?.recircPct ?? 0}%`, `total ${t.recircPct}%`],
      ['No-reads', `${s?.noreadPct ?? 0}%`, `total ${t.noreadPct}%`],
      ['To manual', `${s?.manualPct ?? 0}%`, `total ${t.manualPct}%`],
      ['Missorts', String(t.missorts)],
      ['Chutes full', s ? `${s.chutesFull}` : '–'],
      ['Robots busy', s ? `${s.robotsBusyPct}%` : '–'],
      ['Infeed queue', s ? String(s.infeedQueue) : '–'],
      ['Trucks on time', `${t.onTimePct}%`, `${t.departures} left`],
      ['Load factor', `${t.loadFactorPct}%`, 'of trailer room'],
    ];
    const grid = el('div', 'tiles');
    for (const [label, value, sub] of tiles) {
      const tile = el('div', 'tile');
      tile.append(el('span', 'tl', label), el('b', '', value));
      if (sub) tile.append(el('span', 'ts', sub));
      grid.append(tile);
    }
    // Throughput over the last three hours of hub time: in (grey) and out (teal), per hour.
    const pts = k.samples.slice(-36);
    const W = 520;
    const H = 110;
    const max = Math.max(60, ...pts.map((x) => Math.max(x.inPerHour, x.outPerHour)));
    const line = (f: (x: (typeof pts)[number]) => number) =>
      pts.map((x, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, pts.length - 1)) * W).toFixed(1)},${(H - (f(x) / max) * (H - 10)).toFixed(1)}`).join('');
    const chart = el('div', 'chart');
    chart.innerHTML = pts.length > 1
      ? `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Parcels per hour, in and out"><path d="${line((x) => x.inPerHour)}" fill="none" stroke="#a9adb5" stroke-width="2"/><path d="${line((x) => x.outPerHour)}" fill="none" stroke="#2fa58f" stroke-width="2.5"/></svg><div class="legend"><span class="in">in</span> <span class="out">out</span> per hour · max ${max} · every ${k.every} min of hub time</div>`
      : '<div class="legend">The chart fills in after a few minutes of hub time.</div>';
    const deps = el('div', 'deps');
    deps.append(el('div', 'tl', 'Last departures'));
    for (const d of k.departures.slice(-8).reverse()) {
      const r = el('div', 'dep');
      r.append(el('span', '', hhmm(d.at)), el('span', '', `${d.door} ${d.city}`), el('span', '', `${d.load}/${d.room}`), el('span', d.onTime ? 'ok' : 'late', d.onTime ? (d.full ? 'full' : 'on time') : 'late'));
      deps.append(r);
    }
    this.stats.body.replaceChildren(grid, chart, deps);
  }

  private panelCount(): void {
    const go = this.panel?.querySelector<HTMLButtonElement>('.go');
    if (!go) return;
    const n = this.panel!.querySelectorAll('.door.on').length;
    go.textContent = n ? `Start cleardown (${n})` : 'Start cleardown';
    go.disabled = !n;
  }

  /** Door states in the panel (a door already in cleardown or away cannot be picked). */
  private refreshPanel(): void {
    const doors = this.scene.doors();
    this.panel?.querySelectorAll<HTMLButtonElement>('.door').forEach((b) => {
      const d = doors.find((x) => x.number === Number(b.dataset.n));
      if (!d) return;
      const busy = d.state !== 'open';
      const st = busy ? (d.state === 'cleardown' || d.state === 'closing' ? 'Cleardown' : d.state === 'opening' ? 'Opening' : 'Truck away') : `${Math.round(d.fill * 100)}% full`;
      const span = b.querySelector('.st')!;
      if (span.textContent !== st) span.textContent = st;
      b.classList.toggle('busy', busy);
      if (busy) b.classList.remove('on');
    });
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
      // Walking uses W A S D and the arrows itself.
      if (this.scene.cameraMode() === 'walk' && ['w', 'a', 's', 'd', 'escape', 'shift'].includes(k)) return;
      if (/^[0-9]$/.test(k)) {
        const d = depts[(Number(k) + 9) % 10];
        if (d) this.scene.visit(d.id);
      } else if (k === 'a') this.scene.setControl('cam', 'auto');
      else if (k === 'v') this.scene.setControl('cam', this.scene.cameraMode() === 'walk' ? 'auto' : 'walk');
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

  /** Drag (mouse) or swipe (touch) on the hall to look around, outside walk mode. */
  private bindLook(): void {
    const canvas = document.querySelector('#app canvas') ?? document.querySelector('canvas');
    let drag: { id: number; x: number; y: number } | null = null;
    let tap: { x: number; y: number; t: number } | null = null;
    const target = (canvas ?? window) as HTMLElement;
    target.addEventListener('pointerdown', (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.('.bar,.panel,.menu,.label-card')) return;
      tap = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.scene.cameraMode() === 'walk') return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    // A click or tap (not a drag) on a parcel shows its shipping label.
    window.addEventListener('pointerup', (e) => {
      if (!tap) return;
      const still = Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8 && performance.now() - tap.t < 500;
      tap = null;
      if (!still) return;
      const p = this.scene.pickParcel(e.clientX, e.clientY);
      if (p) this.showLabel(p);
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const k = 0.005;
      this.scene.lookAround((e.clientX - drag.x) * k, (e.clientY - drag.y) * k);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (drag?.id === e.pointerId) drag = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  private showLabel(p: Parcel): void {
    this.card?.el.remove();
    const info = this.scene.parcelInfo(p);
    const a = info.address;
    const el = el_('div', 'label-card');
    const head = el_('div', 'lc-head');
    head.append(el_('b', '', 'PARCEL'), el_('span', '', info.id));
    const close = el_('button', 'lc-close', '×');
    close.setAttribute('aria-label', 'Close label');
    close.onclick = () => {
      el.remove();
      this.card = null;
    };
    head.append(close);
    const to = el_('div', 'lc-to');
    to.append(el_('span', 'lc-small', 'Deliver to'), el_('div', 'lc-name', a.name), el_('div', '', a.line1), el_('div', 'lc-pc', a.line2));
    // Barcode from the parcel number.
    const bars = el_('div', 'lc-bars');
    let seed = Number(info.id) * 2654435761;
    for (let i = 0; i < 46; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const b = el_('i');
      b.style.width = `${1 + ((seed >>> 29) % 3)}px`;
      b.style.marginRight = `${1 + ((seed >>> 26) & 1)}px`;
      bars.append(b);
    }
    const meta = el_('div', 'lc-meta');
    meta.append(el_('span', '', info.route), el_('span', '', info.kg), el_('span', '', info.size));
    const where = el_('div', 'lc-where', info.where);
    const tags = el_('div', 'lc-tags');
    const TAG_TEXT = { fragile: 'Fragile', cod: 'Cash on delivery', express: 'Express', registered: 'Registered' } as const;
    for (const t of info.tags) tags.append(el_('span', `lc-tag ${t}`, TAG_TEXT[t]));
    el.append(head, ...(info.tags.length ? [tags] : []), to, bars, el_('div', 'lc-id', info.id), meta, where);
    if (info.note) el.append(el_('div', 'lc-noread', info.note));
    this.root.append(el);
    this.card = { el, p, where };
    this.scene.followParcel(p);
  }

  private hide(): void {
    clearTimeout(this.hideTimer);
    this.hidden = true;
    this.root.classList.add('idle');
  }

  /** Show the bar, and hide it again after three quiet seconds (a bit longer when opened with the menu button). */
  private wake(long = false): void {
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
      // Keep the controls up while the cleardown or figures panel is open.
      if (this.panel || this.stats) return this.wake();
      this.hidden = true;
      this.root.classList.add('idle');
      (document.activeElement as HTMLElement | null)?.blur?.();
    }, long ? 8000 : 3000);
  }
}
