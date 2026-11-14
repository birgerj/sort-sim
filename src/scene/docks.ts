// The dock side of the hall (north wall): the chutes feed roller belts that
// end at truck docks. Each dock serves one city (big cities have several docks,
// shared out by volume, with the same postcodes); its six roll cages each take a part of the city's
// postcodes (on the cards on each cage). At the end of each belt a picker takes
// the parcels off (the flow projector shows the postcodes of the first three) and
// walks each to the cage that takes it. A loader pushes full cages into the truck
// (up to ten go in a trailer) and brings an empty one from the stack of empties
// by the door, so the picker never has to stop. One more loader for every two
// doors helps wherever there is a cage to push; at a cleardown the picker helps
// too. Cages in the trailer stay in sight, parcels and all, until the door is down.
//
// By day the workers work, one move per beat. By night they dance when idle.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { FloorKit } from './floor';
import { litPaper } from './realDay';
import { DOCK_CITY, NORTH_CITIES, rangeOf, rangeText, split } from '../sim/postcodes';
import { Labels } from './labels';
import { buildHuman, type Human } from './people';
import { crouch, gait, reach, relaxArms, settle } from './motion';
import { checkerPlate, checkerPlateNormal, sectionalDoor, sectionalDoorNormal, wireMesh } from './textures';
import { ANTICS } from './antics';

type V3 = THREE.Vector3;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** z of the end of the dock belts, and of the wall. */
export const DOCK_BELT_END = -25.4;
const WALL_Z = -40;

/** What the docks need from a parcel (the Sorter's parcels have all of it). */
export interface DockParcel {
  pos: V3;
  q: THREE.Quaternion;
  h: number;
  /** Length along the belt, width, and weight. */
  d: number;
  w: number;
  kg: number;
  dead: boolean;
  /** Postcode (four digits). */
  pc: number;
  /** Service marks on the label ('fragile' is handled with care). */
  tags?: readonly string[];
}

interface Cage {
  /** Home position by the belt. */
  at: V3;
  /** Postcodes it takes. */
  range: [number, number];
  n: number;
  /** Volume (m³) and weight (kg) of the parcels in it. */
  vol: number;
  kg: number;
  g: THREE.Group;
  pile: THREE.Object3D[];
  /** The parcels in it. */
  items: DockParcel[];
  /** By the belt; being pushed or pulled by the worker; in the trailer (gone with the truck). */
  state: 'home' | 'moving' | 'gone';
  /** Full: waiting to go into the trailer. */
  ry: number;
}

/** What a dock needs from its truck (by dock x). */
export interface TruckLink {
  open(x: number): boolean;
  reserve(x: number, n: 1 | -1): void;
  /** One load into the trailer: its volume (m³) and weight (kg). */
  load(x: number, vol: number, kg: number): void;
  /** The truck is in cleardown (it leaves once everything is in). */
  clearing?(x: number): boolean;
  /** Where the next load goes in the trailer (null: full, or no truck). */
  slot?(x: number): V3 | null;
  /** A trailer stands at the door with the door up (open, in cleardown, or the door coming down). */
  atDoor?(x: number): boolean;
}

/**
 * One step of the worker's job, in whole beats: walk somewhere, pick a parcel off
 * the belt, carry it, put it in a cage, push a cage into the trailer, or pull an
 * empty one out of a new truck.
 */
/** Inside the loop where the loaders chat (z), and where the way between the belts meets the cages. */
const CHAT_Z = -2.4;
const OUT_Z = -25.2;
/** Behind the cages, on the door side (between them and where full cages wait). */
const BEHIND_Z = -31;
/** South of this a worker is out on the floor by the loop (or inside it), not among the cages. */
const INSIDE_Z = -12;

interface Step {
  beats: number;
  /** Where the worker ends up. */
  to: V3;
  /** Point to face while doing it. */
  face?: V3;
  pose: 'walk' | 'pick' | 'carry' | 'drop' | 'push' | 'throw';
  /** Not work: going over for a chat (counted as waiting in the staff figures). */
  idle?: boolean;
  /** On tiptoe, arms out, eyes on the parcel (a fragile one). */
  careful?: boolean;
  /** A cage that moves along with the worker, to this spot (and turned to `ry` on the way). */
  cage?: { c: Cage; to: V3; ry?: number };
  done?: () => void;
}

interface Worker extends Human {
  home: V3;
  steps: Step[];
  step: Step | null;
  /** Beat the current step started, and where the worker and its cage were then. */
  t0: number;
  from: V3;
  cageFrom: V3;
  cageRyFrom: number;
  /** The dock it works for now (a helper serves two). */
  job?: Dock;
  parcel: DockParcel | null;
  /** Where the parcel lay on the belt when picked. */
  pickFrom: V3;
  cage: number;
  yaw: number;
  /** Loaders: where they stand to chat with the others of their group when there is no work, and the middle of the group. */
  chat?: V3;
  chatMid?: V3;
  /** The chat group: its number, the others' spots, and this one's place in it. */
  group?: number;
  mates?: V3[];
  /** Own rhythm and habits (from a seed): talking speed, listening pose, how often it nods. */
  rate: number;
  phase: number;
  style: number;
  /** Dances a little while working (headphones on); caught by the camera until this beat. */
  dancer?: boolean;
  caughtUntil?: number;
}

interface Dock {
  x: number;
  chute: number;
  city: number;
  queue: DockParcel[];
  cages: Cage[];
  /** Takes parcels off the belt into the cages. */
  worker: Worker;
  /** Pushes full cages into the truck and brings empty ones. */
  loader: Worker;
  /** Full cages waiting by the door for the next truck (while none is there). */
  staged: Staged[];
  /** Spare cage frames (in the stack of empties), swapped in for staged ones. */
  spares: THREE.Group[];
  /** Its truck was in cleardown on the last beat; the loader stretches once it is over. */
  wasClearing: boolean;
  stretchDue: boolean;
  /**
   * Cages pushed into the trailer, with their parcels: they stay in sight (the trailer's door end
   * is open) until the door has come down, then leave with the truck.
   */
  inTrailer: { g: THREE.Group; items: DockParcel[] }[];
}

/**
 * A dock during a shift of the planning game. The plan says whether it is in use, for which
 * city and with how many people. The parcels are the plan's own: what comes down the belt is
 * taken off, put in the cages and pushed into the trailer as in the free simulation, a little
 * brisker (so that one person loads about 90 an hour of hall time and two about 170, as the
 * score model has it). The shift's timeline says how many may have been taken by now: the
 * pickers never run ahead of it.
 */
interface Run {
  /** Cages stand at the dock (in use or being made ready). */
  cages: boolean;
  /** People at work: nobody, one who picks and loads alone, or two who both pick and take turns with the cages. */
  people: 0 | 1 | 2;
  /** Parcels the timeline has loaded here so far in this block, and parcels taken off the belt. */
  allow: number;
  taken: number;
  /** The last minutes of the block: every cage with parcels goes into the trailer. */
  clearing: boolean;
  name: string;
}
/** How much shorter the cage runs are during a shift (beats × this), and how far a step goes then (m per beat). */
const RUN_PACE = 0.5;
const RUN_WALK = 2.4;
/** The loader's place at the belt end during a shift (x offset from the belt, z offset from its end): beside the picker. */
const SECOND_AT: [number, number] = [-1.0, -0.6];
/** Places in a cage for the shift's small cartons: three across, two deep, four high. */
export const RUN_CAGE = 24;

/** A loader shared by two neighbouring doors: helps wherever there is a cage to push. */
interface Helper {
  w: Worker;
  pair: Dock[];
}

interface Staged {
  g: THREE.Group;
  items: DockParcel[];
  vol: number;
  kg: number;
  /** Its place by the door. */
  spot: number;
  moving: boolean;
}

export interface DockHandlers {
  /** Flow projector of this dock shows the parcel's postcode on it (follows `target`). */
  mark(chute: number, target: V3, code: string): void;
  /** A parcel left in a cage (for the dock lamp). */
  shipped(chute: number): void;
  /** Keep a parcel inside a moving thing (a cage), at a local position. */
  hold(p: DockParcel, holder: THREE.Object3D, local: V3): void;
  /** A parcel for another dock (a missort), put in the return tote. */
  missort(p: DockParcel): void;
  truck: TruckLink;
}

/** Parcels in a full roll cage. */
const CAGE_FULL = 12;
/** A roll cage is full by volume: about this much of parcels (m³), stacked as well as they go. */
const CAGE_M3 = 1.1;
/** Card colours on the cages (pastel, for black print). */
const CARD_COLS = ['#ffe45c', '#9fd8ff', '#a6e8a0', '#ffb877', '#f6a6d6', '#c9b6ff'];
/** Roll cages per dock. */
const CAGES = 6;
/** Where the stack of empty cages stands, beside the door (x offset from the dock, z). */
const STOCK_DX = -2.3;
const STOCK_Z = -36.6;
/** Places by the door where full cages wait when there is no truck (x offset, z). */
const STAGE_AT: [number, number][] = [[1.6, -36.2], [1.6, -37.6], [3.0, -36.2], [3.0, -37.6]];
/** Places for cages in a trailer (as the trucks have them): each in there keeps its own frame in sight. */
const TRAILER_CAGES = 10;
/** Where a helper waits between the two doors it serves (z). */
const HELPER_Z = -32.8;
/** The front parcel stops this far before the end of the belt. */
const QUEUE_FRONT = 0.1;
/** The dock whose picker does not walk: he throws the parcels into the cages (all but the fragile ones). */
const THROW_DOCK = 5;
/** The picker with headphones, who dances a little while working. */
const DANCE_DOCK = 2;

let cageGeo: Record<'frame' | 'wheels' | 'parcel', THREE.BufferGeometry> | null = null;
/** Roll cage geometry, built once: frame and wheels merged, and a parcel for the pile. */
function cageGeometry(): Record<'frame' | 'wheels' | 'parcel', THREE.BufferGeometry> {
  if (cageGeo) return cageGeo;
  const parts: THREE.BufferGeometry[] = [];
  const part = (w: number, h: number, d: number, x: number, y: number, z: number) => parts.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  part(1.4, 0.08, 1.1, 0, 0.3, 0);
  for (const sx of [-0.68, 0.68]) for (const sz of [-0.52, 0.52]) part(0.06, 1.7, 0.06, sx, 1.1, sz);
  for (const sz of [-0.52, 0.52]) part(1.4, 0.06, 0.06, 0, 1.92, sz);
  for (const sx of [-0.68, 0.68]) part(0.06, 0.06, 1.1, sx, 1.92, 0);
  const wheels: THREE.BufferGeometry[] = [];
  for (const sx of [-0.55, 0.55]) for (const sz of [-0.42, 0.42]) wheels.push(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 10).rotateX(Math.PI / 2).translate(sx, 0.12, sz));
  cageGeo = { frame: mergeGeometries(parts)!, wheels: mergeGeometries(wheels)!, parcel: new THREE.BoxGeometry(0.5, 0.28, 0.42) };
  return cageGeo;
}

