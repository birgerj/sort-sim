// The realistic day look ("Day", next to the flat "Minimal" day and the night).
//
// Same hall, same objects, but lit like a photo instead of drawn: no toon
// steps and no ink, an image-based environment so metal and plastic reflect
// the hall, filmic tone mapping, a worn concrete floor, lit wall cladding,
// and soft shafts of daylight under the roof lights.
//
// Everything here is generated in code (canvases and small shaders): no image
// files to ship, and nothing that costs CPU per frame.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { canvasTexture } from './textures';
import { RL_D, RL_W, type RoofLight } from './roof';

/** Seeded random numbers, so the floor looks the same on every load. */
function rnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Metres covered by one floor tile (2 × 2 slabs of 6 m). */
export const FLOOR_TILE_M = 12;
const PX = 1024;
const M = PX / FLOOR_TILE_M;

/**
 * Worn industrial concrete: aggregate speckle, trowel marks, saw-cut joints
 * every 6 m, hairline cracks, oil stains and tyre marks. Drawn twice with the
 * same seed: once as colour, once as roughness (stains and wheel tracks are
 * smoother, the joints rougher).
 */
function drawConcrete(g: CanvasRenderingContext2D, rough: boolean): void {
  const r = rnd(7);
  // Base and fine grain.
  const id = g.createImageData(PX, PX);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = r();
    const v = rough ? 150 + (n - 0.5) * 40 : 168 + (n - 0.5) * 22 + (n > 0.985 ? -40 : 0) + (n < 0.01 ? 30 : 0);
    id.data[i] = v;
    id.data[i + 1] = rough ? v : v + 1;
    id.data[i + 2] = rough ? v : v + 3;
    id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  // Mottling and trowel swirls.
  for (let k = 0; k < 140; k++) {
    const x = r() * PX;
    const y = r() * PX;
    const rad = 20 + r() * 120;
    const dark = r() < 0.55;
    const a = rough ? 0.05 : 0.035;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, dark ? `rgba(60,60,64,${a})` : `rgba(255,255,255,${a})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let k = 0; k < 60; k++) {
    g.strokeStyle = rough ? 'rgba(90,90,90,0.08)' : 'rgba(255,255,255,0.05)';
    g.lineWidth = 1 + r() * 2;
    g.beginPath();
    const x = r() * PX;
    const y = r() * PX;
    g.arc(x, y, 30 + r() * 90, r() * 6, r() * 6 + 1.5);
    g.stroke();
  }
  // Tyre marks: long faint arcs from forklifts and the scrubber, polished smooth.
  for (let k = 0; k < 10; k++) {
    // Wide turns only: tight rings repeat visibly across the tiles.
    const x = r() * PX;
    const y = r() * PX;
    const rad = 900 + r() * 1600;
    const a0 = r() * 6.28;
    const w = 0.12 * M + r() * 0.1 * M;
    for (const off of [0, 0.95 * M]) {
      g.strokeStyle = rough ? 'rgba(70,70,70,0.18)' : `rgba(40,40,44,${0.02 + r() * 0.03})`;
      g.lineWidth = w;
      g.beginPath();
      g.arc(x, y, rad + off, a0, a0 + 0.4 + r() * 0.8);
      g.stroke();
    }
  }
  // Oil and water stains.
  for (let k = 0; k < 5; k++) {
    const x = r() * PX;
    const y = r() * PX;
    const rad = 0.2 * M + r() * 0.6 * M;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, rough ? 'rgba(40,40,40,0.5)' : 'rgba(30,28,26,0.14)');
    gr.addColorStop(0.7, rough ? 'rgba(40,40,40,0.2)' : 'rgba(30,28,26,0.05)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x, y, rad, rad * (0.5 + r() * 0.5), r() * 3, 0, 7);
    g.fill();
  }
  // Hairline cracks, mostly from the joints.
  g.strokeStyle = rough ? 'rgba(230,230,230,0.6)' : 'rgba(70,70,74,0.45)';
  g.lineWidth = 1.2;
  for (let k = 0; k < 9; k++) {
    let x = r() < 0.5 ? (r() < 0.5 ? 0 : PX / 2) : r() * PX;
    let y = r() * PX;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 12; s++) {
      x += (r() - 0.3) * 18;
      y += (r() - 0.5) * 18;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // Saw-cut joints every 6 m (at the tile edge and the middle), slightly chipped.
  const joint = (horiz: boolean, p: number) => {
    g.strokeStyle = rough ? 'rgba(255,255,255,0.9)' : 'rgba(62,62,66,0.75)';
    g.lineWidth = 3;
    g.beginPath();
    if (horiz) {
      g.moveTo(0, p);
      g.lineTo(PX, p);
    } else {
      g.moveTo(p, 0);
      g.lineTo(p, PX);
    }
    g.stroke();
    g.strokeStyle = rough ? 'rgba(255,255,255,0.25)' : 'rgba(90,90,94,0.18)';
    g.lineWidth = 7;
    g.stroke();
  };
  for (const p of [1.5, PX / 2]) {
    joint(true, p);
    joint(false, p);
  }
}

export function realFloorMaps(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const map = canvasTexture('real-floor', PX, PX, (g) => drawConcrete(g, false));
  const rough = canvasTexture('real-floor-rough', PX, PX, (g) => drawConcrete(g, true), false);
  return { map, rough };
}

// Value noise and fbm in world space: large-scale dirt that never repeats with the texture.
const NOISE = /* glsl */ `
float rdHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rdNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rdHash(i), rdHash(i + vec2(1.0, 0.0)), f.x), mix(rdHash(i + vec2(0.0, 1.0)), rdHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float rdFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    s += a * rdNoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}
`;

/**
 * Grime that does not tile: darkens and roughens a material in large, soft
 * patches in world space. `plane` picks the two world axes the noise runs
 * over ('xz' floors, 'xy' or 'zy' walls); `foot` adds dirt near the floor.
 */
export function grime(m: THREE.MeshStandardMaterial, amount: number, scale: number, plane: 'xz' | 'xy' | 'zy', foot = 0): void {
  const axes = plane === 'xz' ? 'vRdW.xz' : plane === 'xy' ? 'vRdW.xy' : 'vRdW.zy';
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRdW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRdW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRdW;\n${NOISE}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          vec2 q = ${axes} / ${scale.toFixed(2)};
          float n = rdFbm(q) * 0.75 + rdFbm(q * 6.0) * 0.25;
          float d = smoothstep(0.35, 0.8, n);
          ${foot > 0 ? `d = max(d, (1.0 - smoothstep(0.0, ${foot.toFixed(2)}, vRdW.y)) * 0.8);` : ''}
          diffuseColor.rgb *= 1.0 - ${amount.toFixed(3)} * d;
          roughnessFactor = clamp(roughnessFactor + 0.15 * d - 0.08 * (1.0 - n), 0.04, 1.0);
        }`,
      );
  };
  m.customProgramCacheKey = () => `grime-${amount}-${scale}-${plane}-${foot}`;
}

