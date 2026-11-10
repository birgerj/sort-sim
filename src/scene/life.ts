// Life around the machines: people walking their rounds, a cleaner on a
// scrubber, a forklift charging
// station, safety details (exit signs, extinguishers, first aid, walkway),
// a coffee machine, painted zone names on the floor, and the walkway round the inside of the loop.
//
// Walkers and vehicles move by day (by night the hall belongs to the party).
// Steps land on the beat: two steps per beat for walkers.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import type { FloorKit } from './floor';
import { buildForklift } from './forklift';
import { XMAS } from '../sim/season';
import { buildHuman, type Human } from './people';
import { gait, relaxArms, settle, sit, swingArms } from './motion';
import { ANTICS, type ActKind } from './antics';
import { Rng } from '../sim/rng';

type V2 = [number, number];

/** One step of a walker's detour from its round (a coffee, a chase): go somewhere, then maybe do something there. */
export interface Errand {
  /** Where to go: a point, or a function that gives it every frame (null: stay). */
  to?: V2 | (() => V2 | null);
  /** Metres per beat (default: walking pace). */
  speed?: number;
  /** Beats to stay after arriving. */
  wait?: number;
  /** Face this point while staying. */
  face?: V2;
  /** Play this act on arriving. */
  act?: ActKind;
  /** Called on arriving. */
  then?: () => void;
  /** Arms out in front, carrying something. */
  carry?: boolean;
}

/** A closed polyline on the floor, walked at constant speed. */
class Route {
  private acc: number[] = [0];
  readonly len: number;
  constructor(private pts: V2[]) {
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i % pts.length]!;
      this.acc.push(this.acc[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    this.len = this.acc[this.acc.length - 1]!;
  }
  /** Position and heading (yaw, facing +z at 0) at distance s. */
  at(s: number): { x: number; z: number; yaw: number } {
    s = ((s % this.len) + this.len) % this.len;
    let i = 0;
    while (this.acc[i + 1]! < s) i++;
    const a = this.pts[i]!;
    const b = this.pts[(i + 1) % this.pts.length]!;
    const f = (s - this.acc[i]!) / (this.acc[i + 1]! - this.acc[i]!);
    return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  }
}

interface Walker {
  h: Human;
  route: Route;
  /** Metres per beat. */
  speed: number;
  s: number;
  /** Where on the round it started, and the beats spent off the round (on errands). */
  s0: number;
  away: number;
  yaw: number;
  /** Seated (a driver): no walking legs. */
  seated?: THREE.Group;
  /** A detour in progress, step by step; when done it walks back to where it left its round. */
  errand?: { steps: Errand[]; i: number; until: number; arrived: boolean };
  /** Where it is while on an errand, and its step phase. */
  x: number;
  z: number;
  gait: number;
  /** No high five again before this beat. */
  cool: number;
}

export interface LifeLayout {
  /** Hall walls. */
  wx: number;
  ex: number;
  hz: number;
  /** North wall (further out than the south one). */
  nz: number;
  /** East face of the high-bay rack, its half length and its shelf heights. */
  rackEastX: number;
  rackHalf: number;
  levels: number[];
  /** Front of the control room (x centre, z of the front wall). */
  controlRoom: [number, number];
  /** Wall columns: x positions on the north and south walls. */
  columnsNorth: number[];
  columnsSouth: number[];
}

export class Life {
  private walkers: Walker[] = [];
  private group = new THREE.Group();
  private lastBt = 0;
  /** The scrubber, and the shiny trail it leaves when it draws a heart on the floor. */
  private scrubber: Walker | null = null;
  private trail!: THREE.InstancedMesh;
  private trailMat!: THREE.MeshBasicMaterial;
  private trailN = 0;
  private trailFrom: V2 | null = null;
  private drawing = false;
  private trailDone = -1;
  private nextDoodle = 48;
  private readonly o = new THREE.Object3D();

  constructor(
    private k: FloorKit,
    private L: LifeLayout,
  ) {
    k.put(this.group, 'day');
    this.buildWalkers();
    this.buildCharging();
    this.buildSafety();
    this.buildBreakArea();
    this.buildExtras();
    this.buildFloorNames();
    this.buildTrail();
  }

