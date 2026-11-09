// Little jokes hidden in the hall, for those who look closely (or tap things):
//
// - a ginger cat that sleeps in odd places and wanders between them; tap it and it bolts;
// - now and then a parcel with little legs jumps off a pickup table and makes a run for it,
//   until someone catches it and carries it back;
// - someone in the break area on the phone, pacing, and taking selfies;
// - someone hiding behind the pigeonholes at manual sorting, peeking out at the camera;
// - taps: a person waves (once), bows (twice) and does a cartwheel (three times); the dock
//   worker with headphones is caught dancing; a forklift honks in tune with the music (tap on
//   for a riff); a robot spins, and sulks on the third tap; the DJ (by night) sounds an
//   airhorn and drops confetti; the coffee machine (by day) calls people over for a coffee;
//   a rubber duck quacks.
//
// Day only, except the cat (day and night) and the DJ (night).
import * as THREE from 'three';

import type { FloorKit } from './floor';
import type { Sfx } from '../audio/music';
import { ANTICS } from './antics';
import { buildHuman, type Human } from './people';
import type { Life } from './life';
import type { Docks } from './docks';
import type { Party } from './party';
import type { RobotFloor } from './floor';

type V3 = THREE.Vector3;
type V2 = [number, number];
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x: number) => {
  const t = clamp(x);
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
};

/** Places the cat likes: where it lies (y is the surface), and the floor point it jumps up from. */
interface Spot {
  at: V3;
  from: V2;
  ry: number;
}

const CAT_SPOTS: Spot[] = [
  // On a chair in the break area.
  { at: v(-38.55, 0.49, 29.65), from: [-39.25, 29.65], ry: 0.6 },
  // On top of a stack of empty pallets.
  { at: v(-59.6, 1.25, 31.6), from: [-59.6, 30.55], ry: 1.9 },
  // On the finished cardboard bale by the baler.
  { at: v(-60.1, 1.1, -6.2), from: [-59.0, -6.2], ry: -1.2 },
  // On the lid of a wheelie bin.
  { at: v(-60.85, 1.24, -1.5), from: [-59.9, -1.5], ry: 2.6 },
  // On the floor in front of the vending machine (no jump).
  { at: v(-43.1, 0, 30.6), from: [-43.1, 30.6], ry: 0.2 },
];
/** The way between the west wall spots and the break area. */
const CAT_X = -58.6;
const CAT_Z = 29.25;

/** The pickup table a parcel runs away from (the westmost station), and where it runs. */
const RUN_FROM = v(-17.5, 0, 15.2);
const RUN_TO: V2 = [-31, 15.9];

/** Break area: where the person on the phone stands. */
const PHONER: V2 = [-35.4, 28.9];
/** Behind the pigeonholes at manual sorting (it leans out to the west, towards −x). */
const PEEKER: V2 = [107.6, 25.3];
const SHELF_MID = v(109, 1.3, 24.7);

const COFFEE_MACHINE = v(-41.5, 1.2, 31.4);

export interface EggLinks {
  life: Life;
  docks: Docks;
  party: Party;
  floor: RobotFloor;
  /** Top of the pickup tables. */
  tableY: number;
}

export class Eggs {
  /** Sounds to play (with where they come from). */
  readonly sounds: { kind: Sfx; at: V3; n?: number }[] = [];
  private links!: EggLinks;
  private day = true;
  private group = new THREE.Group();
  private readonly w = new THREE.Vector3();

  // The cat.
  private cat: { root: THREE.Group; body: THREE.Group; head: THREE.Group; tail: THREE.Group; legs: THREE.Group[]; eyes: THREE.Object3D };
  private catSpot = 0;
  private catPath: { p: V3; jump?: boolean }[] = [];
  private catSpeed = 1;
  private catFrom = new THREE.Vector3();
  private catT0 = 0;
  private catLeg = 0;
  private catYaw = 0;
  private catWake = 24;
  private catState: 'sleep' | 'walk' = 'sleep';

  // The runaway parcel.
  private runner: { root: THREE.Group; legs: THREE.Object3D[]; eyes: THREE.Object3D };
  private run: { state: 'off' | 'jump' | 'run' | 'carried' | 'back'; t0: number; x: number; z: number; yaw: number; carrier: Human | null } = { state: 'off', t0: 0, x: 0, z: 0, yaw: 0, carrier: null };
  private nextRun = 40;

