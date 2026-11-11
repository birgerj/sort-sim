// Live screens: the hall's numbers on the monitoring desk and on big wall
// boards, and wall clocks with the real time. Drawn on canvases and redrawn
// every couple of seconds (clocks every second).
import * as THREE from 'three';
import { daysToChristmas, XMAS } from '../sim/season';
import type { ScanInfo } from './sorter';

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
  /** The hall's outline (with the inbound wing), when it is not just the bounds. */
  outline?: [number, number][];
  /** The infeed: collectors and lanes as lines, and the inbound trucks (what is still in each, 0…1). */
  infeed?: [number, number][][];
  inbound?: { x: number; z: number; state: string; left: number }[];
  loop: [number, number][];
  /** Chute ends with how full they are (0…1) and where they go. */
  chutes: { x: number; z: number; fill: number; dock: boolean; fault?: boolean }[];
  /** Dock doors: state of the truck and its load (0…1). */
  doors: { x: number; z: number; state: string; load: number }[];
  robots: { x: number; z: number; busy: boolean }[];
  boxes: { x: number; z: number; fill: number; away: boolean }[];
  /** Parcels on the loop (positions), and how many go round again. */
  parcels: [number, number][];
  /** Parcels on the infeed (telescopes, collectors, lanes). */
  infeedParcels?: [number, number][];
  /** The scanners (lane tunnels and loop scanners): seconds since their last scan, and whether it read. */
  scanners?: { x: number; z: number; dir: number; age: number; read: boolean }[];
  /** A status panel per lane scanner: the last parcel it read (none yet: undefined). */
  scanPanels?: { name: string; age: number; last?: ScanInfo }[];
  recirculating: number;
  /** Parcels waiting at the infeed (on the lanes and outside). */
  queue: number;
  /** Hub time, trucks on time (%), average dwell (minutes). */
  clock: string;
  onTime: number;
  dwell: number;
}

const PURPLE = '#6b3fd1';
const MAGENTA = '#d6339a';
const TEAL = '#2fa58f';
const INK = '#1d1d1f';
/** How long a scanner stays lit on the video wall after a scan (seconds). */
const SCAN_BLINK = 0.5;

/** Something on the video wall's plan under a point: a scanner, chute, dock door or robot, by its index in `HubMap`. */
export type MapHit = { kind: 'scanner' | 'chute' | 'door' | 'robot'; i: number };