/** A neutral, bright environment for reflections by day (generated, no HDR file). */
export function dayEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pm = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment(renderer);
  const tex = pm.fromScene(room, 0.04).texture;
  room.dispose();
  pm.dispose();
  return tex;
}

/**
 * Shafts of daylight under the roof lights: one slanted, soft-edged volume per
 * roof light, all in one mesh (one draw call), slanting with the sun. Faint
 * and additive: they read as light in dusty air.
 */
export function lightShafts(lights: RoofLight[], roofY: number, sun: THREE.Vector3): THREE.Mesh {
  const dir = sun.clone().normalize();
  // Where the shaft from the roof (y) meets the floor (0): move against the sun.
  const shift = new THREE.Vector2(-dir.x / dir.y, -dir.z / dir.y).multiplyScalar(roofY);
  const geos: THREE.BufferGeometry[] = [];
  for (const l of lights) {
    const g = new THREE.BoxGeometry(RL_W, roofY, RL_D, 1, 1, 1);
    g.translate(0, roofY / 2, 0);
    const p = g.attributes.position!;
    const h = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const t = 1 - y / roofY; // 0 at the roof, 1 at the floor
      p.setX(i, p.getX(i) + l.x + shift.x * t);
      p.setZ(i, p.getZ(i) + l.z + shift.y * t);
      h[i] = y / roofY;
    }
    g.setAttribute('h', new THREE.BufferAttribute(h, 1));
    g.deleteAttribute('normal');
    geos.push(g);
  }
  const merged = mergeSimple(geos);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 0.18 }, uCol: { value: new THREE.Color(1.0, 0.96, 0.86) } },
    vertexShader: /* glsl */ `
      attribute float h;
      varying float vH;
      varying vec2 vUv;
      void main() {
        vH = h;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      uniform vec3 uCol;
      varying float vH;
      varying vec2 vUv;
      void main() {
        // Soft at the sides of each face, strongest under the roof, gone at the floor.
        float side = sin(3.14159 * vUv.x) * sin(3.14159 * clamp(vUv.y, 0.0, 1.0) * 0.999 + 0.0005);
        float a = uStrength * pow(side, 1.5) * smoothstep(0.0, 0.7, vH) * (0.35 + 0.65 * vH);
        gl_FragColor = vec4(uCol * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.userData.noInk = true;
  mesh.renderOrder = 5;
  return mesh;
}

/** Merge non-indexed-compatible box geometries (position, uv, h) into one. */
function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => g.toNonIndexed());
  const total = parts.reduce((a, g) => a + g.attributes.position!.count, 0);
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['uv', 2], ['h', 1]] as const) {
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of parts) {
      const a = g.attributes[name]!.array as Float32Array;
      arr.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

/** A way that wheels take often: floor points (x, z) and how worn it is (0…1). */
export interface TrackPath {
  pts: [number, number][];
  wear?: number;
}

/** How a kind of vehicle marks the floor. */
export interface TrackStyle {
  /** Distance between the wheel lines (m). */
  gauge: number;
  /** Width of one wheel line (m). */
  line: number;
  /** Darkness of a wheel line and of the scuffed band between them, at full wear. */
  lineA: number;
  bandA: number;
  /** Times each path is laid, and how far each pass strays sideways (m). */
  passes: number;
  scatter: number;
}

/** Roll cages: castors 0.9 m apart, pushed by hand, so the passes wander. */
export const CAGE_TRACKS: TrackStyle = { gauge: 0.9, line: 0.08, lineA: 0.16, bandA: 0.035, passes: 3, scatter: 0.16 };
/** Floor robots: two drive wheels close together, driven on a grid, so the passes hardly wander. */
export const ROBOT_TRACKS: TrackStyle = { gauge: 0.42, line: 0.07, lineA: 0.5, bandA: 0.09, passes: 2, scatter: 0.05 };

/**
 * Wheel marks: rubber and dirt left on the concrete where wheels run often, two
 * lines per path and a faint scuffed band between them. Every path is laid a few
 * times with a small sideways scatter, so ways that many share get the darkest.
 * One mesh, one draw call; it lies just above the floor.
 */
export function wheelTracks(paths: TrackPath[], style: TrackStyle, seed = 11): THREE.Mesh {
  const r = rnd(seed);
  const pos: number[] = [];
  const uv: number[] = [];
  const alpha: number[] = [];
  const strip = (pts: [number, number][], off: number, w: number, a: number) => {
    // Corners turn as a swept arc in real life; a short cut across the corner is close enough.
    let along = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, z0] = pts[i]!;
      const [x1, z1] = pts[i + 1]!;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.01) continue;
      const nx = -(z1 - z0) / len;
      const nz = (x1 - x0) / len;
      const ax = x0 + nx * off;
      const az = z0 + nz * off;
      const bx = x1 + nx * off;
      const bz = z1 + nz * off;
      const h = w / 2;
      const quad = [
        [ax - nx * h, az - nz * h, along, 0],
        [ax + nx * h, az + nz * h, along, 1],
        [bx + nx * h, bz + nz * h, along + len, 1],
        [ax - nx * h, az - nz * h, along, 0],
        [bx + nx * h, bz + nz * h, along + len, 1],
        [bx - nx * h, bz - nz * h, along + len, 0],
      ];
      for (const [x, z, u, v] of quad) {
        pos.push(x!, 0.004, z!);
        uv.push(u!, v!);
        alpha.push(a);
      }
      along += len;
    }
  };
  for (const p of paths) {
    const wear = p.wear ?? 1;
    if (wear < 0.02) continue;
    for (let pass = 0; pass < style.passes; pass++) {
      const s = (r() - 0.5) * style.scatter;
      const h = style.gauge / 2;
      for (const side of [-h, h]) strip(p.pts, s + side, style.line * (0.85 + r() * 0.4), style.lineA * wear * (0.8 + r() * 0.35));
      strip(p.pts, s, style.gauge * 0.9, style.bandA * wear);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('a', new THREE.Float32BufferAttribute(alpha, 1));
  g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(0x2a2724) } },
    vertexShader: /* glsl */ `
      attribute float a;
      varying vec2 vUv;
      varying float vA;
      varying vec2 vW;
      void main() {
        vUv = uv;
        vA = a;
        vW = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol;
      varying vec2 vUv;
      varying float vA;
      varying vec2 vW;
      ${NOISE}
      void main() {
        // Soft edges across, broken up along the length (rubber doesn't lay down evenly).
        // The break-up runs in world space, so pieces of one way join without a seam.
        float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
        float n = rdFbm(vec2((vW.x + vW.y) * 1.3, vUv.y * 3.0));
        float a = vA * smoothstep(0.0, 0.6, across) * (0.35 + 0.65 * smoothstep(0.2, 0.7, n));
        gl_FragColor = vec4(uCol, a);
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const m = new THREE.Mesh(g, mat);
  m.userData.noInk = true;
  m.renderOrder = -1;
  return m;
}

/** How much of the realistic day is on screen (0 in the drawn day and at night); set by the scene. */
export const REAL = { value: 0 };

/**
 * Knocks and scuffs on painted safety steel (yellow guards, bollards, rails, red column
 * feet), only in the realistic day: chipped paint showing dark steel, mostly in the
 * bump zone near the floor, horizontal scrapes where pallets and cages rub along, and
 * dirt at the foot. Noise in world space, so it only suits things that stand still;
 * a material can opt out with `userData.noWear` (set before it first draws).
 */
export function wear(m: THREE.MeshStandardMaterial, amount = 1): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    if (m.userData.noWear) return;
    sh.uniforms.uReal = REAL;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWr;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vWr = (modelMatrix * wp).xyz;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uReal;\nvarying vec3 vWr;\n${NOISE}`)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        if (uReal > 0.001) {
          float k = uReal * ${amount.toFixed(2)};
          // Most knocks low down, where forks, cages and pallet corners hit.
          float low = 1.0 - smoothstep(0.15, 1.1, vWr.y);
          float n = rdFbm(vec2(vWr.x + vWr.z, vWr.y) * 16.0 + vec2(vWr.z * 5.3, 0.0));
          // Small flakes; more of them low down.
          float chip = smoothstep(0.7 - 0.1 * low, 0.74 - 0.1 * low, n);
          // Long horizontal scrapes.
          float s = rdNoise(vec2(vWr.y * 38.0, (vWr.x + vWr.z) * 0.6));
          float scrape = smoothstep(0.86, 0.93, s) * (0.4 + 0.6 * low);
          float bare = clamp(max(chip, scrape), 0.0, 1.0) * k;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.31, 0.3), bare);
          roughnessFactor = mix(roughnessFactor, 0.45, bare);
          metalnessFactor = mix(metalnessFactor, 0.7, bare);
          // Dirt and tyre rubber at the foot.
          float foot = 1.0 - smoothstep(0.0, 0.25, vWr.y);
          diffuseColor.rgb *= 1.0 - 0.35 * foot * k;
        }`,
      );
  };
  const key = m.customProgramCacheKey.bind(m);
  // (The opt-out is part of the key: otherwise a vehicle could share a worn program.)
  m.customProgramCacheKey = () => `${key()}-wear-${amount}-${m.userData.noWear ? 0 : 1}`;
}

