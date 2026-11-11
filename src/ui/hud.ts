/**
 * The controls over the canvas: a start screen (sound needs a click), the
 * caption, and a dock of tabs at the bottom (Go to, Camera, Hub, Night at night,
 * More) whose panels slide up above it. The same layout on phones and desktops;
 * keys do most things on a desktop. Settings are remembered in localStorage; URL
 * parameters override them for one visit.
 */
import { CAM_ICONS, CAMERA_VIEW_IDS, DEPT_ICONS, groupDepts, NIGHT_IDS, orderDepts, RIDE_IDS } from './deptIcons';
import { MOODS } from '../audio/composer';
import { Music } from '../audio/music';
import { BELT_SPEEDS, Sorter, type Parcel, type Quality } from '../scene/sorter';
import { COUNTRIES, COUNTRY, setCountry, type CountryId } from '../sim/countries';
import { setXmas, XMAS } from '../sim/season';
import { InfoPanel } from './info';
import { duration, ROLE_TEXT, Staff, type StaffMember } from '../sim/staff';
import { NIGHT_PRESETS, NIGHT_SWITCHES, presetOf, type NightFx, type NightPreset } from '../scene/nightFx';

export type TimeMode = 'day' | 'night';
/** How the day looks: drawn and flat (Minimal) or lit like a photo (Day). */
export type DayLook = 'minimal' | 'real';
type Tab = 'go' | 'camera' | 'hub' | 'night' | 'more';
const TAB_TITLES: Record<Tab, string> = { go: 'Go to', camera: 'Camera', hub: 'Hub', night: 'Night effects', more: 'More' };

export interface Settings {
  time: TimeMode;
  /** The day's look (the night is the same for both). */
  look?: DayLook;
  /** Belt speed multiple (see BELT_SPEEDS). */
  speed: number;
  /** Parcels per minute into the hub. */
  rate: number;
  quality: Quality;
  /** Christmas decorations. */
  xmas?: boolean;
  /** Country the hub serves (unset: from the browser's language). */
  country?: CountryId;
  muted: boolean;
  volume: number;
  /** Product-info cards at tour stops (default on; `?info=0|1`). */
  info?: boolean;
  /** What the night party shows (see NightFx). */
  night?: NightFx;
}

const KEY = 'sortsim.settings';

export function loadSettings(): Settings {
  const s: Settings = { time: 'day', speed: 1, rate: 150, quality: 'normal', muted: false, volume: 0.8 };
  try {
    Object.assign(s, JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    /* no storage */
  }
  // (The day ↔ night cycle is gone: a saved cycle starts by day.)
  if (s.time !== 'day' && s.time !== 'night') s.time = 'day';
  // (There used to be an Ultra above High: it is High now.)
  if ((s.quality as string) === 'ultra') s.quality = 'high';
  if (!['low', 'normal', 'high'].includes(s.quality)) s.quality = 'normal';
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* no storage */
  }
}

/** Hub minutes as a clock time, "22:05". */
const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