/** Place k in a roll cage (local): two by two, in layers. */
function cageSlot(k: number, out: V3): V3 {
  return out.set((k % 2 ? 0.3 : -0.3), 0.36 + Math.floor(k / 4) * 0.48, (Math.floor(k / 2) % 2 ? 0.22 : -0.22));
}

/** Place k in a roll cage for the small cartons of a played shift: three across, two deep, in layers. */
function runSlot(k: number, out: V3): V3 {
  const n = k % RUN_CAGE;
  return out.set(((n % 3) - 1) * 0.43, 0.36 + Math.floor(n / 6) * 0.36, Math.floor(n / 3) % 2 ? 0.24 : -0.24);
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const UP = new THREE.Vector3(0, 1, 0);

export class Docks {
  readonly docks: Dock[] = [];
  /** One extra loader per two doors. */
  readonly helpers: Helper[] = [];
  private boardsDay: boolean | null = null;
  private readonly t = new THREE.Vector3();
  private readonly hands = new THREE.Vector3();
  private readonly t2 = new THREE.Vector3();
  private readonly t3 = new THREE.Vector3();
  private readonly t4 = new THREE.Vector3();
  private readonly t5 = new THREE.Vector3();
  private readonly o = new THREE.Object3D();
  private readonly q = new THREE.Quaternion();
  /** Postcode boards on the cages (two per cage, back to back). */
  private boards: Labels;
  private readonly m = new THREE.Matrix4();
  /** The beat now (for acts started from a step's end). */
  private now = 0;
  /** A Mexican wave along the docks: who goes up on which beat. */
  private waveQueue: { w: Worker; at: number }[] = [];
  /** Tempo on the last frame (air guitar when the music turns to acid techno). */
  private lastBpm = 0;
  private nextGuitar = 0;
  /** Set while a shift of the planning game is played: each dock as the director runs it (null: the free simulation). */
  private runs: Run[] | null = null;
  /** During a shift: a cage is full at this many parcels. */
  private runCap = 22;

  constructor(
    private kit: FloorKit,
    lines: { x: number; chute: number }[],
    private handlers: DockHandlers,
  ) {
    this.boards = new Labels(lines.length * CAGES * 2, 0.68, 0.48, 200, 140);
    // Paper cards: lit like paper in the realistic day.
    litPaper(this.boards.mat);
    kit.put(this.boards.mesh);
    for (const [n, l] of lines.entries()) this.buildDock(l.x, l.chute, n + 1, DOCK_CITY[n] ?? n);
    // One more loader for every two doors, waiting between them (neighbouring docks share the
    // way between their cages: `walkX` of an even dock and the next is the same).
    for (let i = 0; i < this.docks.length; i += 2) {
      const pair = this.docks.slice(i, i + 2);
      const x = this.walkX(pair[0]!);
      const w = this.buildWorker(v(x, 0, HELPER_Z), 2 + i);
      w.job = pair[0];
      this.helpers.push({ w, pair });
    }
    // Loaders (and the helpers) of neighbouring docks chat in groups of two to four when there is nothing to load.
    const chatters: { w: Worker; x: number }[] = [
      ...this.docks.map((d) => ({ w: d.loader, x: this.walkX(d) })),
      ...this.helpers.map((h) => ({ w: h.w, x: this.walkX(h.pair[0]!) })),
    ].sort((a, b) => a.x - b.x);
    const groups: { w: Worker; x: number }[][] = [];
    for (let i = 0; i < chatters.length; ) {
      const left = chatters.length - i;
      const size = left === 5 ? 3 : left <= 4 ? left : left === 6 ? 3 : 4;
      groups.push(chatters.slice(i, i + size));
      i += size;
    }
    // (The chat is inside the loop, off the floor where cages are pushed: they walk there and
    // back between the belts, under the loop: see `walkX`.)
    groups.forEach((g, gi) => {
      const mid = v(g.reduce((a, c) => a + c.x, 0) / g.length, 0, CHAT_Z);
      const spots = g.map((_, k) => {
        const a = (k / g.length) * Math.PI * 2 + 0.6 + gi;
        // (Not quite a ring: people stand at their own distance.)
        const r = 0.6 + g.length * 0.08 + ((gi * 7 + k * 3) % 4) * 0.06;
        return mid.clone().add(v(Math.cos(a) * r, 0, Math.sin(a) * r));
      });
      g.forEach(({ w }, k) => {
        w.chat = spots[k]!;
        w.chatMid = mid;
        w.group = gi;
        w.mates = spots;
      });
    });
  }

  /** A Mexican wave along the docks from this beat: dock after dock, half a beat apart, picker then loader. */
  startWave(from: number): void {
    if (this.waveQueue.length) return;
    [...this.docks].sort((a, b) => a.x - b.x).forEach((d, i) => {
      this.waveQueue.push({ w: d.worker, at: from + i * 0.5 });
      this.waveQueue.push({ w: d.loader, at: from + i * 0.5 + 0.25 });
    });
  }

  /** The picker with headphones. */
  get dancer(): Human {
    return this.docks[DANCE_DOCK]!.worker;
  }

  /** Caught dancing (tapped): stand still and look at the camera, then pretend to work. */
  catchDancer(bt: number, camera: V3): void {
    const w = this.docks[DANCE_DOCK]!.worker;
    w.caughtUntil = bt + 8;
    ANTICS.play(w, 'caught', bt, { look: camera.clone() }, true);
  }

  /** City of a dock (by chute), or −1. */
  cityOf(chute: number): number {
    return this.docks.find((d) => d.chute === chute)?.city ?? -1;
  }

  /** Projector position and default target for each dock (for the projector rig). */
  static projectorAt(x: number): V3 {
    // Right above the end of the belt, where the parcels wait.
    return v(x, 0, DOCK_BELT_END + 1.3);
  }

  /** Belt length taken by the queue at a dock's belt end (by chute). */
  depth(chute: number): number {
    const d = this.docks.find((x) => x.chute === chute);
    return QUEUE_FRONT + (d ? d.queue.reduce((a, p) => a + p.d + 0.06, 0) : 0);
  }

  /** Everyone who can push cages at a dock: its picker, its loader, and the helper of its pair. */
  private crewOf(d: Dock): Worker[] {
    const h = this.helpers.find((x) => x.pair.includes(d));
    return h ? [d.worker, d.loader, h.w] : [d.worker, d.loader];
  }

  /**
   * What the truck at this door still waits for at its cleardown: 2, someone pushing a cage or
   * still in the trailer (the door never comes down on them); 1, cages that should still go in;
   * 0, nothing.
   */
  pending(x: number): number {
    const d = this.docks.find((k) => k.x === x);
    if (!d) return 0;
    // (In the trailer, or on the way in or out of it.)
    const inTruck = (w: Worker) => w.root.position.z < WALL_Z + 0.6 || (!!w.step && w.step.to.z < WALL_Z + 0.6);
    const near = (w: Worker) => Math.abs(w.root.position.x - d.x) < 2.2;
    if (this.crewOf(d).some((w) => w.job === d && (w.step?.pose === 'push' || w.steps.some((s) => s.pose === 'push' && s.to.z < WALL_Z)) || (near(w) && inTruck(w)))) return 2;
    // Cages still on their way.
    if (d.cages.some((c) => c.state === 'moving') || d.staged.some((st) => st.moving)) return 1;
    // Cages that should still go in: only while the trailer has room for them (a full
    // trailer leaves; what is left waits for the next truck).
    const room = !!this.handlers.truck.slot?.(x);
    return room && (d.staged.length > 0 || d.cages.some((c) => c.state === 'home' && c.n > 0)) ? 1 : 0;
  }

  arrive(chute: number, p: DockParcel): void {
    const d = this.docks.find((x) => x.chute === chute);
    if (!d) {
      p.dead = true;
      return;
    }
    // (No limit here: the sorter only sends what fits on the belt, by length.)
    d.queue.push(p);
  }

  /**
   * The roll cage a parcel goes in, as the projector numbers them: 1–6, from the cage beside the
   * belt's end on its west side, clockwise seen from above (up the west side, back down the east).
   * 0: none of this dock's cages (a missort, for the return tote).
   */
  cageNumber(chute: number, pc: number): number {
    const d = this.docks.find((x) => x.chute === chute);
    if (!d) return 0;
    return this.cageIndex(d, pc) + 1;
  }

  /** Which of a dock's cages takes this postcode (−1: none; during a shift there is always one). */
  private cageIndex(d: Dock, pc: number): number {
    const i = rangeOf(d.cages.map((c) => c.range), pc);
    return i < 0 && this.runs ? Math.abs(pc) % CAGES : i;
  }

  /** The parcels banked up at the end of a dock's belt, front first (by chute). */
  queueOf(chute: number): readonly DockParcel[] {
    return this.docks.find((x) => x.chute === chute)?.queue ?? [];
  }

  /** How full the roll cages at this dock are together (0–1), for the screen above the door. */
  cageFill(x: number): number {
    const d = this.docks.find((k) => k.x === x);
    if (!d) return 0;
    const home = d.cages.filter((c) => c.state === 'home');
    return home.length ? home.reduce((a, c) => a + this.fillOf(c), 0) / d.cages.length : 0;
  }

  /** One beat: each worker finishes a step or starts the next job. Day and night alike. */
  beat(b: number, day: boolean): void {
    this.now = b;
    // Now and then by day, a Mexican wave runs along the docks, west to east, half a beat apart.
    if (day && !this.runs && b % 64 === 32 && Math.random() < 0.35) this.startWave(b + 1);
    for (const [i, d] of this.docks.entries()) {
      const run = this.runs?.[i];
      if (run) {
        // A shift of the planning game: the people the plan has here, and nobody else.
        this.leaveWithTruck(d);
        this.show(d, run);
        if (run.people >= 1) this.tick(d.worker, d, b, false, () => this.plan(d));
        if (run.people === 2) this.tick(d.loader, d, b, false, () => void (this.planLoad(d, d.loader) || this.plan(d, d.loader)));
        continue;
      }
      // After a cleardown the loader stretches (once the truck has gone and nothing waits).
      const clearing = this.handlers.truck.clearing?.(d.x) === true;
      if (d.wasClearing && !clearing) d.stretchDue = true;
      d.wasClearing = clearing;
      if (d.stretchDue && !d.loader.step && !d.loader.steps.length && !ANTICS.busy(d.loader)) {
        d.stretchDue = false;
        ANTICS.play(d.loader, 'stretch', b);
        // (Standing still while it lasts.)
        d.loader.steps.push({ beats: 4, to: d.loader.root.position.clone().setY(0), pose: 'walk' });
      }
      this.leaveWithTruck(d);
      this.tick(d.worker, d, b, day, () => this.plan(d));
      this.tick(d.loader, d, b, day, () => this.planLoad(d, d.loader));
    }
    for (const h of this.runs ? [] : this.helpers) {
      this.tick(h.w, h.w.job ?? h.pair[0]!, b, day, () => {
        // A door in cleardown first, then whichever has work.
        const order = [...h.pair].sort((a, c) => Number(this.handlers.truck.clearing?.(c.x) === true) - Number(this.handlers.truck.clearing?.(a.x) === true));
        for (const d of order) {
          if (this.planLoad(d, h.w)) {
            h.w.job = d;
            return;
          }
        }
      });
    }
  }

  /** Cages in the trailer leave with it once the door is down. */
  private leaveWithTruck(d: Dock): void {
    if (!d.inTrailer.length || this.handlers.truck.atDoor?.(d.x) !== false) return;
    for (const c of d.inTrailer) {
      for (const p of c.items) p.dead = true;
      c.g.visible = false;
      d.spares.push(c.g);
    }
    d.inTrailer.length = 0;
  }

  /** One beat of one worker: finish the step, plan the next job (or go for a chat), start the next step. */
  private tick(w: Worker, d: Dock, b: number, day: boolean, plan: () => void): void {
    if (w.step && b >= w.t0 + w.step.beats) {
      const st = w.step;
      w.step = null;
      if (st.cage) {
        st.cage.c.g.position.copy(st.cage.to);
        if (st.cage.ry !== undefined) st.cage.c.g.rotation.y = st.cage.ry;
      }
      w.root.position.copy(st.to).setY(0);
      st.done?.();
    }
    if (!w.step && !w.steps.length) {
      plan();
      // (The job may be at the other door of a helper's pair.)
      const jd = w.job ?? d;
      // Back from a chat inside the loop to work: first out between the belts to the cages.
      if (w.steps.length && w.root.position.z > INSIDE_Z) {
        const x = this.walkX(jd);
        const out = this.wayOut(jd).reverse();
        w.steps.unshift({ beats: 1, to: v(x, 0, CHAT_Z - 1.4), pose: 'walk' }, ...out.map((to) => ({ beats: 1, to, pose: 'walk' as const })));
      }
      // Nothing to load (by day): over to the others for a chat, inside the loop.
      if (day && !w.steps.length && w.chat && w.root.position.distanceTo(w.chat) > 0.3) {
        const x = this.walkX(jd);
        if (w.root.position.z < INSIDE_Z) w.steps.push(...this.wayOut(jd).map((to) => ({ beats: 1, to, pose: 'walk' as const, idle: true })), { beats: 1, to: v(x, 0, CHAT_Z - 1.4), pose: 'walk', idle: true });
        w.steps.push({ beats: 1, to: w.chat, face: w.chatMid, pose: 'walk', idle: true });
      }
    }
    if (!w.step && w.steps.length) {
      w.step = w.steps.shift()!;
      // (A shift: the cage runs are brisker, see `Run`.)
      if (this.runs && w.step.beats >= 2) w.step.beats = Math.max(1, Math.round(w.step.beats * RUN_PACE));
      // Walking takes as long as the distance needs (about 1.6 m a beat).
      if (w.step.pose === 'walk') w.step.beats = Math.max(w.step.beats, Math.ceil(w.root.position.distanceTo(w.step.to) / (this.runs ? RUN_WALK : 1.6)));
      w.t0 = b;
      w.from.copy(w.root.position).setY(0);
      if (w.step.cage) {
        w.cageFrom.copy(w.step.cage.c.g.position);
        w.cageRyFrom = w.step.cage.c.g.rotation.y;
      }
      // Once in a while a loader nearly trips over something on a longer walk.
      if (day && w !== d.worker && w.step.pose === 'walk' && w.step.beats >= 3 && Math.random() < 0.015) ANTICS.play(w, 'windmill', b + 1);
    }
  }

  /**
   * The loader's next job: at cleardown, every cage with parcels goes into the truck;
   * otherwise full ones do. Each is replaced at once by an empty one from the stack.
   */
  private planLoad(d: Dock, w: Worker, onlyClear = false): boolean {
    const T = this.handlers.truck;
    const run = this.runs?.[this.docks.indexOf(d)];
    const clearing = run ? run.clearing : T.clearing?.(d.x) === true;
    if (onlyClear && !clearing) return false;
    // A truck at the door with room for another cage.
    const truck = (T.open(d.x) || clearing) && !!T.slot?.(d.x);
    const door = v(d.x, 0, WALL_Z - 1.4);
    // A truck at the door: first the cages that waited for it.
    const st = d.staged.find((x) => !x.moving);
    if (truck && st) {
      this.loadStaged(d, st, door, w);
      return true;
    }
    const home = d.cages.filter((c) => c.state === 'home');
    if (onlyClear) {
      const c = truck ? home.find((x) => x.n > 0) : undefined;
      if (c) this.pushJob(d, c, door, v(d.x, 0, c.at.z), w);
      return !!c;
    }
    // After a cleardown: empty cages from the stack into every free place first.
    const gone = d.cages.find((c) => c.state === 'gone');
    if (gone && !clearing) {
      gone.state = 'moving';
      gone.g.position.set(d.x + STOCK_DX, 0, STOCK_Z);
      gone.g.rotation.y = 0;
      gone.g.visible = true;
      this.fetchEmpty(d, gone, v(d.x, 0, gone.at.z), w);
      return true;
    }
    const full = home.find((x) => this.isFull(x));
    if (truck) {
      // At cleardown every cage with parcels goes; otherwise full ones.
      const c = clearing ? home.find((x) => x.n > 0) : full;
      if (c) this.pushJob(d, c, door, v(d.x, 0, c.at.z), w);
      return !!c;
    }
    if (clearing) return false;
    // No truck: a full cage is still taken away at once, to wait by the door, and replaced.
    const spot = STAGE_AT.findIndex((_, i) => !d.staged.some((x) => x.spot === i));
    if (full && spot >= 0 && d.spares.length) {
      this.stageJob(d, full, spot, w);
      return true;
    }
    return false;
  }

  /** Push a full cage to a waiting place by the door, and an empty one (from the stack) into its place. */
  private stageJob(d: Dock, c: Cage, spot: number, w: Worker): void {
    const [sx, sz] = STAGE_AT[spot]!;
    const to = v(d.x + sx, 0, sz);
    const aisle = v(d.x, 0, c.at.z);
    const back = (a: V3, from: V3) => a.clone().addScaledVector(this.t.subVectors(a, from).setY(0).normalize(), -0.9);
    c.state = 'moving';
    const turn = v(d.x, 0, sz + 1.0);
    w.steps.push({ beats: 2, to: back(c.at, aisle), face: c.at, pose: 'walk' });
    w.steps.push({ beats: 2, to: back(aisle, c.at), face: aisle, pose: 'push', cage: { c, to: aisle } });
    w.steps.push({ beats: Math.max(2, Math.round(aisle.distanceTo(turn) / 2.5)), to: back(turn, aisle), face: turn, pose: 'push', cage: { c, to: turn } });
    w.steps.push({
      beats: 2,
      to: back(to, turn),
      face: to,
      pose: 'push',
      cage: { c, to },
      done: () => {
        // The full cage (frame and parcels) stays here; the place by the belt gets a spare frame.
        d.staged.push({ g: c.g, items: c.items, vol: c.vol, kg: c.kg, spot, moving: false });
        const g = d.spares.pop()!;
        g.position.set(d.x + STOCK_DX, 0, STOCK_Z);
        g.rotation.y = 0;
        g.visible = true;
        c.g = g;
        c.items = [];
        c.n = 0;
        c.vol = 0;
        c.kg = 0;
      },
    });
    this.fetchEmpty(d, c, aisle, w);
  }

  /** A truck is back: push a cage that waited by the door into it. */
  private loadStaged(d: Dock, st: Staged, door: V3, w: Worker): void {
    const T = this.handlers.truck;
    st.moving = true;
    const slot = T.slot?.(d.x) ?? door;
    T.reserve(d.x, 1);
    const tmp: Cage = { at: st.g.position.clone(), range: [0, 0], n: 0, vol: 0, kg: 0, g: st.g, pile: [], items: [], state: 'moving', ry: 0 };
    const mid = v(d.x, 0, st.g.position.z);
    const back = (a: V3, from: V3) => a.clone().addScaledVector(this.t.subVectors(a, from).setY(0).normalize(), -0.9);
    w.steps.push({ beats: 2, to: back(tmp.at, mid), face: tmp.at, pose: 'walk' });
    w.steps.push({ beats: 2, to: back(mid, tmp.at), face: mid, pose: 'push', cage: { c: tmp, to: mid } });
    const row = v(d.x, 0, slot.z);
    w.steps.push({ beats: 2, to: back(door, mid), face: door, pose: 'push', cage: { c: tmp, to: door, ry: 0 } });
    w.steps.push({ beats: Math.max(2, Math.round(door.distanceTo(row) / 2.5)), to: back(row, door), face: row, pose: 'push', cage: { c: tmp, to: row } });
    w.steps.push({
      beats: 1,
      to: back(slot, row),
      face: slot,
      pose: 'push',
      cage: { c: tmp, to: slot },
      done: () => {
        T.load(d.x, st.vol, st.kg);
        // It stays in sight in the trailer, with its parcels, until the door comes down.
        d.inTrailer.push({ g: st.g, items: st.items });
        d.staged.splice(d.staged.indexOf(st), 1);
        T.reserve(d.x, -1);
      },
    });
    w.steps.push({ beats: 3, to: door.clone().setZ(WALL_Z + 0.8), face: v(d.x, 0, DOCK_BELT_END), pose: 'walk' });
    w.steps.push({ beats: 2, to: w.home, face: v(d.x, 0, DOCK_BELT_END), pose: 'walk' });
  }

  /** From the stack of empties: pull one out and push it along the aisle into the cage's place. */
  private fetchEmpty(d: Dock, c: Cage, aisle: V3, w: Worker): void {
    const stock = v(d.x + STOCK_DX, 0, STOCK_Z);
    const out = v(d.x, 0, STOCK_Z + 0.2);
    const back = (a: V3, from: V3) => a.clone().addScaledVector(this.t.subVectors(a, from).setY(0).normalize(), -0.9);
    w.steps.push({ beats: 2, to: v(stock.x + 0.9, 0, stock.z), face: stock, pose: 'walk' });
    w.steps.push({ beats: 1, to: v(out.x + 0.9, 0, out.z), face: out, pose: 'push', cage: { c, to: out } });
    w.steps.push({ beats: Math.max(2, Math.round(out.distanceTo(aisle) / 2.5)), to: back(aisle, out), face: aisle, pose: 'push', cage: { c, to: aisle } });
    w.steps.push({
      beats: 2,
      to: back(c.at, aisle),
      face: c.at,
      pose: 'push',
      cage: { c, to: c.at, ry: c.ry },
      done: () => {
        c.state = 'home';
        c.g.rotation.y = c.ry;
      },
    });
    w.steps.push({ beats: 2, to: w.home, face: v(d.x, 0, DOCK_BELT_END), pose: 'walk' });
  }

  /** The picker's next job: a parcel off the belt into its cage (one of the first three it can place). */
  private plan(d: Dock, w: Worker = d.worker): void {
    const run = this.runs?.[this.docks.indexOf(d)];
    // Where this one stands to take parcels off the belt (during a shift the loader picks too, beside the picker).
    const at = w === d.worker ? w.home : v(d.x + SECOND_AT[0], 0, DOCK_BELT_END + SECOND_AT[1]);
    if (run) {
      // A shift: alone, the cages are this one's job too; and at the end of the block everyone pushes.
      if ((run.people === 1 || run.clearing) && this.planLoad(d, w)) return;
    } else if (this.planLoad(d, w, true)) return;
    // (Otherwise: at cleardown the picker helps to push the cages into the trailer, with nothing in hand.)
    // Back to the belt end first (after helping at a cleardown).
    if (w.root.position.distanceTo(at) > (run ? 2.6 : 0.6)) {
      w.steps.push({ beats: 2, to: at, face: v(d.x, 0, DOCK_BELT_END + 0.35), pose: 'walk' });
      return;
    }
    // During a shift nobody loads more than the timeline has loaded by now.
    if (run && run.taken >= run.allow) {
      if (w.root.position.distanceTo(at) > 0.3) w.steps.push({ beats: 1, to: at, face: v(d.x, 0, DOCK_BELT_END + 0.35), pose: 'walk' });
      return;
    }
    const first = d.queue[0];
    // Not for any cage here (sent to the wrong dock): into the return tote beside the belt.
    if (first && this.cageIndex(d, first.pc) < 0) {
      const p = first;
      d.queue.shift();
      w.parcel = p;
      w.cage = -1;
      w.pickFrom.copy(p.pos);
      const tote = v(d.x + 0.9, 0, DOCK_BELT_END - 0.4);
      w.steps.push(
        { beats: 1, to: w.home, face: v(d.x, 0, DOCK_BELT_END + 0.35), pose: 'pick' },
        { beats: 1, to: w.home, face: tote, pose: 'carry' },
        {
          beats: 1,
          to: w.home,
          face: tote,
          pose: 'drop',
          done: () => {
            w.parcel = null;
            this.handlers.missort(p);
            // Not again...
            ANTICS.play(w, 'facepalm', this.now);
            w.steps.push({ beats: 4, to: w.home, face: v(d.x, 0, DOCK_BELT_END + 0.35), pose: 'walk' });
          },
        },
      );
      return;
    }
    // The first of the three front parcels whose cage is by the belt and has room.
    let qi = -1;
    let ci = -1;
    for (let i = 0; i < Math.min(3, d.queue.length) && qi < 0; i++) {
      const c = this.pickCage(d, d.queue[i]!);
      if (c >= 0) {
        qi = i;
        ci = c;
      }
    }
    if (qi < 0) return;
    const p = d.queue.splice(qi, 1)[0]!;
    if (run) run.taken++;
    // A parcel: pick it off the belt (the projector shows its postcode), walk to its cage, put it in, step back.
    w.parcel = p;
    w.pickFrom.copy(p.pos);
    w.cage = ci;
    const c = d.cages[ci]!;
    const belt = v(d.x, 0, DOCK_BELT_END + 0.35);
    // In front of the cage's open side, square to it, so the parcel goes straight in.
    const near = c.at.clone().addScaledVector(v(Math.sin(c.ry), 0, Math.cos(c.ry)), 1.15).setY(0);
    const fragile = !!p.tags?.includes('fragile');
    if (run) {
      // A shift: off the belt, over to the cage and in, two beats a parcel; the step back to
      // the belt is part of reaching for the next one.
      w.steps.push(
        { beats: 1, to: at, face: belt, pose: 'pick' },
        {
          beats: 1,
          to: near,
          face: c.at,
          pose: 'drop',
          done: () => {
            this.put(d, ci, p);
            w.parcel = null;
          },
        },
      );
      return;
    }
    if (this.docks.indexOf(d) === THROW_DOCK) {
      if (!fragile) {
        // This one does not walk: he throws it in from where he stands.
        w.steps.push(
          { beats: 1, to: w.home, face: belt, pose: 'pick' },
          {
            beats: 1,
            to: w.home,
            face: c.at,
            pose: 'throw',
            done: () => {
              this.put(d, ci, p);
              w.parcel = null;
            },
          },
        );
        return;
      }
      // Except a fragile one: that he carries over on tiptoe, very slowly, and puts down ever so gently.
      w.steps.push(
        { beats: 1, to: w.home, face: belt, pose: 'pick' },
        { beats: 3, to: near, face: c.at, pose: 'carry', careful: true },
        {
          beats: 2,
          to: near,
          face: c.at,
          pose: 'drop',
          careful: true,
          done: () => {
            this.put(d, ci, p);
            w.parcel = null;
          },
        },
        { beats: 2, to: w.home, face: belt, pose: 'walk' },
      );
      return;
    }
    w.steps.push(
      { beats: 1, to: w.home, face: belt, pose: 'pick' },
      { beats: 1, to: near, face: c.at, pose: 'carry' },
      {
        beats: 1,
        to: near,
        face: c.at,
        pose: 'drop',
        done: () => {
          this.put(d, ci, p);
          w.parcel = null;
        },
      },
      { beats: 1, to: w.home, face: belt, pose: 'walk' },
    );
  }

  /**
   * The loader: walk to the cage, pull it into the aisle, push it through the door into the
   * trailer, then take an empty cage from the stack by the door and push it into its place.
   */
  private pushJob(d: Dock, c: Cage, door: V3, aisle: V3, w: Worker): void {
    const T = this.handlers.truck;
    c.state = 'moving';
    // (Its place in the trailer is taken before it is reserved: the next one gets the next place.)
    const slot = T.slot?.(d.x) ?? door;
    T.reserve(d.x, 1);
    const back = (to: V3, from: V3) => to.clone().addScaledVector(this.t.subVectors(to, from).setY(0).normalize(), -0.9);
    const turn = c.at.distanceTo(aisle) > 0.5;
    w.steps.push({ beats: 2, to: back(c.at, turn ? aisle : door), face: c.at, pose: 'walk' });
    if (turn) w.steps.push({ beats: 2, to: back(aisle, c.at), face: aisle, pose: 'push', cage: { c, to: aisle } });
    // Into the trailer: straight in to the row of its place, then across into the place.
    const row = v(d.x, 0, slot.z);
    // (Turned square on the way to the door: in the trailer the open side faces the hall.)
    w.steps.push({ beats: Math.max(2, Math.round(door.distanceTo(aisle) / 2.5)), to: back(door, aisle), face: door, pose: 'push', cage: { c, to: door, ry: 0 } });
    w.steps.push({ beats: Math.max(2, Math.round(door.distanceTo(row) / 2.5)), to: back(row, door), face: row, pose: 'push', cage: { c, to: row } });
    w.steps.push({
      beats: 1,
      to: back(slot, row),
      face: slot,
      pose: 'push',
      cage: { c, to: slot },
      done: () => {
        T.load(d.x, c.vol, c.kg);
        // The cage stays in the trailer with its parcels, in sight until the door comes down
        // (then they leave with the truck); a spare frame from the stack takes its place here.
        const g = d.spares.pop();
        if (g) {
          d.inTrailer.push({ g: c.g, items: c.items });
          g.position.set(d.x + STOCK_DX, 0, STOCK_Z);
          g.rotation.y = 0;
          c.g = g;
        } else for (const p of c.items) p.dead = true;
        c.items = [];
        c.n = 0;
        c.vol = 0;
        c.kg = 0;
        c.state = 'gone';
        c.g.visible = false;
        T.reserve(d.x, -1);
      },
    });
    // During a cleardown: straight back for the next cage (the empties come with the next truck).
    if (this.runs ? this.runs[this.docks.indexOf(d)]!.clearing : T.clearing?.(d.x)) {
      w.steps.push({ beats: 3, to: door.clone().setZ(WALL_Z + 0.8), face: v(d.x, 0, DOCK_BELT_END), pose: 'walk' });
      return;
    }
    // Out of the trailer, then an empty one from the stack into the free place.
    w.steps.push({
      beats: 3,
      to: door.clone().setZ(WALL_Z + 0.8),
      face: v(d.x, 0, DOCK_BELT_END),
      pose: 'walk',
      done: () => {
        c.state = 'moving';
        c.g.position.set(d.x + STOCK_DX, 0, STOCK_Z);
        c.g.rotation.y = 0;
        c.g.visible = true;
      },
    });
    this.fetchEmpty(d, c, aisle, w);
  }

  update(dt: number, bt: number, s: { kick: number; snare: number; dayShown: boolean; dance?: boolean; bpm?: number }): void {
    // The Mexican wave: each one goes up on their beat (not with a parcel in the hands).
    for (let i = this.waveQueue.length - 1; i >= 0; i--) {
      const q = this.waveQueue[i]!;
      if (bt < q.at) continue;
      this.waveQueue.splice(i, 1);
      if (!q.w.parcel && !q.w.step?.cage) ANTICS.play(q.w, 'waveUp', q.at);
    }
    // When the music turns to acid techno, someone plays air guitar (and again every 32 bars while it lasts).
    const bpm = s.bpm ?? 0;
    if (bpm > 136 && (this.lastBpm <= 136 || bt >= this.nextGuitar)) {
      const idle = [...this.docks.flatMap((d) => [d.worker, d.loader]), ...this.helpers.map((h) => h.w)].filter((w) => !w.parcel && !w.step?.cage && !ANTICS.busy(w));
      const w = idle[Math.floor(Math.random() * idle.length)];
      if (w) ANTICS.play(w, 'airguitar', Math.ceil(bt));
      this.nextGuitar = bt + 128;
    }
    this.lastBpm = bpm;
    if (s.dayShown !== this.boardsDay) {
      this.boardsDay = s.dayShown;
      for (const m of boardMats) m.color.setScalar(s.dayShown ? 1 : 0.22);
      this.boards.dim(s.dayShown ? 1 : 0.3);
    }
    const ph = bt - Math.floor(bt);
    for (const d of this.docks) {
      // Parcels waiting at the belt end.
      // Parcels banked up at the belt end, nose to tail.
      let at = QUEUE_FRONT;
      for (const p of d.queue) {
        this.t.set(d.x, 1.02, DOCK_BELT_END + at + p.d / 2);
        at += p.d + 0.06;
        p.pos.lerp(this.t, Math.min(1, dt * 8));
      }
      this.animateWorker(d, d.worker, dt, bt, ph, s);
      this.animateWorker(d, d.loader, dt, bt, ph, s);
    }
    for (const h of this.helpers) this.animateWorker(h.w.job ?? h.pair[0]!, h.w, dt, bt, ph, s);
    // Cage cards hang on the outside of the mesh, on the side facing the worker and on the back.
    this.docks.forEach((d, n) =>
      d.cages.forEach((c, i) => {
        c.g.updateMatrix();
        for (const side of [0, 1]) {
          if (c.state === 'gone' || !c.g.visible) this.m.makeScale(0, 0, 0);
          // On the cage's two closed sides (left and right of the loading side).
          else this.m.makeRotationY(side ? -Math.PI / 2 : Math.PI / 2).setPosition(side ? -0.705 : 0.705, 1.15, 0).premultiply(c.g.matrix);
          this.boards.place((n * CAGES + i) * 2 + side, this.m);
        }
      }),
    );
    this.boards.flush();
  }

  /** The cage for this parcel's postcode, if it is by the belt and not full (−1 if not). */
  private pickCage(d: Dock, p: DockParcel): number {
    const i = this.cageIndex(d, p.pc);
    const c = d.cages[i];
    return c && c.state === 'home' && !this.isFull(c) ? i : -1;
  }

  /** Full by volume (or out of places to stack). */
  private isFull(c: Cage): boolean {
    if (this.runs) return c.n >= this.runCap;
    return c.n >= CAGE_FULL || c.vol >= CAGE_M3;
  }

  /** How full each cage is (0–1), for the boards and screens. */
  fillOf(c: Cage): number {
    return Math.min(1, Math.max(c.vol / CAGE_M3, c.n / CAGE_FULL));
  }

  private writePile(c: Cage): void {
    c.pile.forEach((p, k) => (p.visible = k < c.n));
  }

  /** Where the next parcel goes in this cage (world). */
  private cageTop(c: Cage): V3 {
    c.g.updateMatrixWorld();
    const p = this.runs ? runSlot(c.n, new THREE.Vector3()) : cageSlot(c.n, new THREE.Vector3());
    return p.setY(p.y + 0.3).applyMatrix4(c.g.matrixWorld);
  }

  private put(d: Dock, cage: number, p: DockParcel): void {
    const c = d.cages[cage]!;
    if (this.runs) {
      // During a shift: the plan's small cartons, closer together (see `runSlot`).
      this.handlers.hold(p, c.g, runSlot(c.n, new THREE.Vector3()));
      c.items.push(p);
      c.n++;
      this.handlers.shipped(d.chute);
      return;
    }
    // The parcel itself stays in the cage (same shape and colour), stacked, and rides along with it.
    this.handlers.hold(p, c.g, cageSlot(c.n, new THREE.Vector3()));
    c.items.push(p);
    c.n = Math.min(CAGE_FULL, c.n + 1);
    c.vol += p.w * p.h * p.d;
    c.kg += p.kg;
    this.handlers.shipped(d.chute);
  }

  private animateWorker(d: Dock, w: Worker, dt: number, bt: number, ph: number, s: { kick: number; snare: number; dayShown: boolean; dance?: boolean }): void {
    const k = Math.min(1, dt * 12);
    const st = w.step;
    let pos: V3 = w.root.position.clone().setY(0);
    let face = w.yaw;
    let bend = 0;
    let armF = 0.1;
    let armUpL = 0;
    let armUpR = 0;
    let bounce = 0;
    /** Metres per step (one step per beat) while walking; and how deep to crouch. */
    let speed = 0;
    let squat = 0;
    let dance = false;
    /** The headphone picker's little dance when idle (stepping on the spot). */
    let groove = false;
    let chat = false;
    w.m.talk = 0;
    let headTurn = 0;
    let nod = 0;
    let armR2: number | null = null;
    let foreL = -0.12;
    let foreR = -0.12;
    let hipR = 0;
    if (st) {
      const f = Math.min(1, Math.max(0, (bt - w.t0) / st.beats));
      const e = ease(f);
      pos = w.from.clone().lerp(st.to, e);
      if (st.face) face = Math.atan2(st.face.x - pos.x, st.face.z - pos.z);
      const moving = w.from.distanceTo(st.to) > 0.2;
      // Walking (or carrying) more than a metre: face the way you go, and turn to what the step
      // looks at only on its last metre. (A step without its own target kept the last way the
      // worker faced: back from a chat in the loop they walked to the cages backwards.)
      if (!st.cage && (st.pose === 'walk' || st.pose === 'carry') && w.from.distanceTo(st.to) > 1 && f < 1 && (!st.face || pos.distanceTo(st.to) > 0.8)) {
        face = Math.atan2(st.to.x - w.from.x, st.to.z - w.from.z);
      }
      if (moving && f < 1) speed = w.from.distanceTo(st.to) / st.beats;
      if (st.cage) {
        st.cage.c.g.position.lerpVectors(w.cageFrom, st.cage.to, e);
        if (st.cage.ry !== undefined) {
          let dr = st.cage.ry - w.cageRyFrom;
          while (dr > Math.PI) dr -= 2 * Math.PI;
          while (dr < -Math.PI) dr += 2 * Math.PI;
          st.cage.c.g.rotation.y = w.cageRyFrom + dr * e;
        }
        // Push from behind: face the way the cage goes.
        this.t.subVectors(st.cage.to, w.cageFrom);
        if (this.t.lengthSq() > 0.01) face = Math.atan2(this.t.x, this.t.z);
      }
      // Picking up and putting down: bend the knees as well as the back.
      if (st.pose === 'pick') {
        bend = 0.4 * Math.sin(f * Math.PI);
        squat = 0.45 * Math.sin(f * Math.PI);
        armF = 0.1 + 1.3 * f;
      } else if (st.pose === 'carry') armF = 1.4;
      else if (st.pose === 'drop') {
        bend = 0.35 * Math.sin(f * Math.PI);
        squat = 0.35 * Math.sin(f * Math.PI);
        armF = 1.4 - 1.2 * f;
      } else if (st.pose === 'push') {
        armF = 1.5;
        bend = 0.3;
        squat = 0.12;
      } else if (st.pose === 'throw') {
        // Swing back, then a big underarm throw up and over into the cage.
        armF = f < 0.35 ? 1.2 - 2.0 * ease(f / 0.35) : -0.8 + 3.2 * ease(Math.min(1, (f - 0.35) / 0.3));
        bend = f < 0.35 ? 0.3 * ease(f / 0.35) : 0.3 - 0.45 * ease(Math.min(1, (f - 0.35) / 0.3));
        bounce = f > 0.35 && f < 0.7 ? 0.05 * Math.sin(((f - 0.35) / 0.35) * Math.PI) : 0;
      }
      if (st.careful) {
        // On tiptoe, arms out in front, eyes on the parcel (slow, short steps).
        bounce = 0.07;
        if (moving) speed = Math.min(speed, 0.3);
        armF = st.pose === 'drop' ? 1.5 - 0.9 * ease(f) : 1.55;
        bend = st.pose === 'drop' ? 0.25 + 0.35 * Math.sin(f * Math.PI) : 0.18;
        nod = 0.45;
      }
      // The parcel follows the hands.
      if (w.parcel && st.pose === 'throw') {
        const hands = this.hands.set(Math.sin(w.yaw) * 0.55, 0.95, Math.cos(w.yaw) * 0.55).add(w.root.position).setY(0.95);
        if (f < 0.5) w.parcel.pos.copy(hands).setY(0.95 - 0.35 * Math.sin((f / 0.5) * Math.PI));
        else {
          // A high arc into the cage, tumbling as it goes.
          const top = this.cageTop(d.cages[w.cage]!);
          const u = ease((f - 0.5) / 0.5);
          w.parcel.pos.lerpVectors(hands, top, u);
          w.parcel.pos.y += Math.sin(u * Math.PI) * 1.1;
          this.q.setFromAxisAngle(this.t2.set(Math.cos(w.yaw), 0, -Math.sin(w.yaw)), u * Math.PI * 2);
          w.parcel.q.copy(this.q);
        }
      } else if (w.parcel && (st.pose === 'pick' || st.pose === 'carry' || st.pose === 'drop')) {
        // (Its own vector: cageTop below uses this.t.)
        // Held in front at waist height, the hands on its sides (the parcel's base is lower by half its height).
        const hands = this.hands.set(Math.sin(w.yaw) * 0.4, 0, Math.cos(w.yaw) * 0.4).add(w.root.position).setY(1.02 - w.parcel.h / 2);
        if (st.pose === 'pick') w.parcel.pos.lerpVectors(w.pickFrom, hands, ease(ph));
        else if (st.pose === 'drop') {
          if (w.cage < 0) w.parcel.pos.lerpVectors(hands, v(d.x + 0.9, 0.5, DOCK_BELT_END - 0.4), ease(ph));
          else {
            // Straight in through the open top half of the front, then down onto the pile.
            const top = this.cageTop(d.cages[w.cage]!);
            const enter = this.t2.copy(top).setY(Math.max(top.y, 1.3));
            const u = ease(ph);
            if (u < 0.6) w.parcel.pos.lerpVectors(hands, enter, u / 0.6);
            else w.parcel.pos.lerpVectors(enter, top, (u - 0.6) / 0.4);
          }
        }
        else w.parcel.pos.copy(hands);
        this.q.setFromAxisAngle(UP, w.yaw);
        w.parcel.q.copy(this.q);
      }
    } else if (!s.dayShown && s.dance !== false) {
      // Nothing to do at night: dance. Bounce on the kick, arms up in turns.
      dance = true;
      const beat = Math.floor(bt);
      face = w.yaw + Math.sin(bt * Math.PI * 0.5) * 0.04;
      // Down in the knees on the kick, a step from side to side.
      bounce = 0.04 * s.kick;
      squat = 0.3 * s.kick;
      armUpL = beat % 2 ? 2.6 : 0.6 + s.snare;
      armUpR = beat % 2 ? 0.6 + s.snare : 2.6;
      bend = -0.15 * s.snare;
      speed = 0.35;
    } else if (w.chat && w.chatMid && w.mates && w.root.position.distanceTo(w.chat) < 0.4) {
      chat = true;
      // Who is talking: it changes every few beats (not on a fixed count), per group.
      const n = w.mates.length;
      const turn = Math.floor(bt / 3.3 + Math.sin(bt * 0.37 + (w.group ?? 0)) * 0.8);
      const speaker = ((Math.imul(turn, 2654435761) + (w.group ?? 0) * 97) >>> 5) % n;
      const me = w.mates.indexOf(w.chat);
      const talking = speaker === me;
      w.m.talk = talking ? 1 : 0;
      const t = bt * w.rate + w.phase;
      // Face the middle of the group, turned a little towards whoever talks.
      const who = w.mates[speaker]!;
      face = Math.atan2(w.chatMid.x - pos.x, w.chatMid.z - pos.z);
      const toWho = Math.atan2(who.x - pos.x, who.z - pos.z);
      let dh = toWho - face;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      headTurn = talking ? Math.sin(t * 0.7) * 0.35 : clamp(dh, -0.7, 0.7);
      // (Weight from one leg to the other: `settle` does that at each one's own pace.)
      if (talking) {
        // Talking with the hands, each at its own speed.
        armF = 0.35 + 0.2 * Math.sin(t * 1.3);
        armR2 = 0.45 + 0.25 * Math.sin(t * 1.7 + 1.1);
        foreL = -0.9 - 0.5 * Math.max(0, Math.sin(t * 2.1));
        foreR = -1.0 - 0.6 * Math.max(0, Math.sin(t * 1.6 + 0.7));
        nod = 0.08 * Math.sin(t * 2.3);
        bend = 0.04;
      } else {
        // Listening in its own way: hands at the sides, clasped in front, or a hand on the hip.
        nod = Math.max(0, Math.sin(t * 0.9)) ** 8 * 0.25;
        if (w.style === 1) {
          armF = 0.28;
          armR2 = 0.28;
          foreL = foreR = -1.25;
        } else if (w.style === 2) {
          hipR = 0.55;
          armR2 = -0.1;
          foreR = -1.7;
        }
        bend = 0.03 * Math.sin(t * 0.5);
      }
    } else bend = 0.04 * Math.sin(bt * Math.PI * 0.5);
    if (w.dancer && s.dayShown && !dance && (w.caughtUntil ?? -1) < bt) {
      // Headphones on: nodding along on the beat while working, and a little dance when there is nothing to do.
      nod += 0.18 * Math.abs(Math.sin(bt * Math.PI));
      headTurn += Math.sin(bt * Math.PI) * 0.12;
      if (!st) {
        bounce = 0.05 * Math.abs(Math.sin(bt * Math.PI));
        armF = 0.6 + 0.25 * Math.sin(bt * Math.PI);
        armR2 = 0.6 - 0.25 * Math.sin(bt * Math.PI);
        foreL = foreR = -1.5;
        chat = true;
        // A little step on the spot, on the beat.
        groove = true;
        face = w.yaw + Math.sin(bt * Math.PI * 0.25) * 0.05;
      }
    }
    w.root.position.lerp(this.t.copy(pos).setY(bounce), st && !st.careful ? 1 : k);
    let dy = face - w.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    w.yaw += dy * (dance ? 0.08 : k);
    w.root.rotation.y = w.yaw;
    w.torso.rotation.x += (bend - w.torso.rotation.x) * k;
    w.head.rotation.y += (headTurn - w.head.rotation.y) * k * 0.4;
    w.head.rotation.x += (nod - w.head.rotation.x) * k * 0.6;
    // Legs and pelvis: one step per beat (each worker a little out of phase), knees down when crouching.
    const swing = gait(w, dt, Math.PI * bt + w.phase, groove ? 0.2 : speed, dance || groove);
    crouch(w, squat);
    // Arms: the hands on the parcel's sides, or on the cage's push bar; otherwise posed as above.
    const holding = st && w.parcel && (st.pose === 'pick' || st.pose === 'carry' || st.pose === 'drop');
    const pushing = st?.pose === 'push';
    if (holding || pushing) {
      const c = this.t3;
      const right = this.t4.set(Math.cos(w.yaw), 0, -Math.sin(w.yaw));
      let half: number;
      if (holding) {
        c.copy(w.parcel!.pos).setY(w.parcel!.pos.y + w.parcel!.h / 2);
        half = w.parcel!.w / 2 + 0.01;
      } else {
        c.set(Math.sin(w.yaw) * 0.45, 0, Math.cos(w.yaw) * 0.45).add(w.root.position).setY(1.02);
        half = 0.24;
      }
      const kk = Math.min(1, dt * 14);
      reach(w, 'L', this.t5.copy(c).addScaledVector(right, -half), kk, holding ? 1 : 0);
      reach(w, 'R', this.t5.copy(c).addScaledVector(right, half), kk, holding ? 1 : 0);
    } else {
      const armL = dance ? -armUpL : -armF + (st ? 0.42 * swing : 0);
      const armR = dance ? -armUpR : -(armR2 ?? armF) - (st ? 0.42 * swing : 0);
      w.armL.rotation.x += (armL - w.armL.rotation.x) * k;
      w.armR.rotation.x += (armR - w.armR.rotation.x) * k;
      // Elbows: a little bent when hanging, more as the arm swings forward; while chatting as set above.
      const fl = chat ? foreL : dance ? -0.4 : -0.14 - (st ? 0.4 * Math.max(0, -swing) : 0);
      const fr = chat ? foreR : dance ? -0.4 : -0.14 - (st ? 0.4 * Math.max(0, swing) : 0);
      w.foreL.rotation.x += (fl - w.foreL.rotation.x) * k * 0.6;
      w.foreR.rotation.x += (fr - w.foreR.rotation.x) * k * 0.6;
      relaxArms(w, k * 0.6, 0, hipR);
    }
    settle(w, dt, { idle: dance ? 0 : 1 });
  }

  /**
   * The ways the roll cages are pushed, as floor paths (x, z), following the loader's jobs:
   * each full cage pulled out of its place into the aisle and pushed through the door (or to a
   * waiting place by the door and later on), and each empty one pulled off the stack by the
   * door and pushed back into the place. Corners are rounded, as a cage swings round on its
   * castors. Used for the wheel marks of the realistic day.
   */
  cagePaths(): [number, number][][] {
    const out: [number, number][][] = [];
    const door = WALL_Z - 0.6;
    for (const d of this.docks) {
      for (const c of d.cages) {
        const home: [number, number] = [c.at.x, c.at.z];
        const aisle: [number, number] = [d.x, c.at.z];
        // Out of its place and through the door.
        out.push(rounded([home, aisle, [d.x, door]]));
        // An empty one from the stack, back into the place.
        out.push(rounded([[d.x + STOCK_DX, STOCK_Z], [d.x, STOCK_Z + 0.2], aisle, home]));
        // Out of its place to a waiting place by the door (one of them, in turn).
        const [sx, sz] = STAGE_AT[d.cages.indexOf(c) % STAGE_AT.length]!;
        out.push(rounded([home, aisle, [d.x, sz + 1.0], [d.x + sx, sz]]));
      }
      // Waiting cages go on into the truck.
      for (const [sx, sz] of STAGE_AT) out.push(rounded([[d.x + sx, sz], [d.x, sz], [d.x, door]]));
    }
    return out;
  }

  // ---------- building ----------

  private buildDock(x: number, chute: number, number: number, city: number): void {
    const k = this.kit;
    buildDockDoor(k, x, WALL_Z, 1, number);
    // Five roll cages around the belt end: two on each side, one at the end; each takes part of the city.
    // (The belt stops short of them, so the worker can get round to every cage.)
    const E = DOCK_BELT_END;
    // Six: three on each side; the middle stays free as the aisle to the door.
    const cageAt: [V3, number][] = [
      [v(x - 2.0, 0, E - 1.2), Math.PI / 2],
      [v(x - 2.0, 0, E - 2.8), Math.PI / 2],
      [v(x - 2.0, 0, E - 4.4), Math.PI / 2],
      [v(x + 2.0, 0, E - 4.4), -Math.PI / 2],
      [v(x + 2.0, 0, E - 2.8), -Math.PI / 2],
      [v(x + 2.0, 0, E - 1.2), -Math.PI / 2],
    ];
    const ranges = split(NORTH_CITIES[city]!, CAGES);
    const cages: Cage[] = cageAt.map(([at, ry], i) => this.buildCage(at, ry, ranges[i]!));
    const n0 = this.docks.length * CAGES;
    this.cardsFor(n0, city, cages);
    // The return tote for parcels sent here by mistake.
    k.box('tote', k.std(0x1f3f80, 0.6, 0.1, 0x2c62c8), x + 0.9, 0.22, E - 0.4, 0.6, 0.44, 0.42);
    const worker = this.buildWorker(v(x, 0, E - 1.1));
    const loader = this.buildWorker(v(x + 0.9, 0, -33.6), 1);
    // The stack of empty cages by the door, nested into each other.
    this.buildStock(v(x + STOCK_DX, 0, STOCK_Z));
    // Spare frames: for cages waiting by the door, and for those standing in the trailer.
    const spares = Array.from({ length: STAGE_AT.length + TRAILER_CAGES }, () => {
      const g = this.cageFrame(v(x + STOCK_DX, 0, STOCK_Z), 0);
      g.visible = false;
      return g;
    });
    if (this.docks.length === DANCE_DOCK) worker.dancer = true;
    const dock: Dock = { x, chute, city, queue: [], cages, worker, loader, staged: [], spares, wasClearing: false, stretchDue: false, inTrailer: [] };
    worker.job = dock;
    loader.job = dock;
    this.docks.push(dock);
  }

  private readonly cageMeshGeo = (() => {
    const g = new THREE.BoxGeometry(1.36, 1.5, 1.04);
    // Drop the top and bottom faces (groups 2 and 3) and the loading side (+z, group 4): that one
    // is only half closed (below), so the worker can put parcels in from the top half.
    const idx = g.getIndex()!.array;
    const keep: number[] = [];
    for (const grp of g.groups) if (grp.materialIndex !== 2 && grp.materialIndex !== 3 && grp.materialIndex !== 4) for (let i = grp.start; i < grp.start + grp.count; i++) keep.push(idx[i]!);
    g.setIndex(keep);
    g.clearGroups();
    const half = new THREE.PlaneGeometry(1.36, 0.75).translate(0, -0.375, 0.52);
    return mergeGeometries([g.toNonIndexed(), half.toNonIndexed()])!;
  })();
  private meshMat: THREE.MeshStandardMaterial | null = null;
  private cageMeshMat(): THREE.MeshStandardMaterial {
    if (!this.meshMat) {
      const t = wireMesh().clone();
      t.repeat.set(4, 4);
      t.needsUpdate = true;
      this.meshMat = this.kit.std(0x5d6670, 0.5, 0.6, 0x2fa58f);
      this.meshMat.alphaMap = t;
      this.meshMat.alphaTest = 0.5;
      this.meshMat.side = THREE.DoubleSide;
    }
    return this.meshMat;
  }

  /** A coloured card about A4 size on each cage, black print: postcodes, and the cage's number (as the projector shows it) and city. */
  private cardsFor(n0: number, city: number | string, cages: Cage[]): void {
    const name = typeof city === 'string' ? city : NORTH_CITIES[city]!.name;
    cages.forEach((c, i) => {
      const bg = CARD_COLS[i % CARD_COLS.length]!;
      for (const side of [0, 1]) this.boards.set((n0 + i) * 2 + side, rangeText(c.range), `${i + 1} · ${name}`, { bg, fg: '#111111', sub: '#111111', border: '#111111' });
    });
  }

  // ---------- a shift of the planning game (see director.ts) ----------

  /**
   * Everything at the docks back to an empty start: cages empty in their places, nothing
   * waiting by the doors or standing in the trailers, belts' ends clear, everyone at their
   * place with empty hands. (Parcels that were there are gone.)
   */
  private clearAll(): void {
    const drop = (w: Worker) => {
      if (w.parcel) w.parcel.dead = true;
      w.parcel = null;
      w.steps.length = 0;
      w.step = null;
      w.root.position.copy(w.home);
      w.root.visible = true;
    };
    for (const d of this.docks) {
      for (const p of d.queue) p.dead = true;
      d.queue.length = 0;
      for (const c of d.cages) {
        for (const p of c.items) p.dead = true;
        c.items = [];
        c.n = 0;
        c.vol = 0;
        c.kg = 0;
        c.state = 'home';
        c.g.position.copy(c.at);
        c.g.rotation.y = c.ry;
        c.g.visible = true;
        this.writePile(c);
      }
      for (const st of [...d.staged, ...d.inTrailer]) {
        for (const p of st.items) p.dead = true;
        d.spares.push(st.g);
      }
      d.staged.length = 0;
      d.inTrailer.length = 0;
      for (const g of d.spares) g.visible = false;
      d.wasClearing = false;
      d.stretchDue = false;
      drop(d.worker);
      drop(d.loader);
      d.worker.job = d;
      d.loader.job = d;
    }
    for (const h of this.helpers) drop(h.w);
    this.waveQueue.length = 0;
  }

  /**
   * A shift begins (every dock bare: no cages, nobody, until the director opens it) or is
   * over (the free simulation's docks again, empty, with their own cities on the cards).
   * `cap`: parcels in a full cage during the shift.
   */
  setDirected(on: boolean, cap = 22): void {
    if (!on && !this.runs) return;
    this.clearAll();
    this.runCap = clamp(Math.round(cap), 1, RUN_CAGE);
    this.runs = on ? this.docks.map(() => ({ cages: false, people: 0, allow: 0, taken: 0, clearing: false, name: '' })) : null;
    this.docks.forEach((d, n) => {
      if (this.runs) return this.show(d, this.runs[n]!);
      const ranges = split(NORTH_CITIES[d.city]!, CAGES);
      d.cages.forEach((c, i) => (c.range = ranges[i]!));
      this.cardsFor(n * CAGES, d.city, d.cages);
    });
    for (const h of this.helpers) h.w.root.visible = !on;
  }

  /** What is in sight at a directed dock: its cages, its picker, its loader. */
  private show(d: Dock, r: Run): void {
    for (const c of d.cages) c.g.visible = r.cages && c.state !== 'gone';
    d.worker.root.visible = r.people >= 1;
    d.loader.root.visible = r.people === 2;
  }

  /** Someone leaves a directed dock: hands empty, the cage they were pushing back in its place. */
  private sendOff(w: Worker): void {
    if (w.parcel) w.parcel.dead = true;
    w.parcel = null;
    for (const st of [w.step, ...w.steps]) {
      if (!st?.cage) continue;
      const c = st.cage.c;
      c.state = 'home';
      c.g.position.copy(c.at);
      c.g.rotation.y = c.ry;
    }
    w.steps.length = 0;
    w.step = null;
    w.root.position.copy(w.home);
  }

  /**
   * The director sets a dock: cages standing or not, people at work, the city on the cards
   * (with its postcode ranges for the six cages), how many parcels the timeline has loaded
   * here so far in this block (`fresh`: a new block, the count of parcels taken starts again),
   * and whether the block is in its last minutes.
   */
  directDock(i: number, o: { cages: boolean; people: 0 | 1 | 2; name: string; ranges: [number, number][] | null; allow: number; clearing: boolean; fresh: boolean }): void {
    const d = this.docks[i];
    const r = this.runs?.[i];
    if (!d || !r) return;
    if (o.name !== r.name) {
      r.name = o.name;
      d.cages.forEach((c, k) => (c.range = o.ranges?.[k] ?? [k, k]));
      this.cardsFor(i * CAGES, o.name, d.cages);
    }
    if (o.fresh) r.taken = 0;
    if (o.people < 1 && r.people >= 1) this.sendOff(d.worker);
    if (o.people < 2 && r.people === 2) this.sendOff(d.loader);
    r.cages = o.cages;
    r.people = o.people;
    r.allow = o.allow;
    r.clearing = o.clearing;
    this.show(d, r);
  }

  /** Parcels taken off the belt at a directed dock in its block so far, and parcels waiting on its belt end. */
  directCount(i: number): { taken: number; waiting: number } {
    return { taken: this.runs?.[i]?.taken ?? 0, waiting: this.docks[i]?.queue.length ?? 0 };
  }

  /**
   * A block ends at a directed dock, in one go (there is no time left to show it): what the
   * timeline has loaded and is still on the belt end goes into the cages, and every cage with
   * parcels stands in the trailer (as far as it has places; the rest of those parcels are
   * simply on board). Returns the parcels the timeline has loaded that were not at the dock
   * yet. What is still on the belt after this has missed the truck: `keep` leaves it lying
   * there, in sight; otherwise the belt end is cleared and the number taken away is returned.
   */
  closeOut(i: number, keep: boolean): { short: number; cleared: number } {
    const d = this.docks[i];
    const r = this.runs?.[i];
    if (!d || !r) return { short: 0, cleared: 0 };
    const T = this.handlers.truck;
    this.sendOff(d.worker);
    this.sendOff(d.loader);
    let short = Math.max(0, r.allow - r.taken);
    while (short > 0 && d.queue.length) {
      const p = d.queue.shift()!;
      const c = d.cages.filter((x) => x.state === 'home').sort((a, b) => a.n - b.n)[0];
      if (c && c.n < RUN_CAGE) this.put(d, d.cages.indexOf(c), p);
      else p.dead = true;
      r.taken++;
      short--;
    }
    const aboard = (g: THREE.Group, items: DockParcel[], vol: number, kg: number): boolean => {
      const slot = T.open(d.x) ? T.slot?.(d.x) : null;
      if (!slot) {
        for (const p of items) p.dead = true;
        return false;
      }
      g.position.copy(slot);
      g.rotation.y = 0;
      g.updateMatrixWorld();
      T.load(d.x, vol, kg);
      d.inTrailer.push({ g, items });
      return true;
    };
    for (const c of d.cages) {
      if (c.items.length) {
        const spare = d.spares.pop();
        if (spare && aboard(c.g, c.items, c.vol, c.kg)) {
          // (The frame went along; a spare one stands in its place for the next block.)
          c.g = spare;
        } else {
          if (spare) d.spares.push(spare);
          for (const p of c.items) p.dead = true;
        }
      }
      c.items = [];
      c.n = 0;
      c.vol = 0;
      c.kg = 0;
      c.state = 'home';
      c.g.position.copy(c.at);
      c.g.rotation.y = c.ry;
    }
    for (const st of d.staged) if (!aboard(st.g, st.items, st.vol, st.kg)) {
      st.g.visible = false;
      d.spares.push(st.g);
    }
    d.staged.length = 0;
    let cleared = 0;
    if (!keep) {
      cleared = d.queue.length;
      for (const p of d.queue) p.dead = true;
      d.queue.length = 0;
    }
    r.allow = r.taken;
    return { short, cleared };
  }

  /**
   * Another country: each dock serves the city of the same rank there; its cages take the same
   * parts of that city's postcodes (cards redrawn). `move` gives a parcel waiting at the dock or
   * in a cage its postcode in the new country (once per parcel).
   */
  setCountry(move: (p: DockParcel) => void): void {
    this.docks.forEach((d, n) => {
      const ranges = split(NORTH_CITIES[d.city]!, CAGES);
      d.cages.forEach((c, i) => (c.range = ranges[i]!));
      this.cardsFor(n * CAGES, d.city, d.cages);
      for (const p of d.queue) move(p);
      for (const c of d.cages) for (const p of c.items) move(p);
    });
  }

  private buildCage(at: V3, ry: number, range: [number, number]): Cage {
    const k = this.kit;
    const geo = cageGeometry();
    const mats = this.cageMats ?? (this.cageMats = {
      teal: k.std(0x5d6670, 0.5, 0.6, 0x2fa58f),
      wheel: k.std(0x222222, 0.8, 0.1, 0x333333),
      card: k.std(0x6f5a3f, 0.95, 0, 0xd9b07a),
    });
    void mats;
    const g = this.cageFrame(at, ry);
    const pile: THREE.Object3D[] = [];
    for (let i = 0; i < CAGE_FULL; i++) {
      const p = k.batch(geo.parcel, mats.card, g);
      p.position.set(((i % 2) - 0.5) * 0.5, 0.42 + Math.floor(i / 2) * 0.3, ((Math.floor(i / 2) % 2) - 0.5) * 0.3);
      p.rotation.y = i * 0.7;
      p.visible = false;
      pile.push(p);
    }
    return { at, range, n: 0, vol: 0, kg: 0, g, pile, items: [], state: 'home', ry };
  }

  private cageMats: Record<'teal' | 'wheel' | 'card', THREE.MeshStandardMaterial> | null = null;

  /** A roll cage: frame, mesh sides and wheels (all instanced). */
  private cageFrame(at: V3, ry: number): THREE.Group {
    const k = this.kit;
    const geo = cageGeometry();
    const mats = this.cageMats ?? (this.cageMats = {
      teal: k.std(0x5d6670, 0.5, 0.6, 0x2fa58f),
      wheel: k.std(0x222222, 0.8, 0.1, 0x333333),
      card: k.std(0x6f5a3f, 0.95, 0, 0xd9b07a),
    });
    const g = new THREE.Group();
    g.position.copy(at);
    g.rotation.y = ry;
    k.put(g);
    k.blobUnder(g, 1.9, 1.6);
    k.batch(geo.frame, mats.teal, g);
    k.batch(this.cageMeshGeo, this.cageMeshMat(), g).position.y = 1.1;
    k.batch(geo.wheels, mats.wheel, g);
    return g;
  }


  /** Empty roll cages nested into each other (just the frames, close together). */
  private buildStock(at: V3): void {
    const k = this.kit;
    const geo = cageGeometry();
    const mats = this.cageMats!;
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      g.position.set(at.x, 0, at.z - i * 0.28);
      g.scale.set(1, 1, 0.98);
      k.put(g);
      k.batch(geo.frame, mats.teal, g);
      k.batch(geo.wheels, mats.wheel, g);
      if (i === 0) k.batch(this.cageMeshGeo, this.cageMeshMat(), g).position.y = 1.1;
    }
    k.blob(at.x, at.z - 0.4, 1.8, 2.2);
  }

  /** Is this dock's picker (role 0) or loader (1) at work: a parcel in hand or a job planned? */
  /**
   * The way from a door's cages to inside the loop and back (x): halfway to the next dock's belt
   * (the last dock: to the one before), clear of the belts and the chutes, under the loop.
   */
  walkX(d: Dock | number): number {
    const dock = typeof d === 'number' ? this.docks[d]! : d;
    const i = this.docks.indexOf(dock);
    // (Only every other gap between neighbouring docks' cages is wide enough to walk through, and
    // clear of the loop's legs: the one east of an even dock, west of an odd one.)
    return i % 2 === 0 ? dock.x + 3 : dock.x - 3;
  }

  /** From a door's cages to the gap between the docks (behind the cages), and south through it past them. */
  wayOut(d: Dock | number): V3[] {
    const dock = typeof d === 'number' ? this.docks[d]! : d;
    const x = this.walkX(dock);
    return [v(dock.x + 1, 0, BEHIND_Z), v(x, 0, BEHIND_Z), v(x, 0, OUT_Z)];
  }

  /** The body now working at a door: the picker (role 0) or the loader (1). */
  body(dock: number, role: 0 | 1): Human {
    const d = this.docks[dock]!;
    return role ? d.loader : d.worker;
  }

  /**
   * A colleague takes over at a door: the job (its steps, its parcel, its place) carries on with
   * the new body `h`, standing where the old one stood; the old body is given back (to walk off
   * on its break).
   */
  swapBody(dock: number, role: 0 | 1, h: Human): Human {
    const w = this.body(dock, role) as unknown as Record<string, unknown>;
    const old: Record<string, unknown> = {};
    for (const key of Object.keys(h)) {
      old[key] = w[key];
      w[key] = (h as unknown as Record<string, unknown>)[key];
    }
    const o = old as unknown as Human;
    h.root.position.copy(o.root.position);
    h.root.rotation.copy(o.root.rotation);
    h.root.visible = true;
    return o;
  }

  /** Is this helper at work (a job planned, not just a chat)? */
  helperBusy(k: number): boolean {
    const w = this.helpers[k]!.w;
    return (!!w.step && !w.step.idle) || w.steps.some((s) => !s.idle);
  }

  busy(dock: number, role: 0 | 1): boolean {
    const d = this.docks[dock]!;
    const w = role ? d.loader : d.worker;
    return !!w.parcel || (!!w.step && !w.step.idle) || w.steps.some((s) => !s.idle);
  }

  /** A worker with jointed arms, legs and torso, so they can work and dance. */
  private buildWorker(home: V3, role = 0): Worker {
    const n = this.docks.length * 2 + role;
    const h = buildHuman(this.kit, {
      shirt: [0x2f3b6b, 0x2fa58f, 0xf3f4f6, 0x6b7280][n % 4]!,
      trousers: [0x22283f, 0x3a3d44][n % 2]!,
      vest: n % 3 === 2 ? 0xf2a51a : 0xc8ff3a,
      skin: [0xf0cfb0, 0xd9a77e, 0x8d5a3b, 0xf5d9c4][n % 4]!,
      // The picker who dances along wears headphones.
      headphones: role === 0 && this.docks.length === DANCE_DOCK ? 0xd6339a : undefined,
    });
    h.root.position.copy(home);
    this.kit.put(h.root);
    const seed = (n * 2654435761) >>> 0;
    const rnd = (k: number) => ((seed >>> k) & 1023) / 1023;
    return { ...h, home, steps: [], step: null, t0: 0, from: home.clone(), cageFrom: new THREE.Vector3(), cageRyFrom: 0, parcel: null, pickFrom: new THREE.Vector3(), cage: 0, yaw: Math.PI, rate: 0.7 + rnd(3) * 0.7, phase: rnd(13) * Math.PI * 2, style: Math.floor(rnd(7) * 3) };
  }

}