/**
 * A light finish for the realistic day, as a camera would give it: the corners fall off
 * a little (vignette) and shadows lean cool while the light leans warm. One full-screen
 * pass, before tone mapping; off in the other looks.
 */
export function gradePass(): ShaderPass {
  const p = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uAmount: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uAmount;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        vec2 d = vUv - 0.5;
        float vig = 1.0 - 0.32 * smoothstep(0.2, 0.75, dot(d, d) * 2.0);
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 split = mix(vec3(0.97, 0.99, 1.04), vec3(1.03, 1.0, 0.96), smoothstep(0.05, 0.6, l));
        c.rgb = mix(c.rgb, c.rgb * split * vig, uAmount);
        gl_FragColor = c;
      }`,
  });
  p.enabled = false;
  return p;
}

/**
 * Wear that differs per tray of the sorter, only in the realistic day. Every tray gets its own
 * age from its instance number: a shade of grey of its own, rubber streaks across the plate
 * where parcels slide off sideways, scratches, dirt in the corners by the lips, and on some
 * a worn patch or a darker, newer replacement plate. All in the tray's own space, so it
 * rides along. (`gl_InstanceID`: WebGL 2.)
 */
export function trayWear(m: THREE.MeshStandardMaterial): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uReal = REAL;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTl;\nvarying float vTk;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTl = position;\nvTk = float(gl_InstanceID);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uReal;\nvarying vec3 vTl;\nvarying float vTk;\n${NOISE}`)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        if (uReal > 0.001) {
          float k = vTk;
          float r1 = rdHash(vec2(k, 1.7));
          float r2 = rdHash(vec2(k, 5.3));
          float r3 = rdHash(vec2(k, 9.1));
          float r4 = rdHash(vec2(k, 13.9));
          // Age 0 (new) … 1 (worn); a few trays are recent replacements.
          float age = r4 < 0.08 ? 0.05 : 0.25 + 0.75 * r1;
          vec2 q = vTl.xz;                   // x across the plate (the way parcels tip off), z along the loop
          vec3 col = diffuseColor.rgb * (0.86 + 0.24 * r2);
          col *= mix(vec3(1.0), vec3(1.03, 1.0, 0.95), r3);   // some greyer-brown, some bluer
          // Rubber and cardboard streaks across the plate, more on older trays.
          float st = rdNoise(vec2(q.y * 28.0 + k * 7.0, q.x * 1.5 + k));
          float streak = smoothstep(0.62, 0.9, st) * smoothstep(0.62, 0.2, abs(q.x)) * age;
          col *= 1.0 - 0.32 * streak;
          // Fine scratches across, catching the light.
          float sc = rdNoise(vec2(q.y * 55.0 + k * 3.0, q.x * 0.8 - k));
          float scratch = smoothstep(0.9, 0.97, sc) * age;
          col = mix(col, vec3(0.62, 0.64, 0.66), 0.35 * scratch);
          // A worn, polished patch where most parcels land.
          float worn = smoothstep(0.55, 0.0, length((q - vec2((r3 - 0.5) * 0.5, (r2 - 0.5) * 0.4)) * vec2(1.2, 2.0))) * step(0.55, r1);
          // Dirt in the corners along the lips and the plate's ends.
          float corner = max(smoothstep(0.45, 0.6, abs(q.x)), smoothstep(0.34, 0.44, abs(q.y)));
          float dirt = corner * (0.4 + 0.6 * rdFbm(q * 9.0 + k)) * age;
          col *= 1.0 - 0.4 * dirt;
          diffuseColor.rgb = mix(diffuseColor.rgb, col, uReal);
          roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor + 0.25 * dirt + 0.15 * streak - 0.2 * worn, 0.1, 1.0), uReal);
          metalnessFactor = mix(metalnessFactor, metalnessFactor + 0.15 * worn, uReal);
        }`,
      );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}-traywear`;
}

