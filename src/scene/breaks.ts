// Breaks and the shift change. Now and then a few of the dock crew go on their break: they walk
// from their door along the walkways (the dock aisle, south under the loop, along the loop's
// walkway, the west wall), up the stair and into the canteen, sit down at a free table (you see
// them through the window), and after a while go back the same way. (A colleague covers the
// door meanwhile, so the docks keep working.) Every few hours of hub time the shift changes:
// the early shift goes up to the lockers, the late shift comes down to the docks.
//
// A rota on the hall's wall by the stair says who is on their break, until when, and when the
// next break and the next shift change are. By day only (at night the hall is a party).
import * as THREE from 'three';

import type { Canteen } from './canteen';
import type { FloorKit } from './floor';
import { buildHuman, type Human } from './people';
import { settle } from './motion';
import { Trip, walkOn, type P3 } from './trips';

/** Walking speed (metres per beat), break length and the time between breaks and shifts (beats). */
const SPEED = 1.0;
const SIT = [140, 220] as const;
const BREAK_EVERY = 260;
const SHIFT_EVERY = 2400;
const GROUP = 3;
const SHIFT_GROUP = 6;
/** Hub minutes per beat (as the Sorter's clock). */
const HUB_MIN_PER_BEAT = 0.25;

const LOOKS = [
  { shirt: 0x3a3d44, trousers: 0x22283f, vest: 0xf2a51a, helmet: 0xffffff },
  { shirt: 0xf3f4f6, trousers: 0x22283f, vest: 0xc8ff3a, helmet: 0xf2c200 },
  { shirt: 0x1755fe, trousers: 0x3a3d44, vest: 0xf2a51a },
  { shirt: 0x22283f, trousers: 0x22283f, vest: 0xc8ff3a, hairStyle: 2 },
  { shirt: 0x6b3fd1, trousers: 0x22283f, vest: 0xf2a51a, hairStyle: 1 },
];

interface Walker {
  h: Human;
  state: 'off' | 'up' | 'sit' | 'down';
  trip: Trip | null;
  s: number;
  seat: number;
  until: number;
  /** Who it is on the rota (name and door), and when they are back (hub minutes). */
  who: string;
  back: number;
  /** A shift change: in at the canteen door (lockers) and gone, or out of it to the docks. */
  shift: boolean;
}

export interface BreakSetup {
  /** The north doors' x (where the crew comes from). */
  docks: number[];
  /** The way over the hall floor from a door to the foot of the stair (ends where `Canteen.stairUp` starts). */
  toStair: (dockX: number) => P3[];
  /** Names and doors of the dock crew, for the rota. */
  crew: () => { name: string; place: string }[];
  /** Hub time (minutes) and how to write it. */
  hubTime: () => number;
  /** Where the rota hangs: on the west wall (x), centred at z, facing east. */
  rota: { x: number; y: number; z: number };
}

export class BreakCrew {
  private walkers: Walker[] = [];
  private nextBreak = 120;
  private nextShift = SHIFT_EVERY;
  private board: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private drawn = '';

