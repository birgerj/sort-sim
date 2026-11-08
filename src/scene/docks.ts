// The dock side of the hall (north wall): the chutes feed roller belts that
// end at truck docks. At the end of each belt a worker takes the parcels off
// and puts each in one of three roll cages; the flow projector above shows
// which cage. The trucks stand outside, behind open dock doors.
//
// By day the workers work, one move per beat: pick, carry, drop, step back.
// By night they dance, and the parcels drop into the cages by themselves.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { FloorKit } from './floor';
import { buildHuman } from './people';
import { checkerPlate, sectionalDoor, wireMesh } from './textures';

type V3 = THREE.Vector3;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** z of the end of the dock belts, and of the wall. */
export const DOCK_BELT_END = -28.6;
const WALL_Z = -34;

/** What the docks need from a parcel (the Sorter's parcels have all of it). */
export interface DockParcel {
  pos: V3;
  q: THREE.Quaternion;
  h: number;
  dead: boolean;
}

interface Cage {
  at: V3;
  n: number;
  pile: THREE.InstancedMesh;
}

interface Worker {
  root: THREE.Group;
  torso: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  home: V3;
  /** Current task: picking a parcel, carrying it to a cage, dropping it, stepping back. */
  task: 'idle' | 'pick' | 'carry' | 'drop' | 'back';
  taskAt: number;
  parcel: DockParcel | null;
  cage: number;
  yaw: number;
}

interface Dock {
  x: number;
  chute: number;
  queue: DockParcel[];
  cages: Cage[];
  worker: Worker;
  /** Night: parcels slide into a cage on their own. */
  sliding: { p: DockParcel; cage: number; at: number }[];
}

export interface DockHandlers {
  /** Flow projector of this dock marks a cage. */
  mark(chute: number, target: V3): void;
  /** A parcel left in a cage (for the dock lamp). */
  shipped(chute: number): void;
}

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const UP = new THREE.Vector3(0, 1, 0);

export class Docks {
  readonly docks: Dock[] = [];
  private boardsDay: boolean | null = null;
  private readonly t = new THREE.Vector3();
  private readonly o = new THREE.Object3D();
  private readonly q = new THREE.Quaternion();

  constructor(
    private kit: FloorKit,
    lines: { x: number; chute: number }[],
    private handlers: DockHandlers,
  ) {
    for (const [n, l] of lines.entries()) this.buildDock(l.x, l.chute, n + 1);
  }

  /** Projector position and default target for each dock (for the projector rig). */
  static projectorAt(x: number): V3 {
    return v(x, 0, DOCK_BELT_END - 1.6);
  }

  arrive(chute: number, p: DockParcel): void {
    const d = this.docks.find((x) => x.chute === chute);
    if (!d) {
      p.dead = true;
      return;
    }
    if (d.queue.length >= 5) {
      p.dead = true;
      return;
    }
    d.queue.push(p);
  }

  /** One beat: by day the worker takes the next step of the job; by night parcels slide into cages. */
  beat(b: number, day: boolean): void {
    for (const d of this.docks) {
      const w = d.worker;
      if (!day) {
        // Night: no picking. Parcels at the belt end slide into a cage on the beat.
        if (w.parcel) {
          d.sliding.push({ p: w.parcel, cage: w.cage, at: b });
          w.parcel = null;
        }
        w.task = 'idle';
        const p = d.queue.shift();
        if (p) {
          const cage = Math.floor(Math.random() * d.cages.length);
          d.sliding.push({ p, cage, at: b });
          this.handlers.mark(d.chute, this.cageTop(d.cages[cage]!));
        }
        continue;
      }
      switch (w.task) {
        case 'idle':
          if (d.queue.length) {
            w.task = 'pick';
            w.taskAt = b;
            w.parcel = d.queue.shift()!;
            w.cage = Math.floor(Math.random() * d.cages.length);
            this.handlers.mark(d.chute, this.cageTop(d.cages[w.cage]!));
          }
          break;
        case 'pick':
          w.task = 'carry';
          w.taskAt = b;
          break;
        case 'carry':
          w.task = 'drop';
          w.taskAt = b;
          break;
        case 'drop':
          if (w.parcel) this.put(d, w.cage, w.parcel);
          w.parcel = null;
          w.task = 'back';
          w.taskAt = b;
          break;
        case 'back':
          w.task = 'idle';
          w.taskAt = b;
          break;
      }
    }
  }

  update(dt: number, bt: number, s: { kick: number; snare: number; dayShown: boolean }): void {
    const ph = bt - Math.floor(bt);
    if (s.dayShown !== this.boardsDay) {
      this.boardsDay = s.dayShown;
      for (const m of boardMats) m.color.setScalar(s.dayShown ? 1 : 0.22);
    }
    for (const d of this.docks) {
      // Parcels waiting at the belt end.
      d.queue.forEach((p, k) => {
        this.t.set(d.x, 1.02, DOCK_BELT_END + 0.35 + k * 0.6);
        p.pos.lerp(this.t, Math.min(1, dt * 8));
      });
      for (let i = d.sliding.length - 1; i >= 0; i--) {
        const sl = d.sliding[i]!;
        const f = Math.min(1, bt - sl.at);
        const from = this.t.set(d.x, 1.02, DOCK_BELT_END + 0.35);
        sl.p.pos.lerpVectors(from, this.cageTop(d.cages[sl.cage]!), ease(f));
        if (f >= 1) {
          this.put(d, sl.cage, sl.p);
          d.sliding.splice(i, 1);
        }
      }
      this.animateWorker(d, dt, bt, ph, s);
    }
  }

