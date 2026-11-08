// Live screens: the hall's numbers on the monitoring desk and on big wall
// boards, and wall clocks with the real time. Drawn on canvases and redrawn
// every couple of seconds (clocks every second).
import * as THREE from 'three';

/** Counters the scene keeps; rates are worked out here. */
export interface HubStats {
  inducted: number;
  toDocks: number;
  toRobots: number;
  boxesShipped: number;
  robotsBusy: number;
  robots: number;
  fullBoxes: number;
  speed: number;
}

/** What the control room's video wall shows: a live plan of the hall. Coordinates in metres. */
export interface HubMap {
  /** Hall bounds: x0, x1, z0, z1. */
  hall: [number, number, number, number];
  loop: [number, number][];
  /** Chute ends with how full they are (0…1) and where they go. */
  chutes: { x: number; z: number; fill: number; dock: boolean }[];
  /** Dock doors: state of the truck and its load (0…1). */
  doors: { x: number; z: number; state: string; load: number }[];
  robots: { x: number; z: number; busy: boolean }[];
  boxes: { x: number; z: number; fill: number; away: boolean }[];
  /** Parcels on the loop (positions), and how many go round again. */
  parcels: [number, number][];
  recirculating: number;
}

const PURPLE = '#6b3fd1';
const MAGENTA = '#d6339a';
const TEAL = '#2fa58f';
const INK = '#1d1d1f';

export class Screens {
  readonly dash: THREE.CanvasTexture;
  readonly board: THREE.CanvasTexture;
  readonly clock: THREE.CanvasTexture;
  readonly map: THREE.CanvasTexture;
  private mapG: CanvasRenderingContext2D | null;
  private lastMap = -99;
  private dashG: CanvasRenderingContext2D | null;
  private boardG: CanvasRenderingContext2D | null;
  private clockG: CanvasRenderingContext2D | null;
  private last = -99;
  private lastClock = -99;
  /** Parcels inducted per minute, one sample per redraw. */
  private history: number[] = [];
  private prev: { t: number; inducted: number } | null = null;