/**
 * A dock door in a wall at z = wallZ, opening into the hall towards +z (dir 1)
 * or −z (dir −1): a dark trailer behind an open door, rubber shelter, rolled-up
 * door, leveler, bumpers, an amber lamp and a number board. `closed` rolls the
 * door down.
 */
/** Number boards of all dock doors: paper, not lights, so dimmed by night (in Docks.update). */
const boardMats: THREE.MeshBasicMaterial[] = [];

const doorMats = new WeakMap<FloorKit, Record<string, THREE.Material>>();
/** Materials shared by all dock doors (so the box batches stay few). */
function dockMats(k: FloorKit): Record<string, THREE.Material> {
  let m = doorMats.get(k);
  if (!m) {
    const door = k.std(0x2c3038, 0.6, 0.5, 0xd5dae0);
    const closedDoor = k.std(0x2c3038, 0.6, 0.4, 0xffffff);
    closedDoor.map = sectionalDoor();
    k.realNormal(closedDoor, sectionalDoorNormal());
    const leveler = k.std(0x3a3d44, 0.6, 0.6, 0xb9c0c8);
    leveler.map = checkerPlate();
    k.realNormal(leveler, checkerPlateNormal());
    m = {
      dark: k.std(0x0d0e10, 0.9, 0, 0x2a2c31),
      rubber: k.std(0x15161a, 0.9, 0, 0x26282e),
      door,
      closedDoor,
      leveler,
      stripes: k.std(0x8a6e00, 0.6, 0.2, 0xf2c200),
      ampOn: new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.1, 0.1) }),
      ampOff: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.05, 0.03) }),
      green: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.4, 0.4) }),
    };
    doorMats.set(k, m);
  }
  return m;
}