  private cageTop(c: Cage): V3 {
    return v(c.at.x, 0.45 + Math.min(c.n, 6) * 0.22, c.at.z);
  }

  private put(d: Dock, cage: number, p: DockParcel): void {
    const c = d.cages[cage]!;
    p.dead = true;
    c.n = c.n >= 8 ? 1 : c.n + 1;
    const o = this.o;
    for (let k = 0; k < c.pile.count; k++) {
      const shown = k < c.n;
      o.position.set(((k % 2) - 0.5) * 0.5, 0.42 + Math.floor(k / 2) * 0.3, ((Math.floor(k / 2) % 2) - 0.5) * 0.3);
      o.rotation.set(0, k * 0.7, 0);
      o.scale.setScalar(shown ? 1 : 0);
      o.updateMatrix();
      c.pile.setMatrixAt(k, o.matrix);
    }
    c.pile.instanceMatrix.needsUpdate = true;
    this.handlers.shipped(d.chute);
  }

  private animateWorker(d: Dock, dt: number, bt: number, ph: number, s: { kick: number; snare: number; dayShown: boolean }): void {
    const w = d.worker;
    const k = Math.min(1, dt * 10);
    const belt = this.t.set(d.x, 0, DOCK_BELT_END + 0.35);
    let pos = w.home;
    let face = Math.atan2(belt.x - w.home.x, belt.z - w.home.z);
    let bend = 0;
    let armF = 0.1;
    let armUpL = 0;
    let armUpR = 0;
    let bounce = 0;
    let step = 0;
    if (!s.dayShown) {
      // Night: dance. Bounce on the kick, arms up in turns, a quarter turn every bar.
      const beat = Math.floor(bt);
      face = w.yaw + (Math.floor(bt / 4) % 4) * (Math.PI / 2) * 0 + Math.sin(bt * Math.PI * 0.5) * 0.6;
      bounce = 0.12 * s.kick;
      armUpL = beat % 2 ? 2.6 : 0.6 + s.snare;
      armUpR = beat % 2 ? 0.6 + s.snare : 2.6;
      bend = -0.15 * s.snare;
      step = Math.sin(bt * Math.PI) * 0.4;
    } else {
      const f = ease(ph);
      const cage = d.cages[w.cage]!;
      const toward = (a: V3, b: V3, t: number) => a.clone().lerp(b, t);
      const nearCage = toward(w.home, cage.at, 0.55).setY(0);
      switch (w.task) {
        case 'pick':
          bend = 0.55 * Math.sin(f * Math.PI);
          armF = 0.1 + 1.3 * f;
          break;
        case 'carry':
          pos = toward(w.home, nearCage, f);
          face = Math.atan2(cage.at.x - pos.x, cage.at.z - pos.z);
          armF = 1.4;
          step = Math.sin(f * Math.PI * 2) * 0.5;
          break;
        case 'drop':
          pos = nearCage;
          face = Math.atan2(cage.at.x - pos.x, cage.at.z - pos.z);
          bend = 0.5 * Math.sin(f * Math.PI);
          armF = 1.4 - 1.2 * f;
          break;
        case 'back':
          pos = toward(nearCage, w.home, f);
          step = Math.sin(f * Math.PI * 2) * 0.5;
          break;
        default:
          bend = 0.04 * Math.sin(bt * Math.PI * 0.5);
      }
      // The parcel follows the hands.
      if (w.parcel && (w.task === 'carry' || w.task === 'drop' || w.task === 'pick')) {
        const hands = this.t
          .set(Math.sin(w.yaw) * 0.55, 0.95, Math.cos(w.yaw) * 0.55)
          .add(w.root.position);
        if (w.task === 'pick') {
          const start = v(d.x, 1.02, DOCK_BELT_END + 0.35);
          w.parcel.pos.lerpVectors(start, hands, ease(ph));
        } else if (w.task === 'drop') w.parcel.pos.lerpVectors(hands, this.cageTop(cage), ease(ph));
        else w.parcel.pos.copy(hands);
        this.q.setFromAxisAngle(UP, w.yaw);
        w.parcel.q.copy(this.q);
      }
    }
    w.root.position.lerp(this.t.copy(pos).setY(bounce), k);
    let dy = face - w.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    w.yaw += dy * k;
    w.root.rotation.y = w.yaw;
    w.torso.rotation.x += (bend - w.torso.rotation.x) * k;
    const armL = s.dayShown ? -armF : -armUpL;
    const armR = s.dayShown ? -armF : -armUpR;
    w.armL.rotation.x += (armL - w.armL.rotation.x) * k;
    w.armR.rotation.x += (armR - w.armR.rotation.x) * k;
    w.legL.rotation.x = step;
    w.legR.rotation.x = -step;
  }

