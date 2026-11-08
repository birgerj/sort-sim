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

const PURPLE = '#6b3fd1';
const MAGENTA = '#d6339a';
const TEAL = '#2fa58f';
const INK = '#1d1d1f';

export class Screens {
  readonly dash: THREE.CanvasTexture;
  readonly board: THREE.CanvasTexture;
  readonly clock: THREE.CanvasTexture;
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