  constructor() {
    const make = (w: number, h: number): [THREE.CanvasTexture, CanvasRenderingContext2D | null] => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return [t, c.getContext('2d')];
    };
    [this.dash, this.dashG] = make(512, 288);
    [this.board, this.boardG] = make(1024, 384);
    [this.clock, this.clockG] = make(128, 128);
    [this.map, this.mapG] = make(1600, 576);
  }

  /** Call every frame; redraws when due. `now` in seconds. */
  update(now: number, s: HubStats): void {
    if (now - this.lastClock >= 1) {
      this.lastClock = now;
      this.drawClock();
    }
    if (now - this.last < 2) return;
    if (this.prev) {
      const rate = ((s.inducted - this.prev.inducted) / Math.max(0.5, now - this.prev.t)) * 3600;
      this.history.push(rate);
      if (this.history.length > 24) this.history.shift();
    }
    this.prev = { t: now, inducted: s.inducted };
    this.last = now;
    this.drawDash(s);
    this.drawBoard(s);
  }

  /** The video wall: redrawn 4× a second when the camera is near, otherwise every few seconds. */
  updateMap(now: number, m: HubMap, near: boolean): void {
    if (now - this.lastMap < (near ? 0.25 : 3)) return;
    this.lastMap = now;
    const g = this.mapG;
    if (!g) return;
    const W = 1600;
    const H = 576;
    const [x0, x1, z0, z1] = m.hall;
    const pad = 24;
    const top = 70;
    const sx = (W - 2 * pad) / (x1 - x0);
    const sz = (H - top - pad) / (z1 - z0);
    const X = (x: number) => pad + (x - x0) * sx;
    const Z = (z: number) => top + (z - z0) * sz;
    g.fillStyle = '#12131a';
    g.fillRect(0, 0, W, H);
    // Title bar with the main numbers.
    g.fillStyle = PURPLE;
    g.fillRect(0, 0, W, 52);
    g.fillStyle = '#ffffff';
    g.font = '700 30px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('Hub plan · live', 20, 27);
    g.font = '600 24px system-ui, sans-serif';
    const clear = m.doors.filter((d) => d.state === 'cleardown' || d.state === 'closing').length;
    const away = m.doors.filter((d) => d.state !== 'open' && d.state !== 'cleardown' && d.state !== 'closing').length;
    const full = m.chutes.filter((c) => c.fill >= 1).length;
    g.fillText(`${Math.round(this.rate()).toLocaleString('en')} parcels/h   ·   chutes full ${full}/${m.chutes.length}   ·   cleardown ${clear}   ·   trucks away ${away}   ·   recirculating ${m.recirculating}`, 330, 27);
    // Hall outline.
    g.strokeStyle = '#3a3d44';
    g.lineWidth = 2;
    g.strokeRect(X(x0), Z(z0), (x1 - x0) * sx, (z1 - z0) * sz);
    // The loop, and the parcels on it.
    g.strokeStyle = '#2fa58f';
    g.lineWidth = 7;
    g.beginPath();
    m.loop.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.closePath();
    g.stroke();
    g.fillStyle = '#e0b882';
    for (const [x, z] of m.parcels) g.fillRect(X(x) - 3, Z(z) - 3, 6, 6);
    // Chutes: a bar each, green → amber → red as they fill.
    for (const c of m.chutes) {
      const col = c.fill >= 1 ? '#e2231a' : c.fill > 0.6 ? '#f2a51a' : '#22cc66';
      const h = 40;
      const y = c.dock ? Z(c.z) - h : Z(c.z);
      g.fillStyle = '#2a2c31';
      g.fillRect(X(c.x) - 7, y, 14, h);
      g.fillStyle = col;
      const fh = h * Math.min(1, c.fill);
      g.fillRect(X(c.x) - 7, c.dock ? y + h - fh : y, 14, fh);
    }
    // Dock doors: truck state; cleardown flashes amber.
    const blink = Math.floor(now * 2) % 2 === 0;
    for (const d of m.doors) {
      const y = Z(d.z);
      const w = 30;
      let col = '#2fa58f';
      if (d.state === 'cleardown' || d.state === 'closing') col = blink ? '#f2a51a' : '#5a4310';
      else if (d.state !== 'open') col = '#4a4d55';
      g.fillStyle = col;
      g.fillRect(X(d.x) - w / 2, d.z < 0 ? y : y - 16, w, 16);
      if (d.state === 'open' || d.state === 'cleardown') {
        g.fillStyle = '#ffffff';
        g.fillRect(X(d.x) - w / 2, d.z < 0 ? y + 18 : y - 22, w * d.load, 4);
      }
    }
    // Boxes on the robot floor (fill), and the robots.
    for (const b of m.boxes) {
      g.fillStyle = b.away ? '#2a2c31' : b.fill >= 1 ? '#e2231a' : '#8a7050';
      g.fillRect(X(b.x) - 6, Z(b.z) - 6, 12, 12);
    }
    for (const r of m.robots) {
      g.fillStyle = r.busy ? '#4d8bff' : '#3a4a70';
      g.beginPath();
      g.arc(X(r.x), Z(r.z), 6, 0, Math.PI * 2);
      g.fill();
    }
    // Legend.
    g.font = '600 18px system-ui, sans-serif';
    const legend: [string, string][] = [['#22cc66', 'chute ok'], ['#f2a51a', 'filling / cleardown'], ['#e2231a', 'full'], ['#4a4d55', 'truck away'], ['#4d8bff', 'robot busy']];
    legend.forEach(([c, t], i) => {
      g.fillStyle = c;
      g.fillRect(24 + i * 230, H - 26, 16, 16);
      g.fillStyle = '#c3c8ce';
      g.fillText(t, 48 + i * 230, H - 17);
    });
    this.map.needsUpdate = true;
  }

  private rate(): number {
    const h = this.history.slice(-5);
    return h.length ? h.reduce((a, b) => a + b, 0) / h.length : 0;
  }

  private bars(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string): void {
    const max = Math.max(1000, ...this.history);
    const n = 24;
    const bw = w / n;
    g.fillStyle = col;
    this.history.forEach((v, k) => {
      const bh = (v / max) * h;
      g.fillRect(x + (n - this.history.length + k) * bw + 1, y + h - bh, bw - 3, bh);
    });
  }

  private drawDash(s: HubStats): void {
    const g = this.dashG;
    if (!g) return;
    g.fillStyle = '#f4f0fd';
    g.fillRect(0, 0, 512, 288);
    g.fillStyle = PURPLE;
    g.fillRect(0, 0, 512, 34);
    g.fillStyle = '#ffffff';
    g.font = '700 20px system-ui, sans-serif';
    g.fillText('Hub overview', 14, 24);
    g.font = '600 16px system-ui, sans-serif';
    g.fillText(`Belt ${((s.speed * 2 * 100) / 60).toFixed(1)} m/s`, 380, 24);
    const tile = (x: number, label: string, value: string, col: string) => {
      g.fillStyle = '#ffffff';
      g.fillRect(x, 46, 116, 70);
      g.fillStyle = col;
      g.fillRect(x, 46, 5, 70);
      g.fillStyle = '#6b7280';
      g.font = '600 13px system-ui, sans-serif';
      g.fillText(label, x + 14, 66);
      g.fillStyle = INK;
      g.font = '800 28px system-ui, sans-serif';
      g.fillText(value, x + 14, 102);
    };
    tile(12, 'Parcels / h', Math.round(this.rate()).toLocaleString('en'), PURPLE);
    tile(136, 'To docks', String(s.toDocks), TEAL);
    tile(260, 'To robots', String(s.toRobots), MAGENTA);
    tile(384, 'Robots busy', `${s.robotsBusy}/${s.robots}`, '#1755fe');
    g.fillStyle = '#ffffff';
    g.fillRect(12, 128, 488, 148);
    this.bars(g, 24, 140, 464, 124, PURPLE);
  }

  private drawBoard(s: HubStats): void {
    const g = this.boardG;
    if (!g) return;
    g.fillStyle = '#1d1d1f';
    g.fillRect(0, 0, 1024, 384);
    const cell = (x: number, label: string, value: string, col: string) => {
      g.fillStyle = col;
      g.fillRect(x, 24, 8, 150);
      g.fillStyle = '#a9adb5';
      g.font = '600 28px system-ui, sans-serif';
      g.fillText(label, x + 24, 64);
      g.fillStyle = '#ffffff';
      g.font = '800 72px system-ui, sans-serif';
      g.fillText(value, x + 24, 150);
    };
    cell(24, 'Parcels / hour', Math.round(this.rate()).toLocaleString('en'), PURPLE);
    cell(360, 'Boxes to trucks', String(s.boxesShipped), TEAL);
    cell(690, 'Full boxes', String(s.fullBoxes), MAGENTA);
    this.bars(g, 24, 200, 976, 160, '#86d3c3');
  }

  private drawClock(): void {
    const g = this.clockG;
    if (!g) return;
    const d = new Date();
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(64, 64, 60, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = INK;
    g.stroke();
    g.lineWidth = 3;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(64 + Math.sin(a) * 46, 64 - Math.cos(a) * 46);
      g.lineTo(64 + Math.sin(a) * 54, 64 - Math.cos(a) * 54);
      g.stroke();
    }
    const hand = (a: number, len: number, w: number, col: string) => {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(64, 64);
      g.lineTo(64 + Math.sin(a) * len, 64 - Math.cos(a) * len);
      g.stroke();
    };
    const h = d.getHours() % 12;
    const m = d.getMinutes();
    const sec = d.getSeconds();
    hand(((h + m / 60) / 12) * Math.PI * 2, 30, 7, INK);
    hand(((m + sec / 60) / 60) * Math.PI * 2, 44, 5, INK);
    hand((sec / 60) * Math.PI * 2, 48, 2, '#e2231a');
    this.clock.needsUpdate = true;
    // Dashboards share this redraw tick.
    this.dash.needsUpdate = true;
    this.board.needsUpdate = true;
  }
}