/**
 * Specks and stains on the belts, only in the realistic day: dark rubber and dirt specks, a few
 * larger grease marks and pale cardboard dust, in the belt texture's own space so they travel
 * with the belt. A faint shade that changes slowly over the hall keeps two belts from looking
 * alike. (The material needs a map: the belt texture.)
 */
export function beltWear(m: THREE.MeshStandardMaterial): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uReal = REAL;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBw;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vBw = (modelMatrix * wp).xz;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uReal;\nvarying vec2 vBw;\n${NOISE}`)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        #ifdef USE_MAP
        if (uReal > 0.001) {
          // u across the belt (0…1), v along it (one unit per 1.2 m, moving with the belt).
          vec2 b = vec2(vMapUv.x * 1.2, vMapUv.y * 1.2);
          float speck = smoothstep(0.9, 0.96, rdNoise(b * 46.0)) * step(0.45, rdNoise(b * 9.0 + 3.0));
          float dust = smoothstep(0.88, 0.95, rdNoise(b * 25.0 + 17.0));
          // Grease and rubber smears: long along the belt, short across.
          float grease = smoothstep(0.58, 0.75, rdFbm(b * vec2(4.0, 0.9) + 5.0));
          // Most dirt down the middle, where parcels ride.
          float mid = 1.0 - smoothstep(0.25, 0.5, abs(vMapUv.x - 0.5));
          vec3 col = diffuseColor.rgb;
          col *= 1.0 - 0.3 * speck;
          col = mix(col, vec3(0.6, 0.54, 0.46), 0.22 * dust * mid);
          col *= 1.0 - 0.28 * grease * (0.4 + 0.6 * mid);
          col *= 0.92 + 0.16 * rdFbm(vBw * 0.08);
          diffuseColor.rgb = mix(diffuseColor.rgb, col, uReal);
          roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor - 0.25 * grease + 0.1 * dust, 0.1, 1.0), uReal);
        }
        #endif`,
      );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}-beltwear`;
}

/** Where the light comes from in the realistic day (the baked sun's direction). */
const PAPER_SUN = new THREE.Vector3(50, 90, 60).normalize();

/**
 * Printed signs, boards and cards are drawn unlit (flat), which reads as glowing in a lit hall.
 * In the realistic day they take light like paper or painted metal: brighter facing the sun and
 * the roof lights, duller facing away. A fixed light (no lights in the shader, so no cost); off
 * in the other looks. Not for screens, lamps and projections: those do glow.
 */
export function litPaper(m: THREE.MeshBasicMaterial): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uReal = REAL;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vPaper;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 nrm = normal;
          #ifdef USE_INSTANCING
            nrm = mat3(instanceMatrix) * nrm;
          #endif
          vec3 wn = normalize(mat3(modelMatrix) * nrm);
          vec3 sun = vec3(${PAPER_SUN.x.toFixed(4)}, ${PAPER_SUN.y.toFixed(4)}, ${PAPER_SUN.z.toFixed(4)});
          // Facing either way counts (single planes, seen from both sides).
          vPaper = 0.5 + 0.3 * abs(dot(wn, sun)) + 0.12 * max(wn.y, 0.0);
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReal;\nvarying float vPaper;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, vPaper, uReal);');
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}-paper`;
}