/** A bar: working (teal) and waiting (grey) as shares of the time counted. */
function workBar(pct: number): HTMLElement {
  const b = el('span', 'wbar');
  const w = el('i');
  w.style.width = `${pct}%`;
  b.append(w);
  b.setAttribute('aria-label', `${pct}% working`);
  return b;
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
  private info: InfoPanel;
  /** The product-info tour is offered (`?pv=true`). */
  private readonly pv: boolean;
  /** The dock: the tabs, always at the bottom. */
  private bar = el('nav', 'bar dock');
  /** The panel of the open tab, above the dock. */
  private sheet = el('section', 'sheet');
  private sheetTitle = el('h2');
  private sheets = new Map<Tab, HTMLElement>();
  private tabs = new Map<Tab, HTMLButtonElement>();
  private open: Tab | null = null;
  private deptBtns = new Map<string, HTMLButtonElement>();
  private deptWhen = new Map<string, 'day' | 'night'>();
  /** Each group heading in Go to, with its departments (hidden when none of them shows). */
  private deptHeads = new Map<HTMLElement, string[]>();
  private camBtns = new Map<string, HTMLButtonElement>();
  private timeBtns = new Map<TimeMode | DayLook, HTMLButtonElement>();
  private speedBtns = new Map<number, HTMLButtonElement>();
  private qualityBtns = new Map<Quality, HTMLButtonElement>();
  private soundBtn!: HTMLButtonElement;
  private rateOut!: HTMLElement;
  private panel: HTMLElement | null = null;
  private stats: { el: HTMLElement; body: HTMLElement; last: number } | null = null;
  /** The shipping label of a clicked parcel. */
  private card: { el: HTMLElement; p: Parcel; where: HTMLElement } | null = null;
  /** The card of a tapped staff member (refreshed every second). */
  private staffCard: { el: HTMLElement; m: StaffMember; body: HTMLElement; last: number } | null = null;
  /** The staff list in the figures (kept while the panel is open). */
  private staffList: { el: HTMLElement; head: HTMLElement; rows: { m: StaffMember; r: HTMLElement; nm: HTMLElement; ts: HTMLElement; bar: HTMLElement; pw: HTMLElement; pq: HTMLElement }[] } | null = null;
  private hideTimer = 0;
  /** Group for the app buttons (install, full screen). */
  appGroup!: HTMLElement;
  private hidden = false;
  /** The night controls (the Night tab is only in the dock while the night look is on screen). */
  private nightCtl!: { presets: Map<NightPreset, HTMLButtonElement>; switches: Map<string, HTMLButtonElement>; glow: HTMLInputElement };
  /** Touch screens: the dock stays up (no mouse to bring it back). */
  private readonly touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;

  constructor(
    private scene: Sorter,
    private music: Music,
    readonly settings: Settings,
    private opts: { showStart: boolean; showUi: boolean; onQuality: () => void; onGame?: () => void },
  ) {
    this.info = new InfoPanel(scene);
    // The product-info tour exists only with `?pv=true` (or `?pv=1`) in the address: without it
    // there are no cards and no setting for them, and the tour keeps its own pace.
    const params = new URLSearchParams(location.search);
    this.pv = ['true', '1'].includes((params.get('pv') ?? '').toLowerCase());
    const q = params.get('info');
    if (this.pv && (q === '0' || q === '1')) settings.info = q === '1';
    this.info.setOn(this.pv && settings.info !== false);
    this.root.append(this.caption, this.info.el, this.sheet, this.bar);
    if (!opts.showUi) this.root.classList.add('off');
    this.buildBar();
    if (opts.showStart) this.root.append(this.startScreen());
    this.bindKeys();
    // Mouse movement, a tap or a key brings the dock back (on touch screens too).
    const wake = () => this.wake();
    // (A finger dragging round the hall to look about is not asking for the controls.)
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') wake();
    });
    window.addEventListener('pointerdown', wake);
    this.wake();
    this.bindLook();
  }

  /** Refresh the active states and the caption (call every frame; cheap). */
  update(): void {
    const cap = this.scene.caption();
    if (this.caption.textContent !== cap) this.caption.textContent = cap;
    this.caption.classList.toggle('show', !!cap);
    this.info.update(this.music.bpm);
    const visiting = this.scene.visiting();
    const night = this.scene.isNight();
    for (const [id, b] of this.deptBtns) {
      b.classList.toggle('on', id === visiting);
      // Night-only stops (dance floor, DJ) only at night.
      const w = this.deptWhen.get(id);
      const show = !w || (w === 'night') === night;
      if (b.hidden === show) b.hidden = !show;
    }
    for (const [head, ids] of this.deptHeads) {
      // (A heading over buttons that are always there has no ids: it stays.)
      if (!ids.length) continue;
      const show = ids.some((id) => !this.deptBtns.get(id)?.hidden);
      if (head.hidden === show) head.hidden = !show;
    }
    const mode = this.scene.cameraMode();
    for (const [id, b] of this.camBtns) b.classList.toggle('on', id === mode);
    const look = this.settings.look ?? 'minimal';
    for (const [id, b] of this.timeBtns) b.classList.toggle('on', this.settings.time === 'day' ? id === look : id === this.settings.time);
    for (const [v, b] of this.speedBtns) {
      b.classList.toggle('on', v === this.scene.beltSpeed());
      // 2 m per beat at the music's tempo now.
      const ms = `${((v * 2 * this.music.bpm) / 60).toFixed(1)} m/s`;
      if (b.textContent !== ms) b.textContent = ms;
    }
    for (const [v, b] of this.qualityBtns) b.classList.toggle('on', v === this.settings.quality);
    const nt = this.tabs.get('night')!;
    if (nt.hidden === night) nt.hidden = !night;
    if (!night && this.open === 'night') this.openTab(null);
    if (this.open === 'night') this.refreshNight();
    const most = this.scene.infeedCapacity();
    const q = this.scene.backlog;
    // (The tempo and style the slider asks for: the music gets there in a few bars.)
    const bpm = this.music.targetBpm;
    const txt = `${this.settings.rate}/min · ${Math.round(bpm)} BPM ${MOODS[Music.moodAt(bpm)]}${this.settings.rate > most ? ` · infeed takes ${most}` : ''}${q > 0 ? ` · queue ${q}` : ''}`;
    if (this.rateOut.textContent !== txt) this.rateOut.textContent = txt;
    if (this.card) {
      const w = this.scene.parcelInfo(this.card.p).where;
      if (this.card.where.textContent !== w) this.card.where.textContent = w;
    }
    if (this.stats && performance.now() - this.stats.last > 1000) this.drawStats();
    if (this.staffCard && performance.now() - this.staffCard.last > 1000) this.drawStaffCard();
    for (const pn of [this.panel, this.stats?.el]) {
      if (!pn) continue;
      // Stay clear of the control bar below.
      // (Under the night-shift dock at the top, when there is one.)
      const top = document.body.classList.contains('gaming') ? 80 : 0;
      const h = `${Math.max(160, window.innerHeight - this.bar.offsetHeight - 48 - top)}px`;
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
    card.append(row);
    s.append(card);
    return s;
  }

  /** One dock tab: icon and label; tapping it opens its panel, tapping again closes it. */
  private tab(id: Tab, label: string, icon: string, title: string): void {
    const b = el('button', 'tab');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-expanded', 'false');
    // (Icons are this file's own constant SVG markup.)
    b.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;
    b.append(el('span', '', label));
    b.onclick = () => this.openTab(this.open === id ? null : id);
    this.bar.append(b);
    this.tabs.set(id, b);
  }

  /** Open a tab's panel above the dock (null closes it). */
  private openTab(id: Tab | null): void {
    if (id && (this.panel || this.stats)) {
      if (this.panel) this.togglePanel();
      if (this.stats) this.toggleStats();
    }
    this.open = id;
    for (const [t, b] of this.tabs) {
      b.classList.toggle('on', t === id);
      b.setAttribute('aria-expanded', String(t === id));
    }
    for (const [t, sec] of this.sheets) sec.hidden = t !== id;
    this.sheet.classList.toggle('show', !!id);
    if (id) this.sheetTitle.textContent = TAB_TITLES[id];
    if (id === 'night') this.refreshNight();
    this.wake();
  }

  /** A titled row in a panel. */
  private row(sec: HTMLElement, label: string, help?: string): HTMLElement {
    const r = el('div', 'set-row');
    r.append(el('span', 'set-label', label));
    const opts = el('div', 'set-opts');
    r.append(opts);
    if (help) r.append(el('span', 'set-help', help));
    sec.append(r);
    return opts;
  }

  private section(id: Tab): HTMLElement {
    const sec = el('div', `sheet-body sheet-${id}`);
    sec.hidden = true;
    this.sheet.append(sec);
    this.sheets.set(id, sec);
    return sec;
  }

  private buildBar(): void {
    this.bar.setAttribute('aria-label', 'Menu');
    this.tab('go', 'Go to', '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>', 'Departments (keys 1–9, 0)');
    this.tab('camera', 'Camera', '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3"/>', 'Camera: auto, fly, follow, walk (keys A, F, P, V)');
    this.tab('hub', 'Hub', '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>', 'Parcels per minute, belt speed, cleardown, figures');
    this.tab('night', 'Night', '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>', 'Night effects: glowing parcels and the party');
    this.tabs.get('night')!.hidden = true;
    this.tab('more', 'More', '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', 'Time of day, sound, graphics, Christmas, country, app');

    // The panel above the dock: a title with a close button, and one body per tab.
    const head = el('div', 'sheet-head');
    const close = el('button', 'sheet-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close (Esc)';
    close.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.onclick = () => this.openTab(null);
    head.append(this.sheetTitle, close);
    this.sheet.append(head);
    this.sheet.setAttribute('aria-label', 'Menu panel');

    // Go to: the places (the camera stays there), in groups with a small heading each (deptIcons.ts).
    const depts = this.scene.departments();
    const byId = new Map(depts.map((d) => [d.id, d]));
    const icon = (svg: string) =>
      `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;
    /** A heading over a group, across the grid's row. */
    const heading = (grid: HTMLElement, title: string, ids: string[]) => {
      const head = el('div', 'dept-group', title);
      grid.append(head);
      this.deptHeads.set(head, ids);
    };
    /** A button that flies to a stop. */
    const stop = (grid: HTMLElement, id: string, key = '') => {
      const d = byId.get(id);
      if (!d) return;
      const b = el('button', 'dept');
      b.type = 'button';
      b.title = key;
      // (Icons are deptIcons.ts's own constant SVG markup.)
      b.innerHTML = icon(DEPT_ICONS[d.id] ?? '');
      b.append(el('span', '', d.label));
      b.onclick = () => this.scene.visit(d.id);
      grid.append(b);
      this.deptBtns.set(d.id, b);
      if (d.when) this.deptWhen.set(d.id, d.when);
    };
    const go = this.section('go');
    const grid = el('div', 'depts');
    let n = 0;
    for (const g of groupDepts(depts)) {
      heading(grid, g.title, g.depts.map((d) => d.id));
      for (const d of g.depts) {
        stop(grid, d.id, n < 10 ? `Key ${(n + 1) % 10}` : '');
        n++;
      }
    }
    go.append(grid);

    // Camera: the ways of looking that move — fly, walk, from above, and riding along.
    const cam = this.section('camera');
    const cams = el('div', 'depts');
    /** A button that switches the camera mode (or, for next, picks another parcel). */
    const mode = (id: 'fly' | 'walk' | 'follow' | 'next', label: string, key: string) => {
      const b = el('button', 'dept');
      b.type = 'button';
      b.title = `Key ${key}`;
      // (Icons are deptIcons.ts's own constant SVG markup.)
      b.innerHTML = icon(CAM_ICONS[id] ?? '');
      b.append(el('span', '', label));
      b.onclick = () => {
        const was = this.scene.followedParcel;
        if (id === 'next') this.scene.setControl('next', true);
        else this.scene.setControl('cam', id);
        // (Parcel: whichever it rides with; Next: once it has picked another.)
        if (id === 'follow') this.showFollowed(null);
        else if (id === 'next') this.showFollowed(was);
      };
      cams.append(b);
      if (id !== 'next') this.camBtns.set(id, b);
    };
    heading(cams, 'View', []);
    mode('fly', 'Fly tour', 'F');
    mode('walk', 'Walk', 'V');
    for (const id of CAMERA_VIEW_IDS) stop(cams, id);
    heading(cams, 'Ride along', []);
    mode('follow', 'Parcel', 'P');
    mode('next', 'Next parcel', 'P');
    for (const id of RIDE_IDS) stop(cams, id);
    cam.append(cams, el('p', 'set-help', 'Click or tap a robot, forklift or person in the hall to follow it; a parcel to see its label.'));

    // Hub: how busy, how fast, cleardown and figures.
    const hub = this.section('hub');
    const rateOpts = this.row(hub, 'Parcels per minute');
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
    rateOpts.classList.add('stack');
    rateOpts.append(rate, this.rateOut);
    const belt = this.row(hub, 'Belt speed', 'Keys [ and ].');
    belt.classList.add('cols4');
    for (const v of BELT_SPEEDS) {
      // 2 m per beat at the music's tempo.
      const ms = (v * 2 * this.music.bpm) / 60;
      const b = el('button', '', `${ms.toFixed(1)} m/s`);
      b.title = `${v}×`;
      b.onclick = () => this.setSpeed(v);
      belt.append(b);
      this.speedBtns.set(v, b);
    }
    const acts = el('div', 'cols3');
    const clear = el('button', 'wide', 'Cleardown…');
    clear.title = 'Choose dock doors whose trucks should leave now';
    clear.onclick = () => {
      this.openTab(null);
      this.togglePanel();
    };
    const stats = el('button', 'wide', 'Figures');
    stats.title = 'Hub figures: throughput, dwell time, recirculation, departures (and a CSV download)';
    stats.onclick = () => {
      this.openTab(null);
      this.toggleStats();
    };
    const fault = el('button', 'wide', 'Fault');
    fault.title = 'Take a dock chute down now: the technician comes to repair it';
    fault.onclick = () => {
      this.scene.fault();
    };
    acts.append(clear, stats, fault);
    hub.append(acts);

    // Night: first its own stops, then the effects.
    const nightSec = this.section('night');
    const nightStops = el('div', 'depts');
    heading(nightStops, 'Go to', NIGHT_IDS);
    for (const id of NIGHT_IDS) stop(nightStops, id);
    nightSec.append(nightStops);
    this.buildNight(nightSec);
    this.buildMore(this.section('more'));
  }

  /** Night: presets, how brightly parcels glow, and a switch per party effect. */
  private buildNight(sec: HTMLElement): void {
    const set = (fx: NightFx) => {
      this.settings.night = { ...fx };
      this.scene.setNightFx(fx);
      saveSettings(this.settings);
      this.refreshNight();
    };
    const pb = this.row(sec, 'Preset', 'Party: everything. Calm: glowing parcels and machines, no party. Dark: only the working light.');
    pb.classList.add('cols3');
    const presets = new Map<NightPreset, HTMLButtonElement>();
    for (const [id, label] of [['party', 'Party'], ['calm', 'Calm'], ['dark', 'Dark']] as const) {
      const b = el('button', '', label);
      b.onclick = () => set({ ...NIGHT_PRESETS[id] });
      pb.append(b);
      presets.set(id, b);
    }
    const gb = this.row(sec, 'Parcels glow', 'Every parcel glows in the colour of its destination (white until scanned), pulsing on the beat.');
    gb.classList.add('stack');
    const glow = el('input');
    glow.type = 'range';
    glow.min = '0';
    glow.max = '1';
    glow.step = '0.05';
    glow.setAttribute('aria-label', 'How brightly the parcels glow');
    glow.oninput = () => set({ ...this.scene.nightFx(), glow: Number(glow.value) });
    gb.append(glow);
    const sb = this.row(sec, 'Show');
    sb.classList.add('chips');
    const switches = new Map<string, HTMLButtonElement>();
    for (const sw of NIGHT_SWITCHES) {
      const b = el('button', '', sw.label);
      b.onclick = () => {
        const fx = this.scene.nightFx();
        fx[sw.id] = !fx[sw.id];
        set(fx);
      };
      sb.append(b);
      switches.set(sw.id, b);
    }
    this.nightCtl = { presets, switches, glow };
  }

  /** More: time of day, sound, graphics quality, Christmas, country, and the app. */
  private buildMore(sec: HTMLElement): void {
    const tb = this.row(sec, 'Time of day', 'Minimal: the day as a clean drawing. Day: the day lit like a photo. Night: the party. Keys D (Minimal ↔ Day), N.');
    tb.classList.add('cols3');
    for (const [id, label] of [['minimal', 'Minimal'], ['real', 'Day'], ['night', 'Night']] as const) {
      const b = el('button', '', label);
      b.onclick = () => {
        if (id === 'minimal' || id === 'real') this.setTime('day', id);
        else this.setTime('night');
      };
      tb.append(b);
      this.timeBtns.set(id, b);
    }
    const mb = this.row(sec, 'Sound', 'Music that follows how busy the hub is, and the sounds of the hall. Key M; Space pauses everything.');
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
    mb.classList.add('inline');
    mb.append(this.soundBtn, vol);
    const qb = this.row(sec, 'Graphics quality', 'Low is for phones; High adds shadows, ambient occlusion and sharper lines.');
    qb.classList.add('cols3');
    for (const [id, label, title] of [
      ['low', 'Low', 'For phones: pixel ratio 1, simpler far away, outlines nearby only'],
      ['normal', 'Normal', 'Outlines, flat shading, contact shadows'],
      ['high', 'High', 'For laptops and desktops: sharper, more detail far away, ambient occlusion, sun shadows, glossy night floor'],
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
    const xb = this.row(sec, 'Christmas', 'Trees, garlands, lights, presents, Father Christmas, a Christmas market, bells in the music. Comes in from where you look.');
    xb.classList.add('cols2');
    const xmasBtns: HTMLButtonElement[] = [];
    for (const [on, label] of [[false, 'Off'], [true, 'On']] as const) {
      const b = el('button', on === XMAS ? 'on' : '', label);
      b.onclick = () => {
        if (on === XMAS) return;
        this.settings.xmas = on;
        saveSettings(this.settings);
        setXmas(on);
        if (on) this.music.xmasFlourish();
        // (Close the panel: the decorations come in, or go, behind it.)
        this.openTab(null);
        xmasBtns.forEach((x, i) => x.classList.toggle('on', (i === 1) === on));
      };
      xmasBtns.push(b);
      xb.append(b);
    }
    const ib = this.pv ? this.row(sec, 'Product info', 'A card with the product behind each tour stop; the tour stays long enough to read it.') : el('div');
    ib.classList.add('cols2');
    const infoBtns: HTMLButtonElement[] = [];
    for (const [on, label] of this.pv ? ([[false, 'Off'], [true, 'On']] as const) : []) {
      const b = el('button', on === (this.settings.info !== false) ? 'on' : '', label);
      b.onclick = () => {
        this.settings.info = on;
        saveSettings(this.settings);
        this.info.setOn(on);
        infoBtns.forEach((x, i) => x.classList.toggle('on', (i === 1) === on));
      };
      infoBtns.push(b);
      ib.append(b);
    }
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
      this.settings.country = id;
      saveSettings(this.settings);
      // A night-shift game is played for one country's hall: start again. Otherwise switch live.
      if (new URLSearchParams(location.search).get('game')) location.reload();
      else setCountry(id);
    };
    const cb = this.row(sec, 'Country', 'Its 40 largest towns get the 40 dock doors; names, streets and postcodes follow it at once. The doors are shared out over the towns again on the next start.');
    cb.classList.add('stack');
    cb.append(country);
    // The app: install and full screen (added by the PWA helper), and hiding the controls.
    this.appGroup = this.row(sec, 'App');
    this.appGroup.classList.add('cols3');
    const hide = el('button', '', 'Hide controls');
    hide.title = 'Key H; click or tap the hall to bring them back';
    hide.onclick = () => {
      this.openTab(null);
      this.root.classList.add('off');
    };
    this.appGroup.append(hide);
    // The night-shift minigame (its briefing opens at the top of the screen).
    const game = el('button', '', 'Night shift');
    game.title = 'Minigame: plan a night and fine-tune it for a score';
    game.onclick = () => {
      this.openTab(null);
      this.opts.onGame?.();
    };
    this.appGroup.append(game);
  }

  /** The cleardown panel: doors 1–40 with their destinations; pick some and start. */
  private togglePanel(): void {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      return;
    }
    if (this.stats) this.toggleStats();
    if (this.open) this.openTab(null);
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

  private refreshNight(): void {
    const n = this.nightCtl;
    const fx = this.scene.nightFx();
    const pre = presetOf(fx);
    for (const [id, b] of n.presets) b.classList.toggle('on', id === pre);
    for (const [id, b] of n.switches) b.classList.toggle('on', fx[id as keyof NightFx] === true);
    if (document.activeElement !== n.glow) n.glow.value = String(fx.glow);
  }

  /** The figures panel: KPI tiles, a throughput chart, recent departures, CSV download. */
  private toggleStats(): void {
    if (this.stats) {
      this.stats.el.remove();
      this.stats = null;
      return;
    }
    if (this.panel) this.togglePanel();
    if (this.open) this.openTab(null);
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
      ['Faults', String(t.faults), `${this.scene.faults.down.size} chute${this.scene.faults.down.size === 1 ? '' : 's'} down now`],
      ['Chutes full', s ? `${s.chutesFull}` : '–'],
      ['Robots busy', s ? `${s.robotsBusyPct}%` : '–'],
      ['Infeed queue', s ? String(s.infeedQueue) : '–'],
      ['Inbound docks', `${this.scene.inboundStatus().unloading} of ${this.scene.inboundStatus().docks} unloading`, `${this.scene.inboundStatus().parcels} parcels in the trucks · ${this.scene.inboundStatus().crew} unloader${this.scene.inboundStatus().crew > 1 ? 's' : ''} per truck`],
      ['Trucks on time', `${t.onTimePct}%`, `${t.departures} left${t.departures - Math.round((t.onTimePct / 100) * t.departures) > 0 ? ` · ${t.departures - Math.round((t.onTimePct / 100) * t.departures)} late` : ''}`],
      ['Load factor', `${t.loadFactorPct}%`, 'of trailer room'],
      ['Buffer store', s ? `${Math.round((100 * s.storeUsed) / s.storeSlots)}%` : '–', s ? `${s.storeUsed} of ${s.storeSlots} places` : undefined],
      ['Busiest destination', s?.topCity ? `${s.topCity}` : '–', s?.topCity ? `${s.topPct}% of the parcels in` : undefined],
      ['Batch', this.scene.batches.active ? this.scene.batches.active.city.name : 'none', this.scene.batches.active ? `${Math.round(this.scene.batches.active.share * 100)}% of the parcels` : this.scene.batches.past.length ? `last: ${this.scene.batches.past[this.scene.batches.past.length - 1]!.city.name}` : undefined],
    ];
    const grid = el('div', 'tiles');
    for (const [label, value, sub] of tiles) {
      const tile = el('div', 'tile');
      // (On-time below 100 %: in red.)
      tile.append(el('span', 'tl', label), el('b', label === 'Trucks on time' && t.departures > 0 && t.onTimePct < 100 ? 'bad' : '', value));
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
    // The buffer store over the same hours (amber), with batches shaded and named.
    const store = el('div', 'chart store');
    if (pts.length > 1) {
      const SH = 56;
      const x = (i: number) => ((i / Math.max(1, pts.length - 1)) * W).toFixed(1);
      const area = `M0,${SH} ${pts.map((p, i) => `L${x(i)},${(SH - (p.storeUsed / Math.max(1, p.storeSlots)) * (SH - 4)).toFixed(1)}`).join(' ')} L${W},${SH} Z`;
      const bands = pts
        .map((p, i) => (p.batch ? `<rect x="${x(i)}" y="0" width="${(W / Math.max(1, pts.length - 1)).toFixed(1)}" height="${SH}" fill="rgba(134,211,195,0.12)"/>` : ''))
        .join('');
      const names = [...new Set(pts.filter((p) => p.batch).map((p) => p.batch.replace(/ \d+%$/, '')))].slice(-4).join(', ');
      // (Built from numbers and city names of this app's own list.)
      store.innerHTML = `<svg viewBox="0 0 ${W} ${SH}" preserveAspectRatio="none" role="img" aria-label="Buffer store fill"><g>${bands}</g><path d="${area}" fill="rgba(242,194,0,0.35)" stroke="#f2c200" stroke-width="1.5"/></svg><div class="legend"><span class="store">buffer store</span> 0–100% · shaded: a batch${names ? ` (${names})` : ''}</div>`;
    }
    const deps = el('div', 'deps');
    deps.append(el('div', 'tl', 'Last departures'));
    for (const d of k.departures.slice(-8).reverse()) {
      // (A late truck: the whole row in red, with how late it left.)
      const r = el('div', d.onTime ? 'dep' : 'dep is-late');
      r.append(el('span', '', hhmm(d.at)), el('span', '', `${d.door} ${d.city}`), el('span', '', `${d.load}/${d.room}`), el('span', d.onTime ? 'ok' : 'late', d.onTime ? (d.full ? 'full' : 'on time') : `late +${Math.max(1, Math.round(d.at - d.cutoff))} min`));
      deps.append(r);
    }
    // (Keep the list where it was scrolled to: the panel is redrawn every second.)
    const top = this.stats.body.scrollTop;
    // (The staff list stays in place below; only what is above it is swapped.)
    const body = this.stats.body;
    const staff = this.drawStaff();
    while (body.firstChild && body.firstChild !== staff) body.firstChild.remove();
    body.prepend(grid, chart, store, deps);
    if (staff.parentNode !== body) body.append(staff);
    this.stats.body.scrollTop = top;
  }

  /**
   * The staff list: the team's share of time working, then everyone in door order with
   * their shares of working and waiting. Built once per opening and updated in place, so a
   * row being tapped is never swapped out from under the finger.
   */
  private drawStaff(): HTMLElement {
    const list = this.scene.staff.list;
    let st = this.staffList;
    if (!st || !this.stats?.el.contains(st.el)) {
      const box = el('div', 'staff');
      const head = el('div', 'tl');
      box.append(head);
      const rows = list.map((m) => {
        const r = el('button', 'person');
        r.title = `${m.name}, ${ROLE_TEXT[m.role]}, ${m.place}: show the card and follow`;
        const name = el('span', 'pn');
        const nm = el('b', '', m.name);
        const ts = el('span', 'ts', `${ROLE_TEXT[m.role]} · ${m.place}`);
        name.append(nm, ts);
        const bar = workBar(0);
        const pw = el('span', 'pw');
        const pq = el('span', 'pq');
        r.append(name, bar, pw, pq);
        r.onclick = () => {
          this.toggleStats();
          this.scene.followStaff(m);
          this.showStaff(m);
        };
        box.append(r);
        return { m, r, nm, ts, bar: bar.firstElementChild as HTMLElement, pw, pq };
      });
      st = this.staffList = { el: box, head, rows };
    }
    const team = Staff.workPct(this.scene.staff.totals());
    st.head.textContent = `Staff · ${list.length} people · team ${team}% working, ${100 - team}% waiting`;
    for (const x of st.rows) {
      const pct = Staff.workPct(x.m);
      x.r.classList.toggle('on', x.m.working);
      // (Names follow the country; places change with breaks.)
      const ts = `${ROLE_TEXT[x.m.role]} · ${x.m.place}`;
      if (x.nm.textContent !== x.m.name) x.nm.textContent = x.m.name;
      if (x.ts.textContent !== ts) {
        x.ts.textContent = ts;
        x.r.title = `${x.m.name}, ${ROLE_TEXT[x.m.role]}, ${x.m.place}: show the card and follow`;
      }
      x.bar.style.width = `${pct}%`;
      x.bar.parentElement!.setAttribute('aria-label', `${pct}% working`);
      x.pw.textContent = `${pct}%`;
      x.pq.textContent = `${100 - pct}%`;
    }
    return st.el;
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

  /** Time of day, and optionally the day's look. */
  setTime(t: TimeMode, look?: DayLook): void {
    this.settings.time = t;
    if (look) {
      this.settings.look = look;
      this.scene.setRealistic(look === 'real');
    }
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
      const depts = orderDepts(this.scene.departments());
      const k = e.key.toLowerCase();
      // Esc closes an open panel first (in walk mode too).
      if (k === 'escape' && (this.open || this.panel || this.stats)) {
        if (this.open) this.openTab(null);
        else if (this.panel) this.togglePanel();
        else this.toggleStats();
        return;
      }
      // Walking uses W A S D and the arrows itself.
      if (this.scene.cameraMode() === 'walk' && ['w', 'a', 's', 'd', 'escape', 'shift'].includes(k)) return;
      if (/^[0-9]$/.test(k)) {
        const d = depts[(Number(k) + 9) % 10];
        if (d) this.scene.visit(d.id);
      } else if (k === 'a') this.scene.setControl('cam', 'fly');
      else if (k === 'v') this.scene.setControl('cam', this.scene.cameraMode() === 'walk' ? 'fly' : 'walk');
      else if (k === 'f') this.scene.setControl('cam', 'fly');
      else if (k === 'p') {
        const was = this.scene.followedParcel;
        this.scene.setControl('next', true);
        this.showFollowed(was);
      }
      // D: to the day, or between Minimal and Day while it is day.
      else if (k === 'd') this.setTime('day', this.settings.time === 'day' ? (this.settings.look === 'real' ? 'minimal' : 'real') : undefined);
      else if (k === 'n') this.setTime('night');
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
    // Pinch with two fingers (zoom in or out on what is followed): the fingers down, and their last spread.
    const fingers = new Map<number, { x: number; y: number }>();
    let spread = 0;
    const spreadNow = () => {
      const [a, b] = [...fingers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const target = (canvas ?? window) as HTMLElement;
    // The mouse wheel (or a trackpad's two-finger scroll) zooms in and out on what is followed.
    target.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (this.scene.topDown()) {
          // Top down: zoom in and out on the floor under the pointer.
          e.preventDefault();
          this.scene.zoomTop(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX, e.clientY);
          return;
        }
        if (this.scene.cameraMode() === 'walk' || !this.scene.following()) return;
        e.preventDefault();
        this.scene.zoomFollow(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
      },
      { passive: false },
    );
    target.addEventListener('pointerdown', (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.('.bar,.sheet,.panel,.label-card')) return;
      // A tap on the hall with a panel open just closes the panel.
      if (this.open) {
        this.openTab(null);
        return;
      }
      // On a touch screen, a tap while the dock is hidden only brings it back (it picks nothing).
      tap = this.hidden && e.pointerType === 'touch' ? null : { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.scene.cameraMode() === 'walk') return;
      if (e.pointerType === 'touch') {
        fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (fingers.size === 2) {
          // Two fingers: a pinch, not a swipe (and not a tap).
          spread = spreadNow();
          drag = null;
          tap = null;
          return;
        }
      }
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    // A click or tap (not a drag) on a parcel shows its shipping label.
    window.addEventListener('pointerup', (e) => {
      if (!tap) return;
      const still = Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8 && performance.now() - tap.t < 500;
      tap = null;
      if (!still) return;
      // Controls hidden (key H, or Hide controls): a click or tap on the hall brings them back.
      if (this.root.classList.contains('off') && this.opts.showUi) {
        this.root.classList.remove('off');
        this.wake();
        return;
      }
      // The control room's video wall: a tap on its plan goes to (or follows) what it shows.
      if (this.scene.tapWall(e.clientX, e.clientY)) return;
      const p = this.scene.pickParcel(e.clientX, e.clientY);
      if (p) {
        this.scene.pokeParcel(p);
        this.showLabel(p);
      } else {
        // Not a parcel: a robot, forklift or person under the pointer reacts and is followed.
        const t = this.scene.pickThing(e.clientX, e.clientY);
        if (t) {
          this.scene.poke(t);
          // Someone with a job in the hall (or a forklift's driver): followed by name, with their card.
          const m = this.scene.staffOf(t.obj);
          if (m) {
            this.scene.followStaff(m);
            this.showStaff(m);
          } else this.scene.followObject(t);
        } else this.scene.tapEgg(e.clientX, e.clientY);
      }
    });
    window.addEventListener('pointermove', (e) => {
      const f = fingers.get(e.pointerId);
      if (f) {
        f.x = e.clientX;
        f.y = e.clientY;
        if (fingers.size === 2) {
          const s = spreadNow();
          if (spread > 0 && s > 0) {
            if (this.scene.topDown()) {
              // Top down: zoom on the floor between the two fingers.
              const [a, b] = [...fingers.values()];
              this.scene.zoomTop(spread / s, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
            } else if (this.scene.following()) this.scene.zoomFollow(spread / s);
          }
          spread = s;
          return;
        }
      }
      if (!drag || drag.id !== e.pointerId) return;
      if (this.scene.topDown()) {
        // Top down: drag the floor along (when zoomed in).
        this.scene.panTop(e.clientX - drag.x, e.clientY - drag.y);
        drag.x = e.clientX;
        drag.y = e.clientY;
        return;
      }
      const k = 0.005;
      this.scene.lookAround((e.clientX - drag.x) * k, (e.clientY - drag.y) * k);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const end = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      if (fingers.size < 2) spread = 0;
      if (drag?.id === e.pointerId) drag = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /** A staff member's card: name, job, where, and how the shift has gone so far. */
  private showStaff(m: StaffMember): void {
    this.card?.el.remove();
    this.card = null;
    this.staffCard?.el.remove();
    const card = el_('div', 'label-card staff-card');
    const head = el_('div', 'lc-head');
    head.append(el_('b', '', 'STAFF'), el_('span', '', `No. ${String(m.id).padStart(3, '0')}`));
    const close = el_('button', 'lc-close', '×');
    close.setAttribute('aria-label', 'Close card');
    close.onclick = () => {
      card.remove();
      this.staffCard = null;
    };
    head.append(close);
    const who = el_('div', 'sc-who');
    who.append(el_('div', 'lc-name', m.name), el_('div', 'sc-role', ROLE_TEXT[m.role]), el_('div', 'lc-small', m.place));
    const body = el_('div', 'sc-body');
    card.append(head, who, body);
    this.root.append(card);
    this.staffCard = { el: card, m, body, last: 0 };
    this.drawStaffCard();
  }

  private drawStaffCard(): void {
    const c = this.staffCard;
    if (!c) return;
    c.last = performance.now();
    const m = c.m;
    const now = this.scene.hubTime();
    const pct = Staff.workPct(m);
    const counted = m.work + m.wait > 0;
    const state = el_('div', `sc-state ${m.working ? 'work' : 'wait'}`, `${m.working ? 'Working' : 'Waiting'} · for ${duration(now - m.changed)}`);
    const rows = el_('div', 'sc-rows');
    const row = (k: string, v: string) => rows.append(el_('span', 'lc-small', k), el_('span', '', v));
    row('On shift since', clock(m.since));
    row('Shift so far', duration(now - m.since));
    row('Working', `${duration(m.work)}${counted ? ` · ${pct}%` : ''}`);
    row('Waiting', `${duration(m.wait)}${counted ? ` · ${100 - pct}%` : ''}`);
    row('Jobs started', String(m.jobs));
    c.body.replaceChildren(state, rows, workBar(pct));
  }

  /** Riding along with a parcel: its label card, as soon as the camera has picked one (not `was`). */
  private showFollowed(was: Parcel | null, tries = 90): void {
    const p = this.scene.followedParcel;
    if (p && p !== was) this.showLabel(p);
    else if (tries > 0) requestAnimationFrame(() => this.showFollowed(was, tries - 1));
  }

  private showLabel(p: Parcel): void {
    this.staffCard?.el.remove();
    this.staffCard = null;
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

  /** Show the dock, and hide it again after a few quiet seconds (not with a panel open). */
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
      // Keep the controls up while a panel is open.
      if (this.panel || this.stats || this.open) return;
      this.hidden = true;
      this.root.classList.add('idle');
      (document.activeElement as HTMLElement | null)?.blur?.();
    }, this.touch ? 4000 : 3000);
  }
}