  update(dt: number, bt: number): void {
    const db = Math.max(0, Math.min(1, bt - this.lastBt));
    this.lastBt = bt;
    for (const w of this.walkers) {
      if (w.errand) {
        w.away += db;
        this.runErrand(w, bt, db, dt);
        continue;
      }
      w.s = w.s0 + (bt - w.away) * w.speed;
      const p = w.route.at(w.s);
      w.x = p.x;
      w.z = p.z;
      let d = p.yaw - w.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      w.yaw += d * Math.min(1, dt * 6);
      w.h.root.position.set(p.x, 0, p.z);
      w.h.root.rotation.y = w.yaw;
      if (w.seated) {
        w.seated.position.set(p.x, 0, p.z);
        w.seated.rotation.y = w.yaw;
        continue;
      }
      // One step per beat; the stride follows the walking speed.
      const swing = gait(w.h, dt, Math.PI * bt + w.h.m.seed * 6.28, w.speed);
      if (w.h.armR.userData.wave) {
        // Father Christmas waves (and carries his sack with the other hand).
        w.h.armR.rotation.x = -2.7;
        w.h.armR.rotation.z = 0.25 + Math.sin(bt * Math.PI * 2) * 0.35;
        w.h.foreR.rotation.x = -0.3 - 0.25 * Math.sin(bt * Math.PI * 2);
        w.h.armL.rotation.x = -0.35;
      } else if (w.h.armR.userData.hold) {
        // The tablet stays in front; the other arm swings.
        swingArms(w.h, swing, 1);
        w.h.armR.rotation.x = -0.5;
        w.h.foreR.rotation.x = -1.2;
        relaxArms(w.h, 1);
      } else swingArms(w.h, swing, 1);
      settle(w.h, dt);
    }
    this.highFives(bt);
    this.updateTrail(bt);
    // Now and then the cleaner draws a heart on the floor with the scrubber (inside the loop, by day).
    if (this.group.visible && bt >= this.nextDoodle) {
      this.nextDoodle = bt + 160 + Math.random() * 160;
      if (Math.random() < 0.7) this.doodle();
    }
  }

  /** Walkers on their rounds who are free (not driving, not on an errand), with their position. */
  private free(): Walker[] {
    // (Not someone with a tablet or a sack in their hands.)
    return this.walkers.filter((w) => !w.seated && !w.errand && w.h.root.parent && !w.h.armR.userData.hold && !w.h.armR.userData.wave);
  }

  /** Send a walker on a detour; afterwards it walks back to its round. */
  send(w: Walker, steps: Errand[]): void {
    w.errand = { steps, i: 0, until: -1, arrived: false };
    w.x = w.h.root.position.x;
    w.z = w.h.root.position.z;
  }

