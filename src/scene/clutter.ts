// Small work tables by the chutes, each with its own odds and ends: papers, a
// clipboard, coffee cups, a roll of tape, markers, a hand scanner, a box
// cutter, sticky notes, gloves, a water bottle, a phone. Every kind of thing is
// one instanced mesh for all the tables, so they cost a few draw calls.
import * as THREE from 'three';
import { specks } from './realDay';

import type { FloorKit } from './floor';
import { Rng } from '../sim/rng';

interface Kind {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  items: { m: THREE.Matrix4; c: THREE.Color }[];
}

const TOP_Y = 0.92;
/** Table size factor: 1.5× the top area of a plain 0.64 × 1.26 m table. */
const F = Math.sqrt(1.5);

export class Clutter {
  private kinds = new Map<string, Kind>();
  private readonly o = new THREE.Object3D();
  private white: THREE.Material;
  private shiny: THREE.Material;
  private glow: THREE.Material;
  /** The tables' own materials, shared by all of them (one batch each). */
  private tableMats: { top: THREE.MeshStandardMaterial; edge: THREE.MeshStandardMaterial; frame: THREE.MeshStandardMaterial; shelf: THREE.MeshStandardMaterial } | null = null;

  constructor(private k: FloorKit) {
    this.white = k.std(0xffffff, 0.75, 0, 0xffffff);
    this.shiny = k.std(0xffffff, 0.3, 0.1, 0xffffff);
    this.glow = new THREE.MeshBasicMaterial({ color: 0xffffff });
  }

  private kind(name: string, make: () => THREE.BufferGeometry, mat = this.white): Kind {
    let k = this.kinds.get(name);
    if (!k) this.kinds.set(name, (k = { geo: make(), mat, items: [] }));
    return k;
  }

  /** Put one thing on the table: local x (across), y (above the top), z (along), turn, tilt. */
  private add(kind: Kind, base: THREE.Matrix4, x: number, y: number, z: number, color: number, ry = 0, rx = 0, rz = 0): void {
    const o = this.o;
    o.position.set(x, TOP_Y + y, z);
    o.rotation.set(rx, ry, rz);
    o.scale.set(1, 1, 1);
    o.updateMatrix();
    kind.items.push({ m: o.matrix.clone().premultiply(base), c: new THREE.Color(color) });
  }