export class Screens {
  /** Where the last plan put things (canvas pixels), for `hitMap`. */
  private spots: (MapHit & { x: number; y: number; r: number })[] = [];
  private panelRects: { x: number; y: number; w: number; h: number }[] = [];
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
    // (Taller since the inbound wing: the plan keeps its scale, the wall grew.)
    [this.map, this.mapG] = make(1600, 688);
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
    const H = 688;
    const [x0, x1, z0, z1] = m.hall;
    const pad = 24;
    const top = 70;
    const sx = (W - 2 * pad) / (x1 - x0);
    const sz = (H - top - pad) / (z1 - z0);
    const X = (x: number) => pad + (x - x0) * sx;
    const Z = (z: number) => top + (z - z0) * sz;
    // What can be clicked, and where it is drawn (centre and how far a click may miss).
    this.spots = [
      ...(m.scanners ?? []).map((c, i) => ({ kind: 'scanner' as const, i, x: X(c.x), y: Z(c.z), r: 16 })),
      ...m.chutes.map((c, i) => ({ kind: 'chute' as const, i, x: X(c.x), y: c.dock ? Z(c.z) - 20 : Z(c.z) + 20, r: 22 })),
      ...m.doors.map((d, i) => ({ kind: 'door' as const, i, x: X(d.x), y: d.z < 0 ? Z(d.z) + 8 : Z(d.z) - 8, r: 18 })),
      ...m.robots.map((r, i) => ({ kind: 'robot' as const, i, x: X(r.x), y: Z(r.z), r: 14 })),
    ];
    this.panelRects = [];
    // (Text is left-aligned throughout; the fault marks centre theirs.)
    g.textAlign = 'left';
    g.fillStyle = '#12131a';
    g.fillRect(0, 0, W, H);
    // Title bar with the main numbers.
    g.fillStyle = PURPLE;
    g.fillRect(0, 0, W, 52);
    g.fillStyle = '#ffffff';
    g.font = '700 30px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(XMAS ? 'Hub plan · live · Happy holidays ★' : 'Hub plan · live', 20, 27);
    g.font = '600 18px system-ui, sans-serif';
    const clear = m.doors.filter((d) => d.state === 'cleardown' || d.state === 'closing').length;
    const away = m.doors.filter((d) => d.state !== 'open' && d.state !== 'cleardown' && d.state !== 'closing').length;
    const full = m.chutes.filter((c) => c.fill >= 1).length;
    g.fillText(`${Math.round(this.rate()).toLocaleString('en')} parcels/h   ·   chutes full ${full}/${m.chutes.length}   ·   ${m.chutes.some((c) => c.fault) ? `FAULT ${m.chutes.filter((c) => c.fault).length}   ·   ` : ''}${m.inbound ? `unloading ${m.inbound.filter((d) => d.state === 'open' && d.left > 0).length}/${m.inbound.length}   ·   ` : ''}cleardown ${clear}   ·   trucks away ${away}   ·   recirculating ${m.recirculating}   ·   infeed queue ${m.queue}   ·   on time ${m.onTime}%   ·   dwell ${m.dwell} min   ·   ${m.clock}`, 330, 27);
    // Hall outline (with the inbound wing).
    g.strokeStyle = '#3a3d44';
    g.lineWidth = 2;
    if (m.outline) {
      g.beginPath();
      m.outline.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
      g.closePath();
      g.stroke();
    } else g.strokeRect(X(x0), Z(z0), (x1 - x0) * sx, (z1 - z0) * sz);
    // Collectors and infeed lanes.
    g.strokeStyle = '#1f6f60';
    g.lineWidth = 4;
    for (const line of m.infeed ?? []) {
      g.beginPath();
      line.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
      g.stroke();
    }
    // Inbound trucks: green while unloading (the white bar is what is still in it), grey when away, amber coming or going.
    for (const d of m.inbound ?? []) {
      const w = 22;
      const col = d.state === 'open' ? '#2fa58f' : d.state === 'away' || d.state === 'leaving' ? '#4a4d55' : '#f2a51a';
      g.fillStyle = col;
      g.fillRect(X(d.x) - w / 2, Z(d.z) - 18, w, 16);
      if (d.left > 0) {
        g.fillStyle = '#ffffff';
        g.fillRect(X(d.x) - w / 2, Z(d.z) - 24, w * d.left, 4);
      }
    }
    // The loop, and the parcels on it.
    g.strokeStyle = '#2fa58f';
    g.lineWidth = 7;
    g.beginPath();
    m.loop.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.closePath();
    g.stroke();
    g.fillStyle = '#e0b882';
    for (const [x, z] of m.parcels) g.fillRect(X(x) - 3, Z(z) - 3, 6, 6);
    // Parcels on the infeed belts.
    for (const [x, z] of m.infeedParcels ?? []) g.fillRect(X(x) - 2.5, Z(z) - 2.5, 5, 5);
    // Scanners: a dim bracket across the belt that lights up for a moment on each scan
    // (green on a read, red on a no-read), with a glow that fades.
    for (const sc of m.scanners ?? []) {
      const f = Math.max(0, 1 - sc.age / SCAN_BLINK);
      const cx = X(sc.x);
      const cz = Z(sc.z);
      if (f > 0) {
        const col = sc.read ? '91, 224, 160' : '255, 90, 74';
        const r = 10 + 8 * f;
        const glow = g.createRadialGradient(cx, cz, 0, cx, cz, r);
        glow.addColorStop(0, `rgba(${col}, ${0.85 * f})`);
        glow.addColorStop(1, `rgba(${col}, 0)`);
        g.fillStyle = glow;
        g.fillRect(cx - r, cz - r, 2 * r, 2 * r);
      }
      // (The bracket lies across the belt: `dir` is the belt's direction in plan.)
      g.save();
      g.translate(cx, cz);
      g.rotate(Math.atan2(Math.sin(sc.dir) * sz, Math.cos(sc.dir) * sx));
      g.fillStyle = f > 0 ? (sc.read ? '#5be0a0' : '#ff5a4a') : '#8a5a10';
      g.fillRect(-3, -8, 6, 16);
      g.restore();
    }
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
      if (c.fault) {
        // Down: a red frame and a mark that flash.
        if (Math.floor(now * 2) % 2 === 0) {
          g.strokeStyle = '#ff3b30';
          g.lineWidth = 3;
          g.strokeRect(X(c.x) - 8.5, y - 1.5, 17, h + 3);
        }
        g.fillStyle = '#ff3b30';
        g.font = '800 20px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText('!', X(c.x), c.dock ? y - 8 : y + h + 20);
      }
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
    // Status panels for the lane scanners, in the free strip right of the inbound wing, above the north docks.
    if (m.scanPanels?.length && m.inbound?.length) {
      const px0 = X(Math.max(...m.inbound.map((d) => d.x))) + 44;
      const px1 = W - pad;
      const northDoors = m.doors.filter((d) => d.z < 0);
      const py0 = 62;
      const py1 = (northDoors.length ? Math.min(...northDoors.map((d) => Z(d.z))) : 180) - 10;
      this.scanPanels(g, m.scanPanels, px0, py0, px1, py1);
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

  /** One panel per lane scanner, side by side: barcode, postcode and city, destination, size and weight. */
  private scanPanels(g: CanvasRenderingContext2D, panels: NonNullable<HubMap['scanPanels']>, x0: number, y0: number, x1: number, y1: number): void {
    const gap = 12;
    const w = (x1 - x0 - gap * (panels.length - 1)) / panels.length;
    const h = y1 - y0;
    const fit = (text: string, max: number) => {
      if (g.measureText(text).width <= max) return text;
      while (text.length > 1 && g.measureText(`${text}…`).width > max) text = text.slice(0, -1);
      return `${text}…`;
    };
    // (Left-aligned, whatever was drawn before: the fault marks centre theirs.)
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    panels.forEach((pn, i) => {
      const x = x0 + i * (w + gap);
      this.panelRects[i] = { x, y: y0, w, h };
      // Everything of a panel stays inside it.
      g.save();
      g.beginPath();
      g.rect(x, y0, w, h);
      g.clip();
      this.scanPanel(g, pn, x, y0, w, h, fit);
      g.restore();
    });
  }

  private scanPanel(g: CanvasRenderingContext2D, pn: NonNullable<HubMap['scanPanels']>[number], x: number, y0: number, w: number, h: number, fit: (text: string, max: number) => string): void {
    {
      const f = Math.max(0, 1 - pn.age / SCAN_BLINK);
      const last = pn.last;
      const ok = !last || last.read;
      g.fillStyle = '#1a1c24';
      g.fillRect(x, y0, w, h);
      // The frame lights up on a scan (green on a read, red on a no-read).
      g.strokeStyle = f > 0 ? (ok ? `rgba(91, 224, 160, ${0.4 + 0.6 * f})` : `rgba(255, 90, 74, ${0.4 + 0.6 * f})`) : '#2e313a';
      g.lineWidth = 2;
      g.strokeRect(x + 1, y0 + 1, w - 2, h - 2);
      // Header: the scanner's name and a status lamp.
      g.fillStyle = '#9aa0a8';
      g.font = '700 14px system-ui, sans-serif';
      g.fillText(pn.name.toUpperCase(), x + 12, y0 + 14);
      g.fillStyle = f > 0 ? (ok ? '#5be0a0' : '#ff5a4a') : last ? (ok ? '#1f6f50' : '#7a2620') : '#3a3d44';
      g.beginPath();
      g.arc(x + w - 16, y0 + 14, 5, 0, Math.PI * 2);
      g.fill();
      if (!last) {
        g.fillStyle = '#6b7078';
        g.font = '600 16px system-ui, sans-serif';
        g.fillText('Waiting for parcels', x + 12, y0 + 46);
        return;
      }
      // The barcode: a few bars from its digits, and the code itself.
      const bx = x + 12;
      const by = y0 + 26;
      g.fillStyle = ok ? '#e8e6ef' : '#ff5a4a';
      let cx = bx;
      for (const ch of last.code) {
        const d = Number(ch);
        for (const bw of [1 + (d % 3), 1 + ((d >> 1) % 2), 2 + (d % 2)]) {
          g.fillRect(cx, by, bw, 14);
          cx += bw + 1.5;
        }
      }
      g.font = '700 20px ui-monospace, Menlo, Consolas, monospace';
      g.fillText(fit(ok ? last.code : `NO READ ${last.code}`, w - (cx - bx) - 34), cx + 10, by + 7);
      // Postcode and city.
      g.fillStyle = '#ffffff';
      g.font = '700 17px system-ui, sans-serif';
      g.fillText(fit(ok ? `${last.postcode}  ${last.city}` : 'Label unreadable', w - 24), x + 12, y0 + 56);
      // Where it goes, then size and weight.
      g.fillStyle = ok ? '#5be0a0' : '#e0a0a0';
      g.font = '600 15px system-ui, sans-serif';
      g.fillText(fit(`→ ${last.dest}`, w - 24), x + 12, y0 + 76);
      if (h >= 104) {
        g.fillStyle = '#9aa0a8';
        g.font = '500 14px system-ui, sans-serif';
        g.fillText(fit(`${last.size} · ${last.kg.toFixed(1)} kg`, w - 24), x + 12, y0 + 95);
      }
    }
  }

  /**
   * What on the video wall's plan is at this canvas pixel (0…1600, 0…688): a scanner, chute, dock
   * door or robot (the nearest within reach of where it is drawn), or a scanner's status panel.
   */
  hitMap(px: number, py: number): MapHit | null {
    const k = this.panelRects.findIndex((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
    if (k >= 0) return { kind: 'scanner', i: k };
    let best: MapHit | null = null;
    let bd = Infinity;
    for (const s of this.spots) {
      const d = Math.hypot(s.x - px, s.y - py) / s.r;
      if (d < 1 && d < bd) {
        bd = d;
        best = { kind: s.kind, i: s.i };
      }
    }
    return best;
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
    if (XMAS) {
      // Christmas: a countdown instead of the full boxes.
      const d = daysToChristmas();
      cell(690, d ? 'Days to Christmas' : 'Merry Christmas', d ? String(d) : '★', '#c8102e');
    } else cell(690, 'Full boxes', String(s.fullBoxes), MAGENTA);
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
