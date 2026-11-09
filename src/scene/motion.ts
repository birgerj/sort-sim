// How people move: a walking cycle, two-bone IK for legs and arms, crouching,
// breathing, shifting weight and a swinging ponytail. Pure maths on the joints
// of `people.ts` (no extra meshes, no draw calls): a few sines per person per
// frame.
//
// A caller poses a person each frame in this order:
//   1. its own pose for the upper body (torso bend, arms, head);
//   2. `gait()` for the legs and pelvis (speed 0 eases into standing);
//   3. optionally `crouch()` and `reach()` (hands to a point);
//   4. `settle()` last: pelvis, breathing, weight shift, ponytail, feet flat.
import * as THREE from 'three';

import { ANKLE, FOREARM, HIP_Y, KNEE, REST_SPREAD, UPPER_ARM, type Human } from './people';

const L1 = KNEE;
const L2 = ANKLE;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
/** A narrow bump around `c` (1 there, falling off on both sides). */
const bump = (q: number, c: number) => Math.max(0, Math.cos(q - c)) ** 6;

/**
 * Walk (or stand, with speed 0). `phase` runs π per step, so `Math.PI * bt`
 * is one step per beat; `speed` is metres per step, which sets the stride so
 * the feet roughly keep to the floor. Returns the arm swing (−1…1, already
 * scaled by how much the person walks): left arm back when it is positive.
 */
export function gait(h: Human, dt: number, phase: number, speed: number): number {
  const m = h.m;
  const e = Math.min(1, dt * 6);
  m.walk += ((speed > 0.04 ? 1 : 0) - m.walk) * e;
  // Half a step ahead of the hip at heel strike: sin(stride) · leg = step / 2.
  const want = speed > 0.04 ? clamp(Math.asin(Math.min(0.8, speed / 2 / (L1 + L2))), 0.14, 0.42) : m.amp;
  m.amp += (want - m.amp) * e;
  const W = m.walk;
  const a = m.amp * W;
  const s = a / 0.4;
  for (const [leg, knee, q, key] of [
    [h.legL, h.kneeL, phase, 'footL'],
    [h.legR, h.kneeR, phase + Math.PI, 'footR'],
  ] as const) {
    // Hip: forward with sin q. Knee: bent most in the swing, as the thigh
    // passes under the hip (the foot clears the floor), a little in the stance. Foot: toes up at heel
    // strike, heel up at push-off.
    leg.rotation.x = -a * Math.sin(q);
    knee.rotation.x = W * (0.06 + 0.1 * s * bump(q, Math.PI / 2 + 0.3)) + Math.min(1, s) * 0.85 * Math.max(0, Math.cos(q - 0.1)) ** 3;
    m[key] = s * (-0.22 * bump(q, Math.PI / 2) + 0.38 * bump(q, -Math.PI / 2 + 0.25));
  }
  // Pelvis: highest when the legs pass, over the standing leg, turned with the
  // forward leg, dropping on the swinging side. The chest turns against it.
  m.px = 0.022 * W * Math.cos(phase);
  m.py = W * (0.018 * Math.cos(2 * phase) - 0.012);
  m.pyaw = 0.11 * s * Math.sin(phase);
  m.proll = 0.045 * s * Math.cos(phase);
  h.chest.rotation.y = -1.9 * m.pyaw;
  return s * Math.sin(phase);
}

/** The usual arm swing while walking (when the arms are free): shoulders and elbows, eased by `k`. */
export function swingArms(h: Human, swing: number, k: number, base = 0.1): void {
  h.armL.rotation.x += (-base + 0.42 * swing - h.armL.rotation.x) * k;
  h.armR.rotation.x += (-base - 0.42 * swing - h.armR.rotation.x) * k;
  h.foreL.rotation.x += (-0.14 - 0.4 * Math.max(0, -swing) - h.foreL.rotation.x) * k;
  h.foreR.rotation.x += (-0.14 - 0.4 * Math.max(0, swing) - h.foreR.rotation.x) * k;
  relaxArms(h, k);
}

/** Ease the arms' twist and spread back to hanging (after `reach`). */
export function relaxArms(h: Human, k: number, spreadL = 0, spreadR = 0): void {
  h.armL.rotation.y += (0 - h.armL.rotation.y) * k;
  h.armR.rotation.y += (0 - h.armR.rotation.y) * k;
  h.armL.rotation.z += (-REST_SPREAD - spreadL - h.armL.rotation.z) * k;
  h.armR.rotation.z += (REST_SPREAD + spreadR - h.armR.rotation.z) * k;
  h.handL.rotation.y += (0 - h.handL.rotation.y) * k;
  h.handR.rotation.y += (0 - h.handR.rotation.y) * k;
}

