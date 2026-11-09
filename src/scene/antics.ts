// Little acts any person can play on top of their own animation: a wave, a bow,
// a cartwheel, a facepalm, a stretch, a near-stumble, air guitar, a phone call,
// a selfie, a high five, a peek round a corner, a sip of coffee.
//
// Whoever owns a person (the docks, the walkers, ...) keeps animating it as
// before. Every frame the overlay first puts back what the owner had set (pre),
// the owners run, and then the act is blended over their pose (post). So an act
// never disturbs the owner's own state, and when it ends the person simply
// carries on. Acts are timed in beats, like everything else in the hall.
import * as THREE from 'three';

import type { FloorKit } from './floor';
import type { Human } from './people';

export type ActKind =
  | 'wave'
  | 'bow'
  | 'cartwheel'
  | 'facepalm'
  | 'stretch'
  | 'windmill'
  | 'airguitar'
  | 'phone'
  | 'selfie'
  | 'highfive'
  | 'peek'
  | 'caught'
  | 'waveUp'
  | 'hype'
  | 'drink';

export interface ActOpts {
  /** Length in beats (each act has its own default). */
  beats?: number;
  /** High five: the other person is on this side (+1 right, −1 left). Peek: lean this way. */
  side?: number;
  /** High five: a miss (one goes high, one low). */
  miss?: boolean;
  /** Turn the head towards this point (world). */
  look?: THREE.Vector3;
  /** Pace round a small circle of this radius (m) while it lasts (a phone call). */
  pace?: number;
}

const BEATS: Record<ActKind, number> = {
  wave: 4,
  bow: 3,
  cartwheel: 3,
  facepalm: 4,
  stretch: 4,
  windmill: 2,
  airguitar: 8,
  phone: 16,
  selfie: 6,
  highfive: 2,
  peek: 6,
  caught: 8,
  waveUp: 2,
  hype: 2,
  drink: 4,
};

/** Which prop an act holds in its right hand. */
const PROP: Partial<Record<ActKind, 'phone' | 'cup'>> = { phone: 'phone', selfie: 'phone', drink: 'cup' };

const JOINTS = ['torso', 'armL', 'armR', 'foreL', 'foreR', 'head', 'legL', 'legR'] as const;
type Joint = (typeof JOINTS)[number];
/** A target rotation per joint: x, y, z (null: leave that axis to the owner). */
type Pose = Partial<Record<Joint, [number | null, number | null, number | null]>>;

interface Act {
  h: Human;
  kind: ActKind;
  t0: number;
  beats: number;
  opts: ActOpts;
  prop: THREE.Object3D | null;
  /** What the owner had set this frame (root position and rotation, then each joint's rotation). */
  under: Float32Array;
  saved: boolean;
  /** The contact shadow under the person (it stays on the floor whatever the body does). */
  blob: THREE.Object3D | null;
  blobPos: THREE.Vector3;
  blobQ: THREE.Quaternion;
}

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x: number) => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};

export class Antics {
  private acts: Act[] = [];
  private holder = new THREE.Group();
  private pool: Record<'phone' | 'cup', THREE.Object3D[]> = { phone: [], cup: [] };
  private readonly p = new THREE.Vector3();
  private readonly g = new THREE.Vector3();
  private readonly gq = new THREE.Quaternion();
  private readonly rq = new THREE.Quaternion();