  /** The nearest free walker within `max` metres of (x, z) (by day only), or null. */
  nearest(x: number, z: number, max = 30): Walker | null {
    if (!this.group.visible) return null;
    let best: Walker | null = null;
    let bd = max;
    for (const w of this.free()) {
      const d = Math.hypot(w.x - x, w.z - z);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  /** The person of a walker (for acts). */
  human(w: Walker): Human {
    return w.h;
  }

  /** Coffee! Up to three walkers nearby wander over to the coffee machine, have a sip, and go back. */
  coffee(): number {
    if (!this.group.visible) return 0;
    const at: V2 = [-41.5, 31.0];
    const spots: V2[] = [[-41.5, 30.55], [-40.6, 30.25], [-42.4, 30.25]];
    const ws = this.free()
      .map((w) => ({ w, d: Math.hypot(w.x - at[0], w.z - at[1]) }))
      .filter((x) => x.d < 45)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    ws.forEach(({ w }, i) => {
      // (Round the east side of the control room, then up to the machine.)
      const via: V2[] = w.z < 22 ? [[-42.3, 18.6], [-42.3, 28.6]] : [];
      this.send(w, [...via.map((to) => ({ to, speed: 1.1 })), { to: spots[i]!, speed: 0.9, face: at, wait: 1 + i }, { act: 'drink', face: at, wait: 5 }]);
    });
    return ws.length;
  }

  /** One step of an errand per frame: walk to its point, then do its thing and wait. */
  private runErrand(w: Walker, bt: number, db: number, dt: number): void {
    const e = w.errand!;
    const st = e.steps[e.i];
    // All steps done: back to the round, where it left it.
    const home = w.route.at(w.s);
    const to = st ? (typeof st.to === 'function' ? st.to() : st.to ?? null) : ([home.x, home.z] as V2);
    const speed = st?.speed ?? Math.max(1, w.speed * 1.5);
    let moved = 0;
    if (!e.arrived && to) {
      const dx = to[0] - w.x;
      const dz = to[1] - w.z;
      const d = Math.hypot(dx, dz);
      const step = speed * db;
      if (d <= step || d < 0.02) {
        w.x = to[0];
        w.z = to[1];
        moved = d;
        if (typeof st?.to !== 'function') this.arrive(w, bt);
      } else {
        w.x += (dx / d) * step;
        w.z += (dz / d) * step;
        moved = step;
        this.turn(w, Math.atan2(dx, dz), dt);
      }
      // A function target (a moving thing) counts as reached when close.
      if (typeof st?.to === 'function' && d < 0.55) this.arrive(w, bt);
    } else if (!e.arrived) this.arrive(w, bt);
    if (e.arrived && st?.face) this.turn(w, Math.atan2(st.face[0] - w.x, st.face[1] - w.z), dt);
    if (e.arrived && bt >= e.until) {
      if (!st) {
        // Back on the round.
        w.errand = undefined;
      } else {
        e.i++;
        e.arrived = false;
      }
    }
    const r = w.seated ?? w.h.root;
    r.position.set(w.x, 0, w.z);
    r.rotation.y = w.yaw;
    if (w.seated) return;
    // Steps as long as the stride: faster when running.
    w.gait += moved / 0.75;
    const swing = Math.sin(w.gait * Math.PI) * Math.min(0.8, 0.3 + speed * 0.15) * (moved > 0 ? 1 : 0);
    w.h.legL.rotation.x = swing;
    w.h.legR.rotation.x = -swing;
    const carry = st?.carry;
    w.h.armL.rotation.x = carry ? -1.3 : -swing * 0.8;
    w.h.armR.rotation.x = carry ? -1.3 : w.h.armR.userData.hold ? -0.9 : swing * 0.8;
    w.h.root.position.y = moved > 0 ? Math.abs(Math.cos(w.gait * Math.PI)) * 0.03 * Math.min(2, speed) : 0;
  }

  private arrive(w: Walker, bt: number): void {
    const e = w.errand!;
    if (e.arrived) return;
    e.arrived = true;
    const st = e.steps[e.i];
    e.until = bt + (st?.wait ?? 0);
    if (!st) return;
    if (st.act) ANTICS.play(w.h, st.act, bt);
    st.then?.();
  }

  private turn(w: Walker, want: number, dt: number): void {
    let d = want - w.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    w.yaw += d * Math.min(1, dt * 8);
  }

  /** Two walkers passing each other give each other a high five (and now and then miss). */
  private highFives(bt: number): void {
    const ws = this.free();
    for (let i = 0; i < ws.length; i++) {
      for (let j = i + 1; j < ws.length; j++) {
        const a = ws[i]!;
        const b = ws[j]!;
        if (bt < a.cool || bt < b.cool) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        // Coming towards each other, about a beat apart, passing side by side.
        const fa = [Math.sin(a.yaw), Math.cos(a.yaw)];
        const fb = [Math.sin(b.yaw), Math.cos(b.yaw)];
        if (fa[0]! * fb[0]! + fa[1]! * fb[1]! > -0.8) continue;
        const along = dx * fa[0]! + dz * fa[1]!;
        const across = dx * Math.cos(a.yaw) - dz * Math.sin(a.yaw);
        if (along < 0.9 || along > 1.5 || Math.abs(across) > 1.0 || Math.abs(across) < 0.3) continue;
        const miss = Math.random() < 0.2;
        ANTICS.play(a.h, 'highfive', bt, { side: Math.sign(across), miss });
        // (The other one has the first one on the same side of its own body.)
        ANTICS.play(b.h, 'highfive', bt, { side: Math.sign(across), miss });
        a.cool = b.cool = bt + 12;
      }
    }
  }

  /** The scrubber leaves its round, draws a heart on the floor inside the loop, and goes back. */
  private doodle(): void {
    const w = this.scrubber;
    if (!w || w.errand) return;
    const cx = -36;
    const cz = 2.2;
    const heart: V2[] = [];
    // The classic heart curve, about 4 m wide, its point to the south (towards the camera's usual side).
    for (let i = 0; i <= 28; i++) {
      const t = (i / 28) * Math.PI * 2;
      const hx = 16 * Math.sin(t) ** 3;
      const hz = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      heart.push([cx + hx * 0.13, cz - hz * 0.13]);
    }
    const steps: Errand[] = [{ to: [cx, 10.9], speed: 0.8 }, { to: [cx, 5.6], speed: 0.6 }, { to: heart[0]!, speed: 0.6, then: () => this.startTrail() }];
    for (const p of heart.slice(1)) steps.push({ to: p, speed: 0.55 });
    steps.push({ to: heart[0]!, speed: 0.55, then: () => this.stopTrail() }, { to: [cx, 5.6], speed: 0.6 }, { to: [cx, 10.9], speed: 0.8 });
    this.send(w, steps);
  }

  private startTrail(): void {
    this.trailN = 0;
    this.trail.count = 0;
    this.trailFrom = null;
    this.drawing = true;
    this.trailDone = -1;
    this.trailMat.opacity = 0.6;
  }

  private stopTrail(): void {
    this.drawing = false;
    this.trailDone = this.lastBt;
  }

  /** Lay the trail behind the scrubber's brush while it draws; let it dry (fade) afterwards. */
  private updateTrail(bt: number): void {
    const w = this.scrubber;
    if (w && this.drawing) {
      // The brush is behind the driver.
      const bx = w.x - Math.sin(w.yaw) * 0.8;
      const bz = w.z - Math.cos(w.yaw) * 0.8;
      if (!this.trailFrom || Math.hypot(bx - this.trailFrom[0], bz - this.trailFrom[1]) > 0.18) {
        if (this.trailN < TRAIL_MAX) {
          this.o.position.set(bx, 0.016, bz);
          this.o.rotation.set(-Math.PI / 2, 0, -w.yaw);
          this.o.updateMatrix();
          this.trail.setMatrixAt(this.trailN++, this.o.matrix);
          this.trail.count = this.trailN;
          this.trail.instanceMatrix.needsUpdate = true;
        }
        this.trailFrom = [bx, bz];
      }
    }
    if (this.trailDone >= 0) {
      // It dries in about 40 beats.
      const f = (bt - this.trailDone) / 40;
      this.trailMat.opacity = 0.6 * Math.max(0, 1 - f);
      if (f >= 1) {
        this.trail.count = 0;
        this.trailDone = -1;
      }
    }
  }

  private buildTrail(): void {
    // Wet floor: a shiny, pale blue sheen, see-through.
    this.trailMat = new THREE.MeshBasicMaterial({ color: 0x7fa8cf, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.trail = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.0, 0.32), this.trailMat, TRAIL_MAX);
    this.trail.count = 0;
    this.trail.frustumCulled = false;
    this.trail.userData.noInk = true;
    this.group.add(this.trail);
  }

  /**
   * A walkway on the floor: a band `w` wide round the rectangle x0…x1, −z…z (its centre line),
   * both edges marked with black and yellow diagonal stripes. Day only (at night the inside of
   * the loop is the dance floor).
   */
  /** Lays the walkway; gives back its coating (the Sorter shows that in the realistic look only). */
  addWalkway(x0: number, x1: number, z: number, w: number): THREE.Mesh {
    // The path itself: a ring of coating between the edges.
    const ring = new THREE.Shape();
    const h = w / 2;
    ring.moveTo(x0 - h, -z - h);
    ring.lineTo(x1 + h, -z - h);
    ring.lineTo(x1 + h, z + h);
    ring.lineTo(x0 - h, z + h);
    ring.closePath();
    const hole = new THREE.Path();
    hole.moveTo(x0 + h, -z + h);
    hole.lineTo(x0 + h, z - h);
    hole.lineTo(x1 - h, z - h);
    hole.lineTo(x1 - h, -z + h);
    hole.closePath();
    ring.holes.push(hole);
    // A floor coating only just greener than the concrete (the taped edges do the marking);
    // a touch lighter than meant, as the wear map below is light grey where untouched.
    const coat = this.k.std(0x2b302d, 0.6, 0, 0xccd8cd);
    coat.map = walkwayWear(x0, x1, z, w);
    coat.polygonOffset = true;
    coat.polygonOffsetFactor = -1;
    coat.polygonOffsetUnits = -1;
    const c = new THREE.Mesh(new THREE.ShapeGeometry(ring), coat);
    // (Flat on the floor: the shape's y becomes −z, and the ring is the same both ways.)
    c.rotation.x = -Math.PI / 2;
    c.position.y = 0.008;
    c.userData.noInk = true;
    this.k.put(c, 'day');
    const tex = hazardStripes();
    const strip = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const t = tex.clone();
      t.repeat.set(len / 0.6, 1);
      t.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.12), new THREE.MeshBasicMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.rotation.set(-Math.PI / 2, 0, -Math.atan2(bz - az, bx - ax));
      m.position.set((ax + bx) / 2, 0.014, (az + bz) / 2);
      m.userData.noInk = true;
      this.k.put(m, 'day');
    };
    // Both edges of each side of the rectangle (the corners overlap a little: that is how tape is laid).
    for (const o of [-w / 2, w / 2]) {
      const zo = z + o;
      const xo0 = x0 - o;
      const xo1 = x1 + o;
      strip(xo0 - 0.06, -zo, xo1 + 0.06, -zo);
      strip(xo0 - 0.06, zo, xo1 + 0.06, zo);
      strip(xo0, -zo, xo0, zo);
      strip(xo1, -zo, xo1, zo);
    }
    return c;
  }

