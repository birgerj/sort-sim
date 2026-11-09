// The night party: a DJ on the infeed mezzanine with decks and speakers, laser
// fans sweeping the hall from the booth, mirror-ball spots wandering over the
// floor, and confetti when the groove drops in. Night only.
import * as THREE from 'three';

import type { FloorKit } from './floor';
import { buildHuman, type Human } from './people';

export interface PartyInput {
  kick: number;
  snare: number;
  hat: number;
  energy: number;
  bar: number;
  cols: THREE.Color[];
  dayShown: boolean;
}

const FANS = 10;
const SPOTS = 90;
const CONFETTI = 500;

const glowTex = (() => {
  let t: THREE.CanvasTexture | null = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    t = new THREE.CanvasTexture(c);
    return t;
  };
})();

export class Party {
  private group = new THREE.Group();
  private dj: Human;
  private djBase: THREE.Vector3;
  private panel: THREE.MeshBasicMaterial;
  private fans: THREE.InstancedMesh;
  private fanFrom: THREE.Vector3;
  private spots: THREE.InstancedMesh;
  private spotDirs: THREE.Vector3[] = [];
  private confetti: THREE.InstancedMesh;
  private bits: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; spin: THREE.Vector3; life: number }[] = [];
  private lastDrop = -1;
  private readonly o = new THREE.Object3D();
  private readonly c = new THREE.Color();
  private readonly q = new THREE.Quaternion();
  private readonly t = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    k: FloorKit,
    /** Where the DJ stands (on the mezzanine, facing +x). */
    dj: THREE.Vector3,
    /** Mirror ball centre. */
    private ball: THREE.Vector3,
    /** Area the confetti falls over: x0, x1, z0, z1. */
    private area: [number, number, number, number],
  ) {
    k.put(this.group, 'night');
    // Booth: a table with two decks and a mixer, a lit front panel, speaker stacks either side.
    const black = k.std(0x111114, 0.5, 0.3, 0x1d1d1f);
    const grey = k.std(0x3a3d44, 0.4, 0.6, 0x6b7280);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(dj.x + x, dj.y + y, dj.z + z);
      this.group.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(0.7, 1.0, 1.9), black, 0.6, 0.5, 0);
    for (const dz of [-0.55, 0.55]) add(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 24), grey, 0.6, 1.02, dz);
    add(new THREE.BoxGeometry(0.3, 0.06, 0.4), grey, 0.6, 1.03, 0);
    this.panel = new THREE.MeshBasicMaterial({ color: 0x000000 });
    add(new THREE.PlaneGeometry(1.8, 0.8), this.panel, 0.96, 0.5, 0).rotation.y = Math.PI / 2;
    // Speaker stacks behind the DJ, facing the hall.
    for (const dz of [-0.7, 0.7]) {
      for (let s = 0; s < 2; s++) {
        add(new THREE.BoxGeometry(0.5, 0.7, 0.55), black, -0.75, 0.35 + s * 0.72, dz);
        add(new THREE.CircleGeometry(0.2, 18), grey, -0.49, 0.35 + s * 0.72, dz).rotation.y = Math.PI / 2;
      }
    }
    this.dj = buildHuman(k, { shirt: 0x1d1d1f, trousers: 0x22283f, cap: 0xd6339a });
    for (const c of [...this.dj.root.children]) if (c.userData.noInk) this.dj.root.remove(c);
    this.djBase = dj.clone();
    this.dj.root.position.copy(dj);
    this.dj.root.rotation.y = Math.PI / 2;
    this.group.add(this.dj.root);
    // Laser fans from the booth.
    this.fanFrom = dj.clone().add(new THREE.Vector3(0.9, 1.4, 0));
    const lm = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.fans = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 5, 1, true), lm, FANS);
    this.fans.setColorAt(0, new THREE.Color(1, 1, 1));
    this.fans.frustumCulled = false;
    this.group.add(this.fans);
    // Mirror-ball spots on the floor.
    for (let i = 0; i < SPOTS; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, -Math.random() * 0.9 - 0.1, Math.random() - 0.5).normalize();
      this.spotDirs.push(d);
    }
    const sm = new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff });
    this.spots = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), sm, SPOTS);
    this.spots.frustumCulled = false;
    this.group.add(this.spots);
    // Confetti.
    const cm = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.08), cm, CONFETTI);
    this.confetti.setColorAt(0, new THREE.Color(1, 1, 1));
    this.confetti.frustumCulled = false;
    this.confetti.count = 0;
    this.group.add(this.confetti);
    for (const m of [this.fans, this.spots, this.confetti]) m.userData.noInk = true;
  }

  /** What of the party shows: the booth and DJ, laser fans, mirror-ball floor spots, confetti. */
  setShow(on: { dj: boolean; lasers: boolean; ball: boolean; confetti: boolean }): void {
    for (const c of this.group.children) {
      if (c === this.fans) c.visible = on.lasers;
      else if (c === this.spots) c.visible = on.ball;
      else if (c === this.confetti) c.visible = on.confetti;
      else c.visible = on.dj;
    }
  }

  update(dt: number, bt: number, s: PartyInput): void {
    if (s.dayShown) return;
    const o = this.o;
    // DJ: bounce on the kick, nod, one hand on the deck, the other up on the snare.
    const d = this.dj;
    d.root.position.copy(this.djBase).setY(this.djBase.y + 0.06 * s.kick);
    d.torso.rotation.x = 0.12 * s.kick;
    d.armL.rotation.x = -1.1;
    d.armR.rotation.x = -1.2 - 1.6 * s.snare;
    d.legL.rotation.x = -0.1 * s.kick;
    d.legR.rotation.x = 0.1 * s.kick;
    this.panel.color.copy(s.cols[Math.floor(bt) % s.cols.length]!).multiplyScalar(0.6 + s.kick * 1.4);
    // Laser fans: switched off (they crossed the whole hall); kept for an easy return.
    const on = false && s.energy > 0.5;
    const sweep = Math.sin((s.bar % 2) * Math.PI) * 0.6;
    for (let i = 0; i < FANS; i++) {
      if (!on) {
        o.scale.set(0, 0, 0);
        o.updateMatrix();
        this.fans.setMatrixAt(i, o.matrix);
        continue;
      }
      const a = (i / (FANS - 1) - 0.5) * 1.1 + sweep;
      const dir = this.t.set(Math.cos(a), -0.06 - 0.04 * Math.sin(bt * Math.PI + i), Math.sin(a)).normalize();
      const len = 90;
      o.position.copy(this.fanFrom).addScaledVector(dir, len / 2);
      this.q.setFromUnitVectors(this.up, dir);
      o.quaternion.copy(this.q);
      o.scale.set(1, len, 1);
      o.updateMatrix();
      this.fans.setMatrixAt(i, o.matrix);
      this.fans.setColorAt(i, this.c.copy(s.cols[i % s.cols.length]!).multiplyScalar(0.6 + s.hat));
    }
    this.fans.instanceMatrix.needsUpdate = true;
    if (this.fans.instanceColor) this.fans.instanceColor.needsUpdate = true;
    // Mirror-ball spots, turning slowly.
    const rot = bt * 0.25;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    this.spotDirs.forEach((dir, i) => {
      const x = dir.x * cr - dir.z * sr;
      const z = dir.x * sr + dir.z * cr;
      const t = (0.04 - this.ball.y) / dir.y;
      o.position.set(this.ball.x + x * t, 0.04, this.ball.z + z * t);
      o.quaternion.identity();
      const sc = 0.35 + 0.25 * s.hat;
      o.scale.set(sc, 1, sc);
      o.updateMatrix();
      this.spots.setMatrixAt(i, o.matrix);
    });
    this.spots.instanceMatrix.needsUpdate = true;
    (this.spots.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * s.kick;
    // Confetti when the groove comes in (bar 8 of every 32), falling over the loop.
    const bar = Math.floor(s.bar);
    if (bar % 32 === 8 && bar !== this.lastDrop) {
      this.lastDrop = bar;
      const [x0, x1, z0, z1] = this.area;
      this.bits = [];
      for (let i = 0; i < CONFETTI; i++) {
        this.bits.push({
          p: new THREE.Vector3(x0 + Math.random() * (x1 - x0), 9 + Math.random() * 1.5, z0 + Math.random() * (z1 - z0)),
          v: new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.6 - Math.random() * 0.6, (Math.random() - 0.5) * 0.6),
          r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0),
          spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, 0),
          life: 1,
        });
        this.confetti.setColorAt(i, this.c.copy(s.cols[i % s.cols.length]!).lerp(new THREE.Color(1, 1, 1), Math.random() * 0.4));
      }
      if (this.confetti.instanceColor) this.confetti.instanceColor.needsUpdate = true;
    }
    let n = 0;
    for (const b of this.bits) {
      if (b.p.y <= 0.02) {
        b.p.y = 0.02;
        b.life -= dt * 0.08;
      } else {
        b.p.addScaledVector(b.v, dt);
        b.p.x += Math.sin(bt * 3 + b.r.x) * dt * 0.3;
        b.r.x += b.spin.x * dt;
        b.r.y += b.spin.y * dt;
      }
      if (b.life <= 0) continue;
      o.position.copy(b.p);
      o.rotation.copy(b.p.y <= 0.02 ? new THREE.Euler(-Math.PI / 2, 0, b.r.y) : b.r);
      o.scale.setScalar(1);
      o.updateMatrix();
      this.confetti.setMatrixAt(n++, o.matrix);
    }
    this.confetti.count = n;
    this.confetti.instanceMatrix.needsUpdate = true;
  }
}
