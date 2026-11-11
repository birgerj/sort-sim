// Walks along a fixed way (a polyline with heights, so it can climb a stair), one person at a
// time: used by the break crew (to the canteen and back) and the managers (a round over the
// loop's walkway). Positions in metres, speed in metres per beat.
import * as THREE from 'three';

import type { Human } from './people';
import { gait, settle, settleFace, swingArms } from './motion';
import { CLIPS, poseClip } from './clips';

export type P3 = [number, number, number];

export class Trip {
  private acc: number[] = [0];
  readonly len: number;
  constructor(readonly pts: P3[]) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      this.acc.push(this.acc[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    this.len = this.acc[this.acc.length - 1]!;
  }

  /** Position at distance s (clamped to the ends) and the heading there (yaw, 0 facing +z). */
  at(s: number, out: THREE.Vector3): number {
    s = Math.max(0, Math.min(this.len, s));
    let i = 0;
    while (i < this.acc.length - 2 && this.acc[i + 1]! < s) i++;
    const a = this.pts[i]!;
    const b = this.pts[i + 1] ?? a;
    const seg = this.acc[i + 1]! - this.acc[i]! || 1;
    const f = (s - this.acc[i]!) / seg;
    out.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
    return Math.atan2(b[0] - a[0], b[2] - a[2]);
  }

  /** Rise over run of the stretch at distance s (stairs are steep, floors 0). */
  slope(s: number): number {
    s = Math.max(0, Math.min(this.len, s));
    let i = 0;
    while (i < this.acc.length - 2 && this.acc[i + 1]! < s) i++;
    const a = this.pts[i]!;
    const b = this.pts[i + 1] ?? a;
    return (b[1] - a[1]) / (Math.hypot(b[0] - a[0], b[2] - a[2]) || 1);
  }

  /** The same way back. */
  reversed(): Trip {
    return new Trip([...this.pts].reverse());
  }

  /** Two ways one after the other (the second starting where the first ends). */
  then(t: Trip): Trip {
    return new Trip([...this.pts, ...t.pts.slice(1)]);
  }
}

const tmp = new THREE.Vector3();

/** Put a walking person on a trip at distance s, turning smoothly towards where it goes; one step per beat. */
export function walkOn(h: Human, trip: Trip, s: number, dt: number, bt: number, speed: number): void {
  const yaw = trip.at(s, tmp);
  h.root.position.copy(tmp);
  let d = yaw - h.root.rotation.y;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  h.root.rotation.y += d * Math.min(1, dt * 6);
  // A walking clip when there is one (not on the stairs: its feet would miss the steps).
  const clip = CLIPS.get('Walk_Loop');
  if (clip && speed > 0.05 && Math.abs(trip.slope(s)) < 0.05) {
    poseClip(h, clip, bt / 2 + h.m.seed, Math.min(1, speed / clip.step));
    settleFace(h, dt);
    return;
  }
  const swing = gait(h, dt, Math.PI * bt + h.m.seed * 6.28, speed);
  swingArms(h, swing, 1);
  settle(h, dt);
}