  /** Someone walking a round along `pts` (metres per beat), for routes the scene knows best. */
  addWalker(look: Parameters<typeof buildHuman>[1], pts: V2[], speed: number): void {
    const h = buildHuman(this.k, look);
    this.group.add(h.root);
    this.walkers.push(walker(h, new Route(pts), speed, 0));
  }

  // ---------- people and the scrubber ----------

  private buildWalkers(): void {
    const k = this.k;
    const walk = (look: Parameters<typeof buildHuman>[1], pts: V2[], speed: number, phase: number, tablet = false) => {
      const h = buildHuman(k, look);
      this.group.add(h.root);
      if (tablet) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.2), k.std(0x1d1d1f, 0.4, 0.2, 0x1d1d1f));
        t.position.set(0, -0.3, 0.1);
        t.position.set(0, -0.03, 0.1);
        h.handR.add(t);
        h.foreR.rotation.x = -1.2;
        h.armR.userData.hold = true;
      }
      const route = new Route(pts);
      this.walkers.push(walker(h, route, speed, phase * route.len));
    };
    // Team leader with a tablet, round the manual sorting and control room.
    walk({ shirt: 0x6b3fd1, trousers: 0x22283f, cap: 0x1d1d1f }, [[-44, 15.3], [-26, 15.3], [-26, 17.3], [-44, 17.3]], 0.7, 0, true);
    // Two colleagues walking the infeed side.
    if (XMAS) {
      // Father Christmas walks a round by the control room, waving.
      const h = buildHuman(k, { shirt: 0xc8102e, trousers: 0xc8102e, skin: 0xf0cfb0, hair: 0xffffff, santa: true });
      this.group.add(h.root);
      h.armR.userData.wave = true;
      this.walkers.push(walker(h, new Route([[-55, 15], [-46.5, 15], [-46.5, 18.3], [-55, 18.3]]), 0.35, 0));
    }
    walk({ shirt: 0x2fa58f, trousers: 0x3a3d44, vest: 0xc8ff3a, helmet: 0xffffff }, [[-58, 12.6], [-28, 12.6], [-28, 13.6], [-58, 13.6]], 0.6, 0.2);
    // (The other way round, a little to the side: they pass each other, and give each other a high five.)
    walk({ shirt: 0xf3f4f6, trousers: 0x22283f, vest: 0xf2a51a, helmet: 0xf2c200 }, [[-28, 13.2], [-58, 13.2], [-58, 13.0], [-28, 13.0]], 0.6, 0.7);
    // Cleaner on a ride-on scrubber, under the high infeeds.
    const sc = new THREE.Group();
    this.group.add(sc);
    const body = this.k.std(0x2fa58f, 0.5, 0.2, 0x2fa58f);
    const dark = this.k.std(0x1d1d1f, 0.6, 0.2, 0x2a2c31);
    sc.add(new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.7, 1.5, 3, 0.15).translate(0, 0.5, 0), body));
    sc.add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.1, 20).translate(0, 0.08, 0.5), dark));
    sc.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.2).translate(0, 0.06, -0.8), dark));
    sc.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6).rotateX(-0.5).translate(0, 1.05, 0.55), dark));
    sc.add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 14).rotateX(Math.PI / 2.5).translate(0, 1.32, 0.62), dark));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.2, 0.1) }));
    beacon.position.set(0, 1.0, -0.6);
    sc.add(beacon);
    this.k.blobUnder(sc, 1.6, 2.2);
    const driver = buildHuman(this.k, { shirt: 0x1755fe, trousers: 0x22283f, cap: 0x2fa58f });
    driver.root.position.set(0, 0.0, -0.2);
    sit(driver);
    for (const c of [...driver.root.children]) if (c.userData.noInk) driver.root.remove(c);
    const seat = new THREE.Group();
    seat.add(driver.root);
    driver.root.position.y = 0.0;
    sc.add(seat);
    seat.position.y = 0;
    this.scrubber = { ...walker({ ...driver, root: new THREE.Group() }, new Route([[-57, 10.6], [-28, 10.6], [-28, 11.4], [-57, 11.4]]), 0.5, 0), seated: sc };
    this.walkers.push(this.scrubber);
  }

  // ---------- static details ----------

  private buildCharging(): void {
    const k = this.k;
    const z = this.L.hz - 0.4;
    const cab = k.std(0x6b7280, 0.5, 0.5, 0xdfe3e8);
    const green = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.5, 0.4) });
    for (const x of [106.5, 109.5]) {
      k.box('charger', cab, x, 0.9, z, 0.8, 1.8, 0.5);
      k.box('chargerled', green, x - 0.2, 1.5, z - 0.26, 0.12, 0.06, 0.02);
      k.box('chargercable', k.std(0x1d1d1f, 0.6, 0.2, 0x1d1d1f), x + 0.25, 0.6, z - 0.9, 0.05, 0.05, 1.3);
      const f = buildForklift(k, null);
      f.g.position.set(x, 0, z - 2.6);
      f.g.rotation.y = 0;
      f.beacon.color.setRGB(0.2, 1.2, 0.3);
    }
    k.box('chargesign', green, 108, 2.4, z - 0.02, 1.4, 0.4, 0.04);
    k.blob(108, z - 0.2, 5, 1.4);
  }

  private buildSafety(): void {
    const k = this.k;
    const L = this.L;
    // Exit signs: green, lit (so they glow at night too).
    const exit = new THREE.MeshBasicMaterial({ map: exitTex() });
    const place = (x: number, y: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.36, 0.06), [exit, exit, exit, exit, exit, exit]);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      k.put(m);
    };
    for (const z of [-31, 20]) place(L.wx + 0.1, 3.2, z, Math.PI / 2);
    for (const z of [-20, 20]) place(L.ex - 0.1, 3.2, z, -Math.PI / 2);
    // (On the north wall east of the inbound wing, which opens the wall further west.)
    place(-19.5, 4.2, L.nz + 0.1, 0);
    place(-46, 4.2, L.hz - 0.1, Math.PI);
    // Fire extinguishers with a sign, on the columns.
    const red = k.std(0x8a1a14, 0.4, 0.3, 0xe2231a);
    const black = k.std(0x1d1d1f, 0.5, 0.3, 0x1d1d1f);
    const signM = new THREE.MeshBasicMaterial({ map: fireTex() });
    const ext = (x: number, z: number, dir: 1 | -1) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      k.put(g);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 14).translate(0, 0.75, 0), red));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.08, 10).translate(0, 1.04, 0), black));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.03).translate(0.08, 0.86, 0.04 * dir), black));
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), signM);
      s.position.set(0, 1.6, 0.01 * dir);
      if (dir < 0) s.rotation.y = Math.PI;
      g.add(s);
    };
    for (const x of L.columnsNorth) ext(x + 0.55, L.nz + 0.45, 1);
    for (const x of L.columnsSouth) ext(x + 0.55, L.hz - 0.45, -1);
    // First aid box beside the control room door.
    const [cx, cz] = L.controlRoom;
    k.box('firstaid', new THREE.MeshBasicMaterial({ map: firstAidTex() }), cx + 2.9, 1.6, cz - 0.05, 0.5, 0.5, 0.12);
    // A green walkway with white edges and a yellow rail along the robot floor's west end.
    const paint = k.std(0x1f5f4f, 0.9, 0, 0x2fa58f);
    const white = k.std(0x9aa0a8, 0.9, 0, 0xffffff);
    k.box('walkway', paint, -43, 0.011, 13.1, 34, 0.01, 1.6);
    for (const dz of [-0.85, 0.85]) k.box('walkedge', white, -43, 0.012, 13.1 + dz, 34, 0.01, 0.1);
    const rail = k.std(0x8a6e00, 0.5, 0.3, 0xf2c200);
    for (let x = -60; x <= -26; x += 2) k.box('wrail', rail, x, 0.5, 14.1, 0.06, 1.0, 0.06);
    for (const y of [0.5, 1.0]) k.box('wrail', rail, -43, y, 14.1, 34, 0.05, 0.05);
  }

  /** Odds and ends of a working hall: cardboard baler, waste bins, empty pallets, a vending machine. */
  private buildExtras(): void {
    const k = this.k;
    const grey = k.std(0x50545b, 0.5, 0.4, 0xb9c0c8);
    const yellow = k.std(0x8a6e00, 0.5, 0.3, 0xf2c200);
    const dark = k.std(0x1d1d1f, 0.6, 0.2, 0x1d1d1f);
    const card = k.std(0x8a7050, 0.95, 0, 0xc9a06c);
    // Cardboard baler by the west wall: body, a yellow door with a window, a control box, and a finished bale.
    const bx = -60.3;
    const bz = -8;
    k.box('baler', grey, bx, 1.3, bz, 1.6, 2.6, 1.8);
    k.box('baler', grey, bx, 2.9, bz, 1.2, 0.6, 1.2);
    k.box('balerdoor', yellow, bx + 0.82, 1.0, bz, 0.06, 1.6, 1.5);
    k.box('balerwin', dark, bx + 0.86, 1.5, bz, 0.02, 0.35, 1.0);
    k.box('balerctl', dark, bx + 0.82, 1.2, bz - 1.1, 0.2, 0.4, 0.3);
    k.box('bale', card, bx + 0.2, 0.55, bz + 1.8, 1.1, 1.1, 0.8);
    for (const y of [0.25, 0.85]) k.box('balestrap', dark, bx + 0.2, y, bz + 1.8, 1.12, 0.03, 0.82);
    k.blob(bx, bz + 0.6, 2.4, 3.6);
    // Wheelie bins: general, paper, plastic film.
    [0x3a3d44, 0x1755fe, 0x2fa58f].forEach((c, i) => {
      const m = k.std(0x2a2c31, 0.6, 0.1, c);
      const z = -4.2 + i * 1.35;
      k.box('bin', m, -60.9, 0.6, z, 1.0, 1.1, 1.2);
      k.box('binlid', m, -60.85, 1.2, z, 1.06, 0.07, 1.26);
      for (const dz of [-0.45, 0.45]) k.box('binwheel', dark, -61.2, 0.1, z + dz, 0.12, 0.2, 0.2);
    });
    k.blob(-60.9, -2.85, 1.6, 4.4);
    // Stacks of empty pallets.
    const wood = k.std(0x8a6a44, 0.9, 0, 0xd8b080);
    for (const [px, pz, n] of [[-59.6, 29.5, 12], [-59.6, 31.6, 8], [-57.8, 31.6, 15]] as const) {
      for (let i = 0; i < n; i++) k.box('epal', wood, px, 0.07 + i * 0.145, pz, 1.2, 0.13, 1.0, undefined, (i % 3) * 0.02);
      k.blob(px, pz, 1.8, 1.6);
    }
    // Vending machine next to the coffee machine.
    k.box('vend', k.std(0x2a2c31, 0.4, 0.3, 0x2fa58f), -43.1, 0.95, 31.6, 0.9, 1.9, 0.75);
    k.box('vendwin', new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.85, 0.95) }), -43.25, 1.15, 31.21, 0.55, 1.1, 0.02);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      k.box('venditem', k.std(0x444444, 0.6, 0, [0xe2231a, 0xf2c200, 0x1755fe, 0xd6339a][(r + c) % 4]!), -43.45 + c * 0.13, 0.75 + r * 0.26, 31.24, 0.08, 0.12, 0.04);
    }
    k.box('vendpad', dark, -42.8, 1.2, 31.21, 0.16, 0.35, 0.02);
  }

  /**
   * What is left of the old break area (people take their breaks in the canteen now): the coffee
   * machine against the south wall, where people still come for a quick one (tap it).
   */
  private buildBreakArea(): void {
    const k = this.k;
    k.box('coffee', k.std(0x1d1d1f, 0.4, 0.4, 0x1d1d1f), -41.5, 0.9, 31.6, 0.7, 1.8, 0.6);
    k.box('coffeescreen', new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.8, 1.2) }), -41.5, 1.3, 31.28, 0.4, 0.25, 0.02);
    k.blob(-41.5, 31.6, 1.2, 1.0);
  }

  private buildFloorNames(): void {
    const k = this.k;
    const name = (text: string, x: number, z: number, w: number, ry: number, color: string) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 5), new THREE.MeshBasicMaterial({ map: floorText(text, color), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
      m.rotation.set(-Math.PI / 2, 0, ry);
      m.position.set(x, 0.02, z);
      m.userData.noInk = true;
      k.put(m, 'day');
    };
    name('INFEED', -44, 16.6, 8, 0, '#f2a51a');
    name('DOCKS 1–20', -21, -22, 9, Math.PI / 2, '#2fa58f');
    name('ROBOT ZONE', 40, 31.8, 10, 0, '#1755fe');
    name('STORAGE', 112, 12, 8, Math.PI / 2, '#2fa58f');
  }
}