  // ---------- building ----------

  private buildDock(x: number, chute: number, number: number): void {
    const k = this.kit;
    buildDockDoor(k, x, WALL_Z, 1, number);
    // Three roll cages around the belt end.
    const cageAt = [v(x - 1.7, 0, DOCK_BELT_END - 1.5), v(x + 1.7, 0, DOCK_BELT_END - 1.5), v(x, 0, DOCK_BELT_END - 3.3)];
    const cages: Cage[] = cageAt.map((at, i) => this.buildCage(at, i === 2 ? 0 : i === 0 ? Math.PI / 2 : -Math.PI / 2));
    const worker = this.buildWorker(v(x, 0, DOCK_BELT_END - 1.0));
    this.docks.push({ x, chute, queue: [], cages, worker, sliding: [] });
  }

  private readonly cageMeshGeo = (() => {
    const g = new THREE.BoxGeometry(1.36, 1.5, 1.04);
    // Drop the top and bottom faces (groups 2 and 3), keep the four sides.
    const idx = g.getIndex()!.array;
    const keep: number[] = [];
    for (const grp of g.groups) if (grp.materialIndex !== 2 && grp.materialIndex !== 3) for (let i = grp.start; i < grp.start + grp.count; i++) keep.push(idx[i]!);
    g.setIndex(keep);
    g.clearGroups();
    return g;
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

  private buildCage(at: V3, ry: number): Cage {
    const k = this.kit;
    const teal = k.std(0x5d6670, 0.5, 0.6, 0x2fa58f);
    const g = new THREE.Group();
    g.position.copy(at);
    g.rotation.y = ry;
    k.put(g);
    k.blobUnder(g, 1.9, 1.6);
    // Frame and wheels merged into one mesh each (20 docks × 3 cages adds up).
    const parts: THREE.BufferGeometry[] = [];
    const part = (w: number, h: number, d: number, x: number, y: number, z: number) => parts.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
    part(1.4, 0.08, 1.1, 0, 0.3, 0);
    for (const sx of [-0.68, 0.68]) for (const sz of [-0.52, 0.52]) part(0.06, 1.7, 0.06, sx, 1.1, sz);
    for (const sz of [-0.52, 0.52]) part(1.4, 0.06, 0.06, 0, 1.92, sz);
    for (const sx of [-0.68, 0.68]) part(0.06, 0.06, 1.1, sx, 1.92, 0);
    const frame = new THREE.Mesh(mergeGeometries(parts)!, teal);
    g.add(frame);
    k.inkify(frame);
    // Wire mesh sides (open top), with a shelf halfway.
    const mesh = new THREE.Mesh(this.cageMeshGeo, this.cageMeshMat());
    mesh.position.y = 1.1;
    g.add(mesh);
    const wheels: THREE.BufferGeometry[] = [];
    for (const sx of [-0.55, 0.55]) for (const sz of [-0.42, 0.42]) wheels.push(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 10).rotateX(Math.PI / 2).translate(sx, 0.12, sz));
    g.add(new THREE.Mesh(mergeGeometries(wheels)!, k.std(0x222222, 0.8, 0.1, 0x333333)));
    const pile = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.28, 0.42), k.std(0x6f5a3f, 0.95, 0, 0xd9b07a), 8);
    const o = this.o;
    o.scale.setScalar(0);
    o.updateMatrix();
    for (let i = 0; i < 8; i++) pile.setMatrixAt(i, o.matrix);
    o.scale.setScalar(1);
    g.add(pile);
    return { at, n: 0, pile };
  }

  /** A worker with jointed arms, legs and torso, so they can work and dance. */
  private buildWorker(home: V3): Worker {
    const n = this.docks.length;
    const h = buildHuman(this.kit, {
      shirt: [0x2f3b6b, 0x2fa58f, 0xf3f4f6, 0x6b7280][n % 4]!,
      trousers: [0x22283f, 0x3a3d44][n % 2]!,
      vest: n % 3 === 2 ? 0xf2a51a : 0xc8ff3a,
      helmet: [0xffffff, 0xf2c200, 0x1755fe][n % 3]!,
      skin: [0xf0cfb0, 0xd9a77e, 0x8d5a3b, 0xf5d9c4][n % 4]!,
    });
    h.root.position.copy(home);
    this.kit.put(h.root);
    return { ...h, home, task: 'idle', taskAt: 0, parcel: null, cage: 0, yaw: Math.PI };
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
    const leveler = k.std(0x3a3d44, 0.6, 0.6, 0xb9c0c8);
    leveler.map = checkerPlate();
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
    k.box('trailer', dark!, x, 1.9, z(0.06), 3.2, 3.8, 0.1);
    k.box('rolldoor', door!, x, 4.4, z(0.25), 3.6, 0.7, 0.35);
    // Trailer floor edge and the dock seal's light.
    k.box('trailerfloor', M.leveler!, x, 1.0, z(-0.4), 3.0, 0.08, 0.8);
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
