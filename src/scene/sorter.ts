// Parcel hub as an empty club (three.js). Four infeeds at two heights run
// through scan tunnels and each join an endless tilt-tray loop sorter, which
// tips parcels into chutes, sends some up a lift into a high-bay store and
// takes them out again. Some chutes end at pickup stations where sort robots
// take the parcels to rows of open bins (sorterFloor.ts), under flow
// projectors. Forklifts drive around, moving heads and a
// mirror ball light the haze. Everything moves on the beat: belts travel
// BEAT_M metres per beat, inductions, diverts and scans land on beats, lead
// notes feed parcels in the track's colour, bass notes drive the lift, pad
// notes call parcels back from the store and tint the lights.
//
// Two looks, switched with the time-of-day button: "Night" is the club;
// "Day" is a product-illustration style — a light hall, equipment in
// black outlines with teal sorters and roll cages, orange scan tunnels,
// a purple workstation, magenta GPU racks, people and hanging signs, and
// a blue outline on the followed parcel.
import * as THREE from 'three';
import { pcDigits } from '../sim/countries';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { NoteRole, RGB, Scene3D, SceneControl, SceneInput } from './types';
import { BOX_FULL, BOX_M3, DECK_Y, DROP, RobotFloor, STATION_START_Z, TABLE as MANUAL_TABLE } from './floor';
import { DOCK_BELT_END, Docks } from './docks';
import { BoxYard, DOORS } from './boxYard';
import { buildForklift } from './forklift';
import { buildHuman } from './people';
import { blobTexture, InkPass, TOON, toonify } from './post';
import { CAGE_TRACKS, dayEnvironment, FLOOR_TILE_M, gradePass, grime, lightShafts, REAL, realFloorMaps, ROBOT_TRACKS, trayWear, wear, wheelTracks, beltWear, litPaper, lightPools, parcelWear } from './realDay';
import { Life } from './life';
import { HUMANS, INK_MASK_LAYER } from './people';
import { FORKLIFTS } from './forklift';
import { Xmas } from './xmas';
import { XMAS } from '../sim/season';
import { Party } from './party';
import { Roof, ceilingWithLights, roofLights } from './roof';
import { Crowd } from './crowd';
import { defaultNightFx, type NightFx } from './nightFx';
import { Batcher } from './batch';
import { Trucks } from './trucks';
import { Labels } from './labels';
import { Clutter } from './clutter';
import { BPM } from '../audio/composer';
import { addressFor, type Address } from '../sim/addresses';
import { Kpi } from '../sim/kpi';
import { CITIES, DOCK_CITY, NORTH_CITIES, randomPostcode, rangeText, SOUTH_CITIES } from '../sim/postcodes';
import { Batches } from '../sim/batches';
import { ManualSort } from './manualSort';
import { Screens, type HubMap } from './screens';
import { brushed, cardboardNormal, cardboardSide, checkerPlate, claddingNormal, dayFloor, dayWall, floorJointNormal, roofDeckNormal, sectionalDoor, stretchFilm, stretchFilmNormal, wireMesh } from './textures';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FLOOR, type FleetEvent } from '../sim/robotFleet';

type V3 = THREE.Vector3;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3();

/** Metres a belt moves per beat. Every belt, carrier and induction is locked to this. */
export const BEAT_M = 2;
/** Tray pitch on the loop: one tray every eighth note. */
const PITCH = 1;
const LOOP_Y = 4;
/** Corner radius and half depth (z) of the loop: a rounded rectangle, long in x. */
const LOOP_R = 4;
const LOOP_ZH = 8.5;
/** One lap is 142 beats; every even metre mark on the loop is passed on a beat. */
export const LOOP_LEN = 352;
/** Length of the short (west and east) straights, and of a quarter bend. */
const SIDE = 2 * LOOP_ZH - 2 * LOOP_R;
const QUARTER = (Math.PI * LOOP_R) / 2;
/** Length of the long (north and south) straights. */
const STRAIGHT = (LOOP_LEN - 2 * SIDE - 4 * QUARTER) / 2;
/** x where the north straight starts (s = 0); it runs east from here. */
const LX = -54;
/** Centre of the loop. */
const LCX = LX + STRAIGHT / 2;
const TRAYS = LOOP_LEN / PITCH;
/** Hall: west wall, east wall, half depth, height. */
const WX = -62;
const EX = 128;
const HCX = (WX + EX) / 2;
const HW = EX - WX;
const HZ = 34;
/** The north wall is further out than the south one (more room at the truck docks). */
const NZ = -40;
/** Depth of the hall (north to south) and its middle. */
const HD = HZ - NZ;
const HZC = (NZ + HZ) / 2;
const HH = 11;
/** Roof lights: tilted glass in the roof, two rows across the hall (see roof.ts). */
const ROOF_LIGHTS = roofLights(WX, EX);
/** Highest a flying visitor goes: eye a metre under the roof. */
const WALK_MAX_ALT = HH - 1.7 - 1;
const MAX_PARCELS = 1500;
/** Shipping label canvas: cells of LABEL_W × LABEL_H pixels. */
const LABEL_W = 96;
const LABEL_H = 64;
const LABEL_COLS = 21;
const LABEL_ROWS = 32;

// Loop positions (metres from the start of the north straight; chutes on even marks, so on a beat).
// s 0–154: north straight (infeeds at 10–22, 20 dock chutes from 38) · 161–170: east side, to and
// from the store · 176–330: south straight, 20 robot station chutes from 178 · 330–352: west end.
/**
 * Infeeds: four lanes come in through the north wall at floor level, 4 m apart, each
 * through its own scan tunnel just inside the wall, then a buffer (the hold point
 * where parcels queue), then down the hall on a ramp to loop height, a turn to the
 * left and onto the north straight from the outside at 30°, 4 m apart, before the
 * first dock chute. The joins are on even marks: lanes 0 and 2 land on the beat
 * (even trays), lanes 1 and 3 half a beat later (odd trays), so every tray can be filled.
 */
const INDUCT = [10, 14, 18, 22];
/** Half-beat offset of each lane's landing (see above). */
const LANE_PHASE = [0, 0.5, 0, 0.5];
const LANE_Y = 0.9;
/** Belt height where an infeed joins the loop: just above the lips of the trays. */
const LANE_TOP = LOOP_Y + 0.05;
/** Half the width of a tray (its lips), seen from the loop's centre line. */
const TRAY_HALF = 0.62;
/** How far out from the loop's centre line each lane turns onto it (sets the lane's x). */
const LANE_OUT = 3.6;
/** z of the scan tunnels (just inside the north wall). */
const LANE_TUNNEL_Z = -36.4;
/** The maintenance platform inside the loop at its west end (the DJ's at night): centre x, top y. */
const PLATFORM_X = -49;
const PLATFORM_Y = 2.4;
/** The buffer: where parcels queue on an infeed lane (metres along it, after the scan tunnel). */
const HOLD_S = 16;
/** Parcels that fit in a lane's queue inside the hall; more wait outside (counted). */
const LANE_QUEUE = 7;
/** Share of parcels for the robots (the rest go to the roll cages at the north docks). */
const ROBOT_SHARE = 0.12;
/** Rounds on the sorter before a parcel whose chute stays full is put aside (overflow). */
const MAX_LAPS = 3;
/** A buffered parcel stays at least this long in the store (8 bars). */
const MIN_STORE_BEATS = 32;
/** Service marks on labels, and how often each comes up. */
export type Tag = 'fragile' | 'cod' | 'express' | 'registered';
const TAGS: Tag[] = ['fragile', 'cod', 'express', 'registered'];
const TAG_ODDS: Record<Tag, number> = { fragile: 0.06, cod: 0.02, express: 0.08, registered: 0.03 };
/** On the printed label: a letter in a coloured box. */
const TAG_MARK: Record<Tag, [string, string]> = { fragile: ['F', '#e2231a'], cod: ['€', '#2fa58f'], express: ['X', '#f2a51a'], registered: ['R', '#1755fe'] };
/** Chance a parcel lands in the next dock chute by mistake. */
const MISSORT = 0.002;
/** Hub time: minutes per beat, and the time the simulation starts at. */
const HUB_MIN_PER_BEAT = 0.25;
const HUB_START = 18 * 60;
const hhmmOf = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
/** Gap between parcels banked up on a belt or table (metres). */
const GAP = 0.06;
/** Length of a pickup table the queue may use. */
const TABLE_ROOM = 4.2;
const LOOP_TUNNELS = [30, 182];
const STORE_OUT = 162;
const STORE_BACK = 168;
/** Where the station chutes end, at the back of the pickup roller tables. */
const STATION_Z = STATION_START_Z;
/** Parcels that fit on a pickup station's roller table. */
const STATION_CAP = 7;
/**
 * Chutes: loop position and side (1 outside the loop, −1 inside).
 * Off the north straight, 20 chutes run north to the truck docks; off the
 * south straight, 20 run south to the robot pickup stations.
 */
const CHUTES: [number, number][] = [
  ...Array.from({ length: 20 }, (_, k): [number, number] => [38 + 6 * k, 1]),
  ...Array.from({ length: 20 }, (_, k): [number, number] => [178 + 6 * k, 1]),
  // No-reads: off the south-east bend, down to the belt to the manual sort table (east of the robots).
  [174, 1],
];
/** The no-read chute (last in CHUTES). */
const REJECT = 40;
/** x of the no-read belt, where it runs south to the manual sort belt. */
const REJECT_X = 105.1;
const FIRST_STATION_S = 176;
/**
 * Render quality. low: pixel ratio 1, no extras. normal: outlines, toon shading and
 * contact shadows (always on). high: also ambient occlusion, sun shadows around the
 * camera, a glossy floor at night and depth of field when following a parcel.
 */
export type Quality = 'low' | 'normal' | 'high' | 'ultra';
/** x of the wall columns (south wall; the north ones stand 2.4 m further east). */
const COLUMNS = Array.from({ length: Math.floor((EX - 6 - (WX + 19)) / 24) + 1 }, (_, k) => WX + 19 + 24 * k);

/** Belt speeds the conveyor clock can run at: multiples of the beat, so events stay on 8th and 16th notes. */
export const BELT_SPEEDS = [0.5, 1, 2, 4];
/** x of the 20 truck docks on the north wall: straight north of each dock chute's end. */
const DOCK_X = Array.from({ length: 20 }, (_, k) => LX + CHUTES[k]![0] + 2.4);
/** Openings in the long walls, where trailers stand: x of each open door. */
const NORTH_DOORS = DOCK_X;
const SOUTH_DOORS = DOORS.filter((d) => d[2]).map((d) => d[0]);
const DOOR_W = 3.2;
const DOOR_H = 3.8;

/** A long wall (HW × HH, centred on its origin) with door openings at the given x. */
function wallWithDoors(xs: number[]): THREE.ShapeGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(-HW / 2, -HH / 2);
  sh.lineTo(HW / 2, -HH / 2);
  sh.lineTo(HW / 2, HH / 2);
  sh.lineTo(-HW / 2, HH / 2);
  sh.closePath();
  for (const x of xs) {
    const h = new THREE.Path();
    const lx = x - HCX;
    // (A thin sill at the bottom keeps each opening a proper hole.)
    h.moveTo(lx - DOOR_W / 2, -HH / 2 + 0.02);
    h.lineTo(lx - DOOR_W / 2, -HH / 2 + DOOR_H);
    h.lineTo(lx + DOOR_W / 2, -HH / 2 + DOOR_H);
    h.lineTo(lx + DOOR_W / 2, -HH / 2 + 0.02);
    h.closePath();
    sh.holes.push(h);
  }
  return new THREE.ShapeGeometry(sh);
}


// Lift and high-bay buffer store, east of the loop, its back against the east wall.
const STORE_DX = LX + STRAIGHT + LOOP_R - 29.5;
const LIFT_X = 49 + STORE_DX;
const SHUTTLE_X = 50.2 + STORE_DX;
const SLOT_X = 51.6 + STORE_DX;
const RACK_X0 = 50.9 + STORE_DX;
const RACK_X1 = 52.3 + STORE_DX;
const LEVELS = [0.7, 2.3, 3.9, 5.5, 7.1, 8.7];
const BAY = 1.6;
const BAYS = 17; // bays each side of the lift

const PARCEL_COLS = [0xb08a5e, 0xa07c52, 0xc4a070, 0x8f6c48, 0xb08a5e, 0xc4a070, 0xf2c200, 0xf2c200, 0x4a2f1a, 0x4a2f1a, 0xe6e4de, 0xb3122a, 0x4b1a86, 0x1d4f9a];

/** Day palette, after a parcel-sorting product illustration. */
const DAY = {
  bg: 0xeef1f4,
  floor: 0xf6f7f9,
  wall: 0xe6e9ed,
  ceiling: 0xf3f4f6,
  steel: 0xb9c0c8,
  teal: 0x2fa58f,
  tealD: 0x1f7f6c,
  tealL: 0x86d3c3,
  tealP: 0xdff3ee,
  orange: 0xf2a51a,
  orangeL: 0xfbd47c,
  purple: 0x6b3fd1,
  magenta: 0xd6339a,
  red: 0xe2231a,
  ink: 0x1d1d1f,
  blue: 0x1755fe,
};

/**
 * The realistic day's colours for the illustration palette: what these parts would really be.
 * Frames, cages and racks are galvanised or grey steel, the monitoring and computing corners
 * dark grey-blue enclosures, blue a deeper RAL blue; scan tunnels keep a signal orange.
 * Safety yellow and red stay. (Only for materials; people, parcels and trucks keep theirs.)
 */
/** Dark RAL blue (steel structure paint), for supports and legs in the realistic day. */
const RAL_BLUE = 0x1e3a66;

const REAL_PALETTE = new Map<number, { c: number; metal?: number; rough?: number }>([
  [DAY.teal, { c: 0x9da3a9, metal: 0.7, rough: 0.42 }],
  [DAY.tealD, { c: 0x6e757c, metal: 0.6, rough: 0.45 }],
  [DAY.tealL, { c: 0xb5bbc1, metal: 0.5, rough: 0.5 }],
  [DAY.tealP, { c: 0xb9bfc5, metal: 0.8, rough: 0.35 }],
  [DAY.orange, { c: 0xd8862a, metal: 0.2, rough: 0.5 }],
  [DAY.orangeL, { c: 0xe0a85a }],
  [DAY.purple, { c: 0x3d4450, metal: 0.3, rough: 0.55 }],
  [DAY.magenta, { c: 0x2b2f36, metal: 0.3, rough: 0.5 }],
  [DAY.blue, { c: 0x24508f, metal: 0.2, rough: 0.5 }],
]);