/** Most pieces of trail a heart takes. */
const TRAIL_MAX = 260;

function walker(h: Human, route: Route, speed: number, s0: number): Walker {
  return { h, route, speed, s: s0, s0, away: 0, yaw: 0, x: 0, z: 0, gait: 0, cool: 0 };
}

// ---------- textures ----------

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function exitTex(): THREE.CanvasTexture {
  return canvas(256, 92, (g) => {
    g.fillStyle = '#12a150';
    g.fillRect(0, 0, 256, 92);
    g.fillStyle = '#ffffff';
    // A running figure, an arrow and the word.
    g.beginPath();
    g.arc(40, 22, 8, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(36, 34);
    g.lineTo(30, 56);
    g.lineTo(16, 74);
    g.moveTo(30, 56);
    g.lineTo(46, 72);
    g.moveTo(34, 40);
    g.lineTo(52, 48);
    g.moveTo(34, 40);
    g.lineTo(20, 46);
    g.stroke();
    g.beginPath();
    g.moveTo(70, 46);
    g.lineTo(104, 46);
    g.moveTo(92, 34);
    g.lineTo(104, 46);
    g.lineTo(92, 58);
    g.stroke();
    g.font = '800 44px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('EXIT', 124, 50);
  });
}

function fireTex(): THREE.CanvasTexture {
  return canvas(64, 64, (g) => {
    g.fillStyle = '#e2231a';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffffff';
    g.fillRect(26, 18, 12, 36);
    g.fillRect(22, 12, 20, 6);
    g.beginPath();
    g.moveTo(38, 14);
    g.lineTo(52, 8);
    g.lineTo(52, 14);
    g.fill();
  });
}

function firstAidTex(): THREE.CanvasTexture {
  return canvas(64, 64, (g) => {
    g.fillStyle = '#12a150';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffffff';
    g.fillRect(26, 12, 12, 40);
    g.fillRect(12, 26, 40, 12);
  });
}

function floorText(text: string, color: string): THREE.CanvasTexture {
  return canvas(1024, 205, (g) => {
    g.clearRect(0, 0, 1024, 205);
    g.fillStyle = color;
    g.globalAlpha = 0.8;
    g.font = '900 150px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 512, 110);
  });
}

/** Black and yellow diagonal stripes (floor tape), one repeat 0.6 m long. */
/**
 * Wear on the walkway's coating, one picture over the whole ring (UVs are the shape's metres):
 * a lighter worn line where the manager walks (the middle, more at the corners), shoe scuffs,
 * a few stains and drips, small chips and worn patches, a fine speckle. Light grey where
 * untouched, so it can lighten as well as darken the coating. Seeded: the same every load.
 */
function walkwayWear(x0: number, x1: number, z: number, w: number): THREE.CanvasTexture {
  const h = w / 2;
  const X0 = x0 - h;
  const Y0 = -z - h;
  const W = x1 - x0 + w;
  const D = 2 * z + w;
  const S = 34;
  const cw = Math.min(4096, Math.ceil(W * S));
  const ch = Math.ceil(D * S);
  const sx = cw / W;
  const sy = ch / D;
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d')!;
  const r = new Rng(4711);
  const px = (x: number) => (x - X0) * sx;
  const py = (y: number) => (D - (y - Y0)) * sy;
  g.fillStyle = '#e6e6e6';
  g.fillRect(0, 0, cw, ch);
  // A point somewhere on the ring, with how far it is across it (−1 … 1) and which way the path runs.
  const onRing = (): { x: number; y: number; across: number; along: number } => {
    const side = r.next() * (2 * (x1 - x0) + 4 * z);
    const across = r.next() * 2 - 1;
    if (side < 2 * (x1 - x0)) {
      const top = side < x1 - x0;
      return { x: x0 + (side % (x1 - x0)), y: (top ? z : -z) + across * h, across, along: 0 };
    }
    const t = side - 2 * (x1 - x0);
    const left = t < 2 * z;
    return { x: (left ? x0 : x1) + across * h, y: -z + (t % (2 * z)), across, along: Math.PI / 2 };
  };
  const blot = (x: number, y: number, rad: number, col: string, a: number) => {
    const gr = g.createRadialGradient(px(x), py(y), 0, px(x), py(y), rad * sx);
    gr.addColorStop(0, col.replace('A', String(a)));
    gr.addColorStop(0.6, col.replace('A', String(a * 0.6)));
    gr.addColorStop(1, col.replace('A', '0'));
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(px(x), py(y), rad * sx, rad * sy * (0.6 + r.next() * 0.4), r.next() * Math.PI, 0, Math.PI * 2);
    g.fill();
  };
  // The worn line along the middle: many soft patches, heavier where the walker turns.
  for (let i = 0; i < 2600; i++) {
    const p = onRing();
    const nearCorner = Math.min(Math.abs(p.x - x0), Math.abs(p.x - x1)) < 3 && Math.abs(Math.abs(p.y) - z) < 3;
    const off = p.across * 0.35;
    const x = p.along ? p.x - p.across * h + off : p.x;
    const y = p.along ? p.y : p.y - p.across * h + off;
    blot(x, y, 0.25 + r.next() * 0.45, 'rgba(255,255,255,A)', (nearCorner ? 0.15 : 0.09) * (1 - Math.abs(p.across) * 0.6));
  }
  // Worn patches and chips, lighter (the coating thinned to the concrete).
  for (let i = 0; i < 70; i++) {
    const p = onRing();
    blot(p.x, p.y, 0.1 + r.next() * 0.5, 'rgba(250,246,238,A)', 0.18 + r.next() * 0.16);
  }
  for (let i = 0; i < 260; i++) {
    const p = onRing();
    g.fillStyle = `rgba(248,244,236,${0.2 + r.next() * 0.3})`;
    g.beginPath();
    g.ellipse(px(p.x), py(p.y), 1 + r.next() * 3, 1 + r.next() * 2, r.next() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // Stains: coffee, oil, a dried puddle; darker and soft, a few.
  for (let i = 0; i < 26; i++) {
    const p = onRing();
    blot(p.x, p.y, 0.15 + r.next() * 0.6, r.next() < 0.5 ? 'rgba(40,30,18,A)' : 'rgba(10,12,12,A)', 0.1 + r.next() * 0.1);
    // Drips beside some.
    if (r.next() < 0.4) for (let j = 0; j < 4; j++) blot(p.x + (r.next() - 0.5) * 0.8, p.y + (r.next() - 0.5) * 0.8, 0.03 + r.next() * 0.05, 'rgba(30,24,16,A)', 0.15);
  }
  // Shoe and wheel scuffs: short dark strokes, mostly along the path.
  g.lineCap = 'round';
  for (let i = 0; i < 520; i++) {
    const p = onRing();
    const a = p.along + (r.next() - 0.5) * 0.9 + (r.next() < 0.5 ? 0 : Math.PI);
    const len = 0.05 + r.next() * 0.3;
    g.strokeStyle = `rgba(20,20,20,${0.08 + r.next() * 0.14})`;
    g.lineWidth = 0.6 + r.next() * 1.6;
    g.beginPath();
    g.moveTo(px(p.x), py(p.y));
    g.quadraticCurveTo(px(p.x + Math.cos(a) * len * 0.5) + (r.next() - 0.5) * 3, py(p.y + Math.sin(a) * len * 0.5), px(p.x + Math.cos(a) * len), py(p.y + Math.sin(a) * len));
    g.stroke();
  }
  // A fine speckle all over.
  for (let i = 0; i < 60000; i++) {
    const p = onRing();
    g.fillStyle = r.next() < 0.5 ? `rgba(255,255,255,${r.next() * 0.08})` : `rgba(0,0,0,${r.next() * 0.07})`;
    g.fillRect(px(p.x), py(p.y), 1 + r.next() * 1.5, 1 + r.next() * 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(1 / W, 1 / D);
  t.offset.set(-X0 / W, -Y0 / D);
  return t;
}

function hazardStripes(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2c200';
  g.fillRect(0, 0, 96, 16);
  g.fillStyle = '#1d1d1f';
  for (let x = -32; x < 96 + 32; x += 32) {
    g.beginPath();
    g.moveTo(x, 16);
    g.lineTo(x + 16, 16);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