  // People.
  private phoner: Human;
  private peeker: Human;
  private peekCool = 0;
  private lastBeat = -1;
  private lastBt = 0;

  // Taps on the same thing in a row.
  private taps = { obj: null as THREE.Object3D | null, n: 0, at: 0 };

  constructor(private k: FloorKit) {
    k.put(this.group);
    this.cat = this.buildCat();
    this.runner = this.buildRunner();
    const was = k.only;
    k.only = 'day';
    this.phoner = buildHuman(k, { shirt: 0xd6339a, trousers: 0x22283f, cap: 0x1d1d1f, skin: 0xd9a77e, hairStyle: 2 }, { x: PHONER[0], z: PHONER[1], ry: Math.PI * 0.9 });
    this.peeker = buildHuman(k, { shirt: 0xf2c200, trousers: 0x3a3d44, cap: 0x1755fe, skin: 0xf0cfb0 }, { x: PEEKER[0], z: PEEKER[1], ry: Math.PI });
    k.only = was;
    const s = CAT_SPOTS[0]!;
    this.cat.root.position.copy(s.at);
    this.catYaw = s.ry;
  }

  link(l: EggLinks): void {
    this.links = l;
  }

  /** Things to tap that are not people, robots or forklifts: where they are, and a height to aim at. */
  targets(): { kind: 'cat' | 'coffee' | 'dj' | 'runner'; at: V3 }[] {
    const out: { kind: 'cat' | 'coffee' | 'dj' | 'runner'; at: V3 }[] = [];
    this.cat.root.getWorldPosition(this.w);
    out.push({ kind: 'cat', at: this.w.clone().setY(this.w.y + 0.2) });
    if (this.day) out.push({ kind: 'coffee', at: COFFEE_MACHINE });
    else out.push({ kind: 'dj', at: this.links.party.booth.clone().setY(this.links.party.booth.y + 1.0) });
    if (this.run.state !== 'off') out.push({ kind: 'runner', at: this.runner.root.position.clone().setY(this.runner.root.position.y + 0.25) });
    return out;
  }

  /** Something was tapped. */
  tapThing(kind: 'cat' | 'coffee' | 'dj' | 'runner', bt: number): void {
    if (kind === 'cat') {
      this.sounds.push({ kind: 'meow', at: this.cat.root.position.clone() });
      this.catBolt(bt);
    } else if (kind === 'coffee') {
      if (this.links.life.coffee() > 0) this.sounds.push({ kind: 'boop', at: COFFEE_MACHINE });
    } else if (kind === 'dj') this.djHype(bt);
    else if (kind === 'runner' && this.run.state === 'run') this.sounds.push({ kind: 'quack', at: this.runner.root.position.clone() });
  }

  /** How many times in a row this was tapped (within a second and a half each). */
  private count(obj: THREE.Object3D): number {
    const now = performance.now();
    if (this.taps.obj === obj && now - this.taps.at < 1500) this.taps.n++;
    else this.taps.n = 1;
    this.taps.obj = obj;
    this.taps.at = now;
    return this.taps.n;
  }

  /** A person was tapped: a wave, a bow, a cartwheel; or the special ones. */
  tapPerson(root: THREE.Object3D, h: Human, bt: number, camera: V3): void {
    const L = this.links;
    if (root === L.docks.dancer.root) return L.docks.catchDancer(bt, camera);
    if (root === L.party.dj.root) return this.djHype(bt);
    if (root === this.peeker.root) {
      // Found! Back behind the shelf.
      ANTICS.stop(this.peeker);
      this.peekCool = bt + 16;
      return;
    }
    const n = this.count(root);
    const kind = n === 1 ? 'wave' : n === 2 ? 'bow' : 'cartwheel';
    if (n > 3) return;
    ANTICS.play(h, kind, bt, { look: kind === 'wave' ? camera.clone() : undefined, side: Math.random() < 0.5 ? 1 : -1 }, true);
  }

  /** A forklift was tapped: it honks a note of the chord now; keep tapping for a riff up the chord. */
  tapForklift(obj: THREE.Object3D): void {
    const n = this.count(obj);
    obj.getWorldPosition(this.w);
    this.sounds.push({ kind: 'tune', at: this.w.clone(), n: [0, 1, 2, 3, 2, 1, 0, 3][(n - 1) % 8] });
  }