export function buildDockDoor(k: FloorKit, x: number, wallZ: number, dir: 1 | -1, number: number, closed = false): void {
  const z = (d: number) => wallZ + dir * d;
  const M = dockMats(k);
  const { dark, rubber, door } = M as Record<string, THREE.Material>;
  if (closed) k.box('rolldoor', M.closedDoor!, x, 1.9, z(0.08), 3.2, 3.8, 0.1);
  else {
    // (The wall has an opening here; the trailer behind it is built by the hall.)
    void dark;
    k.box('rolldoor', door!, x, 4.4, z(0.25), 3.6, 0.7, 0.35);
  }
  k.box('shelter', rubber!, x - 1.8, 2.0, z(0.2), 0.4, 4.0, 0.3);
  k.box('shelter', rubber!, x + 1.8, 2.0, z(0.2), 0.4, 4.0, 0.3);
  k.box('shelter', rubber!, x, 3.95, z(0.2), 4.0, 0.3, 0.3);
  // Yellow guide stripes down the shelter.
  for (const sx of [-1.8, 1.8]) k.box('sstripe', M.stripes!, x + sx, 2.0, z(0.36), 0.12, 3.6, 0.02);
  k.box('leveler', M.leveler!, x, 0.03, z(1.1), 3.0, 0.06, 2.2);
  for (const sx of [-1.65, 1.65]) k.box('bumper', M.stripes!, x + sx, 0.5, z(0.3), 0.3, 1.0, 0.3);
  // Traffic light for the truck driver: amber when loading, dark red when closed; a green one beside it.
  k.box('dockled', closed ? M.ampOff! : M.ampOn!, x - 2.3, 4.0, z(0.15), 0.3, 0.3, 0.1);
  if (!closed) k.box('dockled', M.green!, x - 2.3, 3.6, z(0.15), 0.22, 0.22, 0.1);
  // Control box with buttons, beside the door.
  k.box('dockctl', door!, x + 2.35, 1.4, z(0.12), 0.35, 0.5, 0.15);
  const bm = new THREE.MeshBasicMaterial({ map: numberTex(String(number)) });
  litPaper(bm);
  boardMats.push(bm);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), bm);
  board.position.set(x, 5.4, z(0.12));
  if (dir < 0) board.rotation.y = Math.PI;
  k.put(board);
}

function numberTex(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#1d1d1f';
    g.lineWidth = 4;
    g.strokeRect(2, 2, 60, 60);
    g.fillStyle = '#1d1d1f';
    g.font = '700 40px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 32, 35);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A floor path with its corners swung round (radius up to `r` m), sampled as short straight pieces. */
function rounded(pts: [number, number][], r = 0.9): [number, number][] {
  const out: [number, number][] = [pts[0]!];
  for (let i = 1; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i - 1]!;
    const [bx, bz] = pts[i]!;
    const [cx, cz] = pts[i + 1]!;
    const la = Math.hypot(bx - ax, bz - az);
    const lc = Math.hypot(cx - bx, cz - bz);
    const k = Math.min(r, la / 2, lc / 2);
    if (k < 0.05) {
      out.push([bx, bz]);
      continue;
    }
    const p0: [number, number] = [bx + ((ax - bx) / la) * k, bz + ((az - bz) / la) * k];
    const p2: [number, number] = [bx + ((cx - bx) / lc) * k, bz + ((cz - bz) / lc) * k];
    for (let t = 0; t <= 1.0001; t += 0.2) {
      const u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * bx + t * t * p2[0], u * u * p0[1] + 2 * u * t * bz + t * t * p2[1]]);
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}
