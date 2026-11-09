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