  /** A robot was tapped. */
  tapRobot(k: number, obj: THREE.Object3D, bt: number): void {
    const n = this.count(obj);
    const r = this.links.floor.poke(k, n, bt);
    obj.getWorldPosition(this.w);
    this.sounds.push({ kind: r === 'sulk' ? 'sulk' : 'boop', at: this.w.clone() });
  }

  /** A rubber duck was tapped. */
  quack(at: V3): void {
    this.sounds.push({ kind: 'quack', at: at.clone() });
  }

  private djHype(bt: number): void {
    const P = this.links.party;
    ANTICS.play(P.dj, 'hype', bt, {}, true);
    P.boost();
    this.sounds.push({ kind: 'airhorn', at: P.booth.clone() });
  }

  update(dt: number, bt: number, day: boolean, camera: V3): void {
    this.day = day;
    const db = clamp(bt - this.lastBt, 0, 0.5);
    this.lastBt = bt;
    this.updateCat(dt, bt);
    this.updateRunner(db, bt);
    if (!day) return;
    // The person in the break area: a phone call (pacing), then selfies, then a stretch.
    const beat = Math.floor(bt);
    if (beat !== this.lastBeat && !ANTICS.busy(this.phoner)) {
      const ph = beat % 48;
      if (ph === 4) ANTICS.play(this.phoner, 'phone', beat, { beats: 20, pace: 0.7 });
      else if (ph === 30) ANTICS.play(this.phoner, 'selfie', beat, { beats: 8 });
      else if (ph === 42) ANTICS.play(this.phoner, 'stretch', beat);
    }
    this.lastBeat = beat;
    // Standing, weight from one foot to the other.
    this.phoner.root.rotation.z = Math.sin(bt * 0.4) * 0.02;
    // The one behind the pigeonholes peeks out when the camera comes by.
    const near = camera.distanceTo(SHELF_MID);
    if (near < 18 && camera.z < SHELF_MID.z - 0.5 && bt > this.peekCool && !ANTICS.busy(this.peeker)) {
      ANTICS.play(this.peeker, 'peek', bt, { side: 1, look: camera.clone(), beats: near < 7 ? 3 : 6 });
      this.peekCool = bt + 10 + Math.random() * 8;
    }
  }

  // ---------- the cat ----------

  private buildCat(): Eggs['cat'] {
    const k = this.k;
    const fur = k.std(0xffffff, 0.9, 0, 0xffffff);
    const dark = k.std(0x15161a, 0.6, 0, 0x1d1d1f);
    const ginger = 0xe38b3a;
    const root = new THREE.Group();
    this.group.add(root);
    k.blobUnder(root, 0.45, 0.6);
    const body = new THREE.Group();
    root.add(body);
    k.batch(new THREE.SphereGeometry(1, 14, 10).scale(0.12, 0.11, 0.25), fur, body, ginger);
    // A white chest.
    k.batch(new THREE.SphereGeometry(1, 10, 8).scale(0.08, 0.08, 0.06).translate(0, -0.02, 0.2), fur, body, 0xfff4e6);
    const head = new THREE.Group();
    head.position.set(0, 0.1, 0.24);
    body.add(head);
    k.batch(new THREE.SphereGeometry(0.085, 14, 10).scale(1.05, 0.95, 1), fur, head, ginger);
    k.batch(
      (() => {
        const a = new THREE.ConeGeometry(0.035, 0.07, 4).translate(-0.05, 0.09, -0.01);
        const b = new THREE.ConeGeometry(0.035, 0.07, 4).translate(0.05, 0.09, -0.01);
        return mergeTwo(a, b);
      })(),
      fur,
      head,
      ginger,
    );
    // Muzzle and nose.
    k.batch(new THREE.SphereGeometry(0.04, 10, 8).scale(1.2, 0.8, 0.9).translate(0, -0.025, 0.07), fur, head, 0xfff4e6);
    k.batch(new THREE.SphereGeometry(0.012, 6, 5).translate(0, -0.01, 0.105), fur, head, 0xe58a9a);
    const eyes = new THREE.Group();
    head.add(eyes);
    k.batch(mergeTwo(new THREE.SphereGeometry(0.014, 8, 6).translate(-0.032, 0.015, 0.075), new THREE.SphereGeometry(0.014, 8, 6).translate(0.032, 0.015, 0.075)), dark, eyes);
    const tail = new THREE.Group();
    tail.position.set(0, 0.03, -0.23);
    body.add(tail);
    k.batch(new THREE.CapsuleGeometry(0.025, 0.26, 3, 8).translate(0, 0.15, 0), fur, tail, ginger);
    const legs: THREE.Group[] = [];
    for (const [x, z] of [[-0.06, 0.15], [0.06, 0.15], [-0.06, -0.15], [0.06, -0.15]] as const) {
      const l = new THREE.Group();
      l.position.set(x, -0.04, z);
      body.add(l);
      k.batch(new THREE.CapsuleGeometry(0.025, 0.12, 3, 6).translate(0, -0.08, 0), fur, l, ginger);
      legs.push(l);
    }
    return { root, body, head, tail, legs, eyes };
  }