/** Position and direction of travel at loop position s (counter-clockwise seen from above: east along the north side). */
function loopAt(s: number, pos: V3, tan: V3): void {
  s = ((s % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  const S = STRAIGHT;
  const R = LOOP_R;
  const Z = LOOP_ZH;
  const Q = QUARTER;
  const y = LOOP_Y;
  if (s < S) {
    pos.set(LX + s, y, -Z);
    tan.set(1, 0, 0);
    return;
  }
  s -= S;
  if (s < Q) {
    const f = s / R;
    pos.set(LX + S + R * Math.sin(f), y, -Z + R - R * Math.cos(f));
    tan.set(Math.cos(f), 0, Math.sin(f));
    return;
  }
  s -= Q;
  if (s < SIDE) {
    pos.set(LX + S + R, y, -Z + R + s);
    tan.set(0, 0, 1);
    return;
  }
  s -= SIDE;
  if (s < Q) {
    const f = s / R;
    pos.set(LX + S + R * Math.cos(f), y, Z - R + R * Math.sin(f));
    tan.set(-Math.sin(f), 0, Math.cos(f));
    return;
  }
  s -= Q;
  if (s < S) {
    pos.set(LX + S - s, y, Z);
    tan.set(-1, 0, 0);
    return;
  }
  s -= S;
  if (s < Q) {
    const f = s / R;
    pos.set(LX - R * Math.sin(f), y, Z - R + R * Math.cos(f));
    tan.set(-Math.cos(f), 0, -Math.sin(f));
    return;
  }
  s -= Q;
  if (s < SIDE) {
    pos.set(LX - R, y, Z - R - s);
    tan.set(0, 0, -1);
    return;
  }
  s -= SIDE;
  const f = s / R;
  pos.set(LX - R * Math.cos(f), y, -Z + R - R * Math.sin(f));
  tan.set(Math.sin(f), 0, -Math.cos(f));
}
/** Outward normal of the loop for a tangent. */
const outward = (tan: V3, out: V3) => out.set(tan.z, 0, -tan.x);

/** Beats from loop position a to b going forward (at least one lap if equal). */
export function beatsAlong(a: number, b: number): number {
  const d = (((b - a) % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  // (Exact: a parcel inducted at an odd mark rides to an even chute in a whole beat and a half.)
  return (d === 0 ? LOOP_LEN : d) / BEAT_M;
}

/** Which tray sits at loop position s at beat t. */
export function trayAt(s: number, t: number): number {
  return ((Math.round((s - t * BEAT_M) / PITCH) % TRAYS) + TRAYS) % TRAYS;
}

/** A smooth path through dense points; corners are rounded in 3D, so ramps and bends flow. */
export class Path {
  readonly acc: number[] = [0];
  readonly len: number;
  constructor(
    readonly pts: V3[],
    readonly closed = false,
  ) {
    for (let i = 1; i < pts.length; i++) this.acc.push(this.acc[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
    this.len = this.acc[this.acc.length - 1]!;
  }

  static fillet(ctrl: V3[], r: number): Path {
    const out: V3[] = [ctrl[0]!.clone()];
    const line = (to: V3) => {
      const from = out[out.length - 1]!;
      const n = Math.max(1, Math.ceil(from.distanceTo(to) / 0.5));
      for (let k = 1; k <= n; k++) out.push(from.clone().lerp(to, k / n));
    };
    for (let i = 1; i < ctrl.length - 1; i++) {
      const A = ctrl[i - 1]!;
      const P = ctrl[i]!;
      const C = ctrl[i + 1]!;
      const a = P.clone().sub(A);
      const la = a.length();
      a.divideScalar(la);
      const b = C.clone().sub(P);
      const lb = b.length();
      b.divideScalar(lb);
      const ang = Math.acos(clamp(a.dot(b), -1, 1));
      const t = Math.min(r * Math.tan(ang / 2), la * (i === 1 ? 0.9 : 0.5), lb * (i === ctrl.length - 2 ? 0.9 : 0.5));
      const e0 = P.clone().addScaledVector(a, -t);
      const e1 = P.clone().addScaledVector(b, t);
      line(e0);
      for (let k = 1; k <= 16; k++) {
        const u = k / 16;
        const w = 1 - u;
        out.push(new THREE.Vector3().addScaledVector(e0, w * w).addScaledVector(P, 2 * w * u).addScaledVector(e1, u * u));
      }
    }
    line(ctrl[ctrl.length - 1]!);
    return new Path(out);
  }

  at(s: number, pos: V3, tan?: V3): void {
    const L = this.len;
    s = this.closed ? ((s % L) + L) % L : clamp(s, 0, L);
    let lo = 0;
    let hi = this.acc.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.acc[m]! <= s) lo = m;
      else hi = m;
    }
    const a = this.pts[lo]!;
    const b = this.pts[hi]!;
    const seg = this.acc[hi]! - this.acc[lo]!;
    pos.lerpVectors(a, b, seg > 0 ? (s - this.acc[lo]!) / seg : 0);
    if (tan) tan.subVectors(b, a).normalize();
  }
}

/** Sweeps a 2D profile (across, up) along a path. uv.y is the distance in metres. */
/**
 * A plane that ends an extrusion at an angle (a mitred end): whatever lies past it (on the side
 * `n` points to) is slid back along the path onto it. Only for an end on a straight stretch.
 */
interface Cut {
  c: V3;
  n: V3;
}

function extrude(path: Path, prof: [number, number][], s0 = 0, s1 = path.len, step = 0.35, cut?: Cut): THREE.BufferGeometry {
  const n = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  const segs = prof.length - 1;
  const pos = new Float32Array(n * segs * 2 * 3);
  const uv = new Float32Array(n * segs * 2 * 2);
  const idx: number[] = [];
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const Sd = new THREE.Vector3();
  const N = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const s = s0 + ((s1 - s0) * i) / (n - 1);
    path.at(s, P, T);
    Sd.crossVectors(T, UP).normalize();
    N.crossVectors(Sd, T).normalize();
    for (let j = 0; j < segs; j++) {
      for (let k = 0; k < 2; k++) {
        const [px, py] = prof[j + k]!;
        const o = (j * n + i) * 2 + k;
        let x = P.x + Sd.x * px + N.x * py;
        let y = P.y + Sd.y * px + N.y * py;
        let z = P.z + Sd.z * px + N.z * py;
        let ss = s;
        if (cut) {
          const over = (x - cut.c.x) * cut.n.x + (z - cut.c.z) * cut.n.z;
          const along = T.x * cut.n.x + T.z * cut.n.z;
          if (over > 0 && along > 1e-3) {
            const back = over / along;
            x -= T.x * back;
            y -= T.y * back;
            z -= T.z * back;
            ss -= back;
          }
        }
        pos[o * 3] = x;
        pos[o * 3 + 1] = y;
        pos[o * 3 + 2] = z;
        uv[o * 2] = k;
        uv[o * 2 + 1] = ss;
      }
    }
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = (j * n + i) * 2;
      const b = a + 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A closed rounded rectangle on the floor (forklift routes). */
function roundRect(cx: number, cz: number, w: number, d: number, r: number): Path {
  const pts: V3[] = [];
  const x0 = cx - w / 2 + r;
  const x1 = cx + w / 2 - r;
  const z0 = cz - d / 2 + r;
  const z1 = cz + d / 2 - r;
  const corners: [number, number, number][] = [
    [x1, z0, -Math.PI / 2],
    [x1, z1, 0],
    [x0, z1, Math.PI / 2],
    [x0, z0, Math.PI],
  ];
  for (const [x, z, a0] of corners) {
    for (let k = 0; k <= 10; k++) {
      const a = a0 + (k / 10) * (Math.PI / 2);
      pts.push(v(x + r * Math.cos(a), 0, z + r * Math.sin(a)));
    }
  }
  pts.push(pts[0]!.clone());
  const dense: V3[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.6));
    for (let k = 1; k <= n; k++) dense.push(a.clone().lerp(b, k / n));
  }
  return new Path(dense, true);
}

// ---------- shaders ----------
const STRIP_VERT = /* glsl */ `
varying float vS;
void main() { vS = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const STRIP_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uBeat;
uniform float uKick;
uniform float uGain;
uniform float uDay;
uniform vec3 uDayCol;
varying float vS;
void main() {
  float ph = fract(vS * 0.125 - uBeat * 0.5);
  float chase = smoothstep(0.8, 1.0, ph);
  vec3 night = uCol * (0.3 + uKick * 0.9 + chase * 1.7) * uGain;
  gl_FragColor = vec4(mix(night, uDayCol * (1.0 + chase * 0.35), uDay), 1.0);
}`;
const BEAM_VERT = /* glsl */ `
varying float vY;
varying vec3 vN;
varying vec3 vV;
void main() {
  vY = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uO;
varying float vY;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(abs(dot(vN, vV)), 1.5);
  gl_FragColor = vec4(uCol * uO * f * pow(vY, 1.6), 1.0);
}`;

// ---------- textures ----------
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
/** Belt surface: dark rubber by night, light rollers by day. */
/** The belt surface: white slats in the drawn day, mid-grey rubber in the realistic day, dark at night. */
function drawBelt(t: THREE.CanvasTexture, day: boolean, real = false): void {
  const c = t.image as HTMLCanvasElement;
  const g = c.getContext('2d');
  if (!g) return;
  g.fillStyle = real && day ? '#7b8087' : day ? '#eef0f3' : '#1f2125';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = real && day ? '#62666c' : day ? '#c4cad1' : '#34373d';
  for (let y = 0; y < c.height; y += 8) g.fillRect(0, y, c.width, day ? 2 : 3);
  t.needsUpdate = true;
}

const SIGN_FONT = 'Futura, "Futura PT", "Century Gothic", "Trebuchet MS", sans-serif';

function letterTex(letter: string): THREE.CanvasTexture {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = '#86d3c3';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#1d1d1f';
    g.lineWidth = 4;
    g.strokeRect(2, 2, 60, 60);
    g.fillStyle = '#1d1d1f';
    g.font = `700 40px ${SIGN_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 32, 34);
  });
}

function barcodeTex(): THREE.CanvasTexture {
  return canvasTex(128, 32, (g) => {
    g.fillStyle = '#f2a51a';
    g.fillRect(0, 0, 128, 32);
    g.fillStyle = '#1d1d1f';
    for (let x = 20; x < 108; ) {
      const w = 1 + Math.floor(Math.random() * 4);
      g.fillRect(x, 6, w, 20);
      x += w + 2;
    }
  });
}

function eyeTex(): THREE.CanvasTexture {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = '#f2a51a';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(32, 32, 22, 0, 7);
    g.fill();
    g.strokeStyle = '#1d1d1f';
    g.lineWidth = 4;
    g.beginPath();
    g.ellipse(32, 32, 15, 9, 0, 0, 7);
    g.stroke();
    g.fillStyle = '#1d1d1f';
    g.beginPath();
    g.arc(32, 32, 5, 0, 7);
    g.fill();
  });
}

/** A hanging sign like the labels in the illustration: a round icon and the name in the product colour. */
function signTex(text: string, color: string, icon: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  return canvasTex(512, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = '#1d1d1f';
    g.lineWidth = 5;
    g.strokeRect(3, 3, 506, 122);
    g.fillStyle = color;
    g.beginPath();
    g.arc(64, 64, 40, 0, 7);
    g.fill();
    g.save();
    g.translate(64, 64);
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ffffff';
    g.lineWidth = 5;
    icon(g);
    g.restore();
    g.fillStyle = color;
    g.font = `600 40px ${SIGN_FONT}`;
    g.textBaseline = 'middle';
    const words = text.toUpperCase().split(' ');
    if (words.length > 1 && text.length > 14) {
      g.fillText(words[0]!, 124, 42);
      g.fillText(words.slice(1).join(' '), 124, 88);
    } else g.fillText(text.toUpperCase(), 124, 66);
  });
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, base: number, amp: number) {
  const id = g.createImageData(w, h);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = base + (Math.random() - 0.5) * amp;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = n;
    id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
}

/** 'dock': at a truck dock, moved by the Docks (worker or slide into a roll cage). */
type Mode = 'path' | 'loop' | 'tween' | 'carriage' | 'shuttle' | 'fixed' | 'queue' | 'table' | 'robot' | 'dock' | 'manual' | 'held';

export interface Parcel {
  id: number;
  w: number;
  h: number;
  d: number;
  col: THREE.Color;
  /** Glow colour once scanned: destination colour, or the track colour for lead parcels. */
  glow: THREE.Color;
  lead: boolean;
  /** 0 box, 1 polybag, 2 tube. */
  shape: 0 | 1 | 2;
  scanned: boolean;
  flash: number;
  /** Chute index, or −1 for the store. */
  dest: number;
  /** Its cell in the label canvas (0: a plain label). */
  labelCell?: number;
  /** In a cage or box: what holds it. */
  holder?: THREE.Object3D;
  /** Place in the queue at its infeed lane's hold point (0 = next to go). */
  rank?: number;
  /** Distance of its centre from the front of the queue it is in (infeed hold, pickup table). */
  queueAt?: number;
  /** On a dock belt: how far it may run (behind the parcel ahead), and whether that is the queue at the end. */
  limit?: number;
  limitIsQueue?: boolean;
  /** Postcode (four digits): which city, and which cage or box there. */
  pc: number;
  /** An exception for the manual sort table (by robot, from a west station). */
  manual?: boolean;
  mode: Mode;
  path?: Path;
  pathKind: 'lane' | 'chute' | 'intake' | 'back' | 'dock' | 'reject';
  /** Its label could not be read yet (it goes to the no-read chute unless a loop scanner reads it). */
  noread?: boolean;
  /** Why it goes to manual sorting: no read, too big or heavy for the sorter, or round too often. */
  reason?: 'noread' | 'oversize' | 'overflow';
  /** Weight in kg (measured at the infeed). */
  kg: number;
  /** Service marks on the label (only shown, nothing handles them differently). */
  tags: Tag[];
  /** Hub time it came in (minutes), for the dwell time. */
  born: number;
  /** A long parcel takes the tray behind too. */
  tray2?: number;
  /** Sent to the wrong chute by mistake: it goes back to the infeed from the dock. */
  missorted?: boolean;
  /** Not counted as leaving the hub (it came back in). */
  recycled?: boolean;
  /** On its way down the no-read chute. */
  rejected?: boolean;
  lane: number;
  t0: number;
  t1: number;
  ease: 0 | 1;
  sPrev: number;
  sIn: number;
  tIn: number;
  divertAt: number;
  tray: number;
  from: V3;
  to: V3;
  off: V3;
  shuttle: number;
  done?: () => void;
  pos: V3;
  q: THREE.Quaternion;
  yawQ: THREE.Quaternion;
  vel: V3;
  dead: boolean;
  slot?: Slot;
  /** Wrapped as a present (Christmas). */
  gift?: boolean;
  /** In the buffer store because this chute was full; it goes back there when the chute has room. */
  buffered?: number;
  bufferedAt?: number;
  /** At a pickup station, or riding a robot: which one, since when, and the bin it goes to. */
  station?: number;
  bot?: number;
  rideAt?: number;
  bin?: number;
  dropAt?: number;
  /** Times it went round the loop again because its chute was full. */
  laps?: number;
}

interface Slot {
  level: number;
  z: number;
  parcel: Parcel | null;
  reserved: boolean;
}

interface Lane {
  path: Path;
  tunnelS: number;
  lastArrive: number;
  lastSpawn: number;
  tunnel: Tunnel;
  door: THREE.MeshBasicMaterial;
  doorFlash: number;
  doorCol: THREE.Color;
}

interface Tunnel {
  ring: THREE.MeshBasicMaterial;
  curtain: THREE.MeshBasicMaterial;
  flash: number;
  col: THREE.Color;
  /** Scan line sweeping through the tunnel on a read; red on a no-read. */
  line: THREE.Mesh;
  lineMat: THREE.MeshBasicMaterial;
  depth: number;
  read: boolean;
  /** Its display (index into scanLabels; two faces). */
  screen: number;
}

interface Chute {
  s: number;
  side: number;
  path: Path;
  col: THREE.Color;
  lamp: THREE.MeshBasicMaterial;
  flash: number;
  /** Dock chutes: the roller belt from the chute end to the dock. */
  belt?: Path;
}

interface Head {
  piv: THREE.Group;
  u: { uCol: { value: THREE.Color }; uO: { value: number } };
  pos: V3;
  light?: THREE.SpotLight;
  rx: number;
  rz: number;
}

/** A stop on the fly-mode tour: where the camera hovers and what it looks at (both may follow something that moves). */
interface Poi {
  name: string;
  /** Shown as a department to go to (the others are tour stops only). */
  dept?: string;
  /** Where the camera wants to be and what it looks at; `since` is beats since arrival (0 while flying there). */
  at: (pos: V3, look: V3, since: number) => boolean;
  /**
   * How the camera hovers once there:
   * orbit: turns slowly all the way round what it looks at (the default);
   * still: holds the view `at` gives (it may still follow a moving thing);
   * arc: swings gently to and fro, about 20° each way;
   * track: rides along with what `at` gives, closely (riding, chasing).
   */
  hover?: 'orbit' | 'still' | 'arc' | 'track';
  /** How quickly the camera catches up with `at` while hovering (per second; default 1.2). */
  rate?: number;
  /** Only shown in this look (the fly tour skips it in the other one). */
  when?: 'day' | 'night';
  /** Chooses what to look at (the busiest dock, the next robot) before flying there. */
  pick?: () => void;
  /** While visiting: time to move on to the next one (it picks again and flies there). */
  next?: (since: number) => boolean;
  /** Beats to stay on the fly tour (default 6–11). */
  dwell?: number;
}

interface Tour {
  poi: number;
  curve: THREE.CatmullRomCurve3;
  len: number;
  s: number;
  lookFrom: V3;
  /** Beats to hover once arrived. */
  dwell: number;
  arrivedAt: number;
  /** Camera offset from the look point while hovering, slowly turning. */
  offset: V3;
}

/** Height at which the camera travels between stops: above the high infeeds and frames, below ducts and signs. */
/** Fly height between stops: above the projectors (6.4–7.1 m), well below ducts, trays and lamps (8.8 m and up). */
const CRUISE_Y = 7.2;
/** Highest centre for a hanging sign: its top (+0.65 m) stays under the ducts at 8.8 m. */
const SIGN_MAX_Y = 8.05;
/** Highest the flying camera may go. */
const FLY_MAX_Y = 8.0;
/** Metres per beat for the lap above the loop (a lap takes about two minutes at 120 BPM). */
const LAP_M = 3;
/** The top-down pan over the robot floor: east–west from end to end, along its middle, metres per beat. */
const PAN_X0 = FLOOR.x0 + 2;
const PAN_X1 = FLOOR.x0 + FLOOR.ni * FLOOR.cs - 2;
const PAN_Z = FLOOR.z0 + (FLOOR.nj * FLOOR.cs) / 2;
const PAN_M = 1.5;
/** Things the tour must fly around at cruise height: x, z, radius. */
const TOUR_OBSTACLES: [number, number, number][] = [
  [-50, 1.9, 2.4],
  [-50, -2.1, 2.4],
  [-30, -10, 2.4],
];

interface Forklift {
  g: THREE.Group;
  route: Path;
  s: number;
  speed: number;
  forks: THREE.Group;
  beacon: THREE.MeshBasicMaterial;
}

type StepRun = () => number | (() => boolean);
interface Step {
  /** Waits for a trigger (a bass note, or two idle beats) before it starts. */
  gate?: boolean;
  skip?: () => boolean;
  run: StepRun;
}

/** Runs steps one after another; a step lasts a number of beats or until its predicate holds. */
export class Runner {
  steps: Step[] = [];
  private busyUntil = 0;
  private waitFor: (() => boolean) | null = null;

  /** Returns true when a gated step used the trigger. */
  update(bt: number, trig: boolean): boolean {
    let used = false;
    for (let guard = 0; guard < 8; guard++) {
      if (this.waitFor) {
        if (!this.waitFor()) return used;
        this.waitFor = null;
      }
      if (bt < this.busyUntil) return used;
      const st = this.steps[0];
      if (!st) return used;
      if (st.skip?.()) {
        this.steps.shift();
        continue;
      }
      if (st.gate) {
        if (!trig) return used;
        used = true;
        trig = false;
      }
      this.steps.shift();
      const r = st.run();
      if (typeof r === 'number') {
        this.busyUntil = bt + r;
        if (r > 0) return used;
      } else this.waitFor = r;
    }
    return used;
  }

  get busy(): boolean {
    return this.steps.length > 0 || this.waitFor !== null;
  }
}

interface Anim {
  a: number;
  b: number;
  t0: number;
  t1: number;
}
const smooth01 = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const easeIO = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
function animAt(an: Anim, bt: number): number {
  if (bt >= an.t1) return an.b;
  if (bt <= an.t0) return an.a;
  return an.a + (an.b - an.a) * easeIO((bt - an.t0) / (an.t1 - an.t0));
}

/** auto: switch fly/follow every 8 bars; fly: random tour; follow: a parcel; visit: hover at one department. */
type CamMode = 'auto' | 'fly' | 'follow' | 'visit' | 'walk';
const CAM_KEY = 'sortsim.cam';

export class Sorter implements Scene3D {
  readonly canvas: HTMLCanvasElement;
  readonly bass = true;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  /** Vignette and warm/cool finish of the realistic day. */
  private grade: ShaderPass;
  private smaa: SMAAPass;
  /** Day outlines as a screen effect. */
  private ink: InkPass;
  private gtao: GTAOPass;
  private bokeh: BokehPass;
  private mirror: Reflector | null = null;
  private quality: Quality = 'normal';
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 260);

  // Music clock: beats since start, locked to the music's beat phase.
  private bt = 0;
  private lastBeats = Number.NaN;
  private offset = 0;
  private time = 0;
  private kick = 0;
  private snare = 0;
  private hat = 0;
  private bassEnv = 0;
  private bassPending = false;
  private lastLead = -99;
  private padCol = new THREE.Color(1, 1, 1);
  private padUntil = 0;
  private lastPad = -99;
  private cols: THREE.Color[] = [new THREE.Color(0.3, 0.5, 1), new THREE.Color(0.8, 0.3, 1), new THREE.Color(1, 0.6, 0.2)];

  // Conveyors.
  private lanes: Lane[] = [];
  private chutes: Chute[] = [];
  private loopTunnels: { s: number; t: Tunnel }[] = [];
  private intake!: Path;
  private back!: Path;
  private backLast = -99;
  private beltTex!: THREE.CanvasTexture;
  private strips: THREE.ShaderMaterial[] = [];
  private trays!: THREE.InstancedMesh;
  private trayOwner: (Parcel | null)[] = new Array<Parcel | null>(TRAYS).fill(null);
  private trayTilt = new Float32Array(TRAYS);

  // Parcels.
  private parcels: Parcel[] = [];
  /** Parcels by shape (0 box, 1 polybag, 2 tube): one instanced mesh and glow buffer each. */
  private shapes: { mesh: THREE.InstancedMesh; glow: THREE.InstancedBufferAttribute }[] = [];
  private labelMesh!: THREE.InstancedMesh;
  /** Displays on the scan tunnels. */
  private scanLabels!: Labels;
  private scanCount = 0;
  private scanDirty = false;
  /** Each parcel's own shipping label (postcode, city, barcode): cells of one canvas, drawn when it is made. */
  private labelCanvas!: CanvasRenderingContext2D;
  private labelTex!: THREE.CanvasTexture;
  private labelCellAttr!: THREE.InstancedBufferAttribute;
  private freeCells: number[] = [];
  private labelsDirty = 0;
  /** Tape across the top of the boxes. */
  private tapeMesh!: THREE.InstancedMesh;
  private ribbonMesh!: THREE.InstancedMesh;
  /** The dock projectors' postcodes, on the first three parcels banked up on each dock belt. */
  private dockCodes!: Labels;
  private dockCodeText: string[] = [];
  private nextId = 400000 + Math.floor(Math.random() * 500000);
  private queue: Parcel[] = [];

  // Lift and store.
  private lift = new Runner();
  private liftAnim: Anim = { a: LOOP_Y, b: LOOP_Y, t0: 0, t1: 0 };
  private liftLastMove = 0;
  private carriage!: THREE.Group;
  private liftLamp!: THREE.MeshBasicMaterial;
  private shuttles: { runner: Runner; anim: Anim; mesh: THREE.Mesh }[] = [];
  private slots: Slot[] = [];
  /** Batches: a big share of the post for one city for a while (fills the store). */
  readonly batches = new Batches();
  private retrieving = 0;
  private lastRetrieve = 0;
  private retrieveShot = 0;

  // Club.
  private heads: Head[] = [];
  private ball!: THREE.Mesh;
  private sparkPos!: Float32Array;
  private sparkGeo!: THREE.BufferGeometry;
  private sparkDirs: V3[] = [];
  private sparkMat!: THREE.PointsMaterial;
  private hazePos!: Float32Array;
  private hazeGeo!: THREE.BufferGeometry;
  private hazeSeed: number[][] = [];
  private hazeMat!: THREE.PointsMaterial;
  // Robots, bins and flow projectors south of the loop.
  private floor!: RobotFloor;
  /** Chute index → pickup station index, for chutes that end at a robot station. */
  private stationOf = new Map<number, number>();
  private stationQueue: Parcel[][] = [];
  private stationXs: number[] = [];
  private cages = new Map<number, THREE.Vector3>();
  private botParcel = new Map<number, Parcel>();
  private strobe!: THREE.MeshBasicMaterial;
  private hemi!: THREE.HemisphereLight;
  private forklifts: Forklift[] = [];
  private docks!: Docks;
  private life!: Life;
  private party!: Party;
  private roof!: Roof;
  private crowd!: Crowd;
  /** Instanced parts of repeated models (robots, people, forklifts, cages, contact shadows). */
  private batcher!: Batcher;
  /** Trailers behind the dock doors: north 0–19 (roll cages), then the open south doors (boxes). */
  private trucks!: Trucks;
  private manual!: ManualSort;
  private screens = new Screens();
  /** Counters for the screens. */
  private stats = { inducted: 0, toDocks: 0, toRobots: 0 };
  private yard!: BoxYard;
  /** Dock chutes: chute index → dock x. */
  private dockOf = new Map<number, number>();
  /** Chutes of each north city (the docks west to east; big cities have several, see planDoors). */
  private get cityChutes(): number[][] {
    const out: number[][] = NORTH_CITIES.map(() => []);
    [...this.dockOf.keys()].forEach((chute, door) => out[DOCK_CITY[door]!]!.push(chute));
    return out;
  }
  /** Turn by turn between a city's two docks (50–50). */
  private splitTurn = 0;

  // Day / night look.
  private day = 0;
  /** Christmas decorations (Settings → Christmas). */
  private xmas: Xmas | null = null;
  private dayShown: boolean | null = null;
  private themed: { m: THREE.MeshStandardMaterial; n: THREE.Color; d: THREE.Color; nr: number; dr: number; nm: number; dm: number; rc?: THREE.Color; rr?: number; rm?: number }[] = [];
  readonly dayOnly: THREE.Object3D[] = [];
  readonly nightOnly: THREE.Object3D[] = [];
  /** What the night party shows (see NightFx); night-only objects that one switch hides. */
  private fx: NightFx = defaultNightFx();
  private fxObjs: [THREE.Object3D, Exclude<keyof NightFx, 'glow'>][] = [];
  /** Which look the objects being built belong to (undefined: both). */
  only: 'day' | 'night' | undefined;
  private nightEnv: THREE.Texture | null = null;
  private keyLight!: THREE.DirectionalLight;
  /** The realistic day look ("Day") instead of the flat one ("Minimal"); nights are the same. */
  private real = false;
  private dayEnv: THREE.Texture | null = null;
  /** Hall surfaces of the flat day look, and their lit counterparts in the realistic one. */
  private flatOnly: THREE.Object3D[] = [];
  private realOnly: THREE.Object3D[] = [];
  /** Materials with relief for the realistic day only: their normal scale at full day. */
  private realNormals: { m: THREE.MeshStandardMaterial; s: number }[] = [];
  /** Materials that wear another picture in the realistic day (their own map otherwise). */
  private realMaps: { m: THREE.MeshStandardMaterial; own: THREE.Texture | null; real: THREE.Texture; col: THREE.Color; realCol: THREE.Color; rough: number; realRough: number }[] = [];
  private hull!: THREE.InstancedMesh;
  private cageLine!: THREE.LineBasicMaterial;

  // Camera.
  private camMode: CamMode = 'auto';
  private follow: Parcel | null = null;
  /** Something else being followed (after a click): a robot, a forklift or a person. */
  private followThing: { obj: THREE.Object3D; h: number; kind: 'robot' | 'forklift' | 'person'; name: string; last: THREE.Vector3 } | null = null;
  private autoFollow = false;
  private lastShotBar = -1;
  /** Fly mode: a random tour past points of interest. */
  private tour: Tour | null = null;
  private recent: number[] = [];
  private pois: Poi[] = [];
  private first = true;
  private readonly look = new THREE.Vector3(18, 3, 0);
  private readonly want = new THREE.Vector3();
  private readonly wantLook = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3(1, 0, 0);

  // Scratch.
  private readonly p = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly o = new THREE.Object3D();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qLabel = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private readonly c = new THREE.Color();
  private readonly white = new THREE.Color(1, 1, 1);

  constructor() {
    this.batcher = new Batcher(this.scene);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vis-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene.background = new THREE.Color(0x0b0910);
    this.scene.fog = new THREE.FogExp2(0x0b0910, 0.017);
    // The scene graph (about 7,000 objects) is brought up to date once per frame, in
    // Batcher.update() just before drawing; every render pass (scene, ink normals, AO,
    // shadows, mirror) would otherwise walk the whole graph again.
    this.scene.matrixWorldAutoUpdate = false;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera, 512, 512);
    this.gtao.enabled = false;
    this.gtao.blendIntensity = 0.85;
    // AO is worked out from depth and normals: see-through things that write no depth (floor marks,
    // light shafts, glass, blob shadows) must stay out of it, or they darken whatever lies under them.
    {
      const gtao = this.gtao as unknown as { overrideVisibility(): void };
      const own = gtao.overrideVisibility.bind(gtao);
      gtao.overrideVisibility = () => {
        own();
        this.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          if ((o as THREE.Mesh).isMesh && m && !Array.isArray(m) && m.transparent && !m.depthWrite) o.visible = false;
        });
      };
    }
    this.composer.addPass(this.gtao);
    this.ink = new InkPass(this.scene, this.camera, INK_MASK_LAYER);
    this.composer.addPass(this.ink);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.55, 0.6);
    this.composer.addPass(this.bloom);
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 10, aperture: 0.0025, maxblur: 0.006 });
    this.bokeh.enabled = false;
    this.composer.addPass(this.bokeh);
    this.grade = gradePass();
    this.composer.addPass(this.grade);
    // Edge smoothing for the realistic day: without the ink lines, stair-stepped edges show.
    this.smaa = new SMAAPass(1, 1);
    this.smaa.enabled = false;
    this.composer.addPass(this.smaa);
    this.composer.addPass(new OutputPass());
    try {
      const saved = localStorage.getItem(CAM_KEY);
      if (saved === 'auto' || saved === 'fly' || saved === 'follow') this.camMode = saved;
    } catch {
      /* no storage */
    }
    this.buildEnv();
    this.buildHall();
    this.buildConveyors();
    this.buildStore();
    this.buildParcels();
    this.buildClub();
    this.buildForklifts();
    this.manual = new ManualSort(this);
    this.floor = new RobotFloor(this, this.stationXs, this.cages, {
      waiting: (st) => (this.stationQueue[st]?.length ?? 0) > 0,
      // Exceptions go to manual sorting, while there is room at the table.
      load: (k) => {
        const p = this.botParcel.get(k);
        if (!p) return null;
        const onRobots = this.floor.fleet.bots.filter((b) => b.bin === this.floor.tableBin).length;
        return { pc: p.pc, manual: !!p.manual, tableRoom: this.manual.room(onRobots) };
      },
      event: (e) => this.onFleet(e),
      full: (b) => this.yard.request(b),
    });
    const pcs = (c: (typeof CITIES)[number]) => rangeText([c.pc[0]![0], c.pc[c.pc.length - 1]![1]]);
    // A box emptied into a truck: its parcels leave with the truck.
    this.floor.onEmptied = (b) => {
      const g = this.floor.bins[b]!.g;
      for (const p of this.parcels) if (p.mode === 'held' && p.holder === g) p.dead = true;
    };
    this.trucks = new Trucks(this, [
      ...NORTH_DOORS.map((x, k) => ({ x, wallZ: NZ, dir: 1 as const, cargo: 'cage' as const, number: k + 1, city: NORTH_CITIES[DOCK_CITY[k]!]!.name, pc: pcs(NORTH_CITIES[DOCK_CITY[k]!]!), hold: () => this.docks.pending(x), cages: () => (this.docks ? this.docks.cageFill(x) : 0) })),
      ...SOUTH_DOORS.map((x, k) => ({ x, wallZ: HZ, dir: -1 as const, cargo: 'box' as const, number: 21 + k, city: SOUTH_CITIES[k]!.name, pc: pcs(SOUTH_CITIES[k]!) })),
    ]);
    this.trucks.clock = () => this.hubTime();
    this.trucks.onDepart = (d) => this.kpi.departed(d);
    this.yard = new BoxYard(this, this.floor, {
      open: (x) => this.trucks.isOpen(NORTH_DOORS.length + SOUTH_DOORS.indexOf(x)),
      reserve: (x, n) => this.trucks.reserve(NORTH_DOORS.length + SOUTH_DOORS.indexOf(x), n),
      load: (x, vol, kg) => this.trucks.load(NORTH_DOORS.length + SOUTH_DOORS.indexOf(x), vol, kg),
    });
    this.docks = new Docks(
      this,
      [...this.dockOf].map(([chute, x]) => ({ x, chute })),
      {
        mark: (chute, target, code) => {
          const p = this.parcels.find((q) => q.pos === target);
          this.floor.flashCage(chute, this.chutes[chute]!.col, target, code, (p?.h ?? 0.3) + 0.01);
        },
        shipped: (chute) => (this.chutes[chute]!.flash = 1),
        hold: (p, holder, local) => this.hold(p as Parcel, holder, local),
        // A parcel in the wrong dock: the worker puts it in the return tote; it goes back to the infeed.
        missort: (p) => {
          const q = p as Parcel;
          this.kpi.missort();
          q.dead = true;
          q.recycled = true;
          this.backlog++;
        },
        truck: {
          open: (x) => this.trucks.isOpen(NORTH_DOORS.indexOf(x)),
          reserve: (x, n) => this.trucks.reserve(NORTH_DOORS.indexOf(x), n),
          load: (x, vol, kg) => this.trucks.load(NORTH_DOORS.indexOf(x), vol, kg),
          clearing: (x) => this.trucks.clearing(NORTH_DOORS.indexOf(x)),
          slot: (x) => this.trucks.nextSlot(NORTH_DOORS.indexOf(x)),
        },
      },
    );
    if (XMAS) {
      const edge: { x: number; z: number; nx: number; nz: number; y: number }[] = [];
      for (let s = 0; s < LOOP_LEN; s += 0.6) {
        loopAt(s, this.p, this.t);
        outward(this.t, this.n);
        edge.push({ x: this.p.x, z: this.p.z, nx: this.n.x, nz: this.n.z, y: this.p.y });
      }
      const beams: number[] = [];
      for (let x = WX + 2; x <= EX - 2; x += 10) beams.push(x);
      this.xmas = new Xmas(this, {
        wx: WX,
        ex: EX,
        hz: HZ,
        nz: NZ,
        hh: HH,
        beams,
        northDoors: NORTH_DOORS,
        southDoors: SOUTH_DOORS,
        loopEdge: edge,
        trees: [
          { x: -55.8, z: 21.2, h: 7 },
          { x: -48.6, z: 31.2, h: 6 },
          { x: -19.5, z: -36.2, h: 7 },
          { x: PLATFORM_X - 2.2, z: 2.4, y: PLATFORM_Y, h: 3.4 },
        ],
        canes: [
          { x: -41.6, z: 1.7, ry: 0 },
          { x: -41.6, z: -1.7, ry: Math.PI },
          { x: -45.4, z: 22.8, ry: Math.PI / 2 },
          { x: -42.6, z: 22.8, ry: -Math.PI / 2 },
          { x: -17.6, z: -33.5, ry: 0.4 },
          { x: -31.2, z: 31.6, ry: Math.PI },
        ],
        stars: [
          ...Array.from({ length: 6 }, (_, k) => ({ x: -38 + k * 26, z: 0, y: HH - 2.6, r: 0.8 })),
          ...Array.from({ length: 5 }, (_, k) => ({ x: -30 + k * 28, z: k % 2 ? 22 : -22, y: HH - 2.2, r: 0.5 })),
        ],
        snow: [...Array.from({ length: 11 }, (_, k) => ({ x: -36 + k * 12, z: 0 })), { x: -58, z: 12 }, { x: -58, z: -14 }, { x: -26, z: -20 }],
        market: { x: -28.6, z: 32.6 },
      });
    }
    this.life = new Life(this, {
      wx: WX,
      ex: EX,
      hz: HZ,
      nz: NZ,
      rackEastX: RACK_X1,
      rackHalf: BAYS * BAY,
      levels: LEVELS,
      controlRoom: [-48, 23.5],
      columnsNorth: COLUMNS.map((x) => x + 2.4),
      columnsSouth: COLUMNS,
    });
    this.party = new Party(this, v(PLATFORM_X - 0.6, PLATFORM_Y + 0.0, 0), v(LCX, 9.2, 0), [LX, LX + STRAIGHT, -LOOP_ZH - 4, LOOP_ZH + 4]);
    // The manager (in a suit, no helmet) walks a round inside the loop, past the chute tables.
    {
      const zi = LOOP_ZH - 2.1;
      const x0 = PLATFORM_X + 5.5;
      const x1 = LX + STRAIGHT - 1.5;
      this.life.addWalker({ shirt: 0x2b2f3a, trousers: 0x2b2f3a, suit: { tie: 0xb3122a }, skin: 0xe8c4a0, hair: 0x3a2a1c, hairStyle: 0 }, [[x0, -zi], [x1, -zi], [x1, zi], [x0, zi]], 0.55);
    }
    // The inside of the loop is the dance floor at night (clear of the inner legs and cable tray).
    this.crowd = new Crowd(this, PLATFORM_X + 8, LX + STRAIGHT - 1, -LOOP_ZH + 2.2, LOOP_ZH - 2.2, 520);
    this.buildBoards();
    this.buildDay();
    this.roof = new Roof(this, ROOF_LIGHTS, HH);
    this.buildCamera();
    this.batcher.build();
    this.setupShadows();
    this.applyTheme(0);
  }

  private buildMirror(): Reflector {
    const base = (Reflector as unknown as { ReflectorShader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string } }).ReflectorShader;
    const shader = {
      ...base,
      fragmentShader: base.fragmentShader.replace(
        'gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );',
        // A soft, faint reflection: four taps of the mirror image, mostly transparent.
        `vec2 px = vec2(0.004, 0.0) * vUv.w;
        vec3 sum = base.rgb;
        sum += texture2DProj(tDiffuse, vUv + vec4(px, 0.0, 0.0)).rgb;
        sum += texture2DProj(tDiffuse, vUv - vec4(px, 0.0, 0.0)).rgb;
        sum += texture2DProj(tDiffuse, vUv + vec4(0.0, px.x, 0.0, 0.0)).rgb;
        // Only the bright parts (lights, lasers, LED strips) reflect, added on top of the floor.
        gl_FragColor = vec4(max(sum * 0.25 - vec3(0.45), vec3(0.0)) * 0.7, 1.0);`,
      ),
    };
    const m = new Reflector(new THREE.PlaneGeometry(HW, HD), {
      shader,
      textureWidth: Math.round(this.canvas.width * 0.4) || 512,
      textureHeight: Math.round(this.canvas.height * 0.4) || 288,
      clipBias: 0.003,
    });
    const mat = m.material as THREE.ShaderMaterial;
    mat.transparent = true;
    mat.blending = THREE.AdditiveBlending;
    mat.depthWrite = false;
    m.rotation.x = -Math.PI / 2;
    m.position.set(HCX, 0.006, 0);
    m.userData.noInk = true;
    m.renderOrder = -2;
    this.scene.add(m);
    this.ink.refresh();
    return m;
  }

  /** Sun shadows (quality high): every solid mesh casts and receives; the shadow box follows the camera. */
  private setupShadows(): void {
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const sun = this.keyLight;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = c.bottom = -36;
    c.right = c.top = 36;
    c.near = 1;
    c.far = 140;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun.target);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || o.userData.noInk) return;
      const mat = m.material as THREE.Material;
      if (!(mat instanceof THREE.MeshStandardMaterial)) {
        // Lights and labels catch no shadow, but floors and walls drawn flat by day do.
        if (mat instanceof THREE.MeshBasicMaterial) return;
        return;
      }
      m.castShadow = true;
      m.receiveShadow = true;
    });
  }

  resize(w: number, h: number, ratio: number): void {
    const r = Math.max(0.3, ratio);
    if (this.renderer.getPixelRatio() !== r) {
      this.ink.pixelRatio = r;
      this.renderer.setPixelRatio(r);
      this.composer.setPixelRatio(r);
    }
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.composer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  note(color: RGB, pitch: number, vel: number, durS: number, role?: NoteRole): void {
    if (role === 'bass') {
      this.bassPending = true;
      this.bassEnv = Math.max(this.bassEnv, 0.5 + vel * 0.5);
    } else if (role === 'pad') {
      this.padCol.setRGB(...color);
      this.padUntil = this.time + Math.max(1, durS);
      this.lastPad = this.bt;
      this.requestRetrieve();
    } else {
      this.lastLead = this.bt;
      this.spawnLead(color, pitch, vel);
    }
  }

  caption(): string {
    if (this.camMode === 'visit') return this.pois[this.visitPoi]!.dept ?? '';
    if (this.camMode === 'follow' && this.followThing) return `Following ${this.followThing.name}`;
    if (this.camMode === 'walk') return this.walk.alt > 0.01 ? 'Flying' : 'Walking';
    const f = this.follow;
    if (!f || this.camMode === 'fly' || (this.camMode === 'auto' && !this.autoFollow)) return '';
    if (f.mode === 'dock') return `Parcel ${f.id} · at truck dock ${DOCK_X.indexOf(this.dockOf.get(f.dest) ?? 0) + 1}`;
    if (f.mode === 'table') return `Parcel ${f.id} · waiting for a robot`;
    if (f.mode === 'robot') {
      const bot = this.floor.robotNumber(f.bot!);
      return f.bin === undefined ? `Parcel ${f.id} · loading onto robot ${bot}` : `Parcel ${f.id} · robot ${bot} → bin ${this.floor.bins[f.bin]!.code}`;
    }
    const where =
      f.mode === 'fixed'
        ? 'stored'
        : f.dest < 0
          ? f.mode === 'loop' || f.pathKind === 'lane'
            ? `to the buffer${f.buffered !== undefined ? ` (chute ${f.buffered + 1} full)` : ''}`
            : `in the buffer${f.buffered !== undefined ? ` (chute ${f.buffered + 1} full)` : ''}`
          : f.pathKind === 'back'
            ? `out of the store → chute ${f.dest + 1}`
            : this.stationOf.has(f.dest)
              ? 'to the robots'
              : `to truck dock ${DOCK_X.indexOf(this.dockOf.get(f.dest) ?? 0) + 1}`;
    return `Parcel ${f.id} · ${where}`;
  }

  controls(): SceneControl[] {
    return [
      {
        kind: 'choice', id: 'cam', label: 'Camera', title: 'Fly around the hall, follow a parcel, or switch every 8 bars', value: this.camMode,
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'fly', label: 'Fly' },
          { value: 'follow', label: 'Follow' },
        ],
      },
      { kind: 'action', id: 'next', label: 'Next parcel', title: 'Follow another parcel' },
      {
        kind: 'choice', id: 'speed', label: 'Belt speed', title: 'How fast the belts and the loop run', value: String(this.speed),
        options: BELT_SPEEDS.map((v) => ({ value: String(v), label: `${v}×` })),
      },
    ];
  }

  setControl(id: string, value: boolean | string): void {
    if (id === 'cam' && value === 'walk') {
      this.startWalk();
    } else if (id === 'cam' && (value === 'auto' || value === 'fly' || value === 'follow')) {
      this.camMode = value;
      this.follow = null;
      this.followThing = null;
      this.autoFollow = false;
      try {
        localStorage.setItem(CAM_KEY, value);
      } catch {
        /* no storage */
      }
    } else if (id === 'speed') {
      this.setBeltSpeed(Number(value));
    } else if (id === 'next') {
      this.followThing = null;
      if (this.camMode === 'fly' || this.camMode === 'visit') this.camMode = 'follow';
      this.autoFollow = true;
      this.pickFollow();
    }
  }

  render(i: SceneInput): void {
    const dt = clamp(i.dt, 0, 0.1);
    this.time += dt;
    // Beat clock: follow the music's beats; on a jump, move forward to the same phase.
    const prev = this.bt;
    if (Number.isNaN(this.lastBeats)) this.offset = -i.beats;
    else {
      const d = i.beats - this.lastBeats;
      if (d < 0 || d > 0.5) this.offset = Math.ceil(prev - i.beats);
    }
    this.lastBeats = i.beats;
    this.bt = Math.max(prev, i.beats + this.offset);
    const bt = this.bt;
    const prevCt = this.ct;
    this.ct = Number.isNaN(this.lastCt) ? bt : this.ct + (bt - prev) * this.speed;
    this.dct = this.ct - prevCt;
    this.bpmNow = i.bpm ?? BPM;
    this.due = Math.min(this.due + ((bt - prev) * this.rate) / this.bpmNow, 4);
    this.lastCt = this.ct;
    const crossed = Math.floor(bt) !== Math.floor(prev);

    this.kick += (i.kick - this.kick) * Math.min(1, dt * 20);
    this.snare += (i.snare - this.snare) * Math.min(1, dt * 20);
    this.hat += (i.hat - this.hat) * Math.min(1, dt * 20);
    this.bassEnv *= Math.exp(-dt * 4);
    i.cols.forEach((c, k) => {
      const t = this.cols[k];
      if (!t) return;
      this.c.setRGB(...c);
      const m = Math.max(this.c.r, this.c.g, this.c.b, 0.05);
      t.lerp(this.c.multiplyScalar(1 / m), Math.min(1, dt * 3));
    });
    const bar = i.playing && i.bar !== undefined ? i.bar : bt / 4;

    if (crossed) {
      for (let b = Math.floor(prev) + 1; b <= Math.floor(bt); b++) this.onBeat(b);
    }
    for (let c = Math.floor(prevCt) + 1; c <= Math.floor(this.ct) && c - prevCt < 16; c++) this.onConveyorBeat(c);
    const liftTrig = this.bassPending || (crossed && bt - this.liftLastMove >= 2);
    if (this.lift.update(bt, liftTrig)) this.bassPending = false;
    if (!this.lift.busy) this.bassPending = false;
    for (const s of this.shuttles) s.runner.update(bt, false);
    // Every bar: call a buffered parcel back out of the store if its chute has room again.
    if (Math.floor(bar) !== this.retrieveShot) {
      this.retrieveShot = Math.floor(bar);
      this.requestRetrieve();
    }

    // Time of day: "dusk" (0) is the day look, "night" (1) the club.
    this.applyTheme(1 - smooth01((i.tod ?? 0) * 1.6 - 0.3));

    this.floor.update(dt, bt, {
      kick: this.kick,
      snare: this.snare,
      hat: this.hat,
      day: this.day,
      dayShown: !!this.dayShown,
      cols: this.cols,
      pad: this.time < this.padUntil ? this.padCol : null,
      bar,
      show: this.fx.projectors,
      robotGlow: this.fx.robotGlow,
      dance: this.fx.dance,
    });
    this.updateParcels(dt);
    this.updateTrays(dt);
    this.updateStore();
    this.updateClub(dt, bar);
    this.updateForklifts(dt, prev);
    this.trucks.update(bt);
    this.batches.tick(this.hubTime());
    this.kpi.tick(this.hubTime(), () => ({
      chutesFull: CHUTES.reduce((a, _, k) => a + (k !== REJECT && this.room(k) <= 0 ? 1 : 0), 0),
      robotsBusyPct: (100 * this.floor.fleet.bots.filter((b) => b.state !== 'idle').length) / this.floor.fleet.bots.length,
      infeedQueue: this.backlog + this.waiting.reduce((a, b) => a + b, 0),
      ...this.storeUse(),
      batch: this.batches.active ? `${this.batches.active.city.name} ${Math.round(this.batches.active.share * 100)}%` : '',
    }));
    this.manual.update(bt, this.dayShown !== false);
    this.yard.update(bt);
    this.life.update(dt, bt);
    this.xmas?.update(bt, 1 - this.day, this.kick);
    this.crowd.update(dt, bt, { kick: this.kick, snare: this.snare, hat: this.hat, energy: i.energy, cols: this.cols, dayShown: !!this.dayShown });
    this.roof.update(bt, this.day, this.camera);
    this.party.update(dt, bt, { kick: this.kick, snare: this.snare, hat: this.hat, energy: i.energy, bar, cols: this.cols, dayShown: !!this.dayShown });
    const bots = this.floor.fleet.bots;
    this.screens.updateMap(this.time, this.mapData(), this.camera.position.distanceTo(this.t.set(-48, 2.7, 21.5)) < 14);
    this.screens.update(this.time, {
      ...this.stats,
      boxesShipped: this.floor.shippedBoxes,
      robotsBusy: bots.filter((b) => b.state !== 'idle').length,
      robots: bots.length,
      fullBoxes: this.floor.bins.filter((b) => !b.open).length,
      speed: this.speed,
    });
    this.docks.update(dt, bt, { kick: this.kick, snare: this.snare, dayShown: !!this.dayShown, dance: this.fx.dance });
    this.updateCamera(dt, bar, i.travelSpeed);
    this.bakeShadows();
    if (this.shadowMode === 'live') {
      // The sun stands high in the south-east; its shadow box is centred where the camera looks.
      this.keyLight.position.copy(this.look).add(this.t.set(25, 45, 30));
      this.keyLight.target.position.copy(this.look);
    }
    // (No depth of field when following a parcel: the blurred background did not look right.)
    this.bokeh.enabled = false;
    this.bloom.strength = (0.75 + this.kick * 0.35 + this.snare * 0.15) * (1 - this.day);
    this.bloom.enabled = this.day < 0.98 && this.fx.bloom;
    this.batcher.update();
    this.composer.render(dt);
  }

  // ---------- music events ----------
  private onBeat(b: number): void {
    this.floor.beat(b);
    this.docks.beat(b, !!this.dayShown);
    if (b % 2 === 0) this.floor.tableBeat(b / 2, this.cols);
  }

  /** Every beat of the conveyor clock: keep parcels flowing (more of them when the belts run faster). */
  private onConveyorBeat(c: number): void {
    void c;
    // Parcels arrive at the set rate (lead notes count towards it); each goes to the lane with
    // the shortest queue. Each lane lands at most one parcel per belt beat on the next free tray
    // of its parity (the loop then fills every tray); above that a queue
    // builds up at the infeed (shown on the lanes, the rest counted on the screens).
    while (this.due >= 1) {
      this.due--;
      this.backlog++;
    }
    for (let tries = 0; this.backlog > 0 && tries < 4; tries++) {
      const k = this.quietestLane();
      if (k < 0 || !this.spawn(k, null, false)) break;
      this.backlog--;
    }
  }

  /** The lane with the fewest parcels waiting, if one has room for another (−1 if all are full). */
  private quietestLane(): number {
    let best = -1;
    for (let k = 0; k < this.lanes.length; k++) if (this.waiting[k]! < LANE_QUEUE && (best < 0 || this.waiting[k]! < this.waiting[best]!)) best = k;
    return best;
  }

  /** Parcels per minute coming into the hub (set from the controls). */
  rate = 150;
  /** Parcels due but not yet on a lane (the queue outside the infeed doors). */
  backlog = 0;
  private due = 0;
  private readonly hq = new THREE.Quaternion();
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();

  /** Draw a shipping label: postcode, city, a barcode from the parcel number, and a sorting code. */
  private drawLabel(cell: number, p: Parcel | null): void {
    const g = this.labelCanvas;
    const x = (cell % LABEL_COLS) * LABEL_W;
    const y = Math.floor(cell / LABEL_COLS) * LABEL_H;
    g.fillStyle = '#ffffff';
    g.fillRect(x, y, LABEL_W, LABEL_H);
    g.fillStyle = '#111';
    g.fillRect(x + 1, y + 1, LABEL_W - 2, 1);
    // Barcode: bar widths from the parcel number.
    let seed = (p?.id ?? 7) * 2654435761;
    for (let bx = x + 6; bx < x + LABEL_W - 8; ) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const w = 1 + (seed >>> 29) % 3;
      g.fillRect(bx, y + 34, w, 18);
      bx += w + 1 + ((seed >>> 26) & 1);
    }
    if (p) {
      g.textBaseline = 'top';
      g.font = '700 17px system-ui, sans-serif';
      g.fillText(pcDigits(p.pc), x + 5, y + 4);
      g.font = '600 10px system-ui, sans-serif';
      const city = CITIES.find((c) => c.pc.some(([a, b]) => p.pc >= a && p.pc <= b))?.name ?? '';
      g.fillText(city.slice(0, 15), x + 5, y + 22);
      g.font = '500 8px system-ui, sans-serif';
      g.fillText(String(p.id).padStart(8, '0'), x + 6, y + 54);
      // Measured size (L×B×H cm) and weight, as the scan tunnel will print them.
      g.fillText(`${Math.round(p.d * 100)}×${Math.round(p.w * 100)}×${Math.round(p.h * 100)} ${p.kg.toFixed(1)}kg`, x + 46, y + 54);
      // A sorting code box in the corner: chute number.
      g.fillRect(x + LABEL_W - 26, y + 4, 22, 16);
      g.fillStyle = '#fff';
      g.font = '700 11px system-ui, sans-serif';
      g.fillText(String((p.dest >= 0 ? p.dest + 1 : 0)).padStart(2, '0'), x + LABEL_W - 22, y + 6);
      // Service marks: small coloured boxes with a letter, under the sorting code.
      p.tags.forEach((t, i) => {
        const [ch, col] = TAG_MARK[t];
        const bx = x + LABEL_W - 26 + (i % 2) * 11;
        const by = y + 22 + Math.floor(i / 2) * 11;
        g.fillStyle = col;
        g.fillRect(bx, by, 10, 10);
        g.fillStyle = '#fff';
        g.font = '700 8px system-ui, sans-serif';
        g.fillText(ch, bx + 2, by + 1);
      });
    }
    if (!this.labelsDirty) this.labelsDirty = this.time || 0.001;
  }

  /** Put a parcel in a cage or box (local position): it keeps its shape and colour and moves with it. */
  private hold(p: Parcel, holder: THREE.Object3D, local: V3): void {
    p.mode = 'held';
    p.holder = holder;
    p.off.copy(local);
    p.flash = 0;
  }
  /** Conveyor beats since the last frame. */
  private dct = 0;
  /** Parcels waiting at each lane's hold point. */
  private waiting = [0, 0, 0, 0];

  /** Most parcels per minute the infeed can take at the highest belt speed. */
  static readonly MAX_RATE = 2 * BELT_SPEEDS[BELT_SPEEDS.length - 1]! * BPM;
  /** At the current belt speed. */
  infeedCapacity(): number {
    return Math.round(2 * this.speed * this.bpmNow);
  }

  /** The music's tempo now: everything in the hall runs on its beat. */
  bpmNow = BPM;

  getQuality(): Quality {
    return this.quality;
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    const hq = q === 'high' || q === 'ultra';
    this.gtao.enabled = hq;
    const ultra = q === 'ultra';
    this.gtao.updateGtaoMaterial({ samples: ultra ? 24 : 12, radius: ultra ? 0.5 : 0.35 });
    this.quality = q;
    this.shadowMode = null; // re-decide the shadows for this quality
    this.dayShown = null; // re-apply the look (mirror floor, shadows)
    this.applyTheme(this.day);
  }

  /**
   * Sun shadows. `live` (quality high and up, Minimal and Night): every solid casts, in a box
   * that follows the camera, drawn every frame. `baked` (the realistic day, quality normal and
   * up): one box over the whole hall, drawn once and then only now and then, with only what
   * stands still casting (what moves keeps its soft contact shadow), so the shadows cost
   * next to nothing per frame. `off` otherwise.
   */
  private shadowMode: 'off' | 'live' | 'baked' | null = null;
  /** Meshes that move (found by watching them for a moment), kept out of the baked shadows. */
  private movers: THREE.Mesh[] | null = null;
  private moverWatch: { list: { m: THREE.Mesh; w: THREE.Matrix4; v: number }[]; until: number } | null = null;
  private nextBake = 0;

  private updateShadows(): void {
    const q = this.quality;
    const hq = q === 'high' || q === 'ultra';
    const mode = this.real && this.dayShown === true ? (q === 'low' ? 'off' : 'baked') : hq ? 'live' : 'off';
    if (mode === this.shadowMode) return;
    const on = mode !== 'off';
    if (on !== this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.enabled = on;
      // Shadow maps change the shader programs.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
      });
    }
    const sun = this.keyLight;
    sun.castShadow = on;
    const sc = sun.shadow.camera;
    if (mode === 'baked') {
      // The whole hall from a fixed sun (high in the south-east, as in the live mode).
      sun.target.position.set(HCX, 0, HZC);
      sun.position.set(HCX + 50, 90, HZC + 60);
      sc.left = sc.bottom = -115;
      sc.right = sc.top = 115;
      sc.near = 1;
      sc.far = 320;
      // (2048 even on high: a 4096 depth map is 64 MB, too much for many phones.)
      sun.shadow.mapSize.setScalar(2048);
      sun.shadow.normalBias = 0.06;
      sun.shadow.bias = -0.0004;
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.shadowMap.needsUpdate = true;
      for (const m of this.movers ?? []) m.castShadow = false;
      if (!this.movers) this.watchMovers();
    } else {
      const ultra = q === 'ultra';
      sc.left = sc.bottom = ultra ? -55 : -36;
      sc.right = sc.top = ultra ? 55 : 36;
      sc.near = 1;
      sc.far = 140;
      sun.shadow.mapSize.setScalar(ultra ? 4096 : 2048);
      sun.shadow.normalBias = 0.03;
      sun.shadow.bias = -0.0006;
      this.renderer.shadowMap.autoUpdate = true;
      for (const m of this.movers ?? []) m.castShadow = true;
    }
    sc.updateProjectionMatrix();
    sun.shadow.map?.dispose();
    sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    this.shadowMode = mode;
  }

  /** Note where every shadow caster is now; `checkMovers` compares a moment later. */
  private watchMovers(): void {
    const list: { m: THREE.Mesh; w: THREE.Matrix4; v: number }[] = [];
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.castShadow) return;
      const im = m as THREE.InstancedMesh;
      list.push({ m, w: m.matrixWorld.clone(), v: im.isInstancedMesh ? im.instanceMatrix.version : 0 });
    });
    this.moverWatch = { list, until: this.time + 1.5 };
  }

  /** Per frame while baking: find the movers, then bake again now and then (doors, trucks). */
  private bakeShadows(): void {
    if (this.shadowMode !== 'baked') return;
    const w = this.moverWatch;
    if (w && this.time >= w.until) {
      this.movers = w.list
        .filter(({ m, w: mw, v }) => {
          const im = m as THREE.InstancedMesh;
          return (m as THREE.SkinnedMesh).isSkinnedMesh || !m.matrixWorld.equals(mw) || (im.isInstancedMesh && im.instanceMatrix.version !== v);
        })
        .map(({ m }) => m);
      for (const m of this.movers) m.castShadow = false;
      this.moverWatch = null;
      this.renderer.shadowMap.needsUpdate = true;
      this.nextBake = this.time + 30;
    } else if (!w && this.time >= this.nextBake) {
      this.renderer.shadowMap.needsUpdate = true;
      this.nextBake = this.time + 30;
    }
  }

  /** Belt speed, as a multiple of 2 m per beat (3.3 m/s at 100 BPM). */
  beltSpeed(): number {
    return this.speed;
  }

  setBeltSpeed(v: number): void {
    if (BELT_SPEEDS.includes(v)) this.speed = v;
  }

  /** Robots take parcels from the stations and tip them into bins. */
  private onFleet(e: FleetEvent): void {
    if (e.t === 'load') {
      const p = this.stationQueue[e.station]!.shift();
      if (!p) return;
      p.mode = 'robot';
      p.bot = e.bot;
      this.floor.stationCode(e.station, p.pos, pcDigits(p.pc), p.h + 0.01, this.chutes[p.dest]!.col);
      p.rideAt = Math.floor(this.bt);
      p.dropAt = undefined;
      this.botParcel.set(e.bot, p);
    } else if (e.t === 'loaded') {
      const p = this.botParcel.get(e.bot);
      if (p) p.bin = e.bin;
    } else if (e.t === 'drop') {
      const p = this.botParcel.get(e.bot);
      if (p) p.dropAt = this.bt;
    } else if (e.t === 'dropped') {
      this.stats.toRobots++;
      const p = this.botParcel.get(e.bot);
      // Into a box (it stays there and leaves with the box, in a truck), or into the drop to the manual sort table.
      if (p && e.bin === this.floor.tableBin) {
        p.mode = 'manual';
        this.manual.arrive(p, this.bt);
      } else if (p) {
        const bin = this.floor.bins[e.bin]!;
        this.hold(p, bin.g, this.floor.binSlot(Math.max(0, bin.n - 1), new THREE.Vector3()));
        this.floor.addToBin(e.bin, p.w * p.h * p.d, p.kg);
      }
      this.botParcel.delete(e.bot);
    }
  }

  private spawnLead(color: RGB, pitch: number, vel: number): void {
    const pair = pitch >= 0.5 ? [2, 3] : [0, 1];
    if (Math.random() < 0.5) pair.reverse();
    for (const k of pair) {
      const lane = this.lanes[k]!;
      lane.doorFlash = 0.6 + vel * 0.4;
      lane.doorCol.setRGB(...color);
      // A lead parcel is one of the due ones (taken early), so the rate stays as set.
      if (this.ct - lane.lastSpawn >= 0.5 && this.backlog + this.due >= 1 && this.waiting[k]! < 2 && this.spawn(k, color, true)) {
        if (this.backlog > 0) this.backlog--;
        else this.due--;
        return;
      }
    }
  }

  /** Buffer store: places taken (or reserved) and all places. */
  storeUse(): { storeUsed: number; storeSlots: number } {
    return { storeUsed: this.slots.filter((s) => s.parcel || s.reserved).length, storeSlots: this.slots.length };
  }

  /** Calls a buffered parcel back out of the store once its chute has room again (oldest first). */
  private requestRetrieve(): void {
    if (this.retrieving >= 3 || this.lift.steps.length > 10) return;
    let best: Slot | null = null;
    for (const s of this.slots) {
      const p = s.parcel;
      if (!p || s.reserved || p.mode !== 'fixed') continue;
      const d = p.buffered ?? -1;
      // Back out once its chute has some room again (not at the first free place), and
      // not before it has stood a few bars: a store fills during a batch and empties after.
      if (d >= 0 && this.room(d) < 4) continue;
      if (this.bt - (p.bufferedAt ?? 0) < MIN_STORE_BEATS) continue;
      if (!best || (p.bufferedAt ?? 0) < (best.parcel!.bufferedAt ?? 0)) best = s;
    }
    if (best) this.retrieve(best);
  }

  /** Sends a parcel whose chute is full to the buffer store, if a rack slot is free. */
  private buffer(p: Parcel): boolean {
    if (p.d >= 1.1 || p.tray2 !== undefined) return false;
    const inFlight = this.parcels.reduce((n, x) => n + (x.slot && x.mode !== 'fixed' && x.pathKind !== 'back' ? 1 : 0), 0);
    if (inFlight >= 12 || this.lift.steps.length > 14) return false;
    const free = this.slots.filter((s) => !s.parcel && !s.reserved);
    if (!free.length) return false;
    // Nearest the lift first (short shuttle trips), low levels a little before high ones.
    free.sort((a, b) => Math.abs(a.z) + a.level * 0.3 - (Math.abs(b.z) + b.level * 0.3));
    const slot = free[0]!;
    slot.reserved = true;
    p.slot = slot;
    p.buffered = p.dest;
    p.bufferedAt = this.bt;
    p.dest = -1;
    this.kpi.recirculated();
    this.retarget(p);
    return true;
  }

  // ---------- parcels ----------
  /**
   * A postcode and the chute for it: most to the cities at the north docks (their
   * chute), about 12% to the cities served by the robots (any pickup station, the least
   * busy of three tried); now and then an exception for manual sorting.
   */
  private assign(p: Parcel): void {
    // The robots handle less than the roll cages: about one parcel in eight goes to them,
    // and fewer still while their pickup tables are filling up.
    const queued = this.stationQueue.reduce((a, q) => a + q.length, 0);
    const load = Math.min(1, queued / Math.max(1, this.stationQueue.length * 3));
    const r = randomPostcode(Math.random, ROBOT_SHARE * (1 - 0.8 * load), this.batches.pick());
    p.pc = r.pc;
    p.manual = false;
    if (r.north) {
      // A city with two docks: they take turns; if the one whose turn it is is full, the other.
      const ch = this.cityChutes[r.city]!;
      let pick = ch[this.splitTurn++ % ch.length]!;
      if (ch.length > 1 && this.room(pick) <= 0) pick = ch.find((c) => c !== pick && this.room(c) > 0) ?? pick;
      p.dest = pick;
      return;
    }
    const stations = CHUTES.map((_, k) => k).filter((k) => this.stationOf.has(k));
    if (Math.random() < 0.03) {
      // Manual sorting: from one of the westmost stations (the last ones along the loop).
      p.manual = true;
      p.dest = stations[stations.length - 1 - Math.floor(Math.random() * 3)]!;
      return;
    }
    let best = -1;
    for (let n = 0; n < 3; n++) {
      const k = stations[Math.floor(Math.random() * stations.length)]!;
      if (best < 0 || this.stationQueue[this.stationOf.get(k)!]!.length < this.stationQueue[this.stationOf.get(best)!]!.length) best = k;
    }
    p.dest = best;
  }

  private newParcel(): Parcel | null {
    if (this.parcels.length >= MAX_PARCELS) return null;
    const r = Math.random();
    // Flat envelopes, soft polybags, tubes and boxes.
    const env = r < 0.12;
    const bag = !env && r < 0.3;
    const tube = !env && !bag && r < 0.37;
    // Now and then a box too big for the sorter (it will be measured at the infeed and put aside).
    const big = !env && !bag && !tube && Math.random() < 0.004;
    const w = env ? rnd(0.7, 0.9) : bag ? rnd(0.45, 0.8) : tube ? rnd(0.16, 0.26) : big ? rnd(0.8, 1.0) : rnd(0.35, 0.95);
    const h = env ? rnd(0.06, 0.12) : bag ? rnd(0.12, 0.25) : tube ? w : big ? rnd(0.6, 0.9) : rnd(0.22, 0.7);
    const d = env ? rnd(0.5, 0.7) : bag ? rnd(0.4, 0.65) : tube ? rnd(0.7, 1.1) : big ? rnd(1.25, 1.6) : rnd(0.35, 0.85);
    // Weight from the volume and a density (most parcels are largely air).
    const vol = w * h * d;
    // (Big boxes are mostly light goods: lower density; only a few end up over 31.5 kg.)
    const kg = env ? rnd(0.1, 0.9) : Math.min(45, vol * (bag ? rnd(60, 160) : tube ? rnd(80, 220) : rnd(30, 120) / (vol > 0.15 ? 1.6 : 1)) + 0.15);
    const p: Parcel = {
      id: this.nextId++,
      w,
      h,
      d,
      kg,
      tags: TAGS.filter((t) => Math.random() < TAG_ODDS[t]),
      born: this.hubTime(),
      col: new THREE.Color(
        env ? pick([0xe8e6e0, 0xd6d3cc, 0xbfc4cc]) : bag ? pick([0xf3f4f6, 0x9aa0a8, 0x1d1d1f, 0x2c62c8, 0xd6339a, 0x6b3fd1]) : tube ? pick([0xb08a5e, 0xc4a070, 0xe6e4de]) : pick(PARCEL_COLS),
      ),
      glow: new THREE.Color(),
      lead: false,
      shape: bag ? 1 : tube ? 2 : 0,
      // Christmas: some boxes are presents, in wrapping paper with a ribbon round them.
      gift: XMAS && !env && !bag && !tube && !big && Math.random() < 0.18,
      scanned: false,
      flash: 0,
      dest: 0,
      pc: 0,
      mode: 'fixed',
      pathKind: 'lane',
      lane: 0,
      t0: 0,
      t1: 1,
      ease: 0,
      sPrev: 0,
      sIn: 0,
      tIn: 0,
      divertAt: 0,
      tray: -1,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      off: new THREE.Vector3(),
      shuttle: 0,
      pos: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      yawQ: new THREE.Quaternion().setFromAxisAngle(UP, rnd(-0.25, 0.25)),
      vel: new THREE.Vector3(),
      dead: false,
    };
    if (p.gift) p.col.set(pick([0xc8102e, 0x1f7a3a, 0xe8b923, 0x1755fe, 0xd6339a, 0xf3f4f6]));
    this.assign(p);
    p.labelCell = this.freeCells.pop() ?? 0;
    if (p.labelCell) this.drawLabel(p.labelCell, p);
    this.parcels.push(p);
    return p;
  }

  /** Puts a parcel on a lane, timed to land on a free tray on a beat. Returns false if the lane is full. */
  private spawn(k: number, color: RGB | null, lead: boolean): boolean {
    const lane = this.lanes[k]!;
    const bt = this.ct;
    let arrive = Math.max(Math.ceil(bt + lane.path.len / BEAT_M) + LANE_PHASE[k]!, lane.lastArrive + 1);
    if (this.waiting[k]! >= LANE_QUEUE) return false;
    const p = this.newParcel();
    if (!p) return false;
    // A parcel longer than a tray takes the one behind it too.
    const long = p.d > 0.9;
    const behind = (t: number) => (t - 1 + TRAYS) % TRAYS;
    const free = (t: number) => !this.trayOwner[t] && (!long || !this.trayOwner[behind(t)]);
    let tries = 0;
    while (!free(trayAt(INDUCT[k]!, arrive)) && tries++ < 6) arrive++;
    const tray = trayAt(INDUCT[k]!, arrive);
    if (!free(tray)) {
      p.dead = true;
      p.recycled = true;
      return false;
    }
    lane.lastArrive = arrive;
    lane.lastSpawn = bt;
    this.trayOwner[tray] = p;
    p.tray = tray;
    if (long) {
      p.tray2 = behind(tray);
      this.trayOwner[p.tray2] = p;
    }
    p.lane = k;
    p.lead = lead;
    if (lead && color) p.glow.setRGB(...color);
    if (!lead) p.glow.copy(p.dest >= 0 ? this.chutes[p.dest]!.col : this.white);
    this.onPath(p, lane.path, 'lane', bt, arrive, 0);
    return true;
  }

  private onPath(p: Parcel, path: Path, kind: Parcel['pathKind'], t0: number, t1: number, ease: 0 | 1): void {
    p.mode = 'path';
    p.path = path;
    p.pathKind = kind;
    p.t0 = t0;
    p.t1 = Math.max(t0 + 0.05, t1);
    p.ease = ease;
    p.sPrev = 0;
  }

  private tween(p: Parcel, to: V3, beats: number, done: () => void): void {
    p.mode = 'tween';
    p.from.copy(p.pos);
    p.to.copy(to);
    p.t0 = this.bt;
    p.t1 = this.bt + beats;
    p.done = done;
  }

  private induct(p: Parcel, s: number, t: number): void {
    p.mode = 'loop';
    p.sIn = s;
    p.tIn = t;
    p.sPrev = s;
    this.retarget(p);
  }

  /** When to leave the loop: at its chute (or the no-read chute), the next time it passes. */
  private retarget(p: Parcel): void {
    const target = p.noread ? this.chutes[REJECT]!.s : p.dest >= 0 ? this.chutes[p.dest]!.s : STORE_OUT;
    let at = p.tIn + beatsAlong(p.sIn, target);
    while (at <= this.ct + 0.01 && p.mode === 'loop' && at > p.tIn + 0.5) at += LOOP_LEN / BEAT_M;
    p.divertAt = at;
  }

  private updateParcels(dt: number): void {
    const bt = this.bt;
    const ct = this.ct;
    // Queues at the infeed hold points: rank parcels by when they go.
    const queued: Parcel[][] = this.lanes.map(() => []);
    for (const p of this.parcels) {
      if (p.mode === 'path' && p.pathKind === 'lane' && ct < p.t1 - (p.path!.len - HOLD_S) / BEAT_M) queued[p.lane]!.push(p);
    }
    queued.forEach((q, k) => {
      let at = 0;
      q.sort((a, b) => a.t1 - b.t1).forEach((p, n) => {
        p.rank = n;
        p.queueAt = at;
        at += p.d + GAP;
      });
      this.waiting[k] = q.length;
    });
    // Pickup tables: nose to tail by length.
    for (const q of this.stationQueue) {
      let at = 0;
      for (const p of q) {
        p.queueAt = at + p.d / 2;
        at += p.d + GAP;
      }
    }
    // Dock belts: each parcel may run up to the one ahead, the first up to the queue at the end.
    this.dockLoad.clear();
    for (const p of this.parcels) {
      if (p.mode !== 'path' || (p.pathKind !== 'dock' && !(p.pathKind === 'chute' && !p.rejected && p.dest >= 0 && !this.stationOf.has(p.dest)))) continue;
      this.dockLoad.set(p.dest, (this.dockLoad.get(p.dest) ?? 0) + p.d + GAP);
    }
    const onBelt = new Map<Path, Parcel[]>();
    for (const p of this.parcels) {
      if (p.mode !== 'path' || p.pathKind !== 'dock') continue;
      const l = onBelt.get(p.path!) ?? [];
      l.push(p);
      onBelt.set(p.path!, l);
    }
    this.beltBack.clear();
    for (const [path, l] of onBelt) {
      l.sort((a, b) => b.sPrev - a.sPrev);
      const last = l[l.length - 1]!;
      this.beltBack.set(path, last.sPrev - last.d / 2);
      let limit = path.len - this.docks.depth(l[0]!.dest);
      let prev: Parcel | null = null;
      for (const p of l) {
        p.limit = prev ? Math.min(limit, prev.sPrev - prev.d / 2 - p.d / 2 - GAP) : limit - p.d / 2;
        p.limitIsQueue = !prev;
        limit = p.limit;
        prev = p;
      }
    }
    this.backlog = Math.min(this.backlog, 5000);
    for (const p of this.parcels) {
      const before = this.p.copy(p.pos);
      switch (p.mode) {
        case 'path': {
          const path = p.path!;
          let f = clamp((ct - p.t0) / (p.t1 - p.t0), 0, 1);
          if (p.ease) f = f * f;
          let s = f * path.len;
          if (p.pathKind === 'lane') {
            // Lanes run at belt speed into a hold point before the scan tunnel, queue there
            // (an accumulating belt) and are let go so they land on their tray on the beat.
            const go = p.t1 - (path.len - HOLD_S) / BEAT_M;
            s = ct >= go ? HOLD_S + (ct - go) * BEAT_M : Math.min((ct - p.t0) * BEAT_M, HOLD_S - (p.queueAt ?? 0));
            s = clamp(s, 0, path.len);
          } else if (p.pathKind === 'dock') {
            // Roller belt to the dock: run at belt speed, but stop behind the parcel ahead
            // (or the queue at the end), so parcels bank up instead of running into each other.
            s = Math.min(p.sPrev + this.dct * BEAT_M, p.limit ?? path.len);
            if (s >= (p.limit ?? path.len) - 0.01 && p.limitIsQueue) {
              path.at(s, p.pos, this.t);
              this.orient(p, this.t);
              p.sPrev = s;
              this.pathEnd(p);
              break;
            }
          }
          path.at(s, p.pos, this.t);
          this.orient(p, this.t);
          if (p.pathKind === 'chute') {
            // Sliding down a chute: it rocks over and turns a little (each its own way), and settles at the bottom.
            const u = clamp((ct - p.t0) / (p.t1 - p.t0), 0, 1);
            const side = p.id % 2 ? 1 : -1;
            const k = Math.sin(u * Math.PI);
            this.qa.setFromAxisAngle(this.t.normalize(), side * k * (p.shape === 1 ? 0.15 : 0.32));
            this.qb.setFromAxisAngle(UP, side * (0.25 + (p.id % 5) * 0.08) * k);
            p.q.premultiply(this.qb).premultiply(this.qa);
            // A small hop where the steep part meets the level run-out.
            p.pos.y += Math.max(0, Math.sin((u - 0.55) * Math.PI * 4)) * 0.05 * (u > 0.55 && u < 0.8 ? 1 : 0);
          }
          if (p.pathKind === 'lane') {
            const lane = this.lanes[p.lane]!;
            if (p.sPrev < lane.tunnelS && s >= lane.tunnelS) {
              this.scan(p, lane.tunnel);
              // The scan tunnel also measures and weighs: too big or too heavy for the trays goes aside.
              if (p.dest >= 0 && (Math.max(p.w, p.d, p.h) > 1.2 || p.kg > 31.5)) {
                p.noread = true;
                p.reason = 'oversize';
              } else if (!lane.tunnel.read && p.dest >= 0) {
                p.noread = true;
                p.reason = 'noread';
                this.kpi.noread();
                if (p.labelCell) this.drawLabel(p.labelCell, p);
              }
            }
          }
          p.sPrev = s;
          // A parcel at the foot of a dock chute waits there until the belt start is clear.
          const belt = p.pathKind === 'chute' && !p.rejected && p.dest >= 0 ? this.chutes[p.dest]!.belt : undefined;
          const blocked = !!belt && !this.stationOf.has(p.dest) && (this.beltBack.get(belt) ?? 99) < p.d + GAP;
          if (ct >= p.t1 && p.pathKind !== 'dock' && !blocked) this.pathEnd(p);
          break;
        }
        case 'loop': {
          const s = p.sIn + (Math.min(ct, p.divertAt) - p.tIn) * BEAT_M;
          loopAt(s, p.pos, this.t);
          this.orient(p, this.t);
          for (const lt of this.loopTunnels) {
            if (Math.floor((p.sPrev - lt.s) / LOOP_LEN) !== Math.floor((s - lt.s) / LOOP_LEN)) {
              this.scan(p, lt.t);
              // A loop scanner may still read a label the infeed could not (then on to its own chute).
              if (p.noread && p.reason === 'noread' && Math.random() < 0.35) {
                p.noread = false;
                this.retarget(p);
              }
            }
          }
          p.sPrev = s;
          if (ct >= p.divertAt) this.divert(p);
          break;
        }
        case 'tween': {
          const f = clamp((bt - p.t0) / (p.t1 - p.t0), 0, 1);
          p.pos.lerpVectors(p.from, p.to, easeIO(f));
          if (f >= 1) {
            const d = p.done;
            p.done = undefined;
            d?.();
          }
          break;
        }
        case 'carriage':
          p.pos.set(LIFT_X + p.off.x, animAt(this.liftAnim, bt), p.off.z);
          break;
        case 'shuttle': {
          const sh = this.shuttles[p.shuttle]!;
          p.pos.set(SHUTTLE_X, LEVELS[p.shuttle]!, animAt(sh.anim, bt));
          break;
        }
        case 'queue': {
          const k = this.queue.indexOf(p);
          const target = this.intake.len - 0.5 - Math.max(0, k) * 1.2;
          p.sPrev += (target - p.sPrev) * Math.min(1, dt * 4);
          this.intake.at(p.sPrev, p.pos, this.t);
          this.orient(p, this.t);
          break;
        }
        case 'table': {
          // Parcels queue nose to tail, each by its own length.
          this.floor.tableSlot(p.station!, p.queueAt ?? 0, this.p);
          // Roll along the table to its place in the queue (rollers: about 3 m/s at most).
          this.n.subVectors(this.p, p.pos);
          const gap = this.n.length();
          if (gap > 1e-4) p.pos.addScaledVector(this.n, Math.min(gap, dt * 3) / gap);
          this.orient(p, this.t.set(0, 0, 1));
          break;
        }
        case 'robot': {
          const yaw = this.floor.robotTop(p.bot!, this.p);
          if (p.dropAt !== undefined) {
            // Tipped off the robot into its bin.
            const f = clamp(bt - p.dropAt, 0, 1);
            this.floor.binPos(p.bin!, this.n);
            p.pos.lerpVectors(this.p, this.n, f * f);
          } else if (bt - p.rideAt! < 1) {
            this.floor.tableSlot(p.station!, p.d / 2 - 0.2, this.n);
            p.pos.lerpVectors(this.n, this.p, easeIO(clamp(bt - p.rideAt!, 0, 1)));
          } else p.pos.copy(this.p);
          this.orient(p, this.t.set(Math.sin(yaw), 0, Math.cos(yaw)));
          break;
        }
        case 'fixed':
        case 'dock': {
          // Banked up at the end of the dock belt: slide forward as the worker takes the ones in front.
          const q = this.docks.queueOf(p.dest);
          const i = q.indexOf(p as never);
          const belt = this.chutes[p.dest]?.belt;
          if (i < 0 || !belt) break;
          let ahead = 0.1;
          for (let j = 0; j < i; j++) ahead += (q[j] as unknown as Parcel).d + GAP;
          const target = belt.len - ahead - p.d / 2;
          if (p.sPrev < target - 0.005) {
            p.sPrev = Math.min(target, p.sPrev + this.dct * BEAT_M);
            belt.at(p.sPrev, p.pos, this.t);
            this.orient(p, this.t);
          }
          break;
        }
        case 'manual':
          this.manual.place(p, bt);
          break;
        case 'held': {
          // In a cage or a box: rides along with it.
          const h = p.holder!;
          p.pos.copy(p.off).applyMatrix4(h.matrixWorld);
          h.getWorldQuaternion(this.hq);
          p.q.copy(this.hq).multiply(p.yawQ);
          break;
        }
      }
      if (dt > 0) p.vel.subVectors(p.pos, before).divideScalar(dt);
      p.flash = Math.max(0, p.flash - dt * 2.5);
    }
    // Drop finished parcels.
    if (this.parcels.some((p) => p.dead)) {
      for (const p of this.parcels) {
        if (!p.dead) continue;
        if (p.labelCell) this.freeCells.push(p.labelCell);
        if (!p.recycled) this.kpi.out(this.hubTime() - p.born);
      }
      this.parcels = this.parcels.filter((p) => !p.dead);
      if (this.follow?.dead) this.follow = null;
    }
    this.writeParcels();
  }

  private orient(p: Parcel, tan: V3): void {
    if (tan.lengthSq() < 1e-6) return;
    this.m4.lookAt(ZERO, tan, UP);
    p.q.setFromRotationMatrix(this.m4).multiply(p.yawQ);
  }

  private scan(p: Parcel, t: Tunnel): void {
    p.scanned = true;
    p.flash = 1;
    t.flash = 1;
    // Now and then a label cannot be read (a red line); the next scanner gets it.
    t.read = Math.random() > 0.02;
    t.col.copy(p.glow);
    const city = CITIES.find((c) => c.pc.some(([a, b]) => p.pc >= a && p.pc <= b))?.name ?? '';
    for (const side of [0, 1]) {
      if (t.read) this.scanLabels.set(t.screen * 2 + side, `${pcDigits(p.pc)} ${city}`, `${String(p.id).padStart(8, '0')} · chute ${p.dest >= 0 ? p.dest + 1 : p.buffered !== undefined ? `${p.buffered + 1} → buffer` : 'store'}`, { bg: '#101114', fg: '#ffffff', sub: '#5be0a0' });
      else this.scanLabels.set(t.screen * 2 + side, 'NO READ', String(p.id).padStart(8, '0'), { bg: '#2a0d0d', fg: '#ff5a4a', sub: '#e0a0a0' });
    }
    this.scanDirty = true;
  }

  private pathEnd(p: Parcel): void {
    switch (p.pathKind) {
      case 'lane':
        this.stats.inducted++;
        this.kpi.inducted(CITIES.find((c) => c.pc.some(([a, b]) => p.pc >= a && p.pc <= b))?.name ?? '');
        this.induct(p, INDUCT[p.lane]!, p.t1);
        break;
      case 'back':
        this.induct(p, STORE_BACK, p.t1);
        break;
      case 'chute': {
        if (p.rejected) {
          // Down the no-read chute: onto the belt to the manual sort table.
          const rb = this.chutes[REJECT]!.belt!;
          this.chutes[REJECT]!.flash = 1;
          this.inbound.set(REJECT, Math.max(0, (this.inbound.get(REJECT) ?? 0) - 1));
          p.rejected = false;
          this.onPath(p, rb, 'reject', p.t1, p.t1 + Math.max(2, Math.round(rb.len / BEAT_M)), 0);
          break;
        }
        const ch = this.chutes[p.dest]!;
        ch.flash = 1;
        const st = this.stationOf.get(p.dest);
        if (st !== undefined) this.inbound.set(p.dest, Math.max(0, (this.inbound.get(p.dest) ?? 0) - 1));
        if (st !== undefined && this.stationQueue[st]!.length < STATION_CAP) {
          // Onto the roller table, to wait for a robot.
          p.mode = 'table';
          p.station = st;
          this.stationQueue[st]!.push(p);

        } else if (ch.belt) {
          // Onto the roller belt to the dock.
          this.onPath(p, ch.belt, 'dock', p.t1, p.t1 + Math.max(2, Math.round(ch.belt.len / BEAT_M)), 0);
        } else p.dead = true;
        break;
      }
      case 'reject':
        // Onto the manual sort table's belt: the worker there gives it a new label.
        p.mode = 'manual';
        this.manual.arrive(p, this.bt, true);
        break;
      case 'dock':
        this.inbound.set(p.dest, Math.max(0, (this.inbound.get(p.dest) ?? 0) - 1));
        this.stats.toDocks++;
        p.mode = 'dock';
        this.docks.arrive(p.dest, p);
        break;
      case 'intake':
        p.mode = 'queue';
        p.sPrev = this.intake.len - 0.5;
        this.queue.push(p);
        this.store(p);
        break;
    }
  }

  /** Parcels on their way down a chute (diverted, not yet at the table or the dock). */
  private inbound = new Map<number, number>();

  /** Room left at a chute's end: the pickup table (4) or the dock belt (5), minus what is on its way. */
  private room(dest: number, need = 0.9): number {
    if (dest === REJECT) {
      const onRobots = this.floor.fleet.bots.filter((b) => b.bin === this.floor.tableBin).length;
      return this.manual.room(onRobots + (this.inbound.get(REJECT) ?? 0), 6) ? 1 : 0;
    }
    const st = this.stationOf.get(dest);
    // A pickup table holds as many as fit by length (about 0.8 m kept per parcel on its way).
    const used = st !== undefined ? this.stationQueue[st]!.reduce((a, p) => a + p.d + GAP, 0) : 0;
    if (st === undefined) return Math.floor(this.dockFree(dest) / need);
    const free = Math.min(STATION_CAP - this.stationQueue[st]!.length, Math.floor((TABLE_ROOM - used) / 0.8));
    return free - (this.inbound.get(dest) ?? 0);
  }

  /**
   * Belt length still free on a dock chute's roller belt: the whole belt, less the queue
   * at its end and every parcel already on the belt or on its way down the chute (by
   * length). The belt fills up nose to tail; a parcel is only tipped when it fits.
   */
  private dockFree(dest: number): number {
    const belt = this.chutes[dest]!.belt;
    if (!belt) return 0;
    // During a cleardown nothing more goes down this chute, until everything is in the truck.
    const door = NORTH_DOORS.indexOf(this.dockOf.get(dest) ?? NaN);
    if (door >= 0 && this.trucks && (this.trucks.clearing(door) || this.trucks.docks[door]?.state === 'closing')) return 0;
    return belt.len - this.docks.depth(dest) - (this.dockLoad.get(dest) ?? 0) - 0.2;
  }

  /** Length (with gaps) of the parcels on each dock belt or chute, not yet in the end queue; recounted every frame. */
  private dockLoad = new Map<number, number>();
  /** Position of the back of the last parcel on each dock belt (recounted every frame). */
  private beltBack = new Map<Path, number>();

  /**
   * The flow projector over each dock belt shows the postcodes of the first three parcels
   * waiting at its end, flat on top of them; a parcel's code goes when the worker lifts it.
   */
  private writeDockCodes(): void {
    const o = this.o;
    let i = 0;
    for (const [chute] of this.dockOf) {
      const q = this.docks.queueOf(chute);
      for (let n = 0; n < 3; n++, i++) {
        const p = q[n] as unknown as Parcel | undefined;
        if (!p || p.mode !== 'dock') {
          o.scale.set(0, 0, 0);
        } else {
          const text = pcDigits(p.pc);
          if (this.dockCodeText[i] !== text) {
            this.dockCodeText[i] = text;
            this.dockCodes.set(i, text, null, { bg: 'rgba(23, 85, 254, 0.88)', fg: '#ffffff' });
          }
          o.position.set(p.pos.x, p.pos.y + p.h + 0.02, p.pos.z);
          o.rotation.set(-Math.PI / 2, 0, 0);
          const sc = Math.min(1, (p.w * 0.9) / 0.5);
          o.scale.set(sc, sc, 1);
        }
        o.updateMatrix();
        this.dockCodes.place(i, o.matrix);
      }
    }
    o.scale.set(1, 1, 1);
    this.dockCodes.flush();
  }

  /** The parcel leaves its tray(s): they tilt and are free again. */
  private freeTrays(p: Parcel, side: number): void {
    for (const t of [p.tray, p.tray2 ?? -1]) {
      if (t < 0) continue;
      if (this.trayOwner[t] === p) this.trayOwner[t] = null;
      this.trayTilt[t] = side;
    }
    p.tray = -1;
    p.tray2 = undefined;
  }

  private divert(p: Parcel): void {
    // A no-read leaves by the no-read chute (its own chute is unknown to the sorter).
    const to = p.noread && p.dest >= 0 ? REJECT : p.dest;
    if (to !== p.dest) {
      if (this.room(REJECT) <= 0) {
        p.divertAt += LOOP_LEN / BEAT_M;
        return;
      }
      this.inbound.set(REJECT, (this.inbound.get(REJECT) ?? 0) + 1);
      this.kpi.toManual();
      this.freeTrays(p, 1);
      p.rejected = true;
      this.onPath(p, this.chutes[REJECT]!.path, 'chute', p.divertAt, p.divertAt + 1.5, 1);
      return;
    }
    if (p.dest >= 0 && this.room(p.dest, p.d + GAP) <= 0) {
      // Destination full: into the buffer store if it has room (it comes back out when the
      // chute has room again); otherwise it stays on its tray and goes round again
      // (recirculation), and after MAX_LAPS rounds it is put aside to manual sorting (overflow).
      if (this.buffer(p)) return;
      p.laps = (p.laps ?? 0) + 1;
      this.kpi.recirculated();
      if (p.laps >= MAX_LAPS) {
        p.noread = true;
        p.reason = 'overflow';
        this.retarget(p);
      } else p.divertAt += LOOP_LEN / BEAT_M;
      return;
    }
    // Now and then a tray tips a moment too early or late: the parcel lands in the next dock chute.
    if (p.dest >= 0 && p.dest < 20 && Math.random() < MISSORT) {
      const n = clamp(p.dest + (Math.random() < 0.5 ? -1 : 1), 0, 19);
      if (n !== p.dest && this.room(n, p.d + GAP) > 0) {
        p.dest = n;
        p.missorted = true;
      }
    }
    if (p.dest >= 0 && p.dest < 40) this.lastChute = p.dest;
    if (p.dest >= 0) this.inbound.set(p.dest, (this.inbound.get(p.dest) ?? 0) + 1);
    if (p.dest >= 0 && !this.stationOf.has(p.dest)) this.dockLoad.set(p.dest, (this.dockLoad.get(p.dest) ?? 0) + p.d + GAP);
    this.freeTrays(p, p.dest >= 0 ? this.chutes[p.dest]!.side : 1);
    if (p.dest >= 0) this.onPath(p, this.chutes[p.dest]!.path, 'chute', p.divertAt, p.divertAt + 1.5, 1);
    else this.onPath(p, this.intake, 'intake', p.divertAt, p.divertAt + Math.max(1, Math.round(this.intake.len / BEAT_M)), 0);
  }

  // ---------- lift and store ----------
  private liftTo(y: number): Step {
    return {
      gate: true,
      skip: () => Math.abs(this.liftAnim.b - y) < 0.01 && this.bt >= this.liftAnim.t1,
      run: () => {
        const a = animAt(this.liftAnim, this.bt);
        const d = 0.5 + Math.abs(y - a) * 0.08;
        this.liftAnim = { a, b: y, t0: this.bt, t1: this.bt + d };
        this.liftLastMove = this.bt + d;
        return d;
      },
    };
  }

  private shuttleTo(k: number, z: number): Step {
    return {
      run: () => {
        const sh = this.shuttles[k]!;
        const a = animAt(sh.anim, this.bt);
        const d = 0.25 + Math.abs(z - a) / 8;
        sh.anim = { a, b: z, t0: this.bt, t1: this.bt + d };
        return d;
      },
    };
  }

  private store(p: Parcel): void {
    const slot = p.slot!;
    const k = slot.level;
    const y = LEVELS[k]!;
    const sh = this.shuttles[k]!;
    this.lift.steps.push(
      this.liftTo(LOOP_Y),
      {
        run: () => {
          this.queue.splice(this.queue.indexOf(p), 1);
          this.tween(p, v(LIFT_X - 0.1, LOOP_Y, -0.9), 0.5, () => {
            p.mode = 'carriage';
            p.off.set(-0.1, 0, -0.9);
          });
          return () => p.mode === 'carriage';
        },
      },
      this.liftTo(y),
      {
        run: () => {
          sh.runner.steps.push(
            this.shuttleTo(k, 0),
            {
              run: () => {
                this.tween(p, v(SHUTTLE_X, y, 0), 0.4, () => {
                  p.mode = 'shuttle';
                  p.shuttle = k;
                });
                return 0.45;
              },
            },
            this.shuttleTo(k, slot.z),
            {
              run: () => {
                this.tween(p, v(SLOT_X, y, slot.z), 0.4, () => {
                  p.mode = 'fixed';
                  slot.parcel = p;
                  slot.reserved = false;
                  this.orient(p, this.t.set(1, 0, 0));
                });
                return 0.45;
              },
            },
            this.shuttleTo(k, 0),
          );
          return () => p.mode !== 'carriage';
        },
      },
    );
  }

  private retrieve(slot: Slot): void {
    const p = slot.parcel!;
    const k = slot.level;
    const y = LEVELS[k]!;
    const sh = this.shuttles[k]!;
    slot.reserved = true;
    this.retrieving++;
    this.lastRetrieve = this.bt;
    if (p.buffered !== undefined) {
      p.dest = p.buffered;
      p.buffered = undefined;
    } else {
      this.assign(p);
      if (p.labelCell) this.drawLabel(p.labelCell, p);
    }
    p.glow.copy(this.chutes[p.dest]!.col);
    p.pathKind = 'back';
    sh.runner.steps.push(
      this.shuttleTo(k, slot.z),
      {
        run: () => {
          this.tween(p, v(SHUTTLE_X, y, slot.z), 0.4, () => {
            p.mode = 'shuttle';
            p.shuttle = k;
            slot.parcel = null;
            slot.reserved = false;
          });
          return 0.45;
        },
      },
      this.shuttleTo(k, 0),
    );
    this.lift.steps.push(
      this.liftTo(y),
      { run: () => () => p.mode === 'shuttle' && this.bt >= sh.anim.t1 && sh.anim.b === 0 },
      {
        run: () => {
          this.tween(p, v(LIFT_X - 0.1, y, 0.9), 0.4, () => {
            p.mode = 'carriage';
            p.off.set(-0.1, 0, 0.9);
          });
          return () => p.mode === 'carriage';
        },
      },
      this.liftTo(LOOP_Y),
      {
        run: () => {
          this.back.at(0, this.p);
          this.tween(p, this.p.clone(), 0.4, () => this.sendBack(p));
          return 0.45;
        },
      },
    );
  }

  private sendBack(p: Parcel): void {
    this.retrieving = Math.max(0, this.retrieving - 1);
    const bt = this.ct;
    let arrive = Math.max(Math.ceil(bt + this.back.len / BEAT_M), this.backLast + 2);
    let tries = 0;
    const long = p.d > 0.9;
    const behind = (t: number) => (t - 1 + TRAYS) % TRAYS;
    while ((this.trayOwner[trayAt(STORE_BACK, arrive)] || (long && this.trayOwner[behind(trayAt(STORE_BACK, arrive))])) && tries++ < 10) arrive++;
    const tray = trayAt(STORE_BACK, arrive);
    this.trayOwner[tray] = p;
    p.tray = tray;
    if (long && !this.trayOwner[behind(tray)]) {
      p.tray2 = behind(tray);
      this.trayOwner[p.tray2] = p;
    }
    this.backLast = arrive;
    p.scanned = true;
    this.onPath(p, this.back, 'back', bt, arrive, 0);
  }

  private updateStore(): void {
    const bt = this.bt;
    const y = animAt(this.liftAnim, bt);
    this.carriage.position.y = y;
    const moving = bt < this.liftAnim.t1;
    this.liftLamp.color.setRGB(3, 1.4, 0.2).multiplyScalar(moving ? (Math.sin(this.time * 18) > 0 ? 1 : 0.15) : 0.12 + this.bassEnv * 0.6);
    this.shuttles.forEach((s) => (s.mesh.position.z = animAt(s.anim, bt)));
  }

  // ---------- per-frame drawing ----------
  private writeParcels(): void {
    const kick = 0.55 + this.kick * 0.8;
    const o = this.o;
    const counts = [0, 0, 0];
    let labels = 0;
    let tapes = 0;
    let ribbons = 0;
    let hull = 0;
    for (const p of this.parcels) {
      const set = this.shapes[p.shape]!;
      const k = counts[p.shape]!;
      if (k >= MAX_PARCELS) continue;
      counts[p.shape]!++;
      this.instParcels[p.shape]![k] = p;
      this.n.set(0, 1, 0).applyQuaternion(p.q);
      o.position.copy(p.pos).addScaledVector(this.n, p.h / 2);
      o.quaternion.copy(p.q);
      o.scale.set(p.w, p.h, p.d);
      o.updateMatrix();
      set.mesh.setMatrixAt(k, o.matrix);
      set.mesh.setColorAt(k, p.col);
      if (p === this.follow) {
        // The followed parcel gets a blue outline (a slightly larger box drawn inside out).
        o.scale.set(p.w + 0.12, p.h + 0.12, p.d + 0.12);
        o.updateMatrix();
        this.hull.setMatrixAt(0, o.matrix);
        this.hull.setColorAt(0, this.c.setHex(DAY.blue));
        hull = 1;
      }
      // At night every parcel glows in its destination colour (white until it is scanned),
      // pulsing on the kick; how brightly is the night setting. Lead parcels and the followed
      // one shine a little more.
      const night = 1 - this.day;
      const base = this.fx.glow * (0.18 + 0.32 * this.kick);
      const extra = (p.scanned ? (p.lead ? 0.38 : 0.16) * kick + (p === this.follow ? 0.25 : 0) : p.lead ? 0.25 : 0) * Math.min(1, this.fx.glow * 2);
      // (By day only the old faint hint on lead and scanned parcels, as before.)
      const dayHint = (p.scanned ? (p.lead ? 0.38 : 0.16) * kick + (p === this.follow ? 0.25 : 0) : p.lead ? 0.25 : 0) * 0.15;
      const g = (base + extra) * night + dayHint * this.day;
      this.c.copy(p.glow).multiplyScalar(g).lerp(this.white, p.flash * 0.8);
      const glow = set.glow.array as Float32Array;
      glow[k * 3] = this.c.r + p.flash * 0.6;
      glow[k * 3 + 1] = this.c.g + p.flash * 0.6;
      glow[k * 3 + 2] = this.c.b + p.flash * 0.6;
      // Shipping label on top (tubes have theirs wrapped round, not drawn).
      if (p.shape === 2) continue;
      // Boxes get a strip of tape along the top first.
      if (p.gift) {
        // A present: a ribbon both ways round the top.
        o.position.copy(p.pos).addScaledVector(this.n, p.h + 0.003);
        o.quaternion.copy(p.q).multiply(this.qLabel);
        o.scale.set(0.07, p.d * 1.004, 1);
        o.updateMatrix();
        this.ribbonMesh.setMatrixAt(ribbons++, o.matrix);
        o.scale.set(p.w * 1.004, 0.07, 1);
        o.position.addScaledVector(this.n, 0.001);
        o.updateMatrix();
        this.ribbonMesh.setMatrixAt(ribbons++, o.matrix);
      } else if (p.shape === 0 && p.h > 0.15) {
        o.position.copy(p.pos).addScaledVector(this.n, p.h + 0.002);
        o.quaternion.copy(p.q).multiply(this.qLabel);
        o.scale.set(0.09, p.d * 1.002, 1);
        o.updateMatrix();
        this.tapeMesh.setMatrixAt(tapes++, o.matrix);
      }
      o.position.copy(p.pos).addScaledVector(this.n, p.h + 0.005);
      // The label sits off-centre, beside the tape.
      this.t.set(1, 0, 0).applyQuaternion(p.q);
      if (p.shape === 0 && p.h > 0.15) o.position.addScaledVector(this.t, Math.min(p.w * 0.22, 0.2));
      o.quaternion.copy(p.q).multiply(this.qLabel);
      const lw = Math.min(p.w * 0.5, 0.3);
      o.scale.set(lw, lw * (LABEL_H / LABEL_W), 1);
      o.updateMatrix();
      this.labelCellAttr.setX(labels, p.labelCell ?? 0);
      this.labelMesh.setMatrixAt(labels++, o.matrix);
    }
    this.shapes.forEach((set, k) => {
      set.mesh.count = counts[k]!;
      set.mesh.instanceMatrix.needsUpdate = true;
      if (set.mesh.instanceColor) set.mesh.instanceColor.needsUpdate = true;
      set.glow.needsUpdate = true;
    });
    if (this.scanDirty) {
      this.scanLabels.flush();
      this.scanDirty = false;
    }
    this.labelMesh.count = labels;
    this.labelCellAttr.needsUpdate = true;
    this.tapeMesh.count = tapes;
    this.tapeMesh.instanceMatrix.needsUpdate = true;
    this.ribbonMesh.count = ribbons;
    this.ribbonMesh.instanceMatrix.needsUpdate = true;
    this.writeDockCodes();
    // New labels are uploaded a few times a second at most (the canvas is large).
    if (this.labelsDirty && this.time - this.labelsDirty > 0.8) {
      this.labelTex.needsUpdate = true;
      this.labelsDirty = 0;
    }
    this.hull.count = hull;
    this.hull.instanceMatrix.needsUpdate = true;
    if (this.hull.instanceColor) this.hull.instanceColor.needsUpdate = true;
    this.labelMesh.instanceMatrix.needsUpdate = true;
  }


  private updateTrays(dt: number): void {
    const o = this.o;
    const bt = this.ct;
    for (let c = 0; c < TRAYS; c++) {
      loopAt(c * PITCH + bt * BEAT_M, this.p, this.t);
      this.m4.lookAt(ZERO, this.t, UP);
      o.quaternion.setFromRotationMatrix(this.m4);
      const tilt = this.trayTilt[c]!;
      if (tilt) {
        o.quaternion.multiply(this.q.setFromAxisAngle(this.n.set(0, 0, 1), tilt * 0.38));
        this.trayTilt[c] = Math.abs(tilt) < 0.01 ? 0 : tilt * Math.exp(-dt * 3);
      }
      o.position.copy(this.p);
      o.position.y -= 0.07;
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      this.trays.setMatrixAt(c, o.matrix);
    }
    this.trays.instanceMatrix.needsUpdate = true;
  }

  private updateClub(dt: number, bar: number): void {
    const bt = this.bt;
    const ph = bt % 1;
    this.beltTex.offset.y = -((this.ct * BEAT_M) / 1.2) % 1;
    this.strips.forEach((m, k) => {
      const u = m.uniforms;
      (u.uCol!.value as THREE.Color).copy(this.cols[k % 3]!);
      u.uBeat!.value = bt;
      u.uKick!.value = this.kick + (k === 1 ? this.bassEnv * 0.6 : 0);
      u.uDay!.value = this.day;
    });
    const pad = this.time < this.padUntil ? 1 : 0;
    for (const lane of this.lanes) {
      lane.doorFlash = Math.max(0, lane.doorFlash - dt * 1.5);
      lane.door.color.copy(lane.doorCol).multiplyScalar(0.25 + lane.doorFlash * 3);
      this.tunnelGlow(lane.tunnel, dt);
    }
    for (const lt of this.loopTunnels) this.tunnelGlow(lt.t, dt);
    this.chutes.forEach((ch, k) => {
      ch.flash = Math.max(0, ch.flash - dt * 2);
      // A dock belt that is full: its lamp flashes red, and the sorter sends nothing more down
      // (parcels for it go round again, or into the buffer store).
      if (ch.belt && this.dockFree(k) < 0.9) ch.lamp.color.setRGB(Math.floor(this.bt * 2) % 2 ? 3 : 0.6, 0.05, 0.02);
      else ch.lamp.color.copy(ch.col).multiplyScalar(0.35 + ch.flash * 3 + this.kick * 0.3);
    });

    // Moving heads: a new figure every bar, moving with the beat.
    const pattern = Math.floor(bar) % 4;
    const swing = Math.sin(Math.PI * (bt % 2));
    this.heads.forEach((h, k) => {
      let rx = 0;
      let rz = 0;
      const side = k % 2 ? 1 : -1;
      if (pattern === 0) {
        rx = 0.55 * swing;
        rz = 0.25 * Math.sin(Math.PI * bt * 0.5);
      } else if (pattern === 1) {
        rx = 0.5 * swing * side;
        rz = 0.4 * Math.cos(Math.PI * bt * 0.5) * side;
      } else if (pattern === 2) {
        rx = 0.45 * Math.cos((Math.PI * bt) / 2 + k);
        rz = 0.45 * Math.sin((Math.PI * bt) / 2 + k);
      } else {
        // Converge on the mirror ball, wobbling on the beat.
        const dx = this.ball.position.x - h.pos.x;
        const dz = this.ball.position.z - h.pos.z;
        rz = Math.atan2(dx, 6) * 0.6 + 0.08 * swing;
        rx = -Math.atan2(dz, 6) * 0.6;
      }
      h.rx += (rx - h.rx) * Math.min(1, dt * 5);
      h.rz += (rz - h.rz) * Math.min(1, dt * 5);
      h.piv.rotation.set(h.rx, 0, h.rz);
      this.c.copy(pad ? this.padCol : this.cols[k % 3]!);
      h.u.uCol.value.copy(this.c);
      h.u.uO.value = 0.16 + this.kick * 0.22 + pad * 0.06;
      if (h.light) {
        h.light.color.copy(this.c);
        // (Dimmed rather than hidden when off: fewer lights would recompile every material.)
        h.light.intensity = this.fx.lasers && !this.dayShown ? 260 * (0.6 + this.kick * 0.8) : 0;
        h.piv.updateMatrixWorld();
        this.p.set(0, -16, 0).applyMatrix4(h.piv.matrixWorld);
        h.light.target.position.copy(this.p);
        h.light.target.updateMatrixWorld();
      }
    });

    if (this.dayShown) {
      this.hemi.intensity = 1.0 + this.snare * 0.08;
      return;
    }
    // Mirror ball and its spots on walls, floor and ceiling.
    const ba = this.time * 0.35;
    this.ball.rotation.y = ba;
    const ca = Math.cos(ba);
    const sa = Math.sin(ba);
    const B = this.ball.position;
    for (let k = 0; k < this.sparkDirs.length; k++) {
      const d = this.sparkDirs[k]!;
      const dx = d.x * ca - d.z * sa;
      const dz = d.x * sa + d.z * ca;
      const dy = d.y;
      let t = 1e9;
      if (dx) t = Math.min(t, ((dx > 0 ? EX - 0.1 : WX + 0.1) - B.x) / dx);
      if (dy) t = Math.min(t, ((dy > 0 ? HH - 0.05 : 0.03) - B.y) / dy);
      if (dz) t = Math.min(t, ((dz > 0 ? HZ - 0.1 : NZ + 0.1) - B.z) / dz);
      this.sparkPos[k * 3] = B.x + dx * t;
      this.sparkPos[k * 3 + 1] = B.y + dy * t;
      this.sparkPos[k * 3 + 2] = B.z + dz * t;
    }
    this.sparkGeo.attributes.position!.needsUpdate = true;
    this.sparkMat.opacity = 0.35 + 0.4 * pad + this.kick * 0.25;
    this.sparkMat.color.copy(this.white).lerp(this.cols[1]!, 0.3);

    // Haze drifts slowly and takes the pad colour.
    this.hazeSeed.forEach((h, k) => {
      this.hazePos[k * 3] = h[0]! + Math.sin(this.time * 0.05 + h[3]!) * 4;
      this.hazePos[k * 3 + 1] = h[1]! + Math.sin(this.time * 0.07 + h[3]! * 2) * 0.8;
      this.hazePos[k * 3 + 2] = h[2]! + Math.cos(this.time * 0.04 + h[3]!) * 4;
    });
    this.hazeGeo.attributes.position!.needsUpdate = true;
    this.hazeMat.color.setRGB(0.16, 0.13, 0.26).lerp(this.c.copy(this.padCol).multiplyScalar(0.3), pad * 0.6);


    this.strobe.color.setRGB(1, 1, 1).multiplyScalar(this.fx.strobe ? this.snare * this.snare * 4 + (1 - ph) ** 8 * 0.3 : 0);
    this.hemi.intensity = 0.45 + this.snare * 0.25;
  }

  private tunnelGlow(t: Tunnel, dt: number): void {
    t.flash = Math.max(0, t.flash - dt * 3);
    // The scan line sweeps once through the tunnel per read.
    t.line.visible = t.flash > 0.02;
    (t.line.userData.fan as THREE.Mesh).visible = t.line.visible;
    if (t.line.visible) {
      t.line.position.z = (0.5 - t.flash) * (t.depth - 0.4);
      const fan = t.line.userData.fan as THREE.Mesh;
      fan.position.z = t.line.position.z;
      (fan.material as THREE.MeshBasicMaterial).color.copy(t.lineMat.color).multiplyScalar(0.25 * t.flash);
      t.lineMat.color.setRGB(...((t.read ? [0.2, 1.6, 0.4] : [1.8, 0.15, 0.1]) as RGB));
      t.lineMat.opacity = 0.35 + 0.6 * t.flash;
    }
    t.ring.color.copy(t.col).multiplyScalar(0.25 + t.flash * 3).lerp(this.white, t.flash * 0.4);
    if (this.day > 0) t.ring.color.lerp(this.c.setHex(DAY.orangeL).lerp(this.white, t.flash * 0.8), this.day);
    t.curtain.opacity = (0.1 + t.flash * 0.45 + this.snare * 0.35) * (1 - this.day);
  }

  private updateForklifts(dt: number, prevBt: number): void {
    const bt = this.bt;
    const db = bt - prevBt;
    void dt;
    for (const f of this.forklifts) {
      // Surge on every beat: fast on the downbeat, nearly still between.
      const surge = 1 - Math.cos(2 * Math.PI * (bt % 1));
      f.s += f.speed * db * surge;
      f.route.at(f.s, this.p, this.t);
      f.g.position.copy(this.p);
      f.g.lookAt(this.p.x + this.t.x, 0, this.p.z + this.t.z);
      f.forks.position.y = 0.15 + this.snare * 0.9;
      f.beacon.color.setRGB(3, 1.3, 0.1).multiplyScalar(0.1 + (1 - (bt % 1)) ** 4);
    }
  }

  // ---------- camera ----------
  private pickFollow(): void {
    const fresh = this.parcels.filter((p) => p.mode === 'path' && p.pathKind === 'lane' && (p.path?.len ?? 0) * clamp((this.ct - p.t0) / (p.t1 - p.t0), 0, 1) < 20);
    const pool = fresh.length ? fresh : this.parcels.filter((p) => p.mode === 'loop');
    const leads = pool.filter((p) => p.lead);
    const stores = pool.filter((p) => p.dest < 0);
    const r = Math.random();
    this.follow = (r < 0.35 && stores.length ? pick(stores) : leads.length && r < 0.7 ? pick(leads) : pool.length ? pick(pool) : null) ?? null;
  }

  // ---------- walking ----------

  /** First person on foot: position on the floor, heading and up/down look. */
  /** On foot, or flying when `alt` (metres above eye height on the floor) is above zero. */
  private walk = { x: 0, z: 0, yaw: 0, pitch: 0, speed: 0, step: 0, alt: 0, goal: -1 };
  /** Movement input for this frame: forward/back and sideways (−1…1), and running. */
  private walkIn = { fwd: 0, side: 0, run: false, up: 0 };

  /** Start walking from where the camera is now, on the floor, looking the same way. */
  private startWalk(): void {
    this.camMode = 'walk';
    this.follow = null;
    this.tour = null;
    const d = this.t.subVectors(this.look, this.camera.position);
    this.walk.x = clamp(this.camera.position.x, WX + 1, EX - 1);
    this.walk.z = clamp(this.camera.position.z, NZ + 1, HZ - 1);
    this.walk.yaw = Math.atan2(d.x, d.z);
    this.walk.pitch = 0;
    this.walk.alt = 0;
    this.walk.goal = -1;
  }

  /** Walking input (from the keyboard, mouse or touch). Look deltas in radians. */
  walkInput(fwd: number, side: number, run: boolean, dYaw: number, dPitch: number, up = 0): void {
    this.walkIn.fwd = clamp(fwd, -1, 1);
    this.walkIn.side = clamp(side, -1, 1);
    this.walkIn.run = run;
    this.walkIn.up = clamp(up, -1, 1);
    // Climbing or descending by hand cancels a take-off or landing in progress.
    if (up) this.walk.goal = -1;
    this.walk.yaw -= dYaw;
    this.walk.pitch = clamp(this.walk.pitch - dPitch, -1.2, 1.2);
  }

  /** Height above walking eye level, in metres (0: on foot). */
  walkAlt(): number {
    return this.walk.alt;
  }

  /** Climb or descend to a height on its own (the Walk / Fly switch): 0 lands, 3 takes off. */
  walkTo(alt: number): void {
    this.walk.goal = clamp(alt, 0, WALK_MAX_ALT);
  }

  private updateWalk(dt: number): void {
    const w = this.walk;
    const i = this.walkIn;
    // Up and down: by hand (E/Q, the arrows on screen) or towards a goal; landing on the floor is walking.
    const climb = i.run ? 6 : 3;
    if (i.up) w.alt += i.up * climb * dt;
    else if (w.goal >= 0) {
      const d = w.goal - w.alt;
      w.alt += Math.sign(d) * Math.min(Math.abs(d), climb * dt);
      if (Math.abs(d) < 0.01) w.goal = -1;
    }
    w.alt = clamp(w.alt, 0, WALK_MAX_ALT);
    const flying = w.alt > 0.01;
    // Flying is quicker than walking (and has no footsteps).
    const want = (flying ? (i.run ? 9 : 4) : i.run ? 4.2 : 1.6) * Math.min(1, Math.hypot(i.fwd, i.side));
    w.speed += (want - w.speed) * Math.min(1, dt * 6);
    const len = Math.hypot(i.fwd, i.side) || 1;
    const fx = Math.sin(w.yaw);
    const fz = Math.cos(w.yaw);
    // Forward along the heading, sideways to the right of it.
    const mx = (fx * i.fwd - fz * i.side) / len;
    const mz = (fz * i.fwd + fx * i.side) / len;
    w.x = clamp(w.x + mx * w.speed * dt, WX + 0.6, EX - 0.6);
    w.z = clamp(w.z + mz * w.speed * dt, NZ + 0.6, HZ - 0.6);
    // Footsteps bob the view, two steps per beat when walking to the music.
    w.step += w.speed * dt * 1.6;
    const bob = flying ? Math.sin(this.time * 1.3) * 0.04 : Math.sin(w.step * Math.PI) * 0.035 * Math.min(1, w.speed);
    const eye = 1.7 + w.alt + bob;
    this.camera.position.set(w.x, eye, w.z);
    const cp = Math.cos(w.pitch);
    this.look.set(w.x + fx * cp, eye + Math.sin(w.pitch), w.z + fz * cp);
    this.want.copy(this.camera.position);
    this.wantLook.copy(this.look);
    this.camera.lookAt(this.look);
  }

  private updateCamera(dt: number, bar: number, travel: number): void {
    if (this.camMode === 'walk') {
      this.updateWalk(dt);
      return;
    }
    const shot = Math.floor(bar / 8);
    if (this.camMode === 'auto' && shot !== this.lastShotBar) {
      this.lastShotBar = shot;
      this.autoFollow = !this.autoFollow;
      if (this.autoFollow) this.pickFollow();
    }
    const following = this.camMode === 'follow' || (this.camMode === 'auto' && this.autoFollow);
    if (following && !this.follow) {
      if (this.camMode === 'follow' || bar - shot * 8 < 6) this.pickFollow();
      if (!this.follow && this.camMode === 'auto') this.autoFollow = false;
    }
    const p = following ? this.follow : null;
    if (p && p.mode === 'fixed' && p.pathKind !== 'back') this.follow = null;
    const th = this.camMode === 'follow' ? this.followThing : null;
    if (th) {
      // A robot, forklift or person: behind it and a little to the side, looking where it goes.
      this.tour = null;
      const c = th.obj.getWorldPosition(this.p);
      const vel = this.n.copy(c).sub(th.last).setY(0);
      th.last.copy(c);
      c.y += th.h * 0.6;
      if (dt > 0 && vel.lengthSq() > 1e-6) this.fwd.lerp(vel.normalize(), 1 - Math.exp(-dt * 2)).normalize();
      const side = this.t.set(-this.fwd.z, 0, this.fwd.x);
      const back = th.kind === 'person' ? 3.2 : th.kind === 'robot' ? 3.0 : 4.6;
      this.want.copy(c).addScaledVector(this.fwd, -back).addScaledVector(side, back * 0.45);
      this.want.y = clamp(c.y + back * 0.55, 1.2, HH - 0.8);
      this.wantLook.copy(c).addScaledVector(this.fwd, 1.5);
    } else if (p) {
      // Back in fly mode, the tour starts afresh from wherever the camera is.
      this.tour = null;
      const c = this.p.copy(p.pos);
      c.y += p.h / 2;
      if (p.mode === 'carriage' || p.mode === 'shuttle' || p.mode === 'fixed' || (p.mode === 'tween' && p.pos.x > LIFT_X - 5)) {
        this.want.set(LIFT_X - 5.5, clamp(c.y + 1.6, 2, 10), c.z - 5);
        this.wantLook.copy(c);
      } else {
        const h = this.n.set(p.vel.x, 0, p.vel.z);
        if (h.lengthSq() > 0.04) this.fwd.lerp(h.normalize(), 1 - Math.exp(-dt * 2)).normalize();
        const side = this.t.set(-this.fwd.z, 0, this.fwd.x);
        this.want.copy(c).addScaledVector(this.fwd, -4.6).addScaledVector(side, 2.2);
        this.want.y = clamp(c.y + 2.6, 1.2, HH - 0.8);
        this.wantLook.copy(c).addScaledVector(this.fwd, 2.2);
      }
    } else this.flyTour(dt, travel);
    // Stay inside the hall, and under the ceiling's ducts, cable trays and lamps.
    this.want.y = Math.min(this.want.y, FLY_MAX_Y);
    this.want.x = clamp(this.want.x, WX + 1.5, EX - 1.5);
    this.want.z = clamp(this.want.z, NZ + 1.5, HZ - 1.5);
    const k = this.first ? 1 : 1 - Math.exp(-dt * (p ? 2.6 : th ? 1.2 : this.camRate));
    this.camera.position.lerp(this.want, k);
    this.look.lerp(this.wantLook, this.first ? 1 : 1 - Math.exp(-dt * 3.2));
    this.first = false;
    this.camera.lookAt(this.look);
    // Looking around by hand (a swipe or drag): turn the view; ten seconds after the last
    // swipe it eases back to where the camera itself looks.
    if (this.time - this.lookAt > 10) {
      const e = Math.exp(-dt * 1.2);
      this.lookYaw *= e;
      this.lookPitch *= e;
    }
    if (Math.abs(this.lookYaw) > 1e-4 || Math.abs(this.lookPitch) > 1e-4) {
      this.camera.rotateOnWorldAxis(UP, this.lookYaw);
      this.camera.rotateX(this.lookPitch);
    }
  }

  private lookYaw = 0;
  private lookPitch = 0;
  private lookAt = -99;

  /** Turn the view by hand (radians); it returns to the camera's own view after 10 s. */
  lookAround(dYaw: number, dPitch: number): void {
    if (this.camMode === 'walk') return;
    this.lookYaw = clamp(this.lookYaw - dYaw, -Math.PI, Math.PI);
    this.lookPitch = clamp(this.lookPitch - dPitch, -0.9, 0.9);
    this.lookAt = this.time;
  }

  // ---------- building ----------
  private buildEnv(): void {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const es = new THREE.Scene();
    es.background = new THREE.Color(0x05050a);
    const add = (c: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 6), new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(x, y, z);
      es.add(m);
    };
    add(0x6a4cff, -10, 6, 0);
    add(0xff3fa0, 10, 6, 0);
    add(0x30d5ff, 0, 8, 10);
    add(0x9999aa, 0, 10, -10);
    this.nightEnv = pm.fromScene(es, 0.04).texture;
    this.scene.environment = this.nightEnv;
    pm.dispose();
    this.hemi = new THREE.HemisphereLight(0x6a6aa0, 0x1a1410, 0.45);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xb0b8ff, 0.3);
    key.position.set(-10, 20, 8);
    this.scene.add(key);
    this.keyLight = key;
  }

  private boxes = new Map<string, { mat: THREE.Material; list: number[][]; only: 'day' | 'night' | undefined }>();
  box(key: string, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, col?: number, ry = 0): void {
    let e = this.boxes.get(key);
    if (!e) this.boxes.set(key, (e = { mat, list: [], only: this.only }));
    e.list.push([x, y, z, sx, sy, sz, col ?? -1, ry]);
  }
  private flushBoxes(): void {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const o = this.o;
    for (const { mat, list, only } of this.boxes.values()) {
      const im = new THREE.InstancedMesh(g, mat, list.length);
      list.forEach((e, k) => {
        o.position.set(e[0]!, e[1]!, e[2]!);
        o.rotation.set(0, e[7]!, 0);
        o.scale.set(e[3]!, e[4]!, e[5]!);
        o.updateMatrix();
        im.setMatrixAt(k, o.matrix);
        if (e[6]! >= 0) im.setColorAt(k, this.c.setHex(e[6]!));
      });
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.put(im, only);
    }
    this.boxes.clear();
    this.flushBlobs();
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    this.put(m);
    return m;
  }

  /** Adds to the scene; objects of one look are shown only in that look. */
  put(obj: THREE.Object3D, only = this.only): void {
    this.scene.add(obj);
    if (only === 'day') this.dayOnly.push(obj);
    else if (only === 'night') this.nightOnly.push(obj);
  }

  /**
   * Outlines come from the InkPass (a screen effect) for everything; these two
   * remain as hooks, e.g. to mark parts that should get no outline later.
   */
  inkify(m: THREE.Mesh, angle = 25): void {
    void m;
    void angle;
  }

  outline(m: THREE.Mesh, width = 0.02): void {
    void m;
    void width;
  }

  // ---------- contact shadows ----------

  private blobs: [number, number, number, number, number][] = [];
  private blobMat: THREE.MeshBasicMaterial | null = null;
  private blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  private blobMaterial(): THREE.MeshBasicMaterial {
    if (!this.blobMat) {
      this.blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTexture(), transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    }
    return this.blobMat;
  }

  /** A soft contact shadow on the floor (static). */
  blob(x: number, z: number, w: number, d: number, ry = 0): void {
    this.blobs.push([x, z, w, d, ry]);
  }

  /** A soft contact shadow that moves with an object (a child at floor level). */
  blobUnder(obj: THREE.Object3D, w: number, d: number): void {
    const p = this.batcher.add(this.blobGeo, this.blobMaterial(), obj, undefined, true);
    p.scale.set(w, 1, d);
    p.position.y = 0.03;
  }

  /** An instanced part of a repeated model (see Batcher). */
  batch(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, color?: THREE.ColorRepresentation): THREE.Object3D {
    return this.batcher.add(geo, mat, parent, color);
  }

  private flushBlobs(): void {
    if (!this.blobs.length) return;
    const im = new THREE.InstancedMesh(this.blobGeo, this.blobMaterial(), this.blobs.length);
    this.blobs.forEach(([x, z, w, d, ry], k) => {
      this.o.position.set(x, 0.028, z);
      this.o.rotation.set(0, ry, 0);
      this.o.scale.set(w, 1, d);
      this.o.updateMatrix();
      im.setMatrixAt(k, this.o.matrix);
    });
    im.renderOrder = -1;
    im.userData.noInk = true;
    this.put(im);
    this.blobs = [];
  }

  /** A material that takes another colour (and a matte finish) by day. */
  private theme<M extends THREE.MeshStandardMaterial>(m: M, day: number, rough = 0.85, metal = 0.05): M {
    this.themed.push({ m, n: m.color.clone(), d: new THREE.Color(day), nr: m.roughness, dr: rough, nm: m.metalness, dm: metal });
    toonify(m);
    // Safety yellow is the paint that takes the knocks (realistic day only).
    if (day === 0xf2c200) wear(m);
    return m;
  }

  std(color: number, rough = 0.7, metal = 0.2, day?: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    if (day === undefined) {
      toonify(m);
      // One colour in every look; the realistic day may still re-colour it (REAL_PALETTE).
      const pal = REAL_PALETTE.get(color);
      if (pal) this.plain.push({ m, c: new THREE.Color(color), r: rough, mt: metal, pal: new THREE.Color(pal.c), pr: pal.rough ?? rough, pm: pal.metal ?? metal });
      return m;
    }
    return this.theme(m, day);
  }

  /** Blends between the club (0) and the day look (1). */
  /** Night fog: thinner without the haze. */
  private nightFog(): number {
    return this.fx.haze ? 0.017 : 0.008;
  }

  /** What the night shows now. */
  nightFx(): NightFx {
    return { ...this.fx };
  }

  /** True while the night look is on screen (the night controls only make sense then). */
  isNight(): boolean {
    return this.dayShown === false;
  }

  setNightFx(fx: NightFx): void {
    this.fx = { ...fx };
    this.applyNightFx();
  }

  /** Show or hide the night's switchable objects (by day they stay hidden anyway). */
  private applyNightFx(): void {
    const night = this.dayShown === false;
    const fx = this.fx;
    for (const [o, key] of this.fxObjs) o.visible = night && fx[key];
    // (Called from applyTheme, which also runs before the party is built.)
    if (this.crowd) this.crowd.group.visible = night && fx.crowd;
    if (this.party) this.party.setShow({ dj: fx.dj, lasers: fx.lasers, ball: fx.ball, confetti: fx.confetti });
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = this.nightFog() + (0.009 - this.nightFog()) * this.day;
  }

  /** Minimal (flat, drawn) or realistic day; the night is the same for both. */
  setRealistic(real: boolean): void {
    if (real === this.real) return;
    this.real = real;
    if (real && !this.dayEnv) {
      this.dayEnv = dayEnvironment(this.renderer);
      this.buildRealHall();
    }
    this.dayShown = null; // re-apply the look
    this.applyTheme(this.day);
  }

  /** Single-colour materials in the illustration palette, re-coloured in the realistic day. */
  private plain: { m: THREE.MeshStandardMaterial; c: THREE.Color; r: number; mt: number; pal: THREE.Color; pr: number; pm: number }[] = [];
  private realC = new THREE.Color();
  /** A day colour toned down for the lit look: light colours are capped at a light grey. */
  private realCol(c: THREE.Color): THREE.Color {
    const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return this.realC.copy(c).multiplyScalar(l > 0.55 ? 0.55 / l : 1);
  }

  realNormal(m: THREE.MeshStandardMaterial, map: THREE.Texture, scale = 1): void {
    if (m.map) {
      // Same tiling as the colour map, so the relief lines up with the print.
      map = map.clone();
      map.repeat.copy(m.map.repeat);
      map.offset.copy(m.map.offset);
      map.rotation = m.map.rotation;
      map.needsUpdate = true;
    }
    m.normalMap = map;
    m.normalScale.setScalar(0);
    this.realNormals.push({ m, s: scale });
  }

  /** In the realistic day, paint `m` this colour (and finish) instead of its palette colour. */
  realColor(m: THREE.MeshStandardMaterial, color: number, rough?: number, metal?: number): void {
    const t = this.themed.find((x) => x.m === m);
    if (t) {
      t.rc = new THREE.Color(color);
      if (rough !== undefined) t.rr = rough;
      if (metal !== undefined) t.rm = metal;
      return;
    }
    const p = this.plain.find((x) => x.m === m);
    if (p) {
      p.pal.setHex(color);
      if (rough !== undefined) p.pr = rough;
      if (metal !== undefined) p.pm = metal;
      return;
    }
    this.plain.push({ m, c: m.color.clone(), r: m.roughness, mt: m.metalness, pal: new THREE.Color(color), pr: rough ?? m.roughness, pm: metal ?? m.metalness });
  }

  /** In the realistic day, show `map` (with colour and roughness) on `m` instead of its own look. */
  realMap(m: THREE.MeshStandardMaterial, map: THREE.Texture, color = 0xffffff, roughness = m.roughness): void {
    this.realMaps.push({ m, own: m.map, real: map, col: m.color.clone(), realCol: new THREE.Color(color), rough: m.roughness, realRough: roughness });
  }

  /** Compile the shaders of what is on show now, without blocking where the browser allows it. */
  async warmUp(tod = 0): Promise<void> {
    try {
      // Put the look in place first (lights, shadows, materials), so the shaders compiled now
      // are the ones the first frame needs, not compiled once more on it.
      this.applyTheme(1 - smooth01(tod * 1.6 - 0.3));
      this.batcher.update();
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* the first frame compiles them instead */
    }
  }

  isRealistic(): boolean {
    return this.real;
  }

  private applyTheme(day: number): void {
    if (Math.abs(day - this.day) < 0.002 && this.dayShown !== null) return;
    this.day = day;
    // The drawn look (toon steps, ink, flat colours) fades in only for Minimal.
    const flat = this.real ? 0 : day;
    TOON.value = flat;
    this.ink.enabled = flat > 0.02;
    this.ink.strength = smooth01(flat * 1.2);
    if (this.blobMat) this.blobMat.opacity = this.real ? 0.45 - 0.1 * day : 0.45 - 0.17 * day;
    for (const t of this.themed) {
      // Realistic day: what the part really is (REAL_PALETTE), else the day colour without pure
      // whites (a lit white reads as paper, not steel).
      const pal = this.real ? REAL_PALETTE.get(t.d.getHex()) : undefined;
      const d = this.real ? (t.rc ?? (pal ? this.realC.setHex(pal.c) : this.realCol(t.d))) : t.d;
      t.m.color.lerpColors(t.n, d, day);
      // Realistic day: as paint on steel (between the matte drawing and the club's metal).
      const dr = this.real ? t.rr ?? pal?.rough ?? Math.max(0.3, (t.nr + t.dr) / 2) : t.dr;
      const dm = this.real ? t.rm ?? pal?.metal ?? t.nm * 0.5 : t.dm;
      t.m.roughness = t.nr + (dr - t.nr) * day;
      t.m.metalness = t.nm + (dm - t.nm) * day;
    }
    const bg = this.scene.background as THREE.Color;
    bg.setHex(0x0b0910).lerp(this.c.setHex(this.real ? 0xc8ccd1 : DAY.bg), day);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(bg);
    fog.density = this.nightFog() + (0.009 - this.nightFog()) * day;
    this.renderer.toneMappingExposure = this.real ? 1.15 - 0.4 * day : 1.15 - 0.2 * day;
    if (this.real) {
      // Daylight from the roof: a warm sun through the roof lights, cool sky light from above.
      this.hemi.color.setHex(0x6a6aa0).lerp(this.c.setHex(0xdfe8ff), day);
      this.hemi.groundColor.setHex(0x1a1410).lerp(this.c.setHex(0x8a8580), day);
      this.hemi.intensity = 0.45 + 0.05 * day;
      this.keyLight.color.setHex(0xb0b8ff).lerp(this.c.setHex(0xfff1dc), day);
      this.keyLight.intensity = 0.3 + 1.5 * day;
    } else {
      this.hemi.color.setHex(0x6a6aa0).lerp(this.c.setHex(0xffffff), day);
      this.hemi.groundColor.setHex(0x1a1410).lerp(this.c.setHex(0xc9cfd6), day);
      this.hemi.intensity = 0.45 + 0.55 * day;
      this.keyLight.color.setHex(0xb0b8ff).lerp(this.white, day);
      this.keyLight.intensity = 0.3 + 0.7 * day;
    }
    this.cageLine.color.setHex(0x8a8f96).lerp(this.c.setHex(DAY.tealD), day);
    for (const n of this.realNormals) n.m.normalScale.setScalar(this.real ? n.s * day : 0);
    REAL.value = this.real ? day : 0;
    // The belts' side strips: the frame's teal in the drawn day, plain dark rubber edging in the realistic one.
    for (const st of this.strips) {
      const u = st.uniforms.uDayCol;
      if (u) (u.value as THREE.Color).setHex(this.real ? 0x3a3e44 : DAY.tealD);
    }
    const rd = this.real ? day : 0;
    for (const p of this.plain) {
      p.m.color.lerpColors(p.c, p.pal, rd);
      p.m.roughness = p.r + (p.pr - p.r) * rd;
      p.m.metalness = p.mt + (p.pm - p.mt) * rd;
    }
    this.grade.enabled = this.real && day > 0.02;
    this.smaa.enabled = this.real && day > 0.5;
    (this.grade.uniforms.uAmount as THREE.IUniform<number>).value = day;
    const show = day > 0.5;
    if (show === this.dayShown) return;
    this.dayShown = show;
    for (const o of this.dayOnly) o.visible = show;
    for (const o of this.nightOnly) o.visible = !show;
    for (const o of this.flatOnly) o.visible = show && !this.real;
    for (const o of this.realOnly) o.visible = show && this.real;
    this.applyNightFx();
    for (const r of this.realMaps) {
      const on = show && this.real;
      const map = on ? r.real : r.own;
      if (r.m.map !== map) {
        // (Going from no map to a map changes the shader: compile again.)
        if (!r.m.map !== !map) r.m.needsUpdate = true;
        r.m.map = map;
      }
      r.m.color.copy(on ? r.realCol : r.col);
      r.m.roughness = on ? r.realRough : r.rough;
    }
    this.updateShadows();
    this.scene.environment = show ? (this.real ? this.dayEnv : null) : this.nightEnv;
    // Night, high quality: a glossy floor that reflects the lasers, LED strips and lamps.
    const hq = this.quality === 'high' || this.quality === 'ultra';
    if (!show && hq && !this.mirror) this.mirror = this.buildMirror();
    if (this.mirror) this.mirror.visible = !show && hq;
    // Flat, bright colours for the drawn day; filmic tone mapping for the photo-like day and the club.
    this.renderer.toneMapping = show && !this.real ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    drawBelt(this.beltTex, show, this.real);
  }

  private buildHall(): void {
    const concrete = canvasTex(256, 256, (g) => {
      noise(g, 256, 256, 120, 40);
      for (let k = 0; k < 50; k++) {
        const c = Math.random() < 0.5 ? 60 : 180;
        g.fillStyle = `rgba(${c},${c},${c},0.07)`;
        g.beginPath();
        g.arc(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 40, 0, 7);
        g.fill();
      }
      g.strokeStyle = 'rgba(25,25,25,0.7)';
      g.lineWidth = 2;
      g.strokeRect(0, 0, 256, 256);
    });
    concrete.repeat.set(Math.round(HW / 6.2), 11);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(HW, HD),
      new THREE.MeshStandardMaterial({ color: 0x7c7c82, map: concrete, roughnessMap: concrete, roughness: 0.55, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(HCX, 0, HZC);
    this.put(floor, 'night');
    // Walkway lines.
    const yel = new THREE.MeshBasicMaterial({ color: 0x8a7420 });
    for (const z of [-15, 12]) this.box('line', yel, HCX, 0.012, z, HW - 12, 0.01, 0.15);
    for (const x of [WX + 6, EX - 6]) this.box('line', yel, x, 0.012, 0, 0.15, 0.01, 60);

    const ribs = canvasTex(128, 128, (g) => {
      g.fillStyle = '#26282e';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#1b1c21';
      for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 128, 5);
    });
    const wallMat = (rx: number, ry: number) => {
      const t = ribs.clone();
      t.repeat.set(rx, ry);
      t.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0.3, side: THREE.DoubleSide });
    };
    const wx = wallMat(Math.round(HW / 4), 4);
    const wz = wallMat(16, 4);
    void wx;
    const ribsM = ribs.clone();
    ribsM.repeat.set(1 / 4, 4 / HH);
    ribsM.offset.set(0, 0.5 * (4 / HH));
    ribsM.needsUpdate = true;
    const longNight = new THREE.MeshStandardMaterial({ map: ribsM, roughness: 0.85, metalness: 0.3, side: THREE.DoubleSide });
    for (const z of [NZ, HZ]) {
      const w = new THREE.Mesh(wallWithDoors(z < 0 ? NORTH_DOORS : SOUTH_DOORS), longNight);
      w.position.set(HCX, HH / 2, z);
      this.put(w, 'night');
    }
    // (The trailers behind the openings are the Trucks'.)
    for (const x of [WX, EX]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(HD, HH), wz);
      w.position.set(x, HH / 2, HZC);
      w.rotation.y = Math.PI / 2;
      this.put(w, 'night');
    }
    const ceilT = ribs.clone();
    // Shape UVs are in metres: one rib tile per 3 m, ribs across the hall.
    ceilT.repeat.set(1 / 3, 1 / 3);
    ceilT.rotation = Math.PI / 2;
    ceilT.needsUpdate = true;
    const ceil = new THREE.Mesh(ceilingWithLights(HCX, HZC, HW, HD, ROOF_LIGHTS), new THREE.MeshStandardMaterial({ map: ceilT, color: 0x77777a, roughness: 0.9, metalness: 0.2 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(HCX, HH, HZC);
    this.put(ceil, 'night');

    const steel = this.std(0x4c515a, 0.5, 0.7, DAY.steel);
    for (let x = WX + 2; x <= EX - 2; x += 10) this.box('steel', steel, x, HH - 0.5, HZC, 0.35, 0.8, HD);
    for (let z = NZ + 2; z <= HZ - 2; z += 8) this.box('steel', steel, HCX, HH - 0.12, z, HW, 0.18, 0.18);
    // Columns: red at the foot, as in the photos.
    const col = this.std(0x3a3d45, 0.6, 0.6, 0xf3f4f6);
    const colRed = this.std(0x7a1a20, 0.6, 0.3, 0xe2231a);
    wear(colRed, 0.7);
    // (In the walls, between the dock doors.)
    for (const x of COLUMNS) {
      // North: halfway between truck docks (x −13.6 + 6k); south: between the box doors (x −16 + 6k).
      for (const [z, dx] of [[NZ + 0.4, 2.4], [HZ - 0.4, 0]] as const) {
        const cx = x + dx;
        this.box('colred', colRed, cx, 0.9, z, 0.76, 1.8, 0.76);
        this.box('col', col, cx, 1.8 + (HH - 1.8) / 2, z, 0.7, HH - 1.8, 0.7);
      }
    }
    // Ducts and sprinkler mains.
    const duct = this.std(0x9aa0a8, 0.35, 0.9, 0xd5d9de);
    for (const z of [-27, 27]) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, HW, 20), duct);
      d.rotation.z = Math.PI / 2;
      d.position.set(HCX, HH - 1.4, z);
      this.put(d);
      this.inkify(d, 40);
    }
    const spr = this.std(0xa01818, 0.5, 0.4, DAY.red);
    // (Clear of the roof lights at z ±20.)
    for (const z of [-17, 0, 17]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, HW, 6), spr);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(HCX, HH - 0.25, z);
      this.put(pipe);
    }
    // High-bay lamps, mostly off; a few glow warm.
    const lampOn = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.0, 0.7) });
    const lampOff = new THREE.MeshBasicMaterial({ color: 0x1e1e22 });
    const lampG = new THREE.CylinderGeometry(0.45, 0.6, 0.3, 16);
    for (let x = WX + 7; x <= EX - 7; x += 15) {
      for (const z of [-24, -8, 8, 24]) {
        const m = new THREE.Mesh(lampG, Math.random() < 0.25 ? lampOn : lampOff);
        m.position.set(x, HH - 0.6, z);
        this.put(m, 'night');
      }
    }
    // Strobe panels on the ceiling.
    this.strobe = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.only = 'night';
    for (let x = WX + 22; x <= EX - 20; x += 20) this.box('strobe', this.strobe, x, HH - 0.3, 0, 2.4, 0.08, 0.5);
    this.only = undefined;

    // Maintenance platform inside the loop at its west end, with railings and a stair
    // down to the east (at night the DJ plays up here).
    {
      const grate = this.std(0x3a3e45, 0.6, 0.7, 0xc9ced4);
      const rail = this.std(0xd9a400, 0.5, 0.4, 0xf2c200);
      const PX = PLATFORM_X;
      const PY = PLATFORM_Y;
      const PW = 7;
      const PD = 8;
      this.box('grate', grate, PX, PY - 0.06, 0, PW, 0.12, PD);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) this.box('steel', steel, PX + x * (PW / 2 - 0.2), (PY - 0.12) / 2, z * (PD / 2 - 0.2), 0.16, PY - 0.12, 0.16);
      // Railings round three sides; the stair side is open in the middle.
      for (const z of [-PD / 2, PD / 2]) {
        this.box('rail', rail, PX, PY + 1.05, z, PW, 0.05, 0.05);
        this.box('rail', rail, PX, PY + 0.55, z, PW, 0.05, 0.05);
        for (let x = PX - PW / 2; x <= PX + PW / 2 + 0.01; x += 1.4) this.box('rail', rail, x, PY + 0.53, z, 0.05, 1.05, 0.05);
      }
      for (const z of [-PD / 2, -1, 1, PD / 2]) this.box('rail', rail, PX - PW / 2, PY + 0.53, z, 0.05, 1.05, 0.05);
      this.box('rail', rail, PX - PW / 2, PY + 1.05, 0, 0.05, 0.05, PD);
      for (const sz of [-1, 1]) {
        this.box('rail', rail, PX + PW / 2, PY + 1.05, sz * (PD / 4 + 0.5), 0.05, 0.05, PD / 2 - 1);
        this.box('rail', rail, PX + PW / 2, PY + 0.53, sz * (PD / 2), 0.05, 1.05, 0.05);
      }
      // The stair: down to the east, between the rail ends.
      const steps = 12;
      for (let k = 0; k < steps; k++) this.box('grate', grate, PX + PW / 2 + 0.15 + k * 0.26, PY - (k + 1) * (PY / steps), 0, 0.28, 0.06, 1.8);
    }
    // Control room with lit windows.
    this.buildControlRoom(-48, 26);
    // Pallets with wrapped goods along the walls.
    const pal = this.std(0x8a6a44, 0.9, 0);
    const wrap = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.35, metalness: 0 });
    // Realistic day: cartons showing through glossy stretch film, with its folds.
    this.realMap(wrap, stretchFilm(), 0xffffff, 0.22);
    this.realNormal(wrap, stretchFilmNormal(), 0.7);
    const stack = (x: number, z: number) => {
      const h = rnd(0.8, 2);
      this.box('pal', pal, x, 0.07, z, 1.2, 0.14, 1);
      this.blob(x, z, 1.8, 1.6);
      this.box('wrap', wrap, x, 0.14 + h / 2, z, 1.15, h, 0.95);
    };
    // (North wall east of x 12: truck docks; south wall east of x −8: box forklift aisle.)
    // (Not where the infeed lanes come in through the north wall, x −52 … −35.)
    for (let x = -60; x < -18; x += 1.6) if ((x < -53 || x > -34) && Math.random() < 0.65) stack(x, NZ + 1.4);
    for (let k = 0; k < 14; k++) stack(rnd(-33, -21), rnd(-28, -14));
    // (South wall west of the box doors: the break area.)
  }



  private mapLoop: [number, number][] | null = null;

  /** Everything the video wall shows, gathered from the hall. */
  private mapData(): HubMap {
    if (!this.mapLoop) {
      this.mapLoop = [];
      for (let s = 0; s < LOOP_LEN; s += 3) {
        loopAt(s, this.p, this.t);
        this.mapLoop.push([this.p.x, this.p.z]);
      }
    }
    const chutes = this.chutes.map((ch, k) => {
      const end = ch.path.pts[ch.path.pts.length - 1]!;
      const st = this.stationOf.get(k);
      const fill = st !== undefined ? 1 - this.room(k) / 4 : ch.belt ? 1 - this.dockFree(k) / ch.belt.len : 0;
      return { x: end.x, z: end.z, fill: clamp(fill, 0, 1), dock: st === undefined };
    });
    const fills = this.trucks.list();
    const doors = this.trucks.docks.map((d, i) => ({ x: d.x, z: d.wallZ, state: d.state, load: Math.min(1, fills[i]!.fill) }));
    const robots = this.floor.robots.map((r, k) => ({ x: r.g.position.x, z: r.g.position.z, busy: this.floor.fleet.bots[k]!.state !== 'idle' }));
    const boxes = this.floor.bins.map((b) => ({ x: b.x, z: b.z, fill: Math.min(1, Math.max(b.vol / BOX_M3, b.n / BOX_FULL)), away: b.g.position.distanceToSquared(this.t.set(b.x, 0, b.z)) > 0.5 }));
    const parcels: [number, number][] = [];
    let recirculating = 0;
    for (const p of this.parcels) {
      if (p.mode === 'loop') parcels.push([p.pos.x, p.pos.z]);
      if ((p.laps ?? 0) > 0 && p.mode === 'loop') recirculating++;
    }
    // (The plan shows the sorter, the docks and the robot floor: the infeed and store ends are cropped.)
    return { hall: [LX - 12, LX + STRAIGHT + 12, NZ - 1, HZ + 1], loop: this.mapLoop, chutes, doors, robots, boxes, parcels, recirculating, queue: this.backlog + this.waiting.reduce((a, b) => a + b, 0), clock: hhmmOf(this.hubTime()), onTime: this.kpi.totals().onTimePct, dwell: this.kpi.totals().dwell };
  }

  /** Big KPI boards and clocks on the walls, showing live numbers and the real time. */
  private buildBoards(): void {
    const board = new THREE.MeshBasicMaterial({ map: this.screens.board });
    const frame = this.std(0x1d1d1f, 0.5, 0.3, 0x1d1d1f);
    const place = (x: number, y: number, z: number, ry: number) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = ry;
      this.put(g);
      g.add(new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.5, 0.12), frame));
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.25), board);
      sc.position.z = 0.07;
      g.add(sc);
    };
    place(-40, 7.2, NZ + 0.12, 0);
    place(-45, 7.2, HZ - 0.12, Math.PI);
    place(EX - 6, 7.2, NZ + 0.12, 0);
    const clock = new THREE.MeshBasicMaterial({ map: this.screens.clock, transparent: true });
    const clk = (x: number, y: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), clock);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.put(m);
    };
    clk(WX + 0.1, 8.4, 4, Math.PI / 2);
    clk(-30, 8.4, NZ + 0.1, 0);
    clk(-30, 8.4, HZ - 0.1, Math.PI);
  }

  /** Control room: a cabin with a window band, door, roof plant and a stair to the roof. Front faces −z. */
  private buildControlRoom(cx: number, cz: number): void {
    const W = 10;
    const D = 5;
    const H = 3.4;
    const front = cz - D / 2;
    const wall = this.std(0x30343b, 0.6, 0.4, 0xf3f4f6);
    const trim = this.std(0x22252b, 0.5, 0.5, DAY.purple);
    const dark = this.std(0x1b1c20, 0.6, 0.4, 0x3a3d44);
    this.outline(this.mesh(new RoundedBoxGeometry(W, H, D, 3, 0.12), wall, cx, H / 2, cz), 0.03);
    this.blob(cx, cz, W + 2, D + 2);
    // Plinth and roof edge in the monitoring purple.
    this.box('roomtrim', trim, cx, 0.12, front - 0.01, W, 0.24, 0.04);
    this.box('roomtrim', trim, cx, H + 0.06, cz, W + 0.2, 0.12, D + 0.2);
    // Window band with mullions and a sill, lit from inside.
    const win = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.55, 1.1) }));
    win.position.set(cx - 1, 2.2, front - 0.02);
    win.rotation.y = Math.PI;
    this.put(win);
    for (let k = 0; k <= 6; k++) this.box('mullion', dark, cx - 4.6 + k * 1.2, 2.2, front - 0.05, 0.06, 1.36, 0.06);
    this.box('mullion', dark, cx - 1, 2.88, front - 0.05, 7.26, 0.06, 0.06);
    this.box('sill', this.std(0x8a9099, 0.4, 0.7, 0xdfe3e8), cx - 1, 1.5, front - 0.12, 7.4, 0.06, 0.24);
    // Door with a handle, a light above it and a small plate.
    this.box('door', dark, cx + 3.9, 1.05, front - 0.03, 1.0, 2.1, 0.06);
    this.box('handle', this.std(0x8a9099, 0.3, 0.9, 0xc3c8ce), cx + 3.55, 1.05, front - 0.09, 0.04, 0.3, 0.04);
    this.box('doorlamp', new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.3, 1.0) }), cx + 3.9, 2.3, front - 0.08, 0.5, 0.08, 0.12);
    // Roof plant: two cooling units with fans, a cable duct and a railing.
    const unit = this.std(0x6b7280, 0.5, 0.6, 0xdfe3e8);
    for (const ux of [cx - 2.5, cx + 1]) {
      this.box('acunit', unit, ux, H + 0.55, cz + 0.6, 1.8, 0.8, 1.2);
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 20), dark);
      fan.position.set(ux, H + 0.97, cz + 0.6);
      this.put(fan);
    }
    this.box('duct', unit, cx - 0.75, H + 0.25, cz - 0.6, 5, 0.3, 0.3);
    const rail = this.std(0xd9a400, 0.5, 0.4, 0xf2c200);
    for (const zz of [cz - D / 2 + 0.1, cz + D / 2 - 0.1]) this.box('roomrail', rail, cx, H + 1.1, zz, W - 0.2, 0.05, 0.05);
    for (let x = cx - W / 2 + 0.1; x <= cx + W / 2; x += 1.6) for (const zz of [cz - D / 2 + 0.1, cz + D / 2 - 0.1]) this.box('roomrail', rail, x, H + 0.6, zz, 0.05, 1.0, 0.05);
  }

  private buildConveyors(): void {
    this.beltTex = canvasTex(32, 64, (g) => {
      g.fillStyle = '#1f2125';
      g.fillRect(0, 0, 32, 64);
      g.fillStyle = '#34373d';
      for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 32, 3);
    });
    this.beltTex.repeat.set(1, 1 / 1.2);
    const beltMat = this.theme(new THREE.MeshStandardMaterial({ map: this.beltTex, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide }), 0xffffff);
    // Realistic day: the grey rubber of the texture as it is, with specks and stains.
    this.themed[this.themed.length - 1]!.rc = new THREE.Color(0xffffff);
    beltWear(beltMat);
    const frameMat = this.theme(new THREE.MeshStandardMaterial({ color: 0x2b5ea8, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }), DAY.teal);
    const chuteTex = brushed().clone();
    chuteTex.repeat.set(1, 1 / 3);
    chuteTex.needsUpdate = true;
    const chuteMat = this.theme(new THREE.MeshStandardMaterial({ color: 0xa8b0ba, map: chuteTex, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide }), DAY.tealP);
    const trackMat = this.theme(new THREE.MeshStandardMaterial({ color: 0x3c4048, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide }), DAY.teal);
    const legMat = this.std(0x6b7280, 0.5, 0.7, DAY.teal);
    // Realistic day: the supports in a dark RAL blue, as on many real sorters.
    this.realColor(legMat, RAL_BLUE, 0.45, 0.3);
    const strip = () => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uCol: { value: new THREE.Color() }, uBeat: { value: 0 }, uKick: { value: 0 }, uGain: { value: 1 }, uDay: { value: 0 }, uDayCol: { value: new THREE.Color(DAY.tealD) } },
        vertexShader: STRIP_VERT,
        fragmentShader: STRIP_FRAG,
        side: THREE.DoubleSide,
      });
      this.strips.push(m);
      return m;
    };
    const stripIn = strip();
    const stripLoop = strip();
    const stripChute = strip();
    const geo: Record<string, THREE.BufferGeometry[]> = { belt: [], frame: [], chute: [], track: [], sIn: [], sLoop: [], sChute: [], rail: [] };
    // Guide rails above the belt edges (closed little profiles), on posts; the loop gets a cable tray on its inside.
    const RAIL_L: [number, number][] = [[-0.74, 0.2], [-0.74, 0.3], [-0.66, 0.3], [-0.66, 0.2], [-0.74, 0.2]];
    const RAIL_R: [number, number][] = RAIL_L.map(([x, y]) => [-x, y]);
    const railMat = this.std(0x8a9099, 0.35, 0.8, 0xdfe3e8);
    const motorMat = this.std(0x2a2c31, 0.5, 0.5, 0x6b7280);
    const footMat = this.std(0x3a3d44, 0.6, 0.5, 0xb9c0c8);
    const BELT: [number, number][] = [[-0.6, 0], [0.6, 0]];
    const FRAME: [number, number][] = [[-0.68, 0.1], [-0.68, -0.28], [0.68, -0.28], [0.68, 0.1]];
    const LEDL: [number, number][] = [[-0.69, -0.07], [-0.69, -0.15]];
    const LEDR: [number, number][] = [[0.69, -0.07], [0.69, -0.15]];
    const legs = (path: Path, s0: number, s1: number, half: number) => {
      for (let s = s0 + 1; s < s1; s += 3.2) {
        path.at(s, this.p, this.t);
        const h = this.p.y - 0.3;
        if (h < 0.3) continue;
        this.n.set(-this.t.z, 0, this.t.x).normalize();
        for (const sg of [-1, 1]) {
          const lx = this.p.x + this.n.x * half * sg;
          const lz = this.p.z + this.n.z * half * sg;
          this.box('leg', legMat, lx, h / 2, lz, 0.1, h, 0.1);
          this.box('foot', footMat, lx, 0.01, lz, 0.22, 0.02, 0.22);
        }
        this.box('leg', legMat, this.p.x, h - 0.05, this.p.z, Math.abs(this.n.x) * half * 2 + 0.1, 0.08, Math.abs(this.n.z) * half * 2 + 0.1);
        // A lower cross bar for the taller supports.
        if (h > 1.5) this.box('leg', legMat, this.p.x, 0.35, this.p.z, Math.abs(this.n.x) * half * 2 + 0.1, 0.06, Math.abs(this.n.z) * half * 2 + 0.1);
      }
    };
    /** A belt from s0 to s1; `rails` can limit each side rail to some stretches (where belts merge). */
    const belt = (path: Path, s0: number, s1: number, led = stripIn, rails?: { L?: [number, number][]; R?: [number, number][] }, cut?: Cut) => {
      const ex = (prof: [number, number][], a: number, b: number) => extrude(path, prof, a, b, 0.35, cut);
      geo.belt!.push(ex(BELT, s0, s1));
      geo.frame!.push(ex(FRAME, s0, s1));
      const k = led === stripIn ? 'sIn' : led === stripLoop ? 'sLoop' : 'sChute';
      geo[k]!.push(ex(LEDL, s0, s1), ex(LEDR, s0, s1));
      for (const [a, b] of rails?.L ?? [[s0, s1]]) if (b > a) geo.rail!.push(ex(RAIL_L, a, b));
      for (const [a, b] of rails?.R ?? [[s0, s1]]) if (b > a) geo.rail!.push(ex(RAIL_R, a, b));
      legs(path, s0, s1, 0.6);
      // Drive motors under the frame, one per section.
      for (let s = s0 + 4; s < s1 - 2; s += 12) {
        path.at(s, this.p, this.t);
        this.n.set(-this.t.z, 0, this.t.x).normalize();
        const mx = this.p.x + this.n.x * 0.45;
        const mz = this.p.z + this.n.z * 0.45;
        this.box('motor', motorMat, mx, this.p.y - 0.45, mz, 0.36, 0.3, 0.36);
        this.box('motor', motorMat, mx, this.p.y - 0.45, mz, 0.5, 0.18, 0.18, undefined, Math.atan2(this.t.x, this.t.z));
      }
    };

    const inductGap = new THREE.MeshBasicMaterial({ color: 0x0c0d0f });
    // Infeeds: four lanes side by side at floor level, in from the north wall, each through its own scan tunnel.
    for (let k = 0; k < 4; k++) {
      const y = LANE_Y;
      // Where it meets the loop, and where it turns towards it (LANE_OUT out from the
      // centre line, on the 30° line in from the outside); the lane runs straight south to there.
      loopAt(INDUCT[k]!, this.p, this.t);
      const end = this.p.clone();
      const into = this.t.clone().applyAxisAngle(UP, -Math.PI / 6);
      const corner = end.clone().addScaledVector(into, -LANE_OUT / Math.abs(into.z));
      // The last stretch is level, its belt just above the trays' lips (as on a real induction).
      corner.y = LANE_TOP;
      end.y = LANE_TOP;
      const x = corner.x;
      const z0 = NZ - 1;
      const path = Path.fillet([v(x, y, z0), v(x, y, -23.5), v(x, corner.y, corner.z), end], 3);
      // The belt ends at the loop's side, cut square to it (mitred at the 30° of the join),
      // a hand's width from the trays, so parcels slide across onto their tray.
      outward(this.t, this.n);
      const cut: Cut = { c: this.p.clone().addScaledVector(this.n, TRAY_HALF + 0.06), n: this.n.clone().negate() };
      belt(path, 0.6, path.len, stripIn, undefined, cut);
      // The run-in is made of short induction belts that time each parcel to its tray:
      // dark gaps across the belt between them, and a drive under each.
      const edgeS = path.len - (TRAY_HALF + 0.06) / Math.sin(Math.PI / 6);
      for (const back of [1.1, 2.5, 3.9]) {
        path.at(edgeS - back, this.p, this.t);
        const ry = Math.atan2(this.t.x, this.t.z);
        this.box('indgap', inductGap, this.p.x, this.p.y + 0.004, this.p.z, 1.2, 0.01, 0.035, undefined, ry);
        this.box('motor', motorMat, this.p.x, this.p.y - 0.4, this.p.z, 0.5, 0.2, 0.3, undefined, ry);
      }

      const tunnelS = LANE_TUNNEL_Z - z0;
      const tunnel = this.tunnel(path, tunnelS, 1.2);
      const doorMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      // Lit opening in the north wall where the lane comes in.
      this.box('dark', new THREE.MeshBasicMaterial({ color: 0x020203 }), x, y + 0.6, NZ + 0.05, 1.8, 1.8, 0.05);
      this.box(`door${k}`, doorMat, x, y + 1.55, NZ + 0.1, 2.0, 0.1, 0.08);
      this.box(`door${k}`, doorMat, x - 0.95, y + 0.6, NZ + 0.1, 0.1, 1.9, 0.08);
      this.box(`door${k}`, doorMat, x + 0.95, y + 0.6, NZ + 0.1, 0.1, 1.9, 0.08);
      this.lanes.push({ path, tunnelS, lastArrive: -99, lastSpawn: -99, tunnel, door: doorMat, doorFlash: 0, doorCol: new THREE.Color(1, 1, 1) });
    }
    // A maintenance walkway along the infeeds (east of them), with a stair up to where the belts are high.
    {
      const grate = this.std(0x3a3e45, 0.6, 0.7, 0xc9ced4);
      const rail = this.std(0xd9a400, 0.5, 0.4, 0xf2c200);
      const steel = this.std(0x4c515a, 0.5, 0.7, DAY.steel);
      loopAt(INDUCT[3]!, this.p, this.t);
      const wx = this.p.x - LANE_OUT / Math.tan(Math.PI / 6) + 1.7;
      const wy = LOOP_Y - 1.0;
      const z1 = -23.5 + ((wy - LANE_Y) / (LANE_TOP - LANE_Y)) * (-8.5 - LANE_OUT + 23.5);
      const z0 = z1 - 6;
      this.box('grate', grate, wx, wy - 0.05, (z0 + z1) / 2, 1.1, 0.1, z1 - z0);
      for (const z of [z0, (z0 + z1) / 2, z1]) this.box('steel', steel, wx, (wy - 0.1) / 2, z, 0.12, wy - 0.1, 0.12);
      for (const yy of [0.55, 1.05]) this.box('rail', rail, wx + 0.55, wy + yy, (z0 + z1) / 2, 0.05, 0.05, z1 - z0);
      for (let z = z0; z <= z1 + 0.01; z += 1.5) this.box('rail', rail, wx + 0.55, wy + 0.53, z, 0.05, 1.05, 0.05);
      const steps = 14;
      for (let k = 0; k < steps; k++) this.box('grate', grate, wx, wy - (k + 1) * (wy / steps), z0 - 0.15 - k * 0.24, 1.0, 0.05, 0.26);
    }

    // The loop: a track with trays riding on it and LEDs along both sides.
    const loopPts: V3[] = [];
    for (let s = 0; s <= LOOP_LEN; s += 0.25) {
      loopAt(s, this.p, this.t);
      loopPts.push(this.p.clone());
    }
    const loop = new Path(loopPts, true);
    geo.track!.push(extrude(loop, [[-0.78, -0.16], [-0.78, -0.6], [0.78, -0.6], [0.78, -0.16]], 0, LOOP_LEN, 0.25));
    geo.sLoop!.push(extrude(loop, [[-0.79, -0.3], [-0.79, -0.42]], 0, LOOP_LEN, 0.25), extrude(loop, [[0.79, -0.3], [0.79, -0.42]], 0, LOOP_LEN, 0.25));
    for (let s = 1; s < LOOP_LEN; s += 4) {
      loopAt(s, this.p, this.t);
      this.box('leg', legMat, this.p.x, (LOOP_Y - 0.6) / 2, this.p.z, 0.22, LOOP_Y - 0.6, 0.22);
      this.box('foot', footMat, this.p.x, 0.01, this.p.z, 0.4, 0.02, 0.4);
    }
    // Linear drive units and a cable tray on the inside of the loop.
    for (let s = 9; s < LOOP_LEN; s += 24) {
      loopAt(s, this.p, this.t);
      this.box('motor', motorMat, this.p.x, LOOP_Y - 0.85, this.p.z, Math.abs(this.t.x) * 1.4 + 0.5, 0.36, Math.abs(this.t.z) * 1.4 + 0.5);
    }
    {
      const tray: V3[] = [];
      for (let s = 0; s <= LOOP_LEN; s += 1) {
        loopAt(s, this.p, this.t);
        outward(this.t, this.n);
        tray.push(this.p.clone().addScaledVector(this.n, -1.05).setY(LOOP_Y - 0.55));
      }
      const tp = new Path(tray, true);
      geo.rail!.push(extrude(tp, [[-0.15, 0.08], [-0.15, 0], [0.15, 0], [0.15, 0.08]], 0, tp.len, 0.5));
    }
    const trayMat = this.theme(new THREE.MeshStandardMaterial({ color: 0x8c96a4, roughness: 0.35, metalness: 0.85 }), 0xffffff, 0.7);
    // Realistic day: dark grey plates, each worn its own way.
    this.themed[this.themed.length - 1]!.rc = new THREE.Color(0x4d5258);
    trayWear(trayMat);
    // Tilt trays: a plate with raised side lips and a pivot block underneath.
    const trayGeo = mergeGeometries([
      new THREE.BoxGeometry(1.2, 0.06, PITCH * 0.88).toNonIndexed(),
      new THREE.BoxGeometry(0.05, 0.12, PITCH * 0.88).translate(-0.6, 0.04, 0).toNonIndexed(),
      new THREE.BoxGeometry(0.05, 0.12, PITCH * 0.88).translate(0.6, 0.04, 0).toNonIndexed(),
      new THREE.BoxGeometry(0.3, 0.1, 0.3).translate(0, -0.08, 0).toNonIndexed(),
    ])!;
    this.trays = new THREE.InstancedMesh(trayGeo, trayMat, TRAYS);
    this.trays.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trays.frustumCulled = false;
    this.put(this.trays);
    for (const s of LOOP_TUNNELS) this.loopTunnels.push({ s, t: this.tunnel(loop, s, 1.6) });

    // Chutes: steel slides that bend away from the loop and down into roll cages.
    const cageMat = new THREE.LineBasicMaterial({ color: 0x8a8f96 });
    this.cageLine = cageMat;
    const meshMat = new THREE.MeshBasicMaterial({ color: DAY.tealL, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    const panelGeo = new THREE.BoxGeometry(1.4, 1.6, 1.0);
    const cageGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.4, 1.6, 1.0, 2, 3, 1));
    const dockChutes: { k: number; end: V3; path: Path; col: THREE.Color; lamp: THREE.MeshBasicMaterial; s: number; side: number }[] = [];
    const beltPaths: Path[] = [];
    CHUTES.forEach(([s, side], k) => {
      loopAt(s, this.p, this.t);
      outward(this.t, this.n).multiplyScalar(side);
      const E = this.p.clone();
      const T = this.t.clone();
      const N = this.n.clone();
      const at = (f: number, o: number, y: number) => E.clone().addScaledVector(T, f).addScaledVector(N, o).setY(y);
      // The outer chutes of the front straight end at robot pickup stations, square to the robot floor.
      const station = side === 1 && s >= FIRST_STATION_S && k !== REJECT;
      const end = at(2.4, 6.5, 1.0);
      if (station) {
        end.x = RobotFloor.stationX(end.x);
        end.z = STATION_Z;
        // Level with the robots' deck, so parcels slide straight across from table to robot.
        end.y = DECK_Y;
      }
      // From the tray, over the edge of the track (the mouth, just below tray height), down a
      // smooth S-curve, and level for the last metre so parcels run straight onto the dock belt
      // or the pickup table, square to it and at the same height.
      const mouth = at(0.5, 0.85, LOOP_Y - 0.08);
      const run = end.clone().addScaledVector(N, -1.1).setY(end.y + 0.06);
      const path = Path.fillet([E, mouth, at(1.2, 1.9, LOOP_Y - 0.35), run, end], 1.4);
      const s0 = E.distanceTo(mouth) - 0.02;
      geo.chute!.push(extrude(path, [[-0.72, 0.42], [-0.62, 0], [0.62, 0], [0.72, 0.42]], s0, path.len));
      geo.sChute!.push(extrude(path, [[-0.74, 0.38], [-0.74, 0.3]], s0, path.len), extrude(path, [[0.74, 0.38], [0.74, 0.3]], s0, path.len));
      // A lip that bridges the gap between the tray edge and the chute.
      this.box('chutelip', legMat, mouth.x - N.x * 0.08, LOOP_Y - 0.12, mouth.z - N.z * 0.08, Math.abs(N.x) * 0.2 + Math.abs(T.x) * 1.3, 0.04, Math.abs(N.z) * 0.2 + Math.abs(T.z) * 1.3);
      legs(path, 1.2, path.len - 0.6, 0.7);
      const col = new THREE.Color().setHSL(k / CHUTES.length, 0.85, 0.55);
      const lamp = new THREE.MeshBasicMaterial({ color: 0x000000 });
      if (k === REJECT) {
        // A roller belt from the chute end, south, onto the manual sort table's belt from the side.
        const belt = Path.fillet([end, end.clone().addScaledVector(N, 1.0), v(REJECT_X, 1.05, end.z + 3), v(REJECT_X, 1.1, DROP.z - 0.75), v(REJECT_X, 1.1, DROP.z - 0.35)], 1.0);
        beltPaths.push(belt);
        this.chutes[k] = { s, side, path, col: new THREE.Color(DAY.red), lamp, flash: 0, belt };
        return;
      }
      if (station) {
        this.stationOf.set(k, this.stationXs.length);
        this.stationXs.push(end.x);
        this.stationQueue.push([]);
        this.chutes[k] = { s, side, path, col, lamp, flash: 0 };
        return;
      }
      // A roller belt from the chute end to the truck dock, and a lamp on a post where they meet.
      dockChutes.push({ k, end, path, col, lamp, s, side });
    });
    // Dock belts, west to east: each turns towards its dock at its own z, so no two cross.
    dockChutes.sort((a, b) => a.end.x - b.end.x);
    dockChutes.forEach((c, n) => {
      const dx = DOCK_X[n] ?? c.end.x;
      this.dockOf.set(c.k, dx);
      const zTurn = -15 - n * 1.5;
      const pts = Math.abs(dx - c.end.x) < 0.3
        ? [c.end, v(dx, 1.0, DOCK_BELT_END)]
        : [c.end, v(c.end.x, 1.0, zTurn), v(dx, 1.0, zTurn), v(dx, 1.0, DOCK_BELT_END)];
      const belt = Path.fillet(pts, 1.2);
      beltPaths.push(belt);
      this.box('post', legMat, c.end.x + 0.9, 1.4, c.end.z, 0.08, 2.8, 0.08);
      this.box(`lamp${c.k}`, c.lamp, c.end.x + 0.9, 2.9, c.end.z, 0.3, 0.3, 0.3);
      this.cages.set(c.k, Docks.projectorAt(dx));
      this.chutes[c.k] = { s: c.s, side: c.side, path: c.path, col: c.col, lamp: c.lamp, flash: 0, belt };
    });
    for (const bp of beltPaths) belt(bp, 0, bp.len, stripIn);

    // A small display at every chute, on the loop's support pillar there (inside face, eye height),
    // and a work table under it with the odds and ends people leave on one.
    {
      const shows = new Labels(CHUTES.length, 0.8, 0.38, 216, 100);
      const dockXs = [...this.dockOf.entries()];
      const m = new THREE.Matrix4();
      const desk = new Clutter(this);
      CHUTES.forEach(([cs, side], k) => {
        // The pillar nearest the chute (the loop's legs stand every 4 m, from s = 1).
        const legS = 1 + 4 * Math.round((cs + 0.9 - 1) / 4);
        loopAt(legS, this.p, this.t);
        outward(this.t, this.n).multiplyScalar(-side);
        const yaw = Math.atan2(this.n.x, this.n.z);
        const px = this.p.x + this.n.x * 0.12;
        const pz = this.p.z + this.n.z * 0.12;
        m.makeRotationY(yaw).setPosition(px + this.n.x * 0.05, 1.65, pz + this.n.z * 0.05);
        shows.place(k, m);
        // A bracket and frame on the pillar.
        this.box('chutedisp', legMat, px + this.n.x * 0.02, 1.65, pz + this.n.z * 0.02, Math.abs(this.n.z) * 0.86 + 0.06, 0.48, Math.abs(this.n.x) * 0.86 + 0.06);
        const dock = dockXs.findIndex(([c]) => c === k);
        if (k === REJECT) shows.set(k, 'NO READ', 'to manual sorting', { bg: '#2a0d0d', fg: '#ff5a4a', sub: '#e0a0a0' });
        else if (dock >= 0) {
          const c = NORTH_CITIES[DOCK_CITY[dock]!]!;
          shows.set(k, `${dock + 1} · ${c.name}`, rangeText([c.pc[0]![0], c.pc[c.pc.length - 1]![1]]), { bg: '#101114', fg: '#ffffff', sub: '#5be0a0' });
        } else shows.set(k, 'Robots', `station ${(this.stationOf.get(k) ?? 0) + 1} · doors 21–40`, { bg: '#101114', fg: '#ffffff', sub: '#f6a6d6' });
        // The table: right under the display, against the pillar, along the loop.
        const tx = this.p.x + this.n.x * 0.62;
        const tz = this.p.z + this.n.z * 0.62;
        desk.table(tx, tz, Math.atan2(this.t.x, this.t.z), k * 7919 + 13);
      });
      desk.build();
      shows.flush();
      this.put(shows.mesh);
    }

    // To and from the store: off the loop's far bend and back on, tangentially.
    {
      loopAt(STORE_OUT, this.p, this.t);
      outward(this.t, this.n);
      const E = this.p.clone();
      const at = (f: number, o: number) => E.clone().addScaledVector(this.t, f).addScaledVector(this.n, o);
      this.intake = Path.fillet([E, at(1.2, 0.7), at(2.3, 2.6), v(LIFT_X - 3.5, LOOP_Y, -0.9), v(LIFT_X - 0.9, LOOP_Y, -0.9)], 1.5);
      belt(this.intake, 0.9, this.intake.len, stripLoop);
    }
    {
      loopAt(STORE_BACK, this.p, this.t);
      outward(this.t, this.n);
      const E = this.p.clone();
      const at = (f: number, o: number) => E.clone().addScaledVector(this.t, f).addScaledVector(this.n, o);
      this.back = Path.fillet([v(LIFT_X - 0.9, LOOP_Y, 0.9), v(LIFT_X - 3.5, LOOP_Y, 0.9), at(-1.9, 2.6), at(-0.9, 0.7), E], 1.5);
      belt(this.back, 0, this.back.len - 0.9, stripLoop);
    }

    const merged = (list: THREE.BufferGeometry[], mat: THREE.Material) => {
      if (!list.length) return;
      const g = mergeGeometries(list);
      if (g) {
        const m = this.mesh(g, mat);
        if (mat instanceof THREE.MeshStandardMaterial) this.inkify(m, 35);
      }
      list.forEach((x) => x.dispose());
    };
    merged(geo.belt!, beltMat);
    merged(geo.frame!, frameMat);
    merged(geo.chute!, chuteMat);
    merged(geo.track!, trackMat);
    merged(geo.rail!, railMat);
    merged(geo.sIn!, stripIn);
    merged(geo.sLoop!, stripLoop);
    merged(geo.sChute!, stripChute);
    stripChute.uniforms.uGain!.value = 0.7;
  }

  /** A scan arch over a path at distance s, with LED rings and a light curtain. */
  private tunnel(path: Path, s: number, width: number): Tunnel {
    path.at(s, this.p, this.t);
    const g = new THREE.Group();
    g.position.copy(this.p);
    g.rotation.y = Math.atan2(this.t.x, this.t.z);
    this.put(g);
    const shell = this.std(0x8a9099, 0.35, 0.8, DAY.orange);
    const W = width + 1.0;
    const H = 1.9;
    const D = 2.6;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    // Rounded shell: two side columns and a roof, with camera pods, a light stack and a cable duct.
    for (const x of [-W / 2, W / 2]) this.outline(add(new RoundedBoxGeometry(0.34, H, D, 3, 0.08), shell, x, H / 2 - 0.3, 0), 0.02);
    this.outline(add(new RoundedBoxGeometry(W + 0.34, 0.44, D, 3, 0.1), shell, 0, H - 0.1, 0), 0.02);
    const dark = this.std(0x1b1c20, 0.5, 0.4, 0x2a2c31);
    const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.4, 0.9) });
    for (const z of [-0.6, 0.6]) {
      for (const x of [-W / 3, 0, W / 3]) {
        this.inkify(add(new THREE.BoxGeometry(0.22, 0.16, 0.3), dark, x, H + 0.2, z));
        add(new THREE.CircleGeometry(0.06, 12), glass, x, H + 0.2, z + Math.sign(z) * 0.152).rotation.y = z < 0 ? Math.PI : 0;
      }
    }
    // Vents on the columns.
    for (const x of [-W / 2 - 0.172, W / 2 + 0.172]) {
      for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.01, 0.04, 0.9), dark, x, 0.25 + k * 0.1, -0.7);
    }
    // Signal light stack: green, amber, red.
    [0x22cc66, 0xf2a51a, 0xe2231a].forEach((c, k) => {
      add(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 12), new THREE.MeshBasicMaterial({ color: c }), W / 2, H + 0.18 + k * 0.13, D / 2 - 0.25);
    });
    add(new THREE.BoxGeometry(0.18, 0.12, 0.18), dark, W / 2, H + 0.08, D / 2 - 0.25);
    this.inkify(add(new THREE.BoxGeometry(0.2, 0.14, D * 0.8), dark, -W / 2, H + 0.18, 0));
    // By day: a barcode panel on both faces and the eye mark on the side, as in the illustration.
    for (const z of [D / 2 + 0.02, -D / 2 - 0.02]) {
      const p = add(new THREE.PlaneGeometry(Math.min(1.4, W - 0.2), 0.3), new THREE.MeshBasicMaterial({ map: barcodeTex() }), 0, H - 0.1, z);
      if (z < 0) p.rotation.y = Math.PI;
      this.dayOnly.push(p);
    }
    for (const x of [W / 2 + 0.16, -W / 2 - 0.16]) {
      const e = add(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map: eyeTex() }), x, H / 2 - 0.3, 0);
      e.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.dayOnly.push(e);
    }
    const ring = new THREE.MeshBasicMaterial({ color: 0x103020 });
    for (const z of [-D / 2 - 0.01, D / 2 + 0.01]) {
      add(new THREE.BoxGeometry(W + 0.32, 0.08, 0.04), ring, 0, H - 0.32, z);
      add(new THREE.BoxGeometry(0.08, H - 0.4, 0.04), ring, -W / 2 + 0.17, H / 2 - 0.5, z);
      add(new THREE.BoxGeometry(0.08, H - 0.4, 0.04), ring, W / 2 - 0.17, H / 2 - 0.5, z);
    }
    const curtain = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const z of [-0.5, 0.5]) add(new THREE.PlaneGeometry(W - 0.3, H - 0.5), curtain, 0, H / 2 - 0.35, z);
    if (this.p.y < 1.5) this.blob(this.p.x, this.p.z, W + 1.2, D + 1.2, Math.atan2(this.t.x, this.t.z));
    // Legs down to the floor for raised tunnels.
    if (this.p.y > 0.8) {
      const leg = this.std(0x6b7280, 0.5, 0.7, DAY.orange);
      for (const x of [-W / 2, W / 2]) add(new THREE.BoxGeometry(0.15, this.p.y - 0.3, 0.15), leg, x, -(this.p.y + 0.3) / 2, 0);
    }
    const lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.6, 0.4), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const line = add(new THREE.PlaneGeometry(W - 0.4, 0.05), lineMat, 0, 0.35, 0);
    line.rotation.x = -Math.PI / 2;
    line.visible = false;
    // A fan of light from the top scanner down to the line.
    const fanMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const fan = add(new THREE.PlaneGeometry(W - 0.4, H - 0.9), fanMat, 0, 0.35 + (H - 0.9) / 2, 0);
    fan.visible = false;
    line.userData.fan = fan;
    // A display on the roof, both faces: the last postcode read (or NO READ).
    if (!this.scanLabels) {
      this.scanLabels = new Labels(16, 1.15, 0.42, 276, 100);
      this.put(this.scanLabels.mesh);
    }
    const screen = this.scanCount++;
    add(new THREE.BoxGeometry(1.25, 0.5, 0.12), dark, 0, H + 0.62, 0);
    g.updateMatrixWorld();
    for (const side of [0, 1]) {
      const m = new THREE.Matrix4().makeRotationY(side * Math.PI).setPosition(0, H + 0.62, side ? -0.065 : 0.065);
      this.scanLabels.place(screen * 2 + side, m.premultiply(g.matrixWorld));
      this.scanLabels.set(screen * 2 + side, 'Ready', 'scanner ' + (screen + 1), { bg: '#101114', fg: '#5be0a0', sub: '#9aa0a8' });
    }
    this.scanLabels.flush();
    return { ring, curtain, flash: 0, col: new THREE.Color(0.3, 1, 0.5), line, lineMat, depth: D, read: true, screen };
  }

  private buildStore(): void {
    const upr = this.std(0x2b4fa0, 0.5, 0.5, DAY.teal);
    const beam = this.std(0xe0661a, 0.5, 0.5, DAY.teal);
    const zMax = BAYS * BAY + BAY / 2;
    for (let z = -zMax; z <= zMax + 0.01; z += BAY) {
      for (const x of [RACK_X0, RACK_X1]) this.box('upr', upr, x, 4.8, z, 0.1, 9.6, 0.1);
    }
    const carton = this.std(0xffffff, 0.88, 0);
    carton.map = cardboardSide();
    this.realNormal(carton, cardboardNormal(), 0.6);
    // Diagonal bracing between the upright pairs, base plates and yellow end guards.
    const braces: THREE.BufferGeometry[] = [];
    const brace = (x: number, z: number, y0: number, y1: number, dir: 1 | -1) => {
      const len = Math.hypot(y1 - y0, RACK_X1 - RACK_X0);
      const ang = Math.atan2(RACK_X1 - RACK_X0, y1 - y0) * dir;
      braces.push(new THREE.BoxGeometry(0.04, len, 0.04).rotateZ(-ang).translate(x, (y0 + y1) / 2, z).toNonIndexed());
    };
    for (let z = -zMax; z <= zMax + 0.01; z += BAY) {
      for (let y = 0.2; y < 9.4; y += 1.6) brace((RACK_X0 + RACK_X1) / 2, z, y, y + 1.6, Math.round(y / 1.6) % 2 ? 1 : -1);
      for (const x of [RACK_X0, RACK_X1]) this.box('rackfoot', this.std(0x3a3d44, 0.6, 0.5, 0xb9c0c8), x, 0.02, z, 0.24, 0.04, 0.24);
    }
    if (braces.length) {
      const bm = this.mesh(mergeGeometries(braces)!, upr);
      void bm;
    }
    this.blob((RACK_X0 + RACK_X1) / 2, 0, 3, zMax * 2 + 1.5);
    const guard = this.std(0x8a6e00, 0.6, 0.2, 0xf2c200);
    for (const z of [-zMax - 0.3, zMax + 0.3]) {
      this.box('rguard', guard, (RACK_X0 + RACK_X1) / 2, 0.3, z, 1.8, 0.6, 0.12);
      for (const x of [RACK_X0, RACK_X1]) this.box('rguard', guard, x, 0.3, z, 0.12, 0.6, 0.3);
    }
    for (const y of LEVELS) {
      for (const x of [RACK_X0, RACK_X1]) this.box('beam', beam, x, y - 0.08, 0, 0.08, 0.14, zMax * 2);
      // The shelf the parcels stand on: a steel deck between the beams, its top at the level.
      this.box('rdeck', this.std(0x6b7078, 0.5, 0.6, 0xc9ced4), (RACK_X0 + RACK_X1) / 2, y - 0.03, 0, RACK_X1 - RACK_X0 + 0.04, 0.04, zMax * 2);
      this.box('srail', this.std(0x50555e, 0.4, 0.8, DAY.tealD), SHUTTLE_X, y - 0.2, 0, 0.9, 0.06, zMax * 2);
    }
    for (let b = -BAYS; b <= BAYS; b++) {
      const z = b * BAY;
      for (let k = 0; k < LEVELS.length; k++) {
        if (b !== 0) this.slots.push({ level: k, z, parcel: null, reserved: false });
      }
    }
    // Shuttles, one per level.
    const shMat = this.std(0xd9a400, 0.45, 0.5, DAY.tealL);
    for (let k = 0; k < LEVELS.length; k++) {
      const m = this.mesh(new THREE.BoxGeometry(0.95, 0.18, 1.2), shMat, SHUTTLE_X, LEVELS[k]! - 0.1, 0);
      this.inkify(m);
      this.shuttles.push({ runner: new Runner(), anim: { a: 0, b: 0, t0: 0, t1: 0 }, mesh: m });
    }
    // Lift mast and carriage.
    const mast = this.std(0x50555e, 0.4, 0.8, DAY.teal);
    for (const z of [-1.75, 1.75]) this.box('mast', mast, LIFT_X + 0.95, 5.2, z, 0.25, 10.4, 0.25);
    this.box('mast', mast, LIFT_X + 0.95, 10.45, 0, 0.3, 0.3, 3.8);
    // Mast cross bracing, a cable chain and a safety fence with wire mesh around the lift.
    for (let y = 1.2; y < 10; y += 2.2) this.box('mast', mast, LIFT_X + 0.95, y, 0, 0.12, 0.12, 3.5);
    this.box('liftchain', this.std(0x1b1c20, 0.6, 0.4, 0x3a3d44), LIFT_X + 1.15, 5.2, 1.4, 0.08, 9.6, 0.25);
    {
      const post = this.std(0x8a6e00, 0.5, 0.3, 0xf2c200);
      const t = wireMesh().clone();
      t.repeat.set(3, 2);
      t.needsUpdate = true;
      const panel = this.std(0x3a3d44, 0.5, 0.5, 0x6b7280);
      panel.alphaMap = t;
      panel.alphaTest = 0.5;
      panel.side = THREE.DoubleSide;
      const fx = LIFT_X - 2.6;
      for (const z of [-2.6, 2.6]) {
        this.box('fpost', post, fx, 1.1, z, 0.08, 2.2, 0.08);
        this.box('fpost', post, LIFT_X + 0.5, 1.1, z, 0.08, 2.2, 0.08);
        const m = this.mesh(new THREE.PlaneGeometry(LIFT_X + 0.5 - fx, 2.0), panel, (fx + LIFT_X + 0.5) / 2, 1.1, z);
        void m;
      }
    }
    this.carriage = new THREE.Group();
    this.carriage.position.set(LIFT_X, LOOP_Y, 0);
    this.put(this.carriage);
    const cm = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.carriage.add(m);
      return m;
    };
    this.inkify(cm(new THREE.BoxGeometry(1.7, 0.14, 3.2), this.theme(new THREE.MeshStandardMaterial({ color: 0x8c96a4, roughness: 0.35, metalness: 0.85 }), DAY.tealL), -0.1, -0.08, 0));
    this.inkify(cm(new THREE.BoxGeometry(0.1, 0.5, 3.2), this.std(0xd9a400, 0.5, 0.4, DAY.teal), 0.8, 0.2, 0));
    this.liftLamp = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (const z of [-1.6, 1.6]) cm(new THREE.BoxGeometry(0.16, 0.16, 0.16), this.liftLamp, 0.8, 0.55, z);
  }

  private buildParcels(): void {
    const cardboard = canvasTex(128, 128, (g) => {
      noise(g, 128, 128, 225, 26);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(52, 0, 24, 128);
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 3;
      g.strokeRect(1, 1, 126, 126);
    });
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: cardboard, roughness: 0.82, metalness: 0, envMapIntensity: 0.5 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aGlow;\nvarying vec3 vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;');
    };
    toonify(mat);
    // Realistic day: every box its own cardboard shade, worn at the edges.
    parcelWear(mat);
    // Plastic for the polybags: shiny, no cardboard print.
    const plastic = mat.clone();
    plastic.map = null;
    plastic.roughness = 0.35;
    plastic.onBeforeCompile = mat.onBeforeCompile;
    plastic.customProgramCacheKey = () => 'parcel-plastic';
    const geos = [
      // Slightly rounded boxes: a softer, more real silhouette than sharp cubes.
      new RoundedBoxGeometry(1, 1, 1, 2, 0.06),
      // Polybags: a soft pillow.
      new RoundedBoxGeometry(1, 1, 1, 5, 0.42),
      // Tubes, lying along their length.
      new THREE.CylinderGeometry(0.5, 0.5, 1, 18).rotateX(Math.PI / 2),
    ];
    geos.forEach((geo, k) => {
      const glow = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARCELS * 3), 3);
      glow.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aGlow', glow);
      const mesh = new THREE.InstancedMesh(geo, k === 1 ? plastic : mat, MAX_PARCELS);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, this.white);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.put(mesh);
      this.shapes.push({ mesh, glow });
    });
    this.hull = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }), MAX_PARCELS);
    this.hull.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.hull.setColorAt(0, this.white);
    this.hull.frustumCulled = false;
    this.hull.count = 0;
    this.put(this.hull);
    this.hull.userData.noInk = true;
    const barcode = canvasTex(64, 44, (g) => {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 64, 44);
      g.fillStyle = '#111';
      for (let x = 4; x < 60; ) {
        const w = 1 + Math.floor(Math.random() * 3);
        g.fillRect(x, 6, w, 22);
        x += w + 1 + Math.floor(Math.random() * 2);
      }
      g.fillRect(4, 32, 30, 4);
    });
    void barcode;
    const c = document.createElement('canvas');
    c.width = LABEL_COLS * LABEL_W;
    c.height = LABEL_ROWS * LABEL_H;
    this.labelCanvas = c.getContext('2d')!;
    this.labelTex = new THREE.CanvasTexture(c);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.labelTex.anisotropy = 4;
    // Cell 0: a plain label, for when every cell is taken.
    this.drawLabel(0, null);
    for (let i = LABEL_COLS * LABEL_ROWS - 1; i > 0; i--) this.freeCells.push(i);
    const labelGeo = new THREE.PlaneGeometry(1, 1);
    this.labelCellAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARCELS), 1);
    this.labelCellAttr.setUsage(THREE.DynamicDrawUsage);
    labelGeo.setAttribute('aCell', this.labelCellAttr);
    const labelMat = new THREE.MeshStandardMaterial({ map: this.labelTex, roughness: 0.5 });
    labelMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aCell;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = vec2((mod(aCell, ${LABEL_COLS}.0) + vMapUv.x) / ${LABEL_COLS}.0, 1.0 - (floor(aCell / ${LABEL_COLS}.0) + 1.0 - vMapUv.y) / ${LABEL_ROWS}.0);`);
    };
    labelMat.customProgramCacheKey = () => 'parcel-labels';
    toonify(labelMat);
    this.tapeMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.std(0x8a6a3a, 0.4, 0, 0xc9a46a), MAX_PARCELS);
    this.tapeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tapeMesh.frustumCulled = false;
    this.tapeMesh.count = 0;
    this.tapeMesh.userData.noInk = true;
    this.put(this.tapeMesh);
    this.ribbonMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.std(0x8a6a10, 0.3, 0.5, 0xe8b923), MAX_PARCELS * 2);
    this.ribbonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ribbonMesh.frustumCulled = false;
    this.ribbonMesh.count = 0;
    this.ribbonMesh.userData.noInk = true;
    this.put(this.ribbonMesh);
    this.dockCodes = new Labels(20 * 3, 0.5, 0.24, 128, 60, { transparent: true });
    this.dockCodes.mesh.userData.noInk = true;
    this.put(this.dockCodes.mesh);
    this.labelMesh = new THREE.InstancedMesh(labelGeo, labelMat, MAX_PARCELS);
    this.labelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.labelMesh.frustumCulled = false;
    this.labelMesh.count = 0;
    this.put(this.labelMesh);
  }

  private buildClub(): void {
    this.only = 'night';
    const blob = canvasTex(64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.4, 'rgba(255,255,255,0.4)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    });
    // Mirror ball over the middle of the loop.
    this.ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.9, 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12, flatShading: true }),
    );
    this.ball.position.set(LCX, 9.2, 0);
    this.put(this.ball);
    this.fxObjs.push([this.ball, 'ball']);
    this.box('ballrod', this.std(0x6b7280, 0.5, 0.7), LCX, 10.2, 0, 0.04, 1.6, 0.04);
    const N = 480;
    this.sparkPos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) this.sparkDirs.push(v(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize());
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkMat = new THREE.PointsMaterial({ size: 0.35, map: blob, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const sparks = new THREE.Points(this.sparkGeo, this.sparkMat);
    sparks.frustumCulled = false;
    this.put(sparks);
    this.fxObjs.push([sparks, 'ball']);
    // Haze.
    const H = 80;
    this.hazePos = new Float32Array(H * 3);
    for (let k = 0; k < H; k++) this.hazeSeed.push([rnd(WX + 4, EX - 4), rnd(1, HH - 2), rnd(-30, 30), rnd(0, 6)]);
    this.hazeGeo = new THREE.BufferGeometry();
    this.hazeGeo.setAttribute('position', new THREE.BufferAttribute(this.hazePos, 3));
    this.hazeMat = new THREE.PointsMaterial({ size: 16, map: blob, color: 0x2a2244, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const haze = new THREE.Points(this.hazeGeo, this.hazeMat);
    haze.frustumCulled = false;
    this.put(haze);
    this.fxObjs.push([haze, 'haze']);
    // Moving heads on two trusses; every other one also casts real light.
    const truss = this.std(0x2a2c31, 0.5, 0.7);
    for (const z of [-14, 14]) this.box('truss', truss, LCX, HH - 0.55, z, STRAIGHT + 20, 0.4, 0.4);
    const cone = new THREE.ConeGeometry(2.4, 16, 24, 1, true);
    let k = 0;
    for (const x of [LCX - 54, LCX - 18, LCX + 18, LCX + 54]) {
      for (const z of [-14, 14]) {
        const pos = v(x, HH - 0.9, z);
        this.box('head', this.std(0x111114, 0.5, 0.5), x, HH - 0.75, z, 0.5, 0.5, 0.5);
        const piv = new THREE.Group();
        piv.position.copy(pos);
        this.put(piv);
        this.fxObjs.push([piv, 'lasers']);
        const u = { uCol: { value: new THREE.Color(1, 1, 1) }, uO: { value: 0.2 } };
        const m = new THREE.Mesh(
          cone,
          new THREE.ShaderMaterial({ uniforms: u, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
        );
        m.position.y = -8;
        piv.add(m);
        const h: Head = { piv, u, pos, rx: 0, rz: 0 };
        if (k % 2 === 0) {
          const l = new THREE.SpotLight(0xffffff, 200, 40, 0.17, 0.5, 1.6);
          l.position.copy(pos);
          this.put(l);
          this.put(l.target);
          h.light = l;
        }
        this.heads.push(h);
        k++;
      }
    }
    this.only = undefined;
  }

  /** A forklift serving the store, driving a loop along the east wall. (The box forklifts live in BoxYard.) */
  private buildForklifts(): void {
    // (The east side of the rack is the reach truck's now; see Life.)
    const routes: Path[] = [];
    void roundRect;
    routes.forEach((route, k) => {
      const { g, forks, beacon } = buildForklift(this, pick([0xb08860, 0xd8d4cc]));
      this.forklifts.push({ g, route, s: rnd(0, route.len), speed: 1.1 + k * 0.15, forks, beacon });
    });
  }

  /** The day look's own scenery: a light hall, the illustration's workstation, GPU racks, people and signs. */
  /**
   * The lit hall of the realistic day look: worn concrete, cladding and a ceiling that
   * take light and shadow, and shafts of daylight under the roof lights.
   */
  private buildRealHall(): void {
    // Built the first time the look is chosen (it simulates the robots' traffic and draws
    // large canvases), after setupShadows: so it sets its own shadow flags.
    const add = (o: THREE.Object3D) => {
      this.put(o, 'day');
      this.realOnly.push(o);
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material instanceof THREE.MeshStandardMaterial) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    };
    const { map, rough } = realFloorMaps();
    const fm = map.clone();
    const fr = rough.clone();
    for (const t of [fm, fr]) {
      t.repeat.set(HW / FLOOR_TILE_M, HD / FLOOR_TILE_M);
      t.needsUpdate = true;
    }
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d4, map: fm, roughnessMap: fr, roughness: 1, metalness: 0, envMapIntensity: 0.6 });
    grime(floorMat, 0.22, 9, 'xz');
    this.realNormal(floorMat, floorJointNormal(), 0.6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HW, HD), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(HCX, 0, HZC);
    add(floor);
    const cl = dayWall().clone();
    cl.repeat.set(1 / 8, 1 / HH);
    cl.offset.set(0, 0.5);
    cl.needsUpdate = true;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xb4b8be, map: cl, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });
    grime(wallMat, 0.18, 6, 'xy', 1.2);
    this.realNormal(wallMat, claddingNormal(), 0.8);
    for (const z of [NZ, HZ]) {
      const w = new THREE.Mesh(wallWithDoors(z < 0 ? NORTH_DOORS : SOUTH_DOORS), wallMat);
      w.position.set(HCX, HH / 2, z);
      add(w);
    }
    const side = dayWall().clone();
    side.repeat.set(HD / 8, 1);
    side.needsUpdate = true;
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xb4b8be, map: side, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });
    grime(sideMat, 0.18, 6, 'zy', 1.2);
    this.realNormal(sideMat, claddingNormal(), 0.8);
    for (const x of [WX, EX]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(HD, HH), sideMat);
      w.position.set(x, HH / 2, HZC);
      w.rotation.y = Math.PI / 2;
      add(w);
    }
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.8, metalness: 0.3, side: THREE.DoubleSide });
    // The steel roof deck: a trapezoid rib every 3 m, across the hall (shape UVs are metres).
    const deck = roofDeckNormal().clone();
    deck.repeat.set(1 / 3, 1 / 3);
    deck.rotation = Math.PI / 2;
    deck.needsUpdate = true;
    this.realNormal(ceilMat, deck);
    const ceil = new THREE.Mesh(ceilingWithLights(HCX, HZC, HW, HD, ROOF_LIGHTS), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(HCX, HH, HZC);
    add(ceil);
    add(lightShafts(ROOF_LIGHTS, HH, this.keyLight.position.clone().sub(this.keyLight.target.position)));
    // The LED fixtures' light on the floor (they hang every 10 m in four rows; see buildDay).
    const spots: [number, number][] = [];
    for (let x = WX + 10; x <= EX - 10; x += 10) for (const z of [-28, -10, 10, 28]) spots.push([x, z]);
    add(lightPools(spots, 7, 4.5));
    // Where the roll cages are pushed, the floor shows it.
    add(wheelTracks(this.docks.cagePaths().map((pts) => ({ pts })), CAGE_TRACKS));
    // The robots keep to one-way lanes on a grid: the busy lanes show as worn tracks.
    add(wheelTracks(this.floor.trafficPaths(), ROBOT_TRACKS, 23));
  }

  private buildDay(): void {
    this.only = 'day';
    const grid = canvasTex(64, 64, (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 64, 64);
      g.strokeStyle = '#dfe3e8';
      g.lineWidth = 2;
      g.strokeRect(0, 0, 64, 64);
    });
    void grid;
    const slabs = dayFloor().clone();
    slabs.repeat.set(HW / 6, HD / 6);
    slabs.needsUpdate = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HW, HD), new THREE.MeshStandardMaterial({ color: DAY.floor, map: slabs, roughness: 0.95, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(HCX, 0, HZC);
    this.put(floor);
    this.flatOnly.push(floor);
    // Flat walls and ceiling, as in a drawing.
    // Cladding with a band of high windows.
    const cladding = (len: number) => {
      const t = dayWall().clone();
      t.repeat.set(len / 8, 1);
      t.needsUpdate = true;
      return new THREE.MeshBasicMaterial({ color: DAY.wall, map: t, side: THREE.DoubleSide });
    };
    const wall = cladding(HD);
    const longWall = cladding(HW);
    void longWall;
    const cl = dayWall().clone();
    // Shape UVs are in metres from the wall's centre: one cladding tile per 8 m, windows at the top.
    cl.repeat.set(1 / 8, 1 / HH);
    cl.offset.set(0, 0.5);
    cl.needsUpdate = true;
    const longDay = new THREE.MeshBasicMaterial({ color: DAY.wall, map: cl, side: THREE.DoubleSide });
    for (const z of [NZ, HZ]) {
      const w = new THREE.Mesh(wallWithDoors(z < 0 ? NORTH_DOORS : SOUTH_DOORS), longDay);
      w.position.set(HCX, HH / 2, z);
      this.put(w);
      this.flatOnly.push(w);
    }
    for (const x of [WX, EX]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(HD, HH), wall);
      w.position.set(x, HH / 2, HZC);
      w.rotation.y = Math.PI / 2;
      this.put(w);
      this.flatOnly.push(w);
    }
    const ceil = new THREE.Mesh(ceilingWithLights(HCX, HZC, HW, HD, ROOF_LIGHTS), new THREE.MeshBasicMaterial({ color: DAY.ceiling, side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(HCX, HH, HZC);
    this.put(ceil);
    this.flatOnly.push(ceil);
    // Rows of linear LED fixtures between the roof lights, and cable trays along the hall.
    const led = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const housing = this.std(0xb9c0c8, 0.5, 0.6, 0xb9c0c8);
    for (let x = WX + 10; x <= EX - 10; x += 10) {
      for (const z of [-28, -10, 10, 28]) {
        this.box('ledhouse', housing, x, HH - 1.0, z, 2.4, 0.1, 0.3);
        this.box('led', led, x, HH - 1.06, z, 2.3, 0.02, 0.22);
        for (const d of [-1, 1]) this.box('ledwire', housing, x + d, HH - 0.5, z, 0.01, 0.9, 0.01);
      }
    }
    const trayMat = this.std(0x9aa0a8, 0.5, 0.6, 0xc3c8ce);
    for (const z of [-16, 16]) {
      this.box('ctray', trayMat, HCX, HH - 1.6, z, HW - 4, 0.02, 0.6);
      for (const side of [-0.3, 0.3]) this.box('ctray', trayMat, HCX, HH - 1.55, z + side, HW - 4, 0.1, 0.02);
      for (let x = WX + 4; x < EX - 2; x += 6) this.box('ctrayrod', trayMat, x, HH - 0.8, z, 0.02, 1.6, 0.02);
    }

    // Monitoring: a purple workstation in front of the control room.
    const purple = this.std(DAY.purple, 0.8, 0.05);
    const dx = -48;
    const dz = 20.6;
    this.box('desk', purple, dx, 1.2, dz, 3.2, 0.12, 1.6);
    this.blob(dx, dz - 0.3, 4, 3);
    for (const sx of [-1.5, 1.5]) for (const sz of [-0.7, 0.7]) this.box('desk', purple, dx + sx, 0.6, dz + sz, 0.1, 1.2, 0.1);
    // One big video wall over the desk: a live plan of the hall (chutes, trucks, cleardowns, robots).
    const ink = this.std(0x1d1d1f, 0.5, 0.3, 0x1d1d1f);
    const vw = new THREE.Group();
    vw.position.set(dx, 2.75, dz + 0.95);
    vw.rotation.y = Math.PI;
    this.put(vw);
    vw.add(new THREE.Mesh(new RoundedBoxGeometry(5.3, 2.0, 0.12, 2, 0.04), ink));
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(5.1, 1.84), new THREE.MeshBasicMaterial({ map: this.screens.map }));
    sc.position.z = 0.065;
    vw.add(sc);
    for (const ox of [-2.2, 2.2]) this.box('wallpost', ink, dx + ox, 0.9, dz + 1.0, 0.1, 1.8, 0.1);
    // A small screen on the desk with the numbers.
    const small = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.35), new THREE.MeshBasicMaterial({ map: this.screens.dash }));
    small.position.set(dx + 1.1, 1.5, dz + 0.2);
    small.rotation.set(-0.2, Math.PI - 0.3, 0);
    this.put(small);
    this.box('kbd', ink, dx, 1.27, dz - 0.25, 0.7, 0.03, 0.22);
    this.box('kbd', ink, dx + 0.55, 1.27, dz - 0.25, 0.1, 0.03, 0.14);
    this.box('mug', this.std(0xffffff, 0.5, 0, 0xffffff), dx - 1.1, 1.32, dz - 0.3, 0.1, 0.12, 0.1);
    // Office chair: star base, pole, seat and back.
    const cz2 = dz - 1.0;
    for (let k = 0; k < 5; k++) this.box('chair', ink, dx + Math.cos((k * 2 * Math.PI) / 5) * 0.2, 0.06, cz2 + Math.sin((k * 2 * Math.PI) / 5) * 0.2, 0.4, 0.04, 0.05, undefined, (k * 2 * Math.PI) / 5);
    this.box('chair', ink, dx, 0.3, cz2, 0.06, 0.45, 0.06);
    this.box('chair', purple, dx, 0.58, cz2, 0.55, 0.1, 0.5);
    this.box('chair', purple, dx, 0.95, cz2 - 0.26, 0.5, 0.65, 0.08);
    this.person(dx + 0.3, dz - 1.5, 0.2);

    // Computing: magenta GPU racks next to the control room.
    const magenta = this.std(DAY.magenta, 0.7, 0.1);
    const gpu = canvasTex(128, 64, (g) => {
      g.fillStyle = '#d6339a';
      g.fillRect(0, 0, 128, 64);
      g.fillStyle = '#1d1d1f';
      g.font = `700 34px ${SIGN_FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('GPU', 64, 34);
    });
    const leds = new THREE.MeshBasicMaterial({ color: 0xffd6ec });
    for (let k = 0; k < 3; k++) {
      const x = -58.5 + k * 1.8;
      this.box('gpu', magenta, x, 2.1, 27.6, 1.5, 4.2, 1.5);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), new THREE.MeshBasicMaterial({ map: gpu }));
      p.position.set(x, 3.5, 26.84);
      p.rotation.y = Math.PI;
      this.put(p);
      for (let j = 0; j < 5; j++) this.box('leds', leds, x, 0.8 + j * 0.45, 26.84, 1.1, 0.05, 0.02);
    }

    // People and parcel trolleys.
    this.person(-57, 14, Math.PI / 2);
    this.person(38.2, 12.9, Math.PI);
    this.person(LIFT_X - 2, -6, -Math.PI / 2);
    this.person(-30, -15, 0.4);
    this.person(EX - 8, 18, Math.PI * 0.8);
    this.trolley(-58.5, 16);
    this.trolley(-56, -29.5);
    this.trolley(-40, 18);

    // Hanging signs, as the labels in the illustration.
    this.sign('Scanning', '#e8960c', -44.2, 6.4, -27, 0, (g) => {
      g.beginPath();
      g.ellipse(0, 0, 24, 14, 0, 0, 7);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 6, 0, 7);
      g.fill();
    });
    this.sign('Sorting', '#2fa58f', LCX - 14, 9.2, 0, 0, (g) => {
      g.strokeRect(-18, -16, 36, 24);
      g.beginPath();
      for (const x of [-12, -4, 4, 12]) g.arc(x, 16, 3, 0, 7);
      g.fill();
    });
    this.sign('Monitoring', '#6b3fd1', -48, 5.4, 23.2, 0, (g) => {
      g.strokeRect(-20, -18, 40, 36);
      for (const [x, h] of [[-12, 10], [-3, 20], [6, 14], [14, 24]] as const) g.fillRect(x - 3, 14 - h, 6, h);
    });
    this.sign('Computing', '#d6339a', -56.7, 6.6, 26, 0, (g) => {
      g.strokeRect(-14, -20, 28, 22);
      g.beginPath();
      g.moveTo(0, 2);
      g.lineTo(0, 12);
      g.moveTo(-14, 12);
      g.lineTo(14, 12);
      g.stroke();
      for (const x of [-14, 0, 14]) g.fillRect(x - 5, 12, 10, 10);
    });
    this.sign('Storage', '#2fa58f', LIFT_X - 3, 9.4, -4, -Math.PI / 2, (g) => {
      g.strokeRect(-16, -20, 32, 40);
      for (const y of [-8, 4]) g.fillRect(-16, y, 32, 3);
      g.fillRect(-10, -16, 8, 7);
      g.fillRect(2, -4, 10, 7);
      g.fillRect(-8, 8, 12, 7);
    });
    this.only = undefined;
    this.flushBoxes();
  }



  /** A person in the illustration style: white shirt, blue trousers, cap. */
  person(x: number, z: number, ry: number): void {
    const n = this.people++;
    const h = buildHuman(this, {
      shirt: [0xffffff, 0x2fa58f, 0xf3f4f6, 0x6b3fd1][n % 4]!,
      trousers: [0x3d4b8f, 0x2a2c31][n % 2]!,
      cap: [0x2f3b6b, 0x2fa58f, 0x1755fe][n % 3]!,
      skin: [0xf3d3b5, 0xc68e64, 0x8d5a3b][n % 3]!,
    }, { x, z, ry });
    // A little life: arms at different angles.
    h.armL.rotation.x = -0.15 - (n % 3) * 0.2;
    h.armR.rotation.x = -0.4 + (n % 2) * 0.3;
  }

  private people = 0;
  private signEdge: THREE.MeshBasicMaterial | null = null;


  /** A white parcel trolley with a few boxes on it. */
  private trolley(x: number, z: number): void {
    // A platform trolley with mesh sides, a push handle and swivel casters.
    const white = this.std(0xffffff, 0.8, 0.05);
    const card = this.std(0xffffff, 0.9, 0);
    card.map = cardboardSide();
    this.realNormal(card, cardboardNormal(), 0.6);
    const black = this.std(0x1d1d1f, 0.6, 0.2);
    this.box('trolley', white, x, 0.32, z, 2.2, 0.08, 1.4);
    this.blob(x, z, 2.8, 2.0);
    for (const sx of [-1.0, 1.0]) for (const sz of [-0.6, 0.6]) {
      this.box('caster', black, x + sx, 0.12, z + sz, 0.08, 0.2, 0.16);
      this.box('caster', white, x + sx, 0.25, z + sz, 0.14, 0.06, 0.14);
    }
    for (const sz of [-0.68, 0.68]) {
      this.box('trolley', white, x, 0.9, z + sz, 2.2, 0.04, 0.04);
      for (let k = -1; k <= 1; k += 0.25) this.box('trolley', white, x + k * 1.05, 0.62, z + sz, 0.025, 0.56, 0.025);
    }
    this.box('trolley', white, x - 1.1, 0.75, z, 0.05, 0.9, 1.4);
    this.box('trolley', black, x - 1.1, 1.2, z, 0.06, 0.06, 1.2);
    for (let k = 0; k < 5; k++) this.box('tbox', card, x - 0.6 + Math.random() * 1.2, 0.56 + Math.floor(k / 3) * 0.42, z - 0.3 + Math.random() * 0.6, rnd(0.55, 0.85), 0.4, 0.5, pick([0xe0b882, 0xd6a870, 0xf3e6cc]), rnd(0, 1));
  }


  /** A sign hanging from the ceiling on two red cables. */
  sign(text: string, color: string, x: number, y: number, z: number, ry: number, icon: (g: CanvasRenderingContext2D) => void): void {
    // Hang below everything on the ceiling (ducts from 8.8 m, cable trays, lamps, beams).
    y = Math.min(y, SIGN_MAX_Y);
    // A framed sign: printed faces on both sides, an aluminium edge and two hanging eyes.
    const face = new THREE.MeshBasicMaterial({ map: signTex(text, color, icon) });
    litPaper(face);
    if (!this.signEdge) {
      this.signEdge = new THREE.MeshBasicMaterial({ color: 0xc3c8ce });
      litPaper(this.signEdge);
    }
    const edge = this.signEdge;
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.9, 1.3, 0.08), [edge, edge, edge, edge, face, face]);
    board.position.set(x, y, z);
    board.rotation.y = ry;
    this.put(board);
    this.inkify(board);
    for (const d of [-2, 2]) {
      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 12), edge);
      eye.position.set(x + Math.cos(ry) * d, y + 0.72, z - Math.sin(ry) * d);
      eye.rotation.y = ry;
      this.put(eye);
    }
    const pts: number[] = [];
    for (const d of [-2, 2]) {
      const cx = x + Math.cos(ry) * d;
      const cz = z - Math.sin(ry) * d;
      pts.push(cx, y + 0.6, cz, cx, HH, cz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.put(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: DAY.red })));
  }

  private buildCamera(): void {
    const fixed = (name: string, pos: V3, look: V3, dept?: string): Poi => ({
      name,
      dept,
      at: (p, l) => {
        p.copy(pos);
        l.copy(look);
        return true;
      },
    });
    const tmp = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    /** The loop position nearest to the camera, so a ride starts where we are. */
    const nearestS = (): number => {
      const c = this.camera.position;
      let best = 0;
      let bd = Infinity;
      for (let s = 0; s < LOOP_LEN; s++) {
        loopAt(s, tmp, tan);
        const d = (tmp.x - c.x) ** 2 + (tmp.z - c.z) ** 2;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best;
    };
    // What the moving stops have chosen to look at (set by their `pick`).
    let lapS = 0;
    let chuteK = 0;
    let dockK = 0;
    let stationK = 0;
    let panX = 0;
    let panDir = 1;
    let boxBin = 0;
    let rideOff = 0;
    let liftK = 0;
    let liftHadJob = false;
    let botK = -1;
    let botDropping = false;
    /** The truck behind a north dock door. */
    const truckAt = (x: number) => this.trucks.docks.find((d) => d.x === x && d.wallZ === NZ);
    // The robot floor, for the top-down pan: east–west extent and its middle (north–south).
    const FX0 = PAN_X0;
    const FX1 = PAN_X1;
    this.pois = [
      { ...fixed('infeeds', v(-33, 7.4, -17), v(-40, 3.6, -9.5), 'Infeed'), hover: 'still' },
      fixed('scan tunnels', v(-36, 4.2, -22), v(-44, 1.4, -30.5), 'Scanning'),
      {
        // One lap above the inside edge of the loop, at cruise height, looking ahead and down.
        name: 'loop',
        dept: 'Sorter loop',
        hover: 'track',
        rate: 4,
        dwell: Math.ceil(LOOP_LEN / LAP_M),
        pick: () => {
          lapS = nearestS();
        },
        at: (p, l, since) => {
          const s = lapS + since * LAP_M;
          loopAt(s, p, tan);
          outward(tan, nrm);
          p.addScaledVector(nrm, -3).setY(CRUISE_Y);
          loopAt(s + 14, l, tan);
          l.setY(2.5);
          return true;
        },
      },
      {
        // The chute that last took a parcel off the loop: from beyond its foot, looking back up it.
        name: 'chutes',
        dept: 'Chutes',
        hover: 'still',
        pick: () => {
          chuteK = this.lastChute;
        },
        next: (since) => since > 8 && this.lastChute !== chuteK,
        at: (p, l) => {
          const path = this.chutes[chuteK]?.path;
          if (!path) return false;
          const a = path.pts[0]!;
          const b = path.pts[path.pts.length - 1]!;
          const d = tmp.set(b.x - a.x, 0, b.z - a.z).normalize();
          l.lerpVectors(a, b, 0.55);
          l.y = Math.max(1.4, l.y);
          p.copy(b).addScaledVector(d, 7);
          p.x += -d.z * 4;
          p.z += d.x * 4;
          p.y = 5;
          return true;
        },
      },
      {
        // The busiest dock (long belt queue, full cages, truck about to leave): its worker, cages and trailer.
        name: 'docks',
        dept: 'Docks',
        hover: 'arc',
        pick: () => {
          let best = -Infinity;
          this.docks.docks.forEach((d, i) => {
            const tr = truckAt(d.x);
            const away = tr && tr.state !== 'open' && tr.state !== 'cleardown';
            const score = d.queue.length + 6 * this.docks.cageFill(d.x) + (tr?.state === 'cleardown' ? 4 : 0) - (away ? 20 : 0);
            if (score > best) {
              best = score;
              dockK = i;
            }
          });
        },
        // When its truck leaves, go to the next busiest.
        next: (since) => {
          const d = this.docks.docks[dockK];
          return since > 4 && !!d && truckAt(d.x)?.state === 'leaving';
        },
        at: (p, l) => {
          const d = this.docks.docks[dockK];
          if (!d) return false;
          p.set(d.x + 2, 3.8, -22);
          l.set(d.x, 1.2, -31);
          return true;
        },
      },
      // Square on to the rack (the lift is in the middle of it).
      { ...fixed('store', v(LIFT_X - 12, 5.5, 0), v(RACK_X0, 5, 0), 'Storage'), hover: 'still' },
      {
        // The pickup table with the longest queue.
        name: 'pickup stations',
        dept: 'Robot stations',
        pick: () => {
          let best = -1;
          this.stationQueue.forEach((q, i) => {
            if (q.length > best) {
              best = q.length;
              stationK = i;
            }
          });
        },
        at: (p, l) => {
          const st = this.floor.stations[stationK];
          if (!st) return false;
          l.set(st.x, 1.2, st.z);
          p.set(st.x + 3, 4.2, st.z - 6.5);
          return true;
        },
      },
      {
        // High above the robot floor, looking down, panning slowly from end to end (parking included).
        name: 'bins',
        dept: 'Robot floor',
        hover: 'track',
        rate: 3,
        dwell: 32,
        pick: () => {
          panX = clamp(this.camera.position.x, FX0, FX1);
          panDir = panX - FX0 < FX1 - panX ? 1 : -1;
        },
        at: (p, l, since) => {
          const span = FX1 - FX0;
          const u = (((panX - FX0) * panDir + since * PAN_M) % (2 * span) + 2 * span) % (2 * span);
          const f = u > span ? 2 * span - u : u;
          const x = panDir > 0 ? FX0 + f : FX1 - f;
          p.set(x, FLY_MAX_Y - 0.1, PAN_Z - 1.2);
          l.set(x, 0, PAN_Z + 0.6);
          return true;
        },
      },
      {
        // Over the worker's shoulder, towards the pigeonholes.
        name: 'manual sorting',
        dept: 'Manual sorting',
        hover: 'still',
        at: (p, l) => {
          const x = this.manual.workerX();
          p.set(x - 0.6, 2.6, MANUAL_TABLE.z + 0.2);
          l.set(x + 0.2, 1.3, MANUAL_TABLE.z + 2.7);
          return true;
        },
      },
      { ...fixed('control room', v(-48, 2.85, 17.2), v(-48, 2.75, 21.6), 'Control room'), hover: 'still' },
      {
        // The box door where a forklift is swapping a box (or the fullest box).
        name: 'boxes',
        dept: 'Boxes & trucks',
        pick: () => {
          const f = this.yard.lifts.find((x) => x.job !== null);
          if (f) boxBin = f.job!;
          else {
            let best = -1;
            this.floor.bins.forEach((b, i) => {
              if (b.vol > best) {
                best = b.vol;
                boxBin = i;
              }
            });
          }
        },
        next: (since) => since > 8 && !this.yard.lifts.some((x) => x.job === boxBin),
        at: (p, l) => {
          const b = this.floor.bins[boxBin];
          if (!b) return false;
          l.set(b.x, 0.8, 32);
          p.set(b.x - 4, 4.2, 25.5);
          return true;
        },
      },
      {
        // Round the crowd, a step on every beat (a turn per 16 bars), inside the loop.
        name: 'dance floor',
        dept: 'Dance floor',
        when: 'night',
        hover: 'track',
        rate: 2,
        at: (p, l) => {
          const b = Math.floor(this.bt);
          const a = (b + easeIO(this.bt - b)) * ((Math.PI * 2) / 64);
          l.set(LCX - 10, 1.2, 0);
          p.set(l.x + Math.cos(a) * 22, 6.5, Math.sin(a) * 5.5);
          return true;
        },
      },
      // Behind the DJ, over the shoulder: the decks and the crowd beyond.
      { ...fixed('dj', v(PLATFORM_X - 2.0, PLATFORM_Y + 1.95, 0.45), v(PLATFORM_X + 2.4, PLATFORM_Y + 0.9, -0.15)), hover: 'still', when: 'night' },
      fixed('break', v(-29, 3.2, 26.8), v(-36.5, 0.8, 31.2)),
      {
        // Standing on a tray: eye height above it, at tray speed, looking ahead.
        name: 'loop ride',
        dept: 'Ride the loop',
        hover: 'track',
        rate: 14,
        dwell: 48,
        pick: () => {
          rideOff = Math.round(nearestS() - this.ct * BEAT_M);
        },
        at: (p, l) => {
          const s = this.ct * BEAT_M + rideOff;
          loopAt(s, p, tan);
          p.y = LOOP_Y + 1.6;
          loopAt(s + 10, l, tan);
          l.y = LOOP_Y + 0.9;
          return true;
        },
      },
      {
        // Behind a forklift on a job; on to the next one when it is done.
        name: 'forklift',
        dept: 'Forklifts',
        hover: 'track',
        rate: 4,
        dwell: 24,
        pick: () => {
          const i = this.yard.lifts.findIndex((x) => x.job !== null);
          liftK = Math.max(0, i);
          liftHadJob = i >= 0;
          const f = this.yard.lifts[liftK];
          if (f) this.chaseStart(f.g.position, f.yaw);
        },
        next: () => (liftHadJob ? this.yard.lifts[liftK]?.job === null : this.yard.lifts.some((x) => x.job !== null)),
        at: (p, l) => {
          const f = this.yard.lifts[liftK];
          if (!f) return false;
          this.chase(tmp.copy(f.g.position).setY(1.4), 5, 2.4, 0.35, 1, p, l);
          return true;
        },
      },
      {
        // Behind a robot from its pickup to its drop, then the next robot.
        name: 'robot',
        dept: 'Ride a robot',
        hover: 'track',
        rate: 4,
        dwell: 24,
        pick: () => {
          const bots = this.floor.fleet.bots;
          const busy = bots.filter((b) => b.state === 'toDrop' || b.state === 'toPick');
          const b = busy[this.tourRobot++ % Math.max(1, busy.length)] ?? bots[0];
          botK = b ? b.k : -1;
          botDropping = false;
          if (b) this.chaseStart(tmp, this.floor.robotTop(b.k, tmp));
        },
        next: (since) => {
          const bots = this.floor.fleet.bots;
          const b = bots.find((x) => x.k === botK);
          if (!b) return true;
          if (b.state === 'toDrop') botDropping = true;
          const working = (x: typeof b) => x.state === 'toPick' || x.state === 'toDrop';
          // Parked with nothing to do (at start-up): go to one that is working, once there is one.
          if (!botDropping && !working(b)) return since > 4 && bots.some(working);
          return botDropping && b.state !== 'toDrop';
        },
        at: (p, l) => {
          if (botK < 0) return false;
          this.floor.robotTop(botK, tmp);
          tmp.y = 0.9;
          this.chase(tmp, 3, 1.6, 0.3, 2, p, l);
          return true;
        },
      },
    ];
    this.camera.position.set(-50, 6, -20);
  }

  /** The chase camera (robots, forklifts): its direction of travel and where the thing was last frame. */
  private chaseFwd = new THREE.Vector3(1, 0, 0);
  private chaseLast = new THREE.Vector3();
  private chaseVel = new THREE.Vector3();
  private chaseDt = 0;
  /** Index of the chute (0–39) that last took a parcel off the loop. */
  private lastChute = 0;

  private chaseStart(at: V3, yaw: number): void {
    this.chaseLast.copy(at);
    this.chaseFwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  }

  /** Behind a moving thing at `c` and a little to the side, looking where it goes; `turn` is how fast the view swings round. */
  private chase(c: V3, back: number, up: number, side: number, turn: number, pos: V3, look: V3): void {
    const vel = this.chaseVel.copy(c).sub(this.chaseLast).setY(0);
    this.chaseLast.copy(c);
    if (this.chaseDt > 0 && vel.lengthSq() > 1e-6) this.chaseFwd.lerp(vel.normalize(), 1 - Math.exp(-this.chaseDt * turn)).normalize();
    const f = this.chaseFwd;
    pos.copy(c).addScaledVector(f, -back);
    pos.x += -f.z * back * side;
    pos.z += f.x * back * side;
    pos.y = c.y + up;
    look.copy(c).addScaledVector(f, 2);
  }

  private tourRobot = 0;
  /**
   * Conveyor clock: beats of the belts and the loop. It runs at `speed` times the
   * music, so belts can run faster (or slower) and still land on 8th or 16th notes.
   * Parcels on belts and the loop are timed in this clock; robots, people, lifts and
   * lights stay on the music's beat (`bt`).
   */
  private ct = 0;
  private lastCt = NaN;
  private speed = 1;
  private visitPoi = 0;

  /** Dock doors 1–40 for the cleardown panel: destination, postcodes and what the truck is doing. */
  doors(): { number: number; city: string; pc: string; state: string; load: number; cap: number; fill: number }[] {
    return this.trucks.list();
  }

  /** Start a cleardown at these doors (numbers 1–40): the trucks leave with what they have. */
  cleardown(numbers: number[]): void {
    const list = this.trucks.list();
    this.trucks.cleardown(numbers.map((n) => list.findIndex((d) => d.number === n)).filter((i) => i >= 0), this.bt);
  }

  /** Hall sounds since the last call, with a volume by distance from the camera. */
  takeSounds(): { kind: 'horn' | 'beep' | 'buzz'; vol: number }[] {
    const out: { kind: 'horn' | 'beep' | 'buzz'; vol: number }[] = [];
    const cam = this.camera.position;
    for (const list of [this.trucks.sounds, this.yard.sounds] as { kind: 'horn' | 'beep' | 'buzz'; at: V3 }[][]) {
      for (const sd of list) {
        const vol = 1 - cam.distanceTo(sd.at) / 40;
        if (vol > 0.05 && out.length < 4 && !out.some((o) => o.kind === sd.kind)) out.push({ kind: sd.kind, vol });
      }
      list.length = 0;
    }
    return out;
  }

  /** How loud the belts hum: with belt speed and how busy the hub is. */
  humLevel(): number {
    return Math.min(1, 0.35 + 0.15 * this.speed) * (this.dayShown === false ? 0.5 : 1);
  }

  /** Which parcel is under this screen point (null if none). */
  pickParcel(clientX: number, clientY: number): Parcel | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    let best: Parcel | null = null;
    let bd = Infinity;
    this.shapes.forEach((set, k) => {
      // (Instances move every frame: the bounds are worked out afresh.)
      set.mesh.boundingSphere = null;
      for (const hit of this.ray.intersectObject(set.mesh, false)) {
        const p = hit.instanceId !== undefined ? this.instParcels[k]![hit.instanceId] : undefined;
        if (p && !p.dead && hit.distance < bd) {
          bd = hit.distance;
          best = p;
        }
      }
    });
    return best;
  }

  /**
   * The robot, forklift or person nearest this screen point (within a few dozen pixels of
   * where it shows), or null. Only things in the current look (day or night) count.
   */
  pickThing(clientX: number, clientY: number): { obj: THREE.Object3D; h: number; kind: 'robot' | 'forklift' | 'person'; name: string } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const shown = (o: THREE.Object3D | null): boolean => {
      for (let x = o; x; x = x.parent) if (!x.visible) return false;
      return true;
    };
    const cands: { obj: THREE.Object3D; h: number; kind: 'robot' | 'forklift' | 'person'; name: string }[] = [
      ...this.floor.robots.map((r) => ({ obj: r.g as THREE.Object3D, h: 0.6, kind: 'robot' as const, name: `robot ${r.num}` })),
      ...FORKLIFTS.map((g) => ({ obj: g, h: 2.0, kind: 'forklift' as const, name: 'a forklift' })),
      ...HUMANS.filter((r) => !FORKLIFTS.some((f) => f === r.parent)).map((r) => ({ obj: r, h: 1.75, kind: 'person' as const, name: 'a person' })),
    ];
    let best: (typeof cands)[number] | null = null;
    let bd = 48;
    const w = this.p;
    for (const c of cands) {
      if (!c.obj.parent || !shown(c.obj)) continue;
      // Test the middle and the top of it, so a click anywhere on it counts.
      for (const f of [0.3, 0.8]) {
        c.obj.getWorldPosition(w);
        w.y += c.h * f;
        const dist = w.distanceTo(this.camera.position);
        w.project(this.camera);
        if (w.z > 1 || w.z < -1) continue;
        const sx = rect.left + ((w.x + 1) / 2) * rect.width;
        const sy = rect.top + ((1 - w.y) / 2) * rect.height;
        // (Nearer things count a little more, so the one in front wins.)
        const d = Math.hypot(sx - clientX, sy - clientY) * (0.8 + dist / 120);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
    }
    return best;
  }

  /** Follow a robot, forklift or person with the camera. */
  followObject(t: { obj: THREE.Object3D; h: number; kind: 'robot' | 'forklift' | 'person'; name: string }): void {
    if (this.camMode === 'walk') return;
    this.camMode = 'follow';
    this.follow = null;
    this.autoFollow = false;
    this.followThing = { ...t, last: t.obj.getWorldPosition(new THREE.Vector3()) };
  }

  /** Follow this parcel with the camera (after clicking it). */
  followParcel(p: Parcel): void {
    this.followThing = null;
    // (Not one resting in the store rack: the camera would only stand there.)
    if (p.mode === 'fixed' || p.mode === 'held') return;
    if (this.camMode !== 'follow' && this.camMode !== 'auto') this.camMode = 'follow';
    this.follow = p;
    this.autoFollow = true;
  }

  /** What its label says, and where it is now. */
  parcelInfo(p: Parcel): { id: string; address: Address; route: string; where: string; kg: string; size: string; noread: boolean; note: string; tags: Tag[] } {
    const city = CITIES.find((c) => c.pc.some(([a, b]) => p.pc >= a && p.pc <= b))?.name ?? '';
    const north = NORTH_CITIES.findIndex((c) => c.name === city);
    const south = SOUTH_CITIES.findIndex((c) => c.name === city);
    const door = [...this.dockOf.keys()].indexOf(p.dest);
    const route = north >= 0 ? `Door ${door >= 0 ? door + 1 : DOCK_CITY.indexOf(north) + 1} · chute ${p.dest + 1}` : south >= 0 ? `Door ${21 + south} · robots` : 'Store';
    const cm = (x: number) => Math.round(x * 100);
    // Weighed and measured at the infeed: actual, volumetric (L×W×H cm / 5000) and the one charged.
    const vol = (cm(p.d) * cm(p.w) * cm(p.h)) / 5000;
    const kg = `${p.kg.toFixed(1)} kg (vol ${vol.toFixed(1)})`;
    const note =
      p.reason === 'oversize' ? 'Too big or heavy for the sorter: to manual sorting' : p.reason === 'overflow' ? `Its chute stayed full (${p.laps ?? 0} rounds): to manual sorting` : p.noread ? 'Label could not be read: to manual sorting' : p.missorted ? 'Sent to the wrong dock by mistake: it will go back' : '';
    return {
      id: String(p.id).padStart(8, '0'),
      address: addressFor(p.id, p.pc, city),
      route,
      where: this.parcelWhere(p),
      kg,
      size: `L ${cm(p.d)} × B ${cm(p.w)} × H ${cm(p.h)} cm`,
      noread: !!p.noread,
      note,
      tags: p.tags,
    };
  }

  private parcelWhere(p: Parcel): string {
    if (p.dead) return 'Gone with the truck';
    switch (p.mode) {
      case 'path':
        return p.pathKind === 'lane' ? (p.scanned ? 'On the infeed, scanned' : 'On the infeed') : p.pathKind === 'chute' ? 'Down its chute' : p.pathKind === 'dock' ? 'On the belt to its dock' : p.pathKind === 'reject' ? 'To manual sorting' : 'To or from the store';
      case 'loop':
        return (p.laps ?? 0) > 0 ? `On the sorter (round ${(p.laps ?? 0) + 1}: its chute was full)` : 'On the sorter';
      case 'table':
        return 'Waiting for a robot';
      case 'robot':
        return `On robot ${this.floor.robotNumber(p.bot!)}`;
      case 'dock':
        return 'With the dock worker';
      case 'held':
        return p.holder && this.floor.bins.some((b) => b.g === p.holder) ? 'In a box, for the truck' : 'In a roll cage, for the truck';
      case 'manual':
        return 'At manual sorting';
      default:
        return p.buffered !== undefined ? `In the buffer store: chute ${p.buffered + 1} is full; it comes back out when there is room` : 'In the store';
    }
  }

  /** Hub time now, in minutes since midnight (a beat is a quarter of a minute). */
  hubTime(): number {
    return HUB_START + this.bt * HUB_MIN_PER_BEAT;
  }

  /** The hub's figures. */
  readonly kpi = new Kpi();

  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly instParcels: Parcel[][] = [[], [], []];

  setRate(perMin: number): void {
    this.rate = clamp(perMin, 0, Sorter.MAX_RATE);
  }

  /** Departments the camera can go to. */
  departments(): { id: string; label: string }[] {
    return this.pois.filter((p) => p.dept).map((p) => ({ id: p.name, label: p.dept! }));
  }

  /** Fly to (or with `jump`, appear at) a department and stay there (turning slowly) until another camera mode is chosen. */
  visit(id: string, jump = false): void {
    const k = this.pois.findIndex((p) => p.name === id);
    if (k < 0) return;
    this.visitPoi = k;
    const poi = this.pois[k]!;
    if (jump) {
      poi.pick?.();
      if (poi.at(this.want, this.wantLook, 0)) {
        // Straight there (start-up and screenshots): no flight.
        this.camera.position.copy(this.want);
        this.look.copy(this.wantLook);
        this.camera.lookAt(this.look);
        this.tour = { poi: k, curve: new THREE.CatmullRomCurve3([this.want.clone(), this.want.clone().add(v(0, 0.1, 0))]), len: 0.01, s: 0.01, lookFrom: this.wantLook.clone(), dwell: poi.dwell ?? 8, arrivedAt: this.bt, offset: new THREE.Vector3().subVectors(this.want, this.wantLook) };
      } else this.tour = null;
    }
    this.camMode = 'visit';
    this.follow = null;
    this.autoFollow = false;
  }

  /** The department being visited, if any. */
  visiting(): string | null {
    return this.camMode === 'visit' ? this.pois[this.visitPoi]!.name : null;
  }

  cameraMode(): CamMode {
    return this.camMode;
  }

  /** How quickly the camera catches up with where the tour wants it (per second). */
  private camRate = 1.2;

  /** Fly mode: travel at cruise height to a random stop, hover and look around, then on to the next. */
  private flyTour(dt: number, travel: number): void {
    const t = this.tour;
    this.camRate = 1.2;
    this.chaseDt = dt;
    const speed = 6.5 * clamp(travel / 0.4, 0.4, 2.5);
    const staying = this.camMode === 'visit' && t?.poi === this.visitPoi;
    const since = t && t.s >= t.len ? this.bt - t.arrivedAt : 0;
    const moveOn = !t
      || (this.camMode === 'visit' && t.poi !== this.visitPoi)
      || (staying ? t.s >= t.len && !!this.pois[t.poi]!.next?.(since) : t.s >= t.len && since > t.dwell);
    if (moveOn) {
      this.planTour(t);
      return this.flyTour(dt, travel);
    }
    const poi = this.pois[t.poi]!;
    const pos = this.p;
    const look = this.n;
    if (!poi.at(pos, look, since)) {
      this.tour = null;
      return;
    }
    if (t.s < t.len) {
      t.s = Math.min(t.len, t.s + speed * dt);
      const u = t.s / t.len;
      t.curve.getPointAt(u, this.want);
      // Look ahead along the way, then settle on the stop.
      t.curve.getPointAt(Math.min(1, u + 0.08), this.wantLook);
      this.wantLook.y -= 1.5;
      const settle = smooth01((u - 0.55) / 0.45);
      this.wantLook.lerp(look, settle);
      if (u < 0.2) this.wantLook.lerp(t.lookFrom, 1 - u / 0.2);
      // The curve ends where the stop was when we set off; if it moves (a ride, a robot), close in on where it is now.
      this.want.lerp(pos, smooth01((u - 0.6) / 0.4));
      if (t.s >= t.len) {
        t.arrivedAt = this.bt;
        t.offset.subVectors(pos, look);
      }
      return;
    }
    const hover = poi.hover ?? 'orbit';
    if (hover === 'still' || hover === 'track') {
      // Hold the view the stop gives (following it if it moves).
      this.want.copy(pos);
      this.camRate = poi.rate ?? (hover === 'track' ? 4 : 1.2);
    } else {
      // Turn around what we look at: all the way round slowly, or a gentle swing to and fro.
      const a = hover === 'arc' ? 0.35 * Math.sin((since * Math.PI * 2) / 32) : since * 0.04;
      this.want.copy(t.offset).applyAxisAngle(UP, a).add(look);
      this.camRate = poi.rate ?? 1.2;
    }
    this.wantLook.copy(look);
  }

  private planTour(prev: Tour | null): void {
    const from = this.camera.position.clone();
    const lookFrom = prev ? this.wantLook.clone() : v(0, 2, 0);
    let k = 0;
    if (this.camMode === 'visit') k = this.visitPoi;
    else {
      // Only stops that belong to the look on screen (no empty DJ booth by day).
      const night = this.isNight();
      const ok = this.pois.map((_, i) => i).filter((i) => {
        const w = this.pois[i]!.when;
        return !w || (w === 'night') === night;
      });
      const fresh = ok.filter((i) => !this.recent.includes(i));
      k = pick(fresh.length ? fresh : ok);
    }
    this.recent.push(k);
    if (this.recent.length > 5) this.recent.shift();
    const poi = this.pois[k]!;
    poi.pick?.();
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (!poi.at(pos, look, 0)) pos.copy(from);
    const pts = [from];
    const flat = Math.hypot(pos.x - from.x, pos.z - from.z);
    if (flat > 12) {
      // Up to cruise height, across, and down to the stop; around obstacles.
      const dir = this.t.set(pos.x - from.x, 0, pos.z - from.z).normalize();
      const a = from.clone().addScaledVector(dir, 3).setY(CRUISE_Y);
      const b = pos.clone().addScaledVector(dir, -5).setY(CRUISE_Y);
      pts.push(a);
      for (const [ox, oz, r] of TOUR_OBSTACLES) {
        const ab = this.n.set(b.x - a.x, 0, b.z - a.z);
        const l2 = ab.lengthSq();
        const f = clamp(((ox - a.x) * ab.x + (oz - a.z) * ab.z) / (l2 || 1), 0, 1);
        const cx = a.x + ab.x * f;
        const cz = a.z + ab.z * f;
        const d = Math.hypot(cx - ox, cz - oz);
        if (d < r && f > 0.05 && f < 0.95) {
          const side = Math.sign((cx - ox) * -dir.z + (cz - oz) * dir.x) || 1;
          pts.push(v(ox - dir.z * side * (r + 1.5), CRUISE_Y, oz + dir.x * side * (r + 1.5)));
        }
      }
      pts.push(b);
    } else pts.push(from.clone().lerp(pos, 0.5).setY(Math.min(FLY_MAX_Y, Math.max(from.y, pos.y) + 1.5)));
    pts.push(pos);
    // Drop points that coincide (a zero-length curve has no points to sample).
    const clean = pts.filter((p, n) => n === 0 || p.distanceTo(pts[n - 1]!) > 0.05);
    if (clean.length < 2) clean.push(pos.clone().add(this.t.set(0, 0.1, 0)));
    const curve = new THREE.CatmullRomCurve3(clean, false, 'centripetal');
    const len = curve.getLength();
    this.tour = { poi: k, curve, len: Number.isFinite(len) && len > 0.01 ? len : 0.01, s: 0, lookFrom, dwell: poi.dwell ?? 6 + Math.floor(Math.random() * 6), arrivedAt: 0, offset: new THREE.Vector3() };
    if (!(len > 0.01)) {
      // Already there: hover.
      this.tour.s = this.tour.len;
      this.tour.arrivedAt = this.bt;
      this.tour.offset.subVectors(pos, look);
    }
  }
}
