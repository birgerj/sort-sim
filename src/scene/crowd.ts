// Night only: a crowd dancing inside the sorter loop, on a floor of LED tiles
// that light up in the chord colours on the beat. Hundreds of dancers, drawn as
// a handful of instanced meshes (body, legs, head, two arms, glow sticks), so
// the crowd costs only a few draw calls.
import * as THREE from 'three';

import type { FloorKit } from './floor';

export interface CrowdInput {
  kick: number;
  snare: number;
  hat: number;
  energy: number;
  cols: THREE.Color[];
  dayShown: boolean;
  /** The camera: dancers out of its view are left out, far ones drawn plain. */
  camera: THREE.Camera;
  /** Metres beyond which a dancer is drawn plain. */
  far: number;
}

interface Dancer {
  x: number;
  z: number;
  /** Their own place, and how far they step aside from it when something stands there. */
  bx: number;
  bz: number;
  ox: number;
  oz: number;
  yaw: number;
  phase: number;
  /** 0 bounce, 1 arms up pumping, 2 sway, 3 glow stick wave. */
  style: number;
  size: number;
  cloth: THREE.Color;
  trousers: THREE.Color;
  skin: THREE.Color;
  hair: THREE.Color;
  shoes: THREE.Color;
}

type PartName = 'body' | 'legs' | 'head' | 'armL' | 'armR' | 'stick' | 'hair' | 'face' | 'shoes' | 'handL' | 'handR';

const SKIN = [0xf3d3b5, 0xd9a77e, 0xc68e64, 0x8d5a3b, 0x5c3a24];
const HAIR = [0x2a1d14, 0x4a3221, 0x7a5a3a, 0xc9a26a, 0x1b1b1d, 0xd6339a, 0x8f8f8f];
const CLOTHES = [0x1d1d1f, 0xf3f4f6, 0x2fa58f, 0xd6339a, 0x6b3fd1, 0x1755fe, 0xf2c200, 0xe2231a, 0x3a3d44, 0x86d3c3];