  /** Tapped: it bolts to another spot, fast. */
  private catBolt(bt: number): void {
    let next = this.catSpot;
    while (next === this.catSpot) next = Math.floor(Math.random() * CAT_SPOTS.length);
    this.planCat(next, bt, 3.2);
    // A start: up in the air first.
    this.catJumpScare = bt;
  }
  private catJumpScare = -9;

  /** The way to another spot: down from this one, along the floor (by the west wall), and up. */
  private planCat(next: number, bt: number, speed: number): void {
    const a = CAT_SPOTS[this.catSpot]!;
    const b = CAT_SPOTS[next]!;
    const path: { p: V3; jump?: boolean }[] = [];
    if (a.at.y > 0) path.push({ p: v(a.from[0], 0, a.from[1]), jump: true });
    const cur = path.length ? path[path.length - 1]!.p : a.at;
    // Along the west wall and the break area (round the control room).
    const west = (x: number) => x < -50;
    if (west(cur.x) !== west(b.from[0])) {
      if (west(cur.x)) path.push({ p: v(CAT_X, 0, cur.z) }, { p: v(CAT_X, 0, CAT_Z) }, { p: v(b.from[0], 0, CAT_Z) });
      else path.push({ p: v(cur.x, 0, CAT_Z) }, { p: v(CAT_X, 0, CAT_Z) }, { p: v(CAT_X, 0, b.from[1]) });
    } else if (west(cur.x)) path.push({ p: v(CAT_X, 0, cur.z) }, { p: v(CAT_X, 0, b.from[1]) });
    else path.push({ p: v(cur.x, 0, CAT_Z) }, { p: v(b.from[0], 0, CAT_Z) });
    path.push({ p: v(b.from[0], 0, b.from[1]) });
    if (b.at.y > 0) path.push({ p: b.at.clone(), jump: true });
    else path.push({ p: b.at.clone() });
    this.catPath = path.filter((x, i) => i === 0 || x.p.distanceTo(path[i - 1]!.p) > 0.05);
    this.catSpot = next;
    this.catSpeed = speed;
    this.catState = 'walk';
    this.catFrom.copy(this.cat.root.position);
    this.catT0 = bt;
  }

