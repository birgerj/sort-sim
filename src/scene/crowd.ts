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
}

interface Dancer {
  x: number;
  z: number;
  yaw: number;
  phase: number;
  /** 0 bounce, 1 arms up pumping, 2 sway, 3 glow stick wave. */
  style: number;
  size: number;
}

const SKIN = [0xf3d3b5, 0xd9a77e, 0xc68e64, 0x8d5a3b, 0x5c3a24];
const HAIR = [0x2a1d14, 0x4a3221, 0x7a5a3a, 0xc9a26a, 0x1b1b1d, 0xd6339a, 0x8f8f8f];
const CLOTHES = [0x1d1d1f, 0xf3f4f6, 0x2fa58f, 0xd6339a, 0x6b3fd1, 0x1755fe, 0xf2c200, 0xe2231a, 0x3a3d44, 0x86d3c3];

export class Crowd {
  /** Everything of the crowd (dancers and LED floor); hidden when the night has no crowd. */
  readonly group = new THREE.Group();
  private dancers: Dancer[] = [];
  private parts: Record<'body' | 'legs' | 'head' | 'armL' | 'armR' | 'stick' | 'hair' | 'face' | 'shoes' | 'handL' | 'handR', THREE.InstancedMesh>;
  private tiles: THREE.InstancedMesh;
  private tileXY: [number, number][] = [];
  private lastBeat = -1;
  private readonly m = new THREE.Matrix4();
  private readonly a = new THREE.Matrix4();
  private readonly o = new THREE.Object3D();
  private readonly c = new THREE.Color();

  /** The dance floor: x0…x1, z0…z1 (inside the loop). */
  constructor(k: FloorKit, x0: number, x1: number, z0: number, z1: number, count: number) {
    k.put(this.group, 'night');
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
    for (let i = 0; i < count; i++) {
      // Packed most densely in the middle of the floor.
      const u = Math.random();
      const x = x0 + 1 + (x1 - x0 - 2) * (0.5 + (u - 0.5) * (0.6 + 0.4 * Math.random()));
      const z = z0 + 0.8 + Math.random() * (z1 - z0 - 1.6);
      const d: Dancer = { x, z, yaw: Math.random() * Math.PI * 2, phase: Math.random(), style: Math.floor(Math.random() * 4), size: 0.9 + Math.random() * 0.2 };
      this.dancers.push(d);
      const cloth = this.c.setHex(CLOTHES[i % CLOTHES.length]!);
      this.parts.body.setColorAt(i, cloth);
      this.parts.armL.setColorAt(i, cloth);
      this.parts.armR.setColorAt(i, cloth);
      this.parts.legs.setColorAt(i, this.c.setHex([0x22283f, 0x1d1d1f, 0x3d4b8f, 0x6b7280][i % 4]!));
      this.parts.head.setColorAt(i, this.c.setHex(SKIN[i % SKIN.length]!));
      this.parts.handL.setColorAt(i, this.c);
      this.parts.handR.setColorAt(i, this.c);
      this.parts.hair.setColorAt(i, this.c.setHex(HAIR[(i * 7) % HAIR.length]!));
      this.parts.shoes.setColorAt(i, this.c.setHex([0xf3f4f6, 0x1d1d1f, 0xe2231a, 0x1755fe, 0x1d1d1f][i % 5]!));
    }
    for (const im of Object.values(this.parts)) if (im.instanceColor) im.instanceColor.needsUpdate = true;
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
    for (const im of [...Object.values(this.parts), this.tiles]) im.userData.noInk = true;
  }

  update(dt: number, bt: number, s: CrowdInput): void {
    void dt;
    if (s.dayShown || !this.group.visible) return;
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
    this.dancers.forEach((d, i) => {
      const t = bt + d.phase * 0.25;
      const bounce = Math.abs(Math.sin(t * Math.PI)) * 0.1 * hype + s.kick * 0.04;
      const sway = Math.sin(t * Math.PI * 0.5) * (d.style === 2 ? 0.35 : 0.12);
      o.position.set(d.x, bounce, d.z);
      o.rotation.set(0, d.yaw + sway, Math.sin(t * Math.PI) * 0.06);
      o.scale.setScalar(d.size);
      o.updateMatrix();
      this.m.copy(o.matrix);
      this.parts.body.setMatrixAt(i, this.m);
      this.parts.legs.setMatrixAt(i, this.m);
      this.parts.head.setMatrixAt(i, this.m);
      this.parts.hair.setMatrixAt(i, this.m);
      this.parts.face.setMatrixAt(i, this.m);
      this.parts.shoes.setMatrixAt(i, this.m);
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
      const wave = d.style === 3 ? Math.sin(t * Math.PI) * 0.6 : 0;
      this.a.makeTranslation(-0.3, 1.46, 0).multiply(new THREE.Matrix4().makeRotationX(l));
      this.parts.armL.setMatrixAt(i, this.a.premultiply(this.m));
      this.parts.handL.setMatrixAt(i, this.a);
      this.a.makeTranslation(0.3, 1.46, 0).multiply(new THREE.Matrix4().makeRotationZ(wave)).multiply(new THREE.Matrix4().makeRotationX(r));
      this.a.premultiply(this.m);
      this.parts.armR.setMatrixAt(i, this.a);
      this.parts.handR.setMatrixAt(i, this.a);
      // Glow sticks for the wavers.
      if (d.style === 3) {
        this.parts.stick.setMatrixAt(i, this.a);
        this.parts.stick.setColorAt(i, this.c.copy(s.cols[i % s.cols.length]!).multiplyScalar(1.5 + s.hat));
      } else {
        o.scale.setScalar(0);
        o.updateMatrix();
        this.parts.stick.setMatrixAt(i, o.matrix);
      }
    });
    for (const im of Object.values(this.parts)) im.instanceMatrix.needsUpdate = true;
    if (this.parts.stick.instanceColor) this.parts.stick.instanceColor.needsUpdate = true;
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
