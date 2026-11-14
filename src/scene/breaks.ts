// Breaks and the shift change. A few of the dock crew are always on their break in the canteen
// (you see them through the window). Now and then each of them, rested, goes down to a door to
// relieve a colleague: down the stair and over the walkways (the west wall, the loop's walkway,
// under the loop, between the belts) to them, a word at the door, and the colleague walks the
// same way up to a free seat, while the one who came carries on with the job (the door never
// stops). So the crew takes turns. Every few hours of hub time the shift changes: the early shift
// goes up to the lockers, the late shift comes down to the docks.
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
/** Beats on a break before someone is rested enough to relieve a colleague, and between reliefs. */
const SIT = 160;
const BREAK_EVERY = 120;
/** People on their break (in the canteen, or on the way) besides the ones working. */
const SPARES = 4;
const SHIFT_EVERY = 2400;
const GROUP = 3;
const SHIFT_GROUP = 6;
/** Hub minutes per beat (as the Sorter's clock). */
const HUB_MIN_PER_BEAT = 0.25;

const LOOKS = [
  { shirt: 0x3a3d44, trousers: 0x22283f, vest: 0xf2a51a },
  { shirt: 0xf3f4f6, trousers: 0x22283f, vest: 0xc8ff3a },
  { shirt: 0x1755fe, trousers: 0x3a3d44, vest: 0xf2a51a },
  { shirt: 0x22283f, trousers: 0x22283f, vest: 0xc8ff3a, hairStyle: 2 },
  { shirt: 0x6b3fd1, trousers: 0x22283f, vest: 0xf2a51a, hairStyle: 1 },
];