  private updateCat(dt: number, bt: number): void {
    const c = this.cat;
    if (this.catState === 'sleep') {
      // Curled up: legs tucked in, head down, tail round, breathing slowly.
      const br = 1 + Math.sin(bt * 0.8) * 0.03;
      c.body.position.y = 0.08;
      c.body.scale.set(br, br, 1);
      c.body.rotation.set(0, 0, 0);
      for (const l of c.legs) l.scale.y = 0.15;
      c.head.position.set(0.05, 0.0, 0.2);
      c.head.rotation.set(0.5, 0.4, 0.2);
      c.tail.rotation.set(1.5, 0, 0);
      c.tail.position.set(0.08, -0.04, -0.15);
      c.eyes.scale.y = 0.15;
      if (bt >= this.catWake) {
        let next = this.catSpot;
        while (next === this.catSpot) next = Math.floor(Math.random() * CAT_SPOTS.length);
        this.planCat(next, bt, 1.1);
      }
    } else {
      const seg = this.catPath[0];
      if (!seg) {
        this.catState = 'sleep';
        this.catWake = bt + 48 + Math.random() * 96;
        this.catYaw = CAT_SPOTS[this.catSpot]!.ry;
      } else {
        const dist = this.catFrom.distanceTo(seg.p);
        const beats = seg.jump ? 1 : Math.max(0.25, dist / this.catSpeed);
        const u = clamp((bt - this.catT0) / beats);
        const e = seg.jump ? ease(u) : u;
        c.root.position.lerpVectors(this.catFrom, seg.p, e);
        if (seg.jump) c.root.position.y += Math.sin(u * Math.PI) * 0.5;
        // Startled: straight up in the air first.
        const scare = clamp((bt - this.catJumpScare) / 0.6);
        if (scare < 1) c.root.position.y += Math.sin(scare * Math.PI) * 0.45;
        if (dist > 0.05) {
          const want = Math.atan2(seg.p.x - this.catFrom.x, seg.p.z - this.catFrom.z);
          let d = want - this.catYaw;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          this.catYaw += d * Math.min(1, dt * 12);
        }
        // Trotting: diagonal pairs of legs, tail up.
        this.catLeg += dt * 9 * Math.min(2.5, this.catSpeed);
        const sw = Math.sin(this.catLeg) * 0.6;
        c.legs.forEach((l, i) => {
          l.scale.y = 1;
          l.rotation.x = (i === 0 || i === 3 ? sw : -sw) * (seg.jump ? 0.2 : 1);
        });
        c.body.position.y = 0.2 + Math.abs(Math.sin(this.catLeg)) * 0.015;
        c.body.scale.set(1, 1, 1);
        c.body.rotation.set(seg.jump ? -0.4 * Math.sin(u * Math.PI) : 0, 0, 0);
        c.head.position.set(0, 0.1, 0.24);
        c.head.rotation.set(-0.1, 0, 0);
        c.tail.position.set(0, 0.03, -0.23);
        c.tail.rotation.set(-0.35 + Math.sin(bt * 2) * 0.1, 0, Math.sin(bt * 3) * 0.2);
        c.eyes.scale.y = 1;
        if (u >= 1) {
          this.catFrom.copy(seg.p);
          this.catT0 = bt;
          this.catPath.shift();
        }
      }
    }
    c.root.rotation.y = this.catYaw;
  }

  // ---------- the runaway parcel ----------

  private buildRunner(): Eggs['runner'] {
    const k = this.k;
    const root = new THREE.Group();
    root.visible = false;
    this.group.add(root);
    k.blobUnder(root, 0.5, 0.45);
    const card = k.std(0x8a7050, 0.9, 0, 0xc9a06c);
    const tape = k.std(0x8a6a3a, 0.5, 0, 0xb08a5e);
    const white = k.std(0xdddddd, 0.6, 0, 0xffffff);
    const dark = k.std(0x15161a, 0.6, 0, 0x1d1d1f);
    // The box (bottom at y 0.14: it stands on its legs), tape, a label, and two eyes on the front.
    k.batch(new THREE.BoxGeometry(0.42, 0.3, 0.36).translate(0, 0.29, 0), card, root);
    k.batch(new THREE.BoxGeometry(0.08, 0.005, 0.37).translate(0, 0.442, 0), tape, root);
    k.batch(new THREE.BoxGeometry(0.15, 0.004, 0.1).translate(0.12, 0.442, -0.06), white, root);
    const eyes = new THREE.Group();
    root.add(eyes);
    k.batch(mergeTwo(new THREE.SphereGeometry(0.04, 10, 8).scale(1, 1, 0.5).translate(-0.08, 0.33, 0.18), new THREE.SphereGeometry(0.04, 10, 8).scale(1, 1, 0.5).translate(0.08, 0.33, 0.18)), white, eyes);
    k.batch(mergeTwo(new THREE.SphereGeometry(0.018, 8, 6).translate(-0.08, 0.325, 0.2), new THREE.SphereGeometry(0.018, 8, 6).translate(0.08, 0.325, 0.2)), dark, eyes);
    const legs: THREE.Object3D[] = [];
    for (const x of [-0.11, 0.11]) {
      const l = new THREE.Group();
      l.position.set(x, 0.15, 0);
      root.add(l);
      k.batch(new THREE.CapsuleGeometry(0.022, 0.08, 3, 6).translate(0, -0.065, 0), dark, l);
      k.batch(new THREE.BoxGeometry(0.06, 0.03, 0.09).translate(0, -0.13, 0.02), dark, l);
      legs.push(l);
    }
    return { root, legs, eyes };
  }