/**
 * Soft pools of light on the floor under the ceiling's LED fixtures, for the realistic day: one
 * stretched, faint, additive patch per fixture, all in one mesh (one draw call). Real lights
 * would cost every material a light; this is only a picture of their light on the floor.
 */
export function lightPools(spots: [number, number][], w: number, d: number): THREE.Mesh {
  const geos = spots.map(([x, z]) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, 0.006, z));
  const pos: number[] = [];
  const uv: number[] = [];
  for (const g of geos) {
    const ng = g.toNonIndexed();
    pos.push(...(ng.attributes.position!.array as Float32Array));
    uv.push(...(ng.attributes.uv!.array as Float32Array));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(1.0, 0.97, 0.9) }, uStrength: { value: 0.07 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        vec2 q = (vUv - 0.5) * 2.0;
        float a = uStrength * pow(max(0.0, 1.0 - dot(q, q)), 2.0);
        gl_FragColor = vec4(uCol * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  const m = new THREE.Mesh(geo, mat);
  m.userData.noInk = true;
  m.renderOrder = -1;
  return m;
}

/**
 * Parcels in the realistic day: every box its own cardboard (from its colour, which stays with
 * it), from pale kraft to brown, a little worn at the edges and corners, a few scuffs and
 * crushed corners. In the box's own space, so it travels with it.
 */
export function parcelWear(m: THREE.MeshStandardMaterial): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uReal = REAL;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPw;\nvarying vec3 vPseed;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPw = position;\n#ifdef USE_INSTANCING_COLOR\nvPseed = instanceColor;\n#else\nvPseed = vec3(0.5);\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uReal;\nvarying vec3 vPw;\nvarying vec3 vPseed;\n${NOISE}`)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        if (uReal > 0.001) {
          float seed = dot(vPseed, vec3(12.9898, 78.233, 37.719));
          float k = fract(sin(seed) * 43758.5453);
          // Edges and corners of the box (its own space runs -0.5 … 0.5).
          vec3 a = abs(vPw) * 2.0;
          float edge = smoothstep(0.86, 0.98, max(min(a.x, a.y), max(min(a.y, a.z), min(a.x, a.z))));
          float corner = smoothstep(0.82, 0.97, min(a.x, min(a.y, a.z)));
          float scuff = smoothstep(0.7, 0.85, rdNoise(vPw.xz * 14.0 + k * 31.0)) * 0.6;
          vec3 c = diffuseColor.rgb;
          // Kraft shade of this box: brighter or browner.
          c *= mix(vec3(1.04, 1.02, 0.98), vec3(0.86, 0.78, 0.66), k);
          c *= 1.0 - 0.18 * edge - 0.22 * corner * step(0.6, k) - 0.12 * scuff;
          diffuseColor.rgb = mix(diffuseColor.rgb, c, uReal);
          roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor + 0.1 * edge, 0.0, 1.0), uReal);
        }`,
      );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}-parcelwear`;
}

/**
 * Small specks on a worktop or shelf (dark grey speckled laminate or powder coat), only in the
 * realistic day: in world space, so a batch of boxes can share it.
 */
export function specks(m: THREE.MeshStandardMaterial): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uReal = REAL;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSk;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vSk = (modelMatrix * wp).xyz;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uReal;\nvarying vec3 vSk;\n${NOISE}`)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        if (uReal > 0.001) {
          vec2 q = vSk.xz + vSk.y * 0.7;
          float dark = step(0.9, rdNoise(q * 160.0));
          float light = step(0.93, rdNoise(q * 130.0 + 7.0));
          float wearSpot = smoothstep(0.6, 0.8, rdFbm(q * 3.0));
          vec3 c = diffuseColor.rgb * (1.0 - 0.45 * dark) + 0.12 * light;
          c *= 1.0 - 0.08 * wearSpot;
          diffuseColor.rgb = mix(diffuseColor.rgb, c, uReal);
          roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor - 0.15 * wearSpot, 0.2, 1.0), uReal);
        }`,
      );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}-specks`;
}