export class Crowd {
  /** Everything of the crowd (dancers and LED floor); hidden when the night has no crowd. */
  readonly group = new THREE.Group();
  private dancers: Dancer[] = [];
  private parts: Record<PartName, THREE.InstancedMesh>;
  /** The same dancers far away: fewer segments, no face or hands (a few pixels each there). */
  private farParts: Partial<Record<PartName, THREE.InstancedMesh>>;
  private readonly frustum = new THREE.Frustum();
  private readonly pv = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 1.6);
  private tiles: THREE.InstancedMesh;
  private tileXY: [number, number][] = [];
  private lastBeat = -1;
  private readonly m = new THREE.Matrix4();
  private readonly a = new THREE.Matrix4();
  private readonly o = new THREE.Object3D();
  private readonly c = new THREE.Color();
  /** The conga line: who is in it (front first), and the floor it winds round. */
  private conga: number[] = [];
  private floor: [number, number, number, number];

  /** The dance floor: x0…x1, z0…z1 (inside the loop). */
  constructor(k: FloorKit, x0: number, x1: number, z0: number, z1: number, count: number) {
    k.put(this.group, 'night');
    this.floor = [x0, x1, z0, z1];
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05 });
    const mk = (geo: THREE.BufferGeometry, m: THREE.Material = mat) => {
      const im = new THREE.InstancedMesh(geo, m, count);
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      im.frustumCulled = false;
      this.group.add(im);
      return im;
    };
    const legs = new THREE.CapsuleGeometry(0.085, 0.62, 3, 8);
    const legsGeo = mergeTwo(legs.clone().translate(-0.1, 0.42, 0), legs.clone().translate(0.1, 0.42, 0));
    this.parts = {
      body: mk(new THREE.CapsuleGeometry(0.2, 0.36, 4, 10).scale(1.15, 1, 0.75).translate(0, 1.2, 0)),
      legs: mk(legsGeo),
      head: mk(new THREE.SphereGeometry(0.14, 12, 10).translate(0, 1.68, 0)),
      // Arms hang from the shoulder (the instance origin is the shoulder).
      armL: mk(new THREE.CapsuleGeometry(0.055, 0.5, 3, 6).translate(0, -0.3, 0)),
      armR: mk(new THREE.CapsuleGeometry(0.055, 0.5, 3, 6).translate(0, -0.3, 0)),
      stick: mk(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6).translate(0, -0.65, 0), new THREE.MeshBasicMaterial({ color: 0xffffff })),
      // Hair on the back and top of the head; eyes and mouth; shoes; hands.
      hair: mk(new THREE.SphereGeometry(0.146, 12, 8, Math.PI, Math.PI, 0, Math.PI * 0.62).scale(1, 1.08, 1.04).translate(0, 1.69, -0.006)),
      face: mk(
        mergeTwo(
          mergeTwo(new THREE.SphereGeometry(0.018, 6, 4).translate(-0.05, 1.71, 0.128), new THREE.SphereGeometry(0.018, 6, 4).translate(0.05, 1.71, 0.128)),
          new THREE.BoxGeometry(0.05, 0.01, 0.01).translate(0, 1.62, 0.132),
        ),
        new THREE.MeshBasicMaterial({ color: 0x15161a }),
      ),
      shoes: mk(mergeTwo(new THREE.BoxGeometry(0.13, 0.09, 0.26).translate(-0.1, 0.045, 0.04), new THREE.BoxGeometry(0.13, 0.09, 0.26).translate(0.1, 0.045, 0.04))),
      handL: mk(new THREE.SphereGeometry(0.055, 8, 6).translate(0, -0.6, 0)),
      handR: mk(new THREE.SphereGeometry(0.055, 8, 6).translate(0, -0.6, 0)),
    };
    const farLegs = new THREE.CapsuleGeometry(0.085, 0.62, 1, 4);
    this.farParts = {
      body: mk(new THREE.CapsuleGeometry(0.2, 0.36, 1, 6).scale(1.15, 1, 0.75).translate(0, 1.2, 0)),
      legs: mk(mergeTwo(farLegs.clone().translate(-0.1, 0.42, 0), farLegs.clone().translate(0.1, 0.42, 0))),
      head: mk(new THREE.SphereGeometry(0.14, 6, 4).translate(0, 1.68, 0)),
      armL: mk(new THREE.CapsuleGeometry(0.055, 0.5, 1, 4).translate(0, -0.3, 0)),
      armR: mk(new THREE.CapsuleGeometry(0.055, 0.5, 1, 4).translate(0, -0.3, 0)),
      stick: mk(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 4).translate(0, -0.65, 0), this.parts.stick.material as THREE.Material),
      hair: mk(new THREE.SphereGeometry(0.146, 6, 4, Math.PI, Math.PI, 0, Math.PI * 0.62).scale(1, 1.08, 1.04).translate(0, 1.69, -0.006)),
      shoes: mk(new THREE.BoxGeometry(0.33, 0.09, 0.26).translate(0, 0.045, 0.04)),
    };
    for (const im of [...Object.values(this.parts), ...Object.values(this.farParts)]) im.count = 0;
    for (let i = 0; i < count; i++) {
      // Packed most densely in the middle of the floor.
      const u = Math.random();
      const x = x0 + 1 + (x1 - x0 - 2) * (0.5 + (u - 0.5) * (0.6 + 0.4 * Math.random()));
      const z = z0 + 0.8 + Math.random() * (z1 - z0 - 1.6);
      this.dancers.push({
        x,
        z,
        bx: x,
        bz: z,
        ox: 0,
        oz: 0,
        yaw: Math.random() * Math.PI * 2,
        phase: Math.random(),
        style: Math.floor(Math.random() * 4),
        size: 0.9 + Math.random() * 0.2,
        cloth: new THREE.Color(CLOTHES[i % CLOTHES.length]!),
        trousers: new THREE.Color([0x22283f, 0x1d1d1f, 0x3d4b8f, 0x6b7280][i % 4]!),
        skin: new THREE.Color(SKIN[i % SKIN.length]!),
        hair: new THREE.Color(HAIR[(i * 7) % HAIR.length]!),
        shoes: new THREE.Color([0xf3f4f6, 0x1d1d1f, 0xe2231a, 0x1755fe, 0x1d1d1f][i % 5]!),
      });
    }
    // LED dance floor tiles.
    const T = 1.6;
    for (let x = x0 + T / 2; x < x1; x += T) for (let z = z0 + T / 2; z < z1; z += T) this.tileXY.push([x, z]);
    this.tiles = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(T * 0.92, T * 0.92).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
      this.tileXY.length,
    );
    this.tileXY.forEach(([x, z], i) => {
      this.o.position.set(x, 0.015, z);
      this.o.updateMatrix();
      this.tiles.setMatrixAt(i, this.o.matrix);
      this.tiles.setColorAt(i, this.c.setRGB(0, 0, 0));
    });
    this.tiles.frustumCulled = false;
    this.group.add(this.tiles);
    for (const im of [...Object.values(this.parts), ...Object.values(this.farParts), this.tiles]) im.userData.noInk = true;
    // Fourteen dancers from all over the floor join the conga line when it starts.
    for (let n = 0; n < 14; n++) this.conga.push(Math.floor(((n + 0.5) / 14) * count));
  }

  /**
   * Where a conga dancer is now (null: not in the line). Every 24 bars, for 36 beats: four beats to
   * join, a long winding round of the dance floor, four beats back to their place.
   */
  private congaAt(n: number, d: Dancer, bt: number, out: { x: number; z: number; yaw: number; w: number }): boolean {
    const t = (((bt - 48) % 96) + 96) % 96;
    if (t >= 36) return false;
    // A loop at the DJ's end of the floor (the west end), where people look most.
    const [x0, , z0, z1] = this.floor;
    const rx = 9;
    const cx = x0 + 2 + rx;
    const cz = (z0 + z1) / 2;
    const rz = (z1 - z0) / 2 - 1.4;
    // The leader goes round at a steady walk; each one 0.8 m behind the one in front.
    const avg = (rx + rz) / 2;
    const a = (Math.max(0, Math.min(32, t) - 4) * 0.9 - n * 0.8) / avg + Math.PI * 0.5;
    const px = cx + Math.cos(a) * rx;
    const pz = cz + Math.sin(a) * rz * (1 + 0.25 * Math.sin(a * 3));
    // Into the line and out of it again.
    const w = Math.min(1, t / 4, (36 - t) / 4);
    const e = w * w * (3 - 2 * w);
    out.x = d.x + (px - d.x) * e;
    out.z = d.z + (pz - d.z) * e;
    out.yaw = Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz);
    out.w = e;
    return true;
  }
  private readonly cg = { x: 0, z: 0, yaw: 0, w: 0 };

  /** Places to keep clear (round), and whether to keep clear of them now (the dancers step aside). */
  private avoidOn = false;
  private avoidF = 0;
  setAvoid(spots: { x: number; z: number; r: number }[], on: boolean, now = false): void {
    this.avoidOn = on;
    // (At once, without the walk aside: as the hall is built.)
    if (now) {
      this.avoidF = on ? 1 : 0;
      for (const d of this.dancers) {
        d.x = d.bx;
        d.z = d.bz;
      }
    }
    for (const d of this.dancers) {
      d.ox = d.oz = 0;
      for (const sp of spots) {
        const dx = d.bx - sp.x;
        const dz = d.bz - sp.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= sp.r) continue;
        // Out to the edge of the circle, the way they already were from its middle.
        const a = dist > 0.01 ? Math.atan2(dz, dx) : d.phase * Math.PI * 2;
        const to = sp.r + d.phase * 0.6;
        d.ox = sp.x + Math.cos(a) * to - d.bx;
        d.oz = sp.z + Math.sin(a) * to - d.bz;
      }
      if (now && on) {
        d.x = d.bx + d.ox;
        d.z = d.bz + d.oz;
      }
    }
  }

  update(dt: number, bt: number, s: CrowdInput): void {
    if (s.dayShown || !this.group.visible) return;
    // Stepping aside (or back) takes a couple of seconds.
    const want = this.avoidOn ? 1 : 0;
    if (this.avoidF !== want) {
      this.avoidF = want ? Math.min(1, this.avoidF + dt * 0.6) : Math.max(0, this.avoidF - dt * 0.6);
      const e = this.avoidF * this.avoidF * (3 - 2 * this.avoidF);
      for (const d of this.dancers) {
        d.x = d.bx + d.ox * e;
        d.z = d.bz + d.oz * e;
      }
    }
    const beat = Math.floor(bt);
    const ph = bt - beat;
    const hype = 0.4 + 0.6 * s.energy;
    // The LED floor: a new pattern on every beat (rings, stripes, checks), fading through it.
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      const pattern = Math.floor(beat / 4) % 3;
      this.tileXY.forEach(([x, z], i) => {
        const v = pattern === 0 ? Math.floor(Math.hypot(x - 40, z) / 3) : pattern === 1 ? Math.floor(x / 3.2) : Math.floor(x / 1.6) + Math.floor(z / 1.6);
        const on = Math.abs(v + beat) % (pattern === 2 ? 2 : 3) === 0;
        this.tiles.setColorAt(i, on ? this.c.copy(s.cols[(((v + beat) % s.cols.length) + s.cols.length) % s.cols.length]!) : this.c.setRGB(0.02, 0.02, 0.04));
      });
      if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    }
    (this.tiles.material as THREE.MeshBasicMaterial).opacity = (0.25 + 0.5 * (1 - ph) ** 2) * hype;
    const o = this.o;
    // Only the dancers in view are drawn (packed to the front of the instance buffers, so the
    // rest cost nothing), near ones in full, far ones plain.
    this.pv.multiplyMatrices(s.camera.projectionMatrix, s.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const cam = s.camera.position;
    const far2 = s.far * s.far;
    let nNear = 0;
    let nFar = 0;
    this.dancers.forEach((d, i) => {
      this.sphere.center.set(d.x, 1, d.z);
      // (Conga dancers wander: give them room.)
      this.sphere.radius = this.conga.includes(i) ? 30 : 1.6;
      if (!this.frustum.intersectsSphere(this.sphere)) return;
      const isFar = (d.x - cam.x) ** 2 + (d.z - cam.z) ** 2 + (1 - cam.y) ** 2 > far2;
      const P = (isFar ? this.farParts : this.parts) as Partial<Record<PartName, THREE.InstancedMesh>>;
      const j = isFar ? nFar++ : nNear++;
      P.body!.setColorAt(j, d.cloth);
      P.armL!.setColorAt(j, d.cloth);
      P.armR!.setColorAt(j, d.cloth);
      P.legs!.setColorAt(j, d.trousers);
      P.head!.setColorAt(j, d.skin);
      P.handL?.setColorAt(j, d.skin);
      P.handR?.setColorAt(j, d.skin);
      P.hair!.setColorAt(j, d.hair);
      P.shoes!.setColorAt(j, d.shoes);
      const t = bt + d.phase * 0.25;
      const bounce = Math.abs(Math.sin(t * Math.PI)) * 0.1 * hype + s.kick * 0.04;
      const sway = Math.sin(t * Math.PI * 0.5) * (d.style === 2 ? 0.35 : 0.12);
      const n = this.conga.indexOf(i);
      const cg = n >= 0 && this.congaAt(n, d, bt, this.cg) ? this.cg : null;
      if (cg) {
        // In the conga: hands on the shoulders of the one in front, a kick to the side on every fourth beat.
        let dy = cg.yaw - d.yaw;
        while (dy > Math.PI) dy -= 2 * Math.PI;
        while (dy < -Math.PI) dy += 2 * Math.PI;
        const kick = Math.floor(bt) % 4 === 3 ? Math.sin((bt % 1) * Math.PI) : 0;
        o.position.set(cg.x, bounce * 0.6, cg.z);
        o.rotation.set(0, d.yaw + dy * cg.w, (Math.sin(t * Math.PI) * 0.06 + kick * 0.18) * (n % 2 ? 1 : -1));
      } else {
        o.position.set(d.x, bounce, d.z);
        o.rotation.set(0, d.yaw + sway, Math.sin(t * Math.PI) * 0.06);
      }
      o.scale.setScalar(d.size);
      o.updateMatrix();
      this.m.copy(o.matrix);
      P.body?.setMatrixAt(j, this.m);
      P.legs?.setMatrixAt(j, this.m);
      P.head?.setMatrixAt(j, this.m);
      P.hair?.setMatrixAt(j, this.m);
      P.face?.setMatrixAt(j, this.m);
      P.shoes?.setMatrixAt(j, this.m);
      // Arms: down and swinging, pumping up on the beat, or waving.
      let l = 0.3 * Math.sin(t * Math.PI);
      let r = -l;
      if (d.style === 1 || (d.style === 0 && s.energy > 0.7)) {
        l = -2.6 - 0.5 * Math.abs(Math.sin(t * Math.PI));
        r = -2.6 - 0.5 * Math.abs(Math.cos(t * Math.PI));
      } else if (d.style === 3) {
        r = -2.8;
        l = 0.2 * Math.sin(t * Math.PI);
      }
      if (cg) {
        // Arms straight forward (onto the shoulders in front).
        l += (-1.45 - l) * cg.w;
        r += (-1.45 - r) * cg.w;
      }
      const wave = d.style === 3 && !cg ? Math.sin(t * Math.PI) * 0.6 : 0;
      this.a.makeTranslation(-0.3, 1.46, 0).multiply(new THREE.Matrix4().makeRotationX(l));
      P.armL?.setMatrixAt(j, this.a.premultiply(this.m));
      P.handL?.setMatrixAt(j, this.a);
      this.a.makeTranslation(0.3, 1.46, 0).multiply(new THREE.Matrix4().makeRotationZ(wave)).multiply(new THREE.Matrix4().makeRotationX(r));
      this.a.premultiply(this.m);
      P.armR?.setMatrixAt(j, this.a);
      P.handR?.setMatrixAt(j, this.a);
      // Glow sticks for the wavers.
      if (d.style === 3 && !cg) {
        P.stick?.setMatrixAt(j, this.a);
        P.stick!.setColorAt(j, this.c.copy(s.cols[i % s.cols.length]!).multiplyScalar(1.5 + s.hat));
      } else {
        o.scale.setScalar(0);
        o.updateMatrix();
        P.stick?.setMatrixAt(j, o.matrix);
      }
    });
    for (const [set, n] of [[this.parts, nNear], [this.farParts, nFar]] as const) {
      for (const im of Object.values(set) as THREE.InstancedMesh[]) {
        im.count = n;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
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