/** Two-bone IK for a leg: ankle to (y down, z forward) from the hip, knee forward. */
function legTo(leg: THREE.Object3D, knee: THREE.Object3D, y: number, z: number): void {
  const d = clamp(Math.hypot(y, z), 0.3, L1 + L2 - 0.001);
  const aim = Math.atan2(z, -y);
  const kneeIn = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  const hipIn = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  leg.rotation.x = -(aim + hipIn);
  knee.rotation.x = Math.PI - kneeIn;
}

/**
 * Crouch by `c` (0…1): the pelvis goes down and the knees bend, the feet stay
 * where the gait put them. Call after `gait`.
 */
export function crouch(h: Human, c: number): void {
  const drop = 0.34 * clamp(c, 0, 1);
  h.m.drop = drop;
  if (drop < 0.002) return;
  for (const [leg, knee] of [
    [h.legL, h.kneeL],
    [h.legR, h.kneeR],
  ] as const) {
    // Where the gait put the ankle (from the hip), then the hip comes down.
    const t1 = -leg.rotation.x;
    const t2 = t1 - knee.rotation.x;
    const z = L1 * Math.sin(t1) + L2 * Math.sin(t2);
    const y = -(L1 * Math.cos(t1) + L2 * Math.cos(t2)) + drop;
    legTo(leg, knee, y, z);
  }
}

const tmp = new THREE.Vector3();
const dir = new THREE.Vector3();
const pole = new THREE.Vector3();
const up = new THREE.Vector3();
const bx = new THREE.Vector3();
const bz = new THREE.Vector3();
const basis = new THREE.Matrix4();
const q = new THREE.Quaternion();

/**
 * Two-bone IK for an arm: put the palm at `world`, the elbow out and down
 * behind. `k` eases towards it (1: at once); `grip` turns the palm inwards
 * (to hold a box from its sides).
 */
export function reach(h: Human, side: 'L' | 'R', world: THREE.Vector3, k: number, grip = 0): void {
  const arm = side === 'L' ? h.armL : h.armR;
  const fore = side === 'L' ? h.foreL : h.foreR;
  const hand = side === 'L' ? h.handL : h.handR;
  const sg = side === 'L' ? -1 : 1;
  h.chest.updateWorldMatrix(true, false);
  h.chest.worldToLocal(tmp.copy(world)).sub(arm.position);
  const d = clamp(tmp.length(), 0.12, UPPER_ARM + FOREARM - 0.002);
  dir.copy(tmp).normalize();
  const elbowIn = Math.acos(clamp((UPPER_ARM ** 2 + FOREARM ** 2 - d * d) / (2 * UPPER_ARM * FOREARM), -1, 1));
  const shoulderIn = Math.acos(clamp((UPPER_ARM ** 2 + d * d - FOREARM ** 2) / (2 * UPPER_ARM * d), -1, 1));
  // The elbow points out, down and back: the upper arm leans that way from the line to the target.
  pole.set(sg * 0.45, -0.5, -1).normalize();
  pole.addScaledVector(dir, -pole.dot(dir));
  if (pole.lengthSq() < 1e-6) pole.set(0, 0, -1);
  pole.normalize();
  const u = up.copy(dir).multiplyScalar(Math.cos(shoulderIn)).addScaledVector(pole, Math.sin(shoulderIn));
  // The arm's own axes: +y up the upper arm (it hangs along −y), +z where the forearm bends to.
  const yAxis = u.negate();
  bz.copy(pole).negate().addScaledVector(yAxis, yAxis.dot(pole)).normalize();
  bx.crossVectors(yAxis, bz);
  basis.makeBasis(bx, yAxis, bz);
  q.setFromRotationMatrix(basis);
  arm.quaternion.slerp(q, k);
  fore.rotation.x += (-(Math.PI - elbowIn) - fore.rotation.x) * k;
  hand.rotation.y += ((Math.PI / 2) * grip * -sg - hand.rotation.y) * k;
}

/** Seated (driver): thighs forward, shins down, feet flat, hands forward on the wheel. */
export function sit(h: Human): void {
  for (const [leg, knee, foot] of [
    [h.legL, h.kneeL, h.footL],
    [h.legR, h.kneeR, h.footR],
  ] as const) {
    leg.rotation.x = -1.45;
    knee.rotation.x = 1.4;
    foot.rotation.x = 0.05;
  }
  h.armL.rotation.x = h.armR.rotation.x = -0.75;
  h.foreL.rotation.x = h.foreR.rotation.x = -0.6;
}

export interface SettleOpts {
  /** How much the person shifts weight when standing (0…1, default 1). */
  idle?: number;
  /** Breathe (default true). */
  breathe?: boolean;
}