  /** A table at (x, z), its long side along `yaw`, with things chosen by `seed`. */
  table(x: number, z: number, yaw: number, seed: number): void {
    const k = this.k;
    const r = new Rng(seed);
    const rnd = (a: number, b: number) => a + r.next() * (b - a);
    const pick = <T>(a: T[]) => a[Math.floor(r.next() * a.length)]!;
    const base = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
    const at = (lx: number, lz: number) => new THREE.Vector3(lx, 0, lz).applyMatrix4(base);
    // The table: a pale top with a yellow edge, four legs, a shelf below with a crate.
    // (Realistic day: a blue frame and dark grey speckled top and shelf.)
    if (!this.tableMats) {
      const top = k.std(0x6b7078, 0.6, 0.1, 0xe9ecef);
      const shelf = k.std(0x50545b, 0.4, 0.6, 0xb9c0c8);
      for (const m of [top, shelf]) {
        k.realColor(m, 0x3b3f45, 0.7, 0.05);
        specks(m);
      }
      const frame = k.std(0x50545b, 0.4, 0.6, 0xb9c0c8);
      k.realColor(frame, 0x1e3a66, 0.45, 0.3);
      this.tableMats = { top, edge: k.std(0x8a6e00, 0.5, 0.2, 0xf2c200), frame, shelf };
    }
    const { top, edge, frame: steel, shelf } = this.tableMats;
    k.box('ctop', top, x, TOP_Y - 0.02, z, 0.64 * F, 0.04, 1.26 * F, undefined, yaw);
    for (const s of [-1, 1]) {
      const e = at(0.33 * F * s, 0);
      k.box('cedge', edge, e.x, TOP_Y - 0.03, e.z, 0.03, 0.05, 1.26 * F + 0.02, undefined, yaw);
    }
    for (const sx of [-0.28 * F, 0.28 * F]) for (const sz of [-0.58 * F, 0.58 * F]) {
      const l = at(sx, sz);
      k.box('cleg', steel, l.x, (TOP_Y - 0.04) / 2, l.z, 0.04, TOP_Y - 0.04, 0.04);
    }
    k.box('cshelf', shelf, x, 0.22, z, 0.56 * F, 0.03, 1.16 * F, undefined, yaw);
    k.blob(x, z, 1.0 * F, 1.6 * F, yaw);
    // Under the top: a crate or a few flat boxes.
    const crate = this.kind('crate', () => new THREE.BoxGeometry(0.4, 0.22, 0.55).translate(0, 0.11, 0));
    if (r.next() < 0.6) this.add(crate, base, rnd(-0.05, 0.05), 0.24 - TOP_Y, rnd(-0.3, 0.3), pick([0x2c62c8, 0x2fa58f, 0x3a3d44]), rnd(-0.1, 0.1));
    else {
      const flat = this.kind('flatbox', () => new THREE.BoxGeometry(0.45, 0.04, 0.6).translate(0, 0.02, 0));
      for (let i = 0; i < 1 + Math.floor(r.next() * 4); i++) this.add(flat, base, rnd(-0.03, 0.03), 0.24 - TOP_Y + i * 0.04, rnd(-0.25, 0.25), pick([0xc9a06c, 0xd9b07a, 0xb08a5e]), rnd(-0.15, 0.15));
    }
    // On top: places along the table, each gets a thing (or nothing).
    const spots = [-0.62, -0.44, -0.26, -0.08, 0.1, 0.28, 0.46, 0.62];
    const things = ['papers', 'clipboard', 'cup', 'tape', 'markers', 'scanner', 'cutter', 'notes', 'gloves', 'bottle', 'phone', 'labels', 'cup'];
    for (const sz of spots) {
      if (r.next() < 0.12) continue;
      const lx = rnd(-0.22, 0.22);
      const lz = sz + rnd(-0.05, 0.05);
      const turn = rnd(-0.6, 0.6);
      switch (pick(things)) {
        case 'papers': {
          const sheet = this.kind('sheet', () => new THREE.BoxGeometry(0.21, 0.003, 0.297).translate(0, 0.0015, 0));
          const n = 1 + Math.floor(r.next() * 4);
          for (let i = 0; i < n; i++) this.add(sheet, base, lx + rnd(-0.02, 0.02), i * 0.004, lz + rnd(-0.02, 0.02), pick([0xffffff, 0xf7f7f2, 0xfff3b0]), turn + rnd(-0.25, 0.25));
          break;
        }
        case 'clipboard': {
          this.add(this.kind('board', () => new THREE.BoxGeometry(0.23, 0.008, 0.32).translate(0, 0.004, 0)), base, lx, 0, lz, 0x8a6a44, turn);
          this.add(this.kind('sheet', () => new THREE.BoxGeometry(0.21, 0.003, 0.297).translate(0, 0.0015, 0)), base, lx, 0.008, lz + 0.01, 0xffffff, turn);
          this.add(this.kind('clip', () => new THREE.BoxGeometry(0.09, 0.02, 0.04).translate(0, 0.01, -0.14), this.shiny), base, lx, 0.008, lz, 0x9aa0a8, turn);
          break;
        }
        case 'cup': {
          const cup = this.kind('cup', () => new THREE.CylinderGeometry(0.042, 0.034, 0.1, 16).translate(0, 0.05, 0));
          const coffee = this.kind('coffee', () => new THREE.CircleGeometry(0.038, 16).rotateX(-Math.PI / 2).translate(0, 0.088, 0));
          const handle = this.kind('handle', () => new THREE.TorusGeometry(0.025, 0.007, 6, 12, Math.PI).rotateZ(-Math.PI / 2).translate(0.045, 0.055, 0));
          const c = pick([0xffffff, 0xe2231a, 0x2fa58f, 0x1755fe, 0xf2c200, 0x1d1d1f]);
          this.add(cup, base, lx, 0, lz, c, turn);
          this.add(handle, base, lx, 0, lz, c, turn);
          this.add(coffee, base, lx, 0, lz, pick([0x3b2416, 0x5a3a22, 0x8a6a4a]));
          break;
        }
        case 'tape': {
          const roll = this.kind('tape', () => new THREE.TorusGeometry(0.045, 0.02, 8, 20).rotateX(Math.PI / 2).translate(0, 0.02, 0), this.shiny);
          this.add(roll, base, lx, 0, lz, pick([0xc9a46a, 0xd8c39a, 0xe2231a]));
          break;
        }
        case 'markers': {
          const pen = this.kind('marker', () => new THREE.CylinderGeometry(0.009, 0.009, 0.13, 10).rotateZ(Math.PI / 2).translate(0, 0.009, 0));
          const cap = this.kind('cap', () => new THREE.CylinderGeometry(0.0105, 0.0105, 0.035, 10).rotateZ(Math.PI / 2).translate(0.06, 0.009, 0));
          for (let i = 0; i < 1 + Math.floor(r.next() * 3); i++) {
            const c = pick([0x1d1d1f, 0xe2231a, 0x1755fe, 0x2fa58f, 0xf2c200]);
            const t = turn + rnd(-0.5, 0.5);
            this.add(pen, base, lx + i * 0.025, 0, lz + rnd(-0.03, 0.03), 0xf3f4f6, t);
            this.add(cap, base, lx + i * 0.025, 0, lz + rnd(-0.03, 0.03), c, t);
          }
          break;
        }
        case 'scanner': {
          this.add(this.kind('scanbody', () => new RoundedBox(0.07, 0.05, 0.17)), base, lx, 0.025, lz, 0x2a2c31, turn);
          this.add(this.kind('scangrip', () => new THREE.BoxGeometry(0.04, 0.03, 0.08).translate(0, 0.015, 0.06)), base, lx, 0, lz, 0xf2a51a, turn);
          this.add(this.kind('scanwin', () => new THREE.PlaneGeometry(0.05, 0.03).translate(0, 0.025, -0.0851).rotateY(Math.PI), this.glow), base, lx, 0.025, lz, 0xff3a2a, turn);
          break;
        }
        case 'cutter': {
          this.add(this.kind('cutter', () => new THREE.BoxGeometry(0.022, 0.016, 0.14).translate(0, 0.008, 0)), base, lx, 0, lz, 0xf2c200, turn);
          this.add(this.kind('blade', () => new THREE.BoxGeometry(0.008, 0.004, 0.025).translate(0, 0.01, -0.08), this.shiny), base, lx, 0, lz, 0xd5dae0, turn);
          break;
        }
        case 'notes': {
          const pad = this.kind('notes', () => new THREE.BoxGeometry(0.076, 0.015, 0.076).translate(0, 0.0075, 0));
          const c = pick([0xfff06a, 0xffb3d9, 0x9fe8ff, 0xb6f29a]);
          this.add(pad, base, lx, 0, lz, c, turn);
          if (r.next() < 0.5) this.add(this.kind('note', () => new THREE.BoxGeometry(0.076, 0.002, 0.076).translate(0, 0.001, 0)), base, lx + 0.09, 0, lz + 0.03, c, turn + 0.4);
          break;
        }
        case 'gloves': {
          const glove = this.kind('glove', () => new RoundedBox(0.09, 0.02, 0.2));
          const c = pick([0xc8ff3a, 0x3a3d44, 0xf2a51a]);
          this.add(glove, base, lx - 0.03, 0.01, lz, c, turn);
          this.add(glove, base, lx + 0.04, 0.02, lz + 0.02, c, turn + 0.4);
          break;
        }
        case 'bottle': {
          this.add(this.kind('bottle', () => new THREE.CylinderGeometry(0.035, 0.035, 0.22, 14).translate(0, 0.11, 0), this.shiny), base, lx, 0, lz, pick([0x86d3c3, 0x6fb6ff, 0xe6e9ed]));
          this.add(this.kind('bcap', () => new THREE.CylinderGeometry(0.018, 0.018, 0.03, 10).translate(0, 0.235, 0)), base, lx, 0, lz, pick([0x1755fe, 0x1d1d1f, 0xe2231a]));
          break;
        }
        case 'phone': {
          this.add(this.kind('phone', () => new RoundedBox(0.075, 0.009, 0.155)), base, lx, 0.0045, lz, 0x1d1d1f, turn);
          this.add(this.kind('screen', () => new THREE.PlaneGeometry(0.065, 0.14).rotateX(-Math.PI / 2).translate(0, 0.0095, 0), this.glow), base, lx, 0, lz, pick([0x2a3442, 0x3a6ea8, 0x1d2430]), turn);
          break;
        }
        case 'labels': {
          this.add(this.kind('labelroll', () => new THREE.CylinderGeometry(0.05, 0.05, 0.1, 16).rotateX(Math.PI / 2).translate(0, 0.05, 0)), base, lx, 0, lz, 0xffffff, turn);
          this.add(this.kind('labelcore', () => new THREE.CylinderGeometry(0.02, 0.02, 0.102, 10).rotateX(Math.PI / 2).translate(0, 0.05, 0)), base, lx, 0, lz, 0x8a6a44, turn);
          break;
        }
      }
    }
  }

  /** Make the instanced meshes (call once, after all tables). */
  build(): void {
    for (const k of this.kinds.values()) {
      if (!k.items.length) continue;
      const im = new THREE.InstancedMesh(k.geo, k.mat, k.items.length);
      k.items.forEach((it, i) => {
        im.setMatrixAt(i, it.m);
        im.setColorAt(i, it.c);
      });
      im.computeBoundingSphere();
      this.k.put(im);
    }
  }
}

/** A small rounded box, centred (for phones, gloves, scanners). */
class RoundedBox extends THREE.BufferGeometry {
  constructor(w: number, h: number, d: number) {
    super();
    const g = new THREE.CapsuleGeometry(Math.min(w, d) / 2, Math.max(w, d) - Math.min(w, d), 3, 10).rotateX(Math.PI / 2).scale(1, h / Math.min(w, d), 1);
    if (w > d) g.rotateY(Math.PI / 2);
    this.copy(g);
  }
}