interface Walker {
  h: Human;
  /** up: to the canteen; sit: on their break; down: on the way to relieve someone; meet: with them, taking over. */
  state: 'off' | 'up' | 'sit' | 'down' | 'meet';
  /** Whom they go to relieve (door and job), and since when they are on their break (hub minutes). */
  dock: number;
  role: 0 | 1;
  since: number;
  spare: boolean;
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
  /** Who is working at a door (picker 0, loader 1), and a colleague taking over there (gives back the one who stops). */
  body: (dock: number, role: 0 | 1) => Human;
  swap: (dock: number, role: 0 | 1, h: Human) => Human;
  /** The name of a person (by their body), for the rota. */
  name: (h: Human) => string;
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
    for (let i = 0; i < 12 + SPARES; i++) {
      const h = buildHuman(k, LOOKS[i % LOOKS.length]!);
      h.root.visible = false;
      k.put(h.root);
      this.walkers.push({ h, state: 'off', trip: null, s: 0, seat: -1, until: 0, who: '', back: 0, shift: false, dock: -1, role: 0, since: 0, spare: i >= 12 });
    }
    // The ones on their break at the start: seated in the canteen, rested at different times.
    for (const w of this.walkers.filter((x) => x.spare)) {
      const seat = this.canteen.seats.findIndex((x) => !x.taken);
      if (seat < 0) break;
      this.canteen.seats[seat]!.taken = true;
      w.seat = seat;
      w.state = 'sit';
      w.until = 40 + this.walkers.indexOf(w) * 30;
      w.since = set.hubTime();
      w.h.root.visible = true;
      this.canteen.sitAt(w.h, seat);
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

  /**
   * Nobody new goes on a break or changes shift (a shift of the planning game is played: the
   * plan says who stands where). Those already walking finish their way.
   */
  hold = false;

  update(dt: number, bt: number, day: boolean): void {
    // (Beats since the last frame, from the clock itself: a slow frame still walks the full way.)
    const beats = Math.min(2, Math.max(0, bt - this.btNow));
    this.btNow = bt;
    if (this.hold) {
      // (The next break is not due the moment the hold ends.)
      this.nextBreak = Math.max(this.nextBreak, bt + 16);
      this.nextShift = Math.max(this.nextShift, bt + 64);
    } else if (day && bt >= this.nextShift) {
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
        continue;
      }
      if (w.state === 'meet') {
        this.meet(w, dt, bt, beats);
        continue;
      }
      w.s += SPEED * beats;
      if (w.s >= w.trip!.len) {
        if (w.state === 'up' && !w.shift) {
          w.state = 'sit';
          w.until = bt + SIT;
          this.canteen.sitAt(w.h, w.seat);
          continue;
        }
        if (w.state === 'down' && !w.shift) {
          // By their door's cages: over to the colleague.
          w.state = 'meet';
          w.until = -1;
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

  /** Those rested go down to relieve a colleague each, at a door nobody is going to yet. */
  private sendOnBreak(bt: number): void {
    const rested = this.walkers.filter((w) => w.spare && w.state === 'sit' && bt >= w.until);
    let n = 0;
    for (const w of rested.slice(0, GROUP)) {
      let d = -1;
      let role: 0 | 1 = 0;
      for (let tries = 0; tries < 20; tries++) {
        d = Math.floor(Math.random() * this.set.docks.length);
        role = Math.random() < 0.5 ? 0 : 1;
        if (!this.walkers.some((x) => x !== w && x.dock === d && x.role === role && (x.state === 'down' || x.state === 'meet'))) break;
      }
      w.dock = d;
      w.role = role;
      this.canteen.seats[w.seat]!.taken = false;
      const trip = this.wayUp(this.set.docks[d]!, w.seat).reversed();
      w.trip = trip;
      w.state = 'down';
      // (Each sets off a few steps behind the one before.)
      w.s = -n++ * 3;
    }
  }

  /**
   * At the door: up to the colleague, a word (two beats), and they swap: the one who came takes
   * over the job where it stands, the other walks off on their break, up to a free seat.
   */
  private meet(w: Walker, dt: number, bt: number, beats: number): void {
    const other = this.set.body(w.dock, w.role);
    const r = w.h.root;
    const to = other.root.position;
    const dx = to.x - r.position.x;
    const dz = to.z - r.position.z;
    const dist = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    if (w.until < 0 && dist > 0.9) {
      // Straight to them (they may be moving about their work).
      const step = Math.min(dist - 0.85, SPEED * beats);
      r.position.x += (dx / dist) * step;
      r.position.z += (dz / dist) * step;
      walkOn(w.h, new Trip([[r.position.x, 0, r.position.z], [r.position.x + dx, 0, r.position.z + dz]]), 0, dt, bt, SPEED);
      return;
    }
    if (w.until < 0) w.until = bt + 2;
    r.rotation.y = yaw;
    walkOn(w.h, new Trip([[r.position.x, 0, r.position.z], [to.x, 0, to.z]]), 0, dt, bt, 0);
    w.h.m.talk = 1;
    if (bt < w.until) return;
    w.h.m.talk = 0;
    // Swap: the one who came carries on with the job; the one who stops is now on their break.
    const old = this.set.swap(w.dock, w.role, w.h);
    w.h = old;
    old.m.talk = 0;
    const seat = this.canteen.seats.findIndex((x) => !x.taken);
    if (seat < 0) {
      // (No free seat: they stay on, and the one who came goes back up.)
      const back = this.set.swap(w.dock, w.role, old);
      w.h = back;
    }
    const s = seat >= 0 ? seat : w.seat;
    this.canteen.seats[s]!.taken = true;
    w.seat = s;
    w.since = this.set.hubTime();
    const up = this.wayUp(this.set.docks[w.dock]!, s);
    // From where they stand, between the belts and the way up.
    w.trip = new Trip([[w.h.root.position.x, 0, w.h.root.position.z], ...up.pts]);
    w.s = 0;
    w.state = 'up';
    w.dock = -1;
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

  /** The people on their break now (and later: they take turns with the ones working). */
  spares(): Human[] {
    return this.walkers.filter((w) => w.spare).map((w) => w.h);
  }

  private wayUp(dockX: number, seat: number): Trip {
    return new Trip([...this.set.toStair(dockX), ...this.canteen.stairUp(), ...this.canteen.toSeat(seat).slice(1)]);
  }

  /** The rota: who is on their break and when they are back, the next break, the next shift change. */
  private draw(): void {
    const now = this.set.hubTime();
    const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
    const away = this.walkers.filter((w) => w.spare && (w.state === 'up' || w.state === 'sit'));
    const lines = away.map((w) => `${this.set.name(w.h)}  ·  since ${hhmm(w.since)}`);
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