/**
 * Last step each frame: place the pelvis (gait, crouch, weight shift), breathe,
 * swing the ponytail and keep the feet flat on the floor.
 */
export function settle(h: Human, dt: number, o: SettleOpts = {}): void {
  const m = h.m;
  dt = clamp(dt, 0, 0.1);
  m.t += dt;
  const t = m.t;
  // Standing still: weight slowly from one leg to the other (each at its own pace);
  // the other knee relaxes.
  const I = (1 - m.walk) * (o.idle ?? 1);
  const sh = Math.sin(t * (0.3 + m.seed * 0.15) + m.seed * 20);
  h.pelvis.position.set(m.px + 0.028 * I * sh, HIP_Y + m.py - m.drop, 0);
  h.pelvis.rotation.set(0, m.pyaw, m.proll + 0.05 * I * sh);
  // Legs stay upright under a tilted pelvis.
  h.legL.rotation.z = h.legR.rotation.z = -h.pelvis.rotation.z;
  h.kneeL.rotation.x += 0.16 * I * Math.max(0, sh);
  h.kneeR.rotation.x += 0.16 * I * Math.max(0, -sh);
  // The upper body leans back over the hips a little.
  h.torso.rotation.z = -0.6 * h.pelvis.rotation.z;
  if (o.breathe !== false) {
    // Breathing: the chest rises and the shoulders with it, about 13 breaths a minute.
    const br = Math.sin(t * (1.3 + m.seed * 0.3) + m.seed * 7);
    h.chest.rotation.x = -0.018 * br;
    h.armL.position.y = h.armR.position.y = 0.215 + 0.004 * br;
  }
  // Feet flat (plus the gait's roll from heel to toe).
  h.footL.rotation.x = m.footL - (h.legL.rotation.x + h.kneeL.rotation.x);
  h.footR.rotation.x = m.footR - (h.legR.rotation.x + h.kneeR.rotation.x);
  h.footL.rotation.z = h.footR.rotation.z = 0;
  m.footL *= 0.9;
  m.footR *= 0.9;
  if (h.tail) swingTail(h, dt);
  face(h, dt);
}

/**
 * Blinking (every few seconds, each at its own pace; a blink takes about a
 * seventh of a second) and talking: while `m.talk` is up, the mouth opens and
 * closes in syllables of uneven length.
 */
function face(h: Human, dt: number): void {
  const m = h.m;
  const t = m.t;
  let lid = 1;
  if (t >= m.blinkAt) {
    const f = (t - m.blinkAt) / 0.14;
    if (f >= 1) {
      // Next blink in 2…6 s (now and then a double blink).
      const n = Math.abs(Math.sin(m.blinkAt * 12.9898 + m.seed * 78.233) * 43758.5453) % 1;
      m.blinkAt = t + (n < 0.12 ? 0.25 : 2 + n * 4);
    } else lid = Math.abs(1 - 2 * f) * 0.92 + 0.08;
  }
  h.eyes.scale.y = lid;
  m.talkE += (m.talk - m.talkE) * Math.min(1, dt * 8);
  const syl = Math.max(0, Math.sin(t * 13 + m.seed * 9)) * (0.55 + 0.45 * Math.sin(t * 4.7 + m.seed * 3));
  const open = m.talkE * syl;
  h.mouth.scale.set(1 - 0.15 * open, 1 + 2.4 * open, 1);
}

/** The ponytail: a damped spring that wants to hang down and lags behind turns and bobbing. */
function swingTail(h: Human, dt: number): void {
  const m = h.m;
  const yaw = h.root.rotation.y;
  const y = h.root.position.y + h.pelvis.position.y;
  let dyaw = yaw - m.yaw;
  while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
  while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  const vy = dt > 0 ? (y - m.y) / dt : 0;
  const vyaw = dt > 0 ? dyaw / dt : 0;
  m.yaw = yaw;
  m.y = y;
  // Hang down whatever the head and back do.
  const tilt = h.torso.rotation.x + h.chest.rotation.x + h.head.rotation.x;
  const wantX = clamp(-tilt * 0.9, -0.5, 0.9);
  const wantZ = clamp(-(h.torso.rotation.z + h.pelvis.rotation.z) - 0.25 * clamp(vyaw, -3, 3), -0.6, 0.6);
  const n = Math.max(1, Math.ceil(dt / 0.016));
  const st = dt / n;
  for (let i = 0; i < n; i++) {
    m.tvx += (55 * (wantX - m.tx) - 5 * m.tvx + 6 * clamp(vy, -2, 2)) * st;
    m.tvz += (55 * (wantZ - m.tz) - 5 * m.tvz) * st;
    m.tx += m.tvx * st;
    m.tz += m.tvz * st;
  }
  h.tail!.rotation.set(m.tx, 0, m.tz);
}
