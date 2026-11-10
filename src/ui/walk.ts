/**
 * Walking and flying around (camera mode 'walk'): input and the on-screen controls.
 *
 * Keyboard: W A S D or the arrow keys to move, Shift to run (fly faster), E / Q or
 * Page Up / Page Down to climb and descend, Esc to stop. Mouse: drag to look around.
 * Touch: a stick under the left thumb (it appears where the thumb lands; at its edge
 * you run), drag on the right half to look, and Up / Down buttons at the right edge.
 * Climbing from the floor is flying; coming down to the floor is walking again.
 *
 * The controls sit above the menu dock, which stays usable; a menu panel may cover them.
 */
import type { Sorter } from '../scene/sorter';

const LOOK = 0.0045; // radians per pixel
const STICK = 60; // pixels for full speed
const HINT_KEY = 'sortsim.walkHints';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const svg = (paths: string, w = 2.2) =>
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export class WalkControls {
  private keys = new Set<string>();
  private dYaw = 0;
  private dPitch = 0;
  private drag: { id: number; x: number; y: number; stick: boolean } | null = null;
  private stick = { fwd: 0, side: 0 };
  private touch2: { id: number; x: number; y: number } | null = null;
  /** Held on-screen Up / Down button: +1, -1 or 0. */
  private held = 0;
  private readonly touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;

  // On-screen controls.
  readonly root = el('div', 'walk-ui');
  private walkBtn = el('button', '', 'Walk');
  private flyBtn = el('button', '', 'Fly');
  private alt = el('span', 'walk-alt-v', 'Floor');
  private base = el('div', 'walk-stick');
  private knob = el('div', 'walk-knob');
  private hints: HTMLElement[] = [];
  private keysCard = el('div', 'walk-keys');
  private shownAt = 0;
  private wasActive = false;
  private moved = false;

  constructor(
    private scene: Sorter,
    private canvas: HTMLCanvasElement,
  ) {
    this.buildUi();
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        // (An open menu panel takes Esc first; see the HUD.)
        if (document.querySelector('.sheet.show, .hud .panel')) return;
        this.scene.setControl('cam', 'fly');
        return;
      }
      if (['w', 'a', 's', 'd', 'e', 'q', 'pageup', 'pagedown', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.held = 0;
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      const stick = e.pointerType === 'touch' && e.clientX < window.innerWidth / 2;
      if (this.drag && e.pointerType === 'touch') {
        // A second finger: the other job (walk with one, look with the other).
        this.touch2 = { id: e.pointerId, x: e.clientX, y: e.clientY };
        if (!this.drag.stick) this.placeStick(e.clientX, e.clientY);
        return;
      }
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, stick };
      if (stick) this.placeStick(e.clientX, e.clientY);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone */
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      const d = this.drag?.id === e.pointerId ? this.drag : this.drag && this.touch2?.id === e.pointerId ? { ...this.touch2, stick: !this.drag.stick } : null;
      if (!d) return;
      if (d.stick) {
        const sx = this.drag?.stick ? this.drag : this.touch2;
        if (!sx) return;
        this.stick.fwd = Math.max(-1, Math.min(1, -(e.clientY - sx.y) / STICK));
        this.stick.side = Math.max(-1, Math.min(1, (e.clientX - sx.x) / STICK));
        this.drawKnob();
      } else {
        const px = this.drag?.id === e.pointerId ? this.drag : this.touch2!;
        this.dYaw += (e.clientX - px.x) * LOOK;
        this.dPitch += (e.clientY - px.y) * LOOK;
        px.x = e.clientX;
        px.y = e.clientY;
      }
      this.used();
    });
    const end = (e: PointerEvent) => {
      if (this.touch2?.id === e.pointerId) {
        if (this.drag && !this.drag.stick) this.releaseStick();
        this.touch2 = null;
        return;
      }
      if (this.drag?.id !== e.pointerId) return;
      const wasStick = this.drag.stick;
      if (wasStick) this.releaseStick();
      // The first finger lifted while a second is still down: that one carries on with its job.
      if (this.touch2) {
        const t = this.touch2;
        this.touch2 = null;
        this.drag = { id: t.id, x: t.x, y: t.y, stick: !wasStick };
        if (this.drag.stick) this.placeStick(t.x, t.y);
        return;
      }
      this.drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  get active(): boolean {
    return this.scene.cameraMode() === 'walk';
  }

  private buildUi(): void {
    const r = this.root;
    r.hidden = true;
    r.classList.toggle('touch', this.touch);
    // Top: stop, walk / fly, height.
    const top = el('div', 'walk-top');
    const stop = el('button', 'walk-pill');
    stop.type = 'button';
    stop.title = 'Stop walking (Esc)';
    stop.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>');
    stop.append('Stop');
    stop.onclick = () => this.scene.setControl('cam', 'fly');
    const seg = el('div', 'walk-seg');
    this.walkBtn.type = this.flyBtn.type = 'button';
    this.walkBtn.title = 'Land and walk (Q down to the floor)';
    this.flyBtn.title = 'Take off (E to climb)';
    this.walkBtn.onclick = () => this.scene.walkTo(0);
    this.flyBtn.onclick = () => {
      if (this.scene.walkAlt() < 0.01) this.scene.walkTo(3);
    };
    seg.append(this.walkBtn, this.flyBtn);
    const alt = el('div', 'walk-pill walk-alt');
    alt.innerHTML = svg('<path d="M12 20V4M6 10l6-6 6 6"/>');
    alt.append(this.alt);
    alt.setAttribute('aria-label', 'Height');
    top.append(stop, seg, alt);

    // Left: the stick (touch only; input comes from the hall canvas, this only shows it).
    this.base.append(el('div', 'walk-ring'), this.knob);
    this.base.setAttribute('aria-hidden', 'true');

    // Right edge: hold to climb or descend.
    const rocker = el('div', 'walk-rocker');
    for (const [dir, label, path] of [
      [1, 'Up', '<path d="M6 15l6-6 6 6"/>'],
      [-1, 'Down', '<path d="M6 9l6 6 6-6"/>'],
    ] as const) {
      const b = el('button');
      b.type = 'button';
      b.setAttribute('aria-label', `${label} (hold)`);
      b.title = dir > 0 ? 'Hold to climb (E)' : 'Hold to descend (Q)';
      b.innerHTML = svg(path, 2.4);
      b.append(el('span', '', label));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          b.setPointerCapture(e.pointerId);
        } catch {
          /* (not a live pointer) */
        }
        this.held = dir;
        b.classList.add('on');
        this.used();
      });
      const up = () => {
        if (this.held === dir) this.held = 0;
        b.classList.remove('on');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      // (Keyboard users: Space or Enter on the button nudges a bit.)
      b.onclick = (e) => {
        if (e.detail === 0) this.scene.walkTo(Math.max(0, this.scene.walkAlt() + dir * 1.5));
      };
      rocker.append(b);
    }

    // First-time hints (touch), and a key card (mouse and keyboard).
    const h1 = el('div', 'walk-hint walk-hint-stick', 'Left thumb: walk · to the edge: run');
    const h2 = el('div', 'walk-hint walk-hint-look', 'Drag here to look around');
    const h3 = el('div', 'walk-hint walk-hint-rocker', 'Hold: up · down');
    this.hints = [h1, h2, h3];
    const rows: [string[], string][] = [
      [['W', 'A', 'S', 'D'], 'Move (or arrows)'],
      [['E', 'Q'], 'Up · down (or PgUp / PgDn)'],
      [['Shift'], 'Run · fly faster'],
      [[], 'Drag to look around'],
      [['Esc'], 'Stop walking'],
    ];
    this.keysCard.append(el('b', '', 'Walk and fly'));
    const grid = el('div', 'walk-keys-grid');
    for (const [ks, text] of rows) {
      const c = el('div', 'k');
      if (ks.length) for (const k of ks) c.append(el('kbd', '', k));
      else c.append(el('span', '', 'Mouse'));
      grid.append(c, el('span', '', text));
    }
    this.keysCard.append(grid, el('p', '', 'Down to the floor lands you. Space still pauses.'));

    r.append(top, this.base, rocker, ...this.hints, this.keysCard);
    this.placeStick(null);
  }

  /** Put the stick under the thumb, or back in its resting place (null). */
  private placeStick(x: number | null, y?: number): void {
    const s = this.base.style;
    if (x === null) {
      s.left = s.top = '';
      this.base.classList.remove('live');
    } else {
      s.left = `${x}px`;
      s.top = `${y}px`;
      this.base.classList.add('live');
    }
    this.drawKnob();
  }

  private releaseStick(): void {
    this.stick = { fwd: 0, side: 0 };
    this.placeStick(null);
  }

  private drawKnob(): void {
    const m = Math.hypot(this.stick.side, this.stick.fwd);
    const k = m > 1 ? 1 / m : 1;
    this.knob.style.transform = `translate(calc(-50% + ${this.stick.side * k * STICK}px), calc(-50% + ${-this.stick.fwd * k * STICK}px))`;
    this.base.classList.toggle('run', m > 0.95);
  }

  /** The first real use hides the hints for good. */
  private used(): void {
    if (this.moved) return;
    this.moved = true;
    for (const h of this.hints) h.classList.add('gone');
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* no storage */
    }
  }

  /** Call every frame before rendering. */
  frame(): void {
    const on = this.active;
    if (on !== this.wasActive) {
      this.wasActive = on;
      this.root.hidden = !on;
      if (on) {
        this.shownAt = performance.now();
        let seen = false;
        try {
          seen = localStorage.getItem(HINT_KEY) === '1';
        } catch {
          /* no storage */
        }
        this.moved = seen;
        for (const h of this.hints) h.classList.toggle('gone', seen);
        this.keysCard.classList.remove('gone');
      } else {
        this.held = 0;
        this.releaseStick();
      }
    }
    if (!on) {
      this.keys.clear();
      this.dYaw = this.dPitch = 0;
      return;
    }
    // The key card fades after a while.
    if (performance.now() - this.shownAt > 12000) this.keysCard.classList.add('gone');
    const k = this.keys;
    let fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) + this.stick.fwd;
    let side = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + this.stick.side;
    fwd = Math.max(-1, Math.min(1, fwd));
    side = Math.max(-1, Math.min(1, side));
    const up = Math.max(-1, Math.min(1, (k.has('e') || k.has('pageup') ? 1 : 0) - (k.has('q') || k.has('pagedown') ? 1 : 0) + this.held));
    const run = k.has('shift') || Math.hypot(this.stick.fwd, this.stick.side) > 0.95;
    this.scene.walkInput(fwd, side, run, this.dYaw, this.dPitch, up);
    this.dYaw = this.dPitch = 0;
    // Show the state: walking or flying, and how high.
    const a = this.scene.walkAlt();
    const flying = a > 0.01;
    this.walkBtn.classList.toggle('on', !flying);
    this.flyBtn.classList.toggle('on', flying);
    this.walkBtn.setAttribute('aria-pressed', String(!flying));
    this.flyBtn.setAttribute('aria-pressed', String(flying));
    const txt = flying ? `${a.toFixed(1)} m` : 'Floor';
    if (this.alt.textContent !== txt) this.alt.textContent = txt;
  }
}