  /** `db`: beats since the last frame. */
  private updateRunner(db: number, bt: number): void {
    const R = this.run;
    const g = this.runner.root;
    if (R.state === 'off') {
      g.visible = false;
      if (this.day && bt >= this.nextRun) {
        this.nextRun = bt + 180 + Math.random() * 200;
        const L = this.links.life;
        const chaser = L.nearest(RUN_TO[0], RUN_TO[1], 40);
        if (!chaser || Math.random() < 0.3) return;
        R.state = 'jump';
        R.t0 = bt;
        R.x = RUN_FROM.x;
        R.z = RUN_FROM.z;
        R.yaw = Math.atan2(RUN_TO[0] - R.x, RUN_TO[1] - R.z);
        R.carrier = L.human(chaser);
        // Chase it, pick it up, carry it back to the table, put it down, and back to the round.
        L.send(chaser, [
          { to: () => [g.position.x, g.position.z], speed: 2.4, then: () => this.catchRunner(bt) },
          {
            to: [RUN_FROM.x - 0.9, RUN_FROM.z],
            speed: 1.0,
            carry: true,
            then: () => {
              R.state = 'back';
              R.t0 = -1;
            },
          },
          { wait: 1, face: [RUN_FROM.x, RUN_FROM.z] },
        ]);
      }
      return;
    }
    g.visible = this.day;
    const legs = this.runner.legs;
    if (R.state === 'jump') {
      // Off the side of the table, onto its little legs.
      const u = clamp((bt - R.t0) / 1.5);
      const top = this.links.tableY;
      g.position.set(R.x - 0.9 * ease(u), top * (1 - u) + Math.sin(u * Math.PI) * 0.6, R.z);
      g.rotation.set(0, R.yaw, Math.sin(u * Math.PI) * 0.6);
      if (u >= 1) {
        R.state = 'run';
        R.x = g.position.x;
      }
    } else if (R.state === 'run') {
      // Waddling off, as fast as its legs go, a little hop on every step.
      const sp = 0.75;
      const dx = RUN_TO[0] - R.x;
      const dz = RUN_TO[1] - R.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.1) {
        R.x += (dx / d) * sp * db;
        R.z += (dz / d) * sp * db;
      }
      const ph = bt * Math.PI * 4;
      g.position.set(R.x, Math.abs(Math.sin(ph)) * 0.05, R.z);
      g.rotation.set(0, R.yaw, Math.sin(ph) * 0.15);
      legs[0]!.rotation.x = Math.sin(ph) * 0.8;
      legs[1]!.rotation.x = -Math.sin(ph) * 0.8;
    } else if (R.state === 'carried') {
      // In the chaser's hands, legs still kicking.
      const h = R.carrier!;
      h.root.getWorldPosition(this.w);
      const yaw = h.root.rotation.y;
      g.position.set(this.w.x + Math.sin(yaw) * 0.5, 0.82, this.w.z + Math.cos(yaw) * 0.5);
      g.rotation.set(0, yaw + Math.PI, Math.sin(bt * 9) * 0.08);
      const kick = Math.sin(bt * Math.PI * 8) * 1.0;
      legs[0]!.rotation.x = kick;
      legs[1]!.rotation.x = -kick;
    } else if (R.state === 'back') {
      // Put back on the table; it settles down and disappears among the parcels.
      if (R.t0 < 0) R.t0 = bt;
      g.position.set(RUN_FROM.x, this.links.tableY + 0.0, RUN_FROM.z);
      g.rotation.set(0, Math.PI, 0);
      g.scale.setScalar(1 - ease((bt - R.t0 - 1) / 1));
      legs[0]!.rotation.x = legs[1]!.rotation.x = 0;
      if (bt - R.t0 >= 2) {
        R.state = 'off';
        g.scale.setScalar(1);
      }
    }
  }

  private catchRunner(bt: number): void {
    this.run.state = 'carried';
    this.run.t0 = bt;
    this.sounds.push({ kind: 'quack', at: this.runner.root.position.clone() });
  }
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const ga = a.index ? a.toNonIndexed() : a;
  const gb = b.index ? b.toNonIndexed() : b;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const x = ga.getAttribute(name);
    const y = gb.getAttribute(name);
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array, 0);
    arr.set(y.array as Float32Array, x.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, x.itemSize));
  }
  return out;
}