  constructor(
    private k: FloorKit,
    private canteen: Canteen,
    private set: BreakSetup,
  ) {
    for (let i = 0; i < 12; i++) {
      const h = buildHuman(k, LOOKS[i % LOOKS.length]!);
      h.root.visible = false;
      k.put(h.root);
      this.walkers.push({ h, state: 'off', trip: null, s: 0, seat: -1, until: 0, who: '', back: 0, shift: false });
    }
    // The rota: a white board with a dark frame, its sheet drawn on a canvas.
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 352;
    this.board = new THREE.CanvasTexture(this.canvas);
    this.board.colorSpace = THREE.SRGBColorSpace;
    const { x, y, z } = set.rota;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), new THREE.MeshBasicMaterial({ map: this.board }));
    m.position.set(x + 0.05, y, z);
    m.rotation.y = Math.PI / 2;
    m.userData.noInk = true;
    k.put(m);
    k.box('rotaframe', k.std(0x1d1d1f, 0.5, 0.3, 0x1d1d1f), x + 0.025, y, z, 0.04, 1.2, 1.7);
    this.draw();
  }

  update(dt: number, bt: number, day: boolean): void {
    // (Beats since the last frame, from the clock itself: a slow frame still walks the full way.)
    const beats = Math.min(2, Math.max(0, bt - this.btNow));
    this.btNow = bt;
    if (day && bt >= this.nextShift) {
      this.nextShift = bt + SHIFT_EVERY;
      this.shiftChange(bt);
    } else if (day && bt >= this.nextBreak) {
      this.nextBreak = bt + BREAK_EVERY * (0.8 + Math.random() * 0.4);
      this.sendOnBreak(bt);
    }
    for (const w of this.walkers) {
      if (w.state === 'off') continue;
      if (w.state === 'sit') {
        settle(w.h, dt, { idle: 0 });
        if (bt >= w.until) this.goBack(w);
        continue;
      }
      w.s += SPEED * beats;
      if (w.s >= w.trip!.len) {
        if (w.state === 'up' && !w.shift) {
          w.state = 'sit';
          this.canteen.sitAt(w.h, w.seat);
          continue;
        }
        // Back at the door (a colleague takes over again), or gone to the lockers: off the floor.
        if (w.seat >= 0) this.canteen.seats[w.seat]!.taken = false;
        w.state = 'off';
        w.h.root.visible = false;
        w.who = '';
        continue;
      }
      walkOn(w.h, w.trip!, w.s, dt, bt, SPEED);
    }
    this.draw();
  }

  /** A few of the dock crew go on their break: each from their own door to a free seat. */
  private sendOnBreak(bt: number): void {
    const crew = this.set.crew();
    const now = this.set.hubTime();
    for (let n = 0; n < GROUP; n++) {
      const w = this.walkers.find((x) => x.state === 'off');
      const seat = this.canteen.seats.findIndex((s) => !s.taken);
      if (!w || seat < 0 || !crew.length) return;
      const d = Math.floor(Math.random() * this.set.docks.length);
      const who = crew[(d * 2 + n) % crew.length]!;
      this.canteen.seats[seat]!.taken = true;
      const sit = SIT[0] + Math.random() * (SIT[1] - SIT[0]);
      const trip = this.wayUp(this.set.docks[d]!, seat);
      this.start(w, trip, false, seat, `${who.name} · ${who.place.replace(/ ·.*/, '')}`);
      // (Each sets off a few steps behind the one before.)
      w.s = -n * 3;
      w.until = bt + trip.len / SPEED + sit;
      w.back = now + (trip.len / SPEED + sit + trip.len / SPEED) * HUB_MIN_PER_BEAT;
    }
  }

  /** The shift changes: one group up to the lockers in the canteen, the other down to the docks. */
  private shiftChange(bt: number): void {
    void bt;
    const door = this.canteen.toSeat(0).slice(0, 3);
    for (let n = 0; n < SHIFT_GROUP * 2; n++) {
      const w = this.walkers.find((x) => x.state === 'off');
      if (!w) return;
      const dx = this.set.docks[Math.floor(Math.random() * this.set.docks.length)]!;
      const up = new Trip([...this.set.toStair(dx), ...this.canteen.stairUp(), ...door.slice(1)]);
      const going = n % 2 === 0;
      this.start(w, going ? up : up.reversed(), true, -1, '');
      w.s = -Math.floor(n / 2) * 2.5;
    }
  }

  private start(w: Walker, trip: Trip, shift: boolean, seat: number, who: string): void {
    w.trip = trip;
    w.s = 0;
    w.state = 'up';
    w.shift = shift;
    w.seat = seat;
    w.who = who;
    w.h.root.visible = true;
    // (Out of sight until it sets off: a negative distance waits at the start.)
    trip.at(0, w.h.root.position);
  }

  private goBack(w: Walker): void {
    w.trip = w.trip!.reversed();
    w.s = 0;
    w.state = 'down';
  }

  private wayUp(dockX: number, seat: number): Trip {
    return new Trip([...this.set.toStair(dockX), ...this.canteen.stairUp(), ...this.canteen.toSeat(seat).slice(1)]);
  }

  /** The rota: who is on their break and when they are back, the next break, the next shift change. */
  private draw(): void {
    const now = this.set.hubTime();
    const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
    const away = this.walkers.filter((w) => w.who && w.state !== 'off');
    const lines = away.map((w) => `${w.who}  ·  back ${hhmm(w.back)}`);
    const nextBreak = now + Math.max(0, this.nextBreak - this.lastBt()) * HUB_MIN_PER_BEAT;
    const nextShift = now + Math.max(0, this.nextShift - this.lastBt()) * HUB_MIN_PER_BEAT;
    const key = `${lines.join('|')}|${hhmm(nextBreak)}|${hhmm(nextShift)}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const g = this.canvas.getContext('2d')!;
    g.fillStyle = '#f7f7f4';
    g.fillRect(0, 0, 512, 352);
    g.fillStyle = '#1d1d1f';
    g.font = 'bold 44px system-ui, sans-serif';
    g.fillText('Break rota', 24, 54);
    g.fillStyle = '#2fa58f';
    g.fillRect(24, 68, 464, 5);
    g.font = 'bold 28px system-ui, sans-serif';
    g.fillStyle = '#1d1d1f';
    g.fillText('On break now', 24, 108);
    g.font = '25px system-ui, sans-serif';
    if (!lines.length) {
      g.fillStyle = '#6b7078';
      g.fillText('nobody', 24, 146);
    }
    lines.slice(0, 5).forEach((l, i) => {
      g.fillStyle = '#d6339a';
      g.fillRect(24, 124 + i * 34, 9, 22);
      g.fillStyle = '#1d1d1f';
      g.fillText(l, 42, 144 + i * 34, 446);
    });
    g.font = 'bold 24px system-ui, sans-serif';
    g.fillStyle = '#1d1d1f';
    g.fillText(`Next break  ${hhmm(nextBreak)}`, 24, 326);
    g.fillText(`Shift change  ${hhmm(nextShift)}`, 262, 326);
    this.board.needsUpdate = true;
  }

  /** The beat of the last update (for the times ahead on the rota). */
  private lastBt(): number {
    return this.btNow;
  }

  btNow = 0;
}
