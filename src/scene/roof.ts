// Roof lights: a few flat skylights in the roof (a curb with level glass on
// top), and the sky above them. By day a light blue sky with flat white
// clouds drifting by; at night a dark sky with stars and a few grey clouds.
// The sky is a dome that follows the camera, so it reads as far away and only
// shows through the glass (the hall's walls and ceiling hide the rest).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { FloorKit } from './floor';

/** One roof light: centre x, z (on the ceiling), opening length along x and depth along z. */
export interface RoofLight {
  x: number;
  z: number;
}

/** Opening size: long along the hall (x), short across it (z). */
export const RL_W = 6;
export const RL_D = 3.6;
/** Curb height above the ceiling; the glass lies level on top of it. */
const CURB = 0.5;

/**
 * Where the roof lights are: two rows across the hall (z ±20, clear of the
 * ducts, cable trays and lamps), one in every other bay between the roof
 * beams (beams every 10 m from x −60), so the roof is not all glass.
 */
export function roofLights(wx: number, ex: number): RoofLight[] {
  const out: RoofLight[] = [];
  for (let x = wx + 17; x <= ex - 8; x += 20) for (const z of [-20, 20]) out.push({ x, z });
  return out;
}

/** Holes for the roof lights in a ceiling plane of w × d centred on (cx, cz) (shape y = world z after rotating). */
export function ceilingWithLights(cx: number, cz: number, w: number, d: number, lights: RoofLight[]): THREE.ShapeGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, -d / 2);
  sh.lineTo(w / 2, -d / 2);
  sh.lineTo(w / 2, d / 2);
  sh.lineTo(-w / 2, d / 2);
  sh.lineTo(-w / 2, -d / 2);
  for (const l of lights) {
    const x0 = l.x - cx - RL_W / 2;
    const x1 = l.x - cx + RL_W / 2;
    const z0 = l.z - cz - RL_D / 2;
    const z1 = l.z - cz + RL_D / 2;
    const h = new THREE.Path();
    h.moveTo(x0, z0);
    h.lineTo(x0, z1);
    h.lineTo(x1, z1);
    h.lineTo(x1, z0);
    h.lineTo(x0, z0);
    sh.holes.push(h);
  }
  return new THREE.ShapeGeometry(sh);
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}
`;

const SKY_FRAG = /* glsl */ `
uniform float uDay;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int k = 0; k < 5; k++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  // Clouds on a flat layer high above: project the view ray onto it.
  vec2 uv = d.xz / max(d.y, 0.08) * 0.9 + vec2(uTime * 0.012, uTime * 0.004);
  float c = fbm(uv * 0.55);
  // Sparse: only the tops of the noise become cloud; a narrow edge keeps them flat, as drawn.
  float cloud = smoothstep(0.52, 0.56, c) * smoothstep(0.02, 0.2, d.y);
  float shade = smoothstep(0.6, 0.75, c);

  // Day: blue at the top, paler towards the horizon; white clouds with a faint grey underside.
  vec3 dayTop = vec3(0.42, 0.68, 0.92);
  vec3 dayLow = vec3(0.78, 0.88, 0.96);
  vec3 daySky = mix(dayLow, dayTop, smoothstep(0.0, 0.7, h));
  vec3 dayCloud = mix(vec3(0.9, 0.93, 0.97), vec3(1.0), shade);
  vec3 dayCol = mix(daySky, dayCloud, cloud);

  // Night: deep blue, stars on a grid of cells (one star in a few cells), twinkling slowly.
  vec3 nTop = vec3(0.012, 0.018, 0.05);
  vec3 nLow = vec3(0.04, 0.05, 0.11);
  vec3 nightSky = mix(nLow, nTop, smoothstep(0.0, 0.6, h));
  vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 70.0;
  vec2 cell = floor(sp);
  vec2 fc = fract(sp) - 0.5;
  float r = hash(cell);
  vec2 off = vec2(hash(cell + 7.1), hash(cell + 3.3)) - 0.5;
  float star = r > 0.88 ? smoothstep(0.14, 0.0, length(fc - off * 0.6)) : 0.0;
  float tw = 0.65 + 0.35 * sin(uTime * (1.0 + 2.0 * hash(cell + 1.7)) + r * 40.0);
  star *= (0.6 + 1.4 * fract(r * 13.0)) * tw;
  vec3 nightCloud = vec3(0.07, 0.08, 0.13);
  vec3 nightCol = nightSky + vec3(1.4, 1.5, 1.8) * star * (1.0 - cloud);
  nightCol = mix(nightCol, nightCloud, cloud * 0.85);

  gl_FragColor = vec4(mix(nightCol, dayCol, uDay), 1.0);
}
`;

export class Roof {
  readonly lights: RoofLight[];
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private glassMat: THREE.MeshBasicMaterial;
  private readonly glassDay = new THREE.Color(0xcfe6f2);

  /** `hh`: ceiling height. */
  constructor(k: FloorKit, lights: RoofLight[], hh: number) {
    this.lights = lights;
    // Shapes in local space: the opening's centre on the ceiling at y 0.
    const t = 0.12;

    // The curb: four sides round the opening.
    const solid = [
      new THREE.BoxGeometry(RL_W + 2 * t, CURB, t).translate(0, CURB / 2, -RL_D / 2 - t / 2),
      new THREE.BoxGeometry(RL_W + 2 * t, CURB, t).translate(0, CURB / 2, RL_D / 2 + t / 2),
      new THREE.BoxGeometry(t, CURB, RL_D).translate(-RL_W / 2 - t / 2, CURB / 2, 0),
      new THREE.BoxGeometry(t, CURB, RL_D).translate(RL_W / 2 + t / 2, CURB / 2, 0),
    ];
    const solidGeo = mergeGeometries(solid)!;

    // Glazing bars on the level glass: a frame and three bars across (four panes).
    const bars: THREE.BufferGeometry[] = [];
    for (const x of [-RL_W / 2, -RL_W / 4, 0, RL_W / 4, RL_W / 2]) bars.push(new THREE.BoxGeometry(0.08, 0.08, RL_D).translate(x, CURB, 0));
    for (const z of [-RL_D / 2, RL_D / 2]) bars.push(new THREE.BoxGeometry(RL_W, 0.08, 0.08).translate(0, CURB, z));
    const barGeo = mergeGeometries(bars)!;
    const glassGeo = new THREE.PlaneGeometry(RL_W, RL_D).rotateX(-Math.PI / 2).translate(0, CURB, 0);

    const inside = k.std(0x2a2c32, 0.85, 0.2, 0xf3f4f6);
    const frame = k.std(0x3a3e45, 0.5, 0.6, 0x1d1d1f);
    this.glassMat = new THREE.MeshBasicMaterial({ color: 0xcfe6f2, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });

    const o = new THREE.Object3D();
    const inst = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const im = new THREE.InstancedMesh(g, m, lights.length);
      lights.forEach((l, i) => {
        o.position.set(l.x, hh, l.z);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      im.frustumCulled = false;
      k.put(im);
      return im;
    };
    inst(solidGeo, inside);
    inst(barGeo, frame);
    const glass = inst(glassGeo, this.glassMat);
    glass.userData.noInk = true;
    glass.renderOrder = 2;

    // The sky dome (inside the camera's far plane; it follows the camera).
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uDay: { value: 1 }, uTime: { value: 0 } },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), this.skyMat);
    this.sky.userData.noInk = true;
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    k.put(this.sky);
  }

  /** `bt` beats (clouds drift a little each beat), `day` 0 night … 1 day. */
  update(bt: number, day: number, camera: THREE.Camera): void {
    this.sky.position.copy(camera.position);
    this.skyMat.uniforms.uDay!.value = day;
    this.skyMat.uniforms.uTime!.value = bt * 0.5;
    // Pale by day; at night almost clear and dark, so the stars show.
    this.glassMat.opacity = 0.03 + 0.09 * day;
    this.glassMat.color.setHex(0x0a0e1a).lerp(this.glassDay, day);
  }
}