  /** Build the props (once, before the batches are built): phones and coffee cups for the hands. */
  build(k: FloorKit): void {
    // Kept in a hidden group until a hand takes one.
    this.holder.visible = false;
    k.put(this.holder);
    const phone = new THREE.BoxGeometry(0.075, 0.15, 0.012);
    const screen = new THREE.PlaneGeometry(0.062, 0.13);
    const cup = new THREE.CylinderGeometry(0.04, 0.032, 0.1, 12);
    const dark = k.std(0x15161a, 0.4, 0.3, 0x1d1d1f);
    const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.8, 1.1) });
    const white = k.std(0xe6e9ed, 0.5, 0, 0xffffff);
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      this.holder.add(g);
      k.batch(phone, dark, g);
      // The screen on the side that faces the person.
      const s = k.batch(screen, glass, g);
      s.position.z = 0.007;
      this.pool.phone.push(g);
    }
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      this.holder.add(g);
      k.batch(cup, white, g);
      this.pool.cup.push(g);
    }
  }

  /** Is this person in the middle of an act? */
  busy(h: Human | THREE.Object3D): boolean {
    const root = 'root' in h ? h.root : h;
    return this.acts.some((a) => a.h.root === root);
  }

  /** What this person is doing now (null: nothing). */
  doing(h: Human): ActKind | null {
    return this.acts.find((a) => a.h.root === h.root)?.kind ?? null;
  }

  /** Start an act now. False when the person is already busy with one (unless `force`: it replaces it). */
  play(h: Human, kind: ActKind, bt: number, opts: ActOpts = {}, force = false): boolean {
    const i = this.acts.findIndex((a) => a.h.root === h.root);
    if (i >= 0) {
      if (!force) return false;
      this.end(i);
    }
    let prop: THREE.Object3D | null = null;
    const pk = PROP[kind];
    if (pk) {
      prop = this.pool[pk].pop() ?? null;
      if (prop) {
        h.foreR.add(prop);
        // In the hand: a phone held up with its screen to the face, a cup upright.
        if (pk === 'phone') prop.position.set(0, -0.31, 0.035);
        else prop.position.set(0, -0.31, 0.05);
        prop.rotation.set(pk === 'phone' ? 0.15 : -1.4, 0, 0);
      }
    }
    const blob = h.root.children.find((c) => c.userData.noInk && c.userData.batched) ?? null;
    this.acts.push({ h, kind, t0: bt, beats: opts.beats ?? BEATS[kind], opts, prop, under: new Float32Array(6 + JOINTS.length * 3), saved: false, blob, blobPos: blob?.position.clone() ?? new THREE.Vector3(), blobQ: blob?.quaternion.clone() ?? new THREE.Quaternion() });
    return true;
  }

  /** Stop an act at once (the person goes back to the owner's pose). */
  stop(h: Human): void {
    const i = this.acts.findIndex((a) => a.h.root === h.root);
    if (i >= 0) {
      this.restore(this.acts[i]!);
      this.end(i);
    }
  }

  private end(i: number): void {
    const a = this.acts[i]!;
    if (a.prop) {
      const pk = PROP[a.kind]!;
      this.holder.add(a.prop);
      this.pool[pk].push(a.prop);
    }
    this.acts.splice(i, 1);
  }

  /** Before the owners animate: put back what they had set last frame. */
  pre(): void {
    for (const a of this.acts) this.restore(a);
  }

  private restore(a: Act): void {
    if (!a.saved) return;
    const u = a.under;
    const r = a.h.root;
    r.position.set(u[0]!, u[1]!, u[2]!);
    r.rotation.set(u[3]!, u[4]!, u[5]!);
    JOINTS.forEach((j, n) => a.h[j].rotation.set(u[6 + n * 3]!, u[7 + n * 3]!, u[8 + n * 3]!));
    if (a.blob) {
      a.blob.position.copy(a.blobPos);
      a.blob.quaternion.copy(a.blobQ);
    }
    a.saved = false;
  }

  /** After the owners: blend each act over their pose. */
  post(bt: number): void {
    for (let i = this.acts.length - 1; i >= 0; i--) {
      const a = this.acts[i]!;
      const u = (bt - a.t0) / a.beats;
      if (u >= 1 || !a.h.root.parent) {
        this.end(i);
        continue;
      }
      // Save what the owner set.
      const s = a.under;
      const r = a.h.root;
      s[0] = r.position.x;
      s[1] = r.position.y;
      s[2] = r.position.z;
      s[3] = r.rotation.x;
      s[4] = r.rotation.y;
      s[5] = r.rotation.z;
      JOINTS.forEach((j, n) => {
        const e = a.h[j].rotation;
        s[6 + n * 3] = e.x;
        s[7 + n * 3] = e.y;
        s[8 + n * 3] = e.z;
      });
      a.saved = true;
      // Where the shadow lies before the act moves the body.
      if (a.blob) {
        a.blob.updateWorldMatrix(true, false);
        a.blob.getWorldPosition(this.g);
        a.blob.getWorldQuaternion(this.gq);
      }
      this.apply(a, Math.max(0, u), bt);
      if (a.blob) {
        // Keep it flat on the floor, under the hips.
        r.updateWorldMatrix(true, false);
        const hip = r.localToWorld(this.p.set(0, 0.95, 0));
        a.blob.position.copy(r.worldToLocal(this.g.set(hip.x, this.g.y, hip.z)));
        r.getWorldQuaternion(this.rq);
        a.blob.quaternion.copy(this.rq.invert().multiply(this.gq));
      }
    }
  }

  private apply(a: Act, u: number, bt: number): void {
    const h = a.h;
    const r = h.root;
    // Into the pose and out of it again over about a third of a beat each.
    const edge = 0.35 / a.beats;
    const w = Math.min(smooth(u / edge), smooth((1 - u) / edge));
    const t = bt - a.t0;
    const side = a.opts.side ?? 1;
    let pose: Pose = {};
    /** Root: lift (m), roll about the forward axis, pitch forward, and a sideways shift (m, local). */
    let lift = 0;
    let roll = 0;
    let pitch = 0;
    let shift = 0;
    let rollDirect = false;
    switch (a.kind) {
      case 'wave': {
        // A big wave over the head, the hand going side to side twice a beat.
        const sw = Math.sin(t * Math.PI * 4) * 0.35;
        pose = { armR: [-2.75, 0, 0.3 + sw], foreR: [-0.35, null, null], head: [-0.1, null, 0.08] };
        break;
      }
      case 'bow': {
        // Bend from the waist, one hand on the belly, the other behind the back; hold, and up.
        const b = Math.sin(clamp(u * 1.4) * Math.PI) ** 0.6;
        pose = { torso: [0.95 * b, null, null], armR: [-0.55, 0, -0.25], foreR: [-1.7, null, null], armL: [0.45, 0, -0.1], foreL: [-1.2, null, null], head: [0.25 * b, 0, 0] };
        break;
      }
      case 'cartwheel': {
        // A full turn sideways round the hips, arms and legs out like a star.
        const e = smooth(clamp((u - 0.08) / 0.84));
        roll = -side * e * Math.PI * 2;
        rollDirect = true;
        pose = { armL: [0, 0, -2.85], armR: [0, 0, 2.85], foreL: [0, null, null], foreR: [0, null, null], legL: [0, null, -0.5], legR: [0, null, 0.5], torso: [0, null, null] };
        break;
      }
      case 'facepalm': {
        // Hand up to the face, head down, then a slow shake of the head.
        const sh = u > 0.35 ? Math.sin((t - a.beats * 0.35) * Math.PI * 1.5) * 0.25 : 0;
        pose = { armR: [-1.15, 0, -0.42], foreR: [-2.15, null, null], head: [0.38, sh, 0], torso: [0.18, null, null] };
        break;
      }
      case 'stretch': {
        // Both arms straight up, leaning back, then a twist to each side.
        const tw = u > 0.4 ? Math.sin((u - 0.4) * Math.PI * 3.3) * 0.28 : 0;
        pose = { armL: [-3.05, 0, 0.12], armR: [-3.05, 0, -0.12], foreL: [-0.05, null, null], foreR: [-0.05, null, null], torso: [-0.22, tw, 0], head: [-0.3, null, null] };
        lift = 0.03 * Math.sin(u * Math.PI);
        break;
      }
      case 'windmill': {
        // Nearly falls over something: pitches forward, arms going round, catches itself.
        const fall = Math.sin(clamp(u * 1.2) * Math.PI);
        const spin = t * Math.PI * 4;
        pose = { armL: [-spin, 0, -0.5], armR: [-spin - Math.PI, 0, 0.5], foreL: [-0.2, null, null], foreR: [-0.2, null, null], legR: [0.7 * fall, null, null], legL: [-0.25 * fall, null, null], head: [-0.3 * fall, null, null] };
        pitch = 0.32 * fall;
        break;
      }
      case 'airguitar': {
        // Left hand out on the neck, right hand strumming on the off-beats, head banging on the beat.
        const strum = Math.sin(t * Math.PI * 4) * 0.4;
        const bang = Math.abs(Math.sin(t * Math.PI)) ** 2;
        pose = {
          armL: [-1.05, -0.2, -0.75],
          foreL: [-0.35, null, null],
          armR: [-0.55 + strum * 0.5, 0, -0.15],
          foreR: [-1.35 + strum, null, null],
          torso: [-0.18 + 0.12 * bang, Math.sin(t * Math.PI * 0.5) * 0.15, 0],
          head: [0.45 * bang - 0.15, null, null],
          legL: [-0.25, null, -0.12],
          legR: [0.2, null, 0.12],
        };
        lift = -0.04;
        break;
      }
      case 'phone': {
        // Phone to the right ear; the free hand talks along.
        const g = Math.sin(t * Math.PI * 1.3);
        pose = { armR: [-0.45, 0, 0.55], foreR: [-2.45, null, null], armL: [-0.55 - 0.35 * g, 0, -0.15], foreL: [-1.1 - 0.4 * Math.abs(g), null, null], head: [0.06, Math.sin(t * 0.9) * 0.25, 0.18] };
        break;
      }
      case 'selfie': {
        // Phone held out high in front, a peace sign by the face, head tilted; a little bounce for each shot.
        const shot = Math.max(0, Math.sin(t * Math.PI)) ** 6;
        pose = { armR: [-2.05, 0.2, 0.3], foreR: [-0.15, null, null], armL: [-0.6, 0, -0.55], foreL: [-2.3, null, null], head: [-0.12, 0.35, -0.22], torso: [-0.06, 0.15, 0] };
        lift = 0.03 * shot;
        break;
      }
      case 'highfive': {
        // Hand up and across towards the other one; the slap is halfway.
        const hi = a.opts.miss ? (side > 0 ? -2.95 : -1.6) : -2.75;
        const reach = Math.sin(clamp(u) * Math.PI);
        if (side > 0) pose = { armR: [hi * reach, 0, 0.35 * reach], foreR: [-0.25, null, null], head: [null, 0.5 * reach, null] };
        else pose = { armL: [hi * reach, 0, -0.35 * reach], foreL: [-0.25, null, null], head: [null, -0.5 * reach, null] };
        // A miss: they look at each other's hand afterwards.
        if (a.opts.miss && u > 0.5) pose.head = [0.25, side * 0.6, null];
        break;
      }
      case 'peek': {
        // Lean out round a corner, look, and back again.
        const out = Math.sin(clamp(u) * Math.PI) ** 0.5;
        shift = side * 0.55 * out;
        roll = side * 0.35 * out;
        pose = { head: [null, side * 0.4 * out, -side * 0.3 * out], armL: [side < 0 ? -0.9 * out : null, null, null], armR: [side > 0 ? -0.9 * out : null, null, null] };
        break;
      }
      case 'caught': {
        // Caught dancing: stand stock-still, look at the camera, then pretend to work.
        pose = u < 0.45 ? { armL: [0.05, 0, -0.04], armR: [0.05, 0, 0.04], foreL: [-0.05, null, null], foreR: [-0.05, null, null], torso: [-0.04, 0, 0], legL: [0, null, null], legR: [0, null, null] } : { torso: [0.35, null, null], armL: [-0.9, null, null], armR: [-0.9, null, null], foreL: [-0.6, null, null], foreR: [-0.6, null, null] };
        break;
      }
      case 'waveUp': {
        // The Mexican wave: both arms up and a hop, once.
        const up = Math.sin(clamp(u) * Math.PI);
        pose = { armL: [-2.95 * up, 0, -0.1], armR: [-2.95 * up, 0, 0.1], foreL: [-0.1, null, null], foreR: [-0.1, null, null] };
        lift = 0.12 * up;
        break;
      }
      case 'hype': {
        // Both arms up, jumping on the beat.
        pose = { armL: [-2.9, 0, -0.35], armR: [-2.9, 0, 0.35], foreL: [-0.2, null, null], foreR: [-0.2, null, null], head: [-0.2, null, null] };
        lift = 0.18 * Math.abs(Math.sin(t * Math.PI));
        break;
      }
      case 'drink': {
        // A sip of coffee: cup to the mouth, head back a little.
        const sip = u > 0.25 && u < 0.75 ? 1 : 0.35;
        pose = { armR: [-0.95 * sip - 0.25, 0, -0.2 * sip], foreR: [-2.1 * sip - 0.3, null, null], head: [-0.25 * sip, null, null] };
        break;
      }
    }
    // Head towards a point.
    if (a.opts.look) {
      r.getWorldPosition(this.p);
      const want = Math.atan2(a.opts.look.x - this.p.x, a.opts.look.z - this.p.z);
      let d = want - r.rotation.y;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const cur = pose.head ?? [null, null, null];
      pose.head = [cur[0], clamp(d, -1.1, 1.1), cur[2]];
    }
    for (const j of JOINTS) {
      const p = pose[j];
      if (!p) continue;
      const e = h[j].rotation;
      if (p[0] !== null) e.x += (p[0] - e.x) * w;
      if (p[1] !== null) e.y += (p[1] - e.y) * w;
      if (p[2] !== null) e.z += (p[2] - e.z) * w;
    }
    // The root: lifted, leaning, shifted sideways; a cartwheel turns round the hips (0.95 m up).
    const yaw = r.rotation.y;
    const rl = rollDirect ? roll : roll * w;
    if (rl) {
      r.rotation.z += rl;
      const hip = 0.95;
      // Keep the hips where they were: the feet swing round under them.
      const dx = hip * Math.sin(rl);
      const dy = hip - hip * Math.cos(rl);
      r.position.x += Math.cos(yaw) * dx;
      r.position.z -= Math.sin(yaw) * dx;
      r.position.y += dy;
    }
    if (pitch) r.rotation.x += pitch * w;
    if (shift) {
      r.position.x += Math.cos(yaw) * shift * w;
      r.position.z -= Math.sin(yaw) * shift * w;
    }
    if (lift) r.position.y += lift * w;
    if (a.opts.pace) {
      // Walking round a small circle, facing the way it goes, legs stepping.
      const rad = a.opts.pace;
      const ang = t * 0.5;
      const ramp = w;
      r.position.x += (Math.cos(ang) - 1) * rad * ramp;
      r.position.z += Math.sin(ang) * rad * ramp;
      const head = Math.atan2(-Math.sin(ang), Math.cos(ang));
      let d = head - r.rotation.y;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      r.rotation.y += d * ramp;
      const step = Math.sin(t * Math.PI * 2) * 0.35 * ramp;
      h.legL.rotation.x = step;
      h.legR.rotation.x = -step;
    }
  }
}

/** The one overlay for the whole hall. */
export const ANTICS = new Antics();
