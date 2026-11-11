// Post-processing for the day look.
//
// InkPass draws the black outlines of the illustration style as a screen
// effect: the scene is rendered once more with normals (and depth), and an
// edge is drawn wherever the normal turns sharply or the depth jumps. This
// replaces thousands of per-object outline meshes and lines, and gives even,
// clean lines on everything, including rounded and animated shapes.
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

const INK_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uStrength;
uniform float uFog;
uniform vec3 uInk;
varying vec2 vUv;

float linearDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  vec4 col = texture2D(tColor, vUv);
  vec4 nC = texture2D(tNormal, vUv);
  // People are drawn with alpha 2: no lines on them, round them, or through them.
  if (nC.a > 1.5) { gl_FragColor = col; return; }
  float dC = linearDepth(vUv);
  float edge = 0.0;
  vec2 offs[4];
  offs[0] = vec2(uTexel.x, 0.0);
  offs[1] = vec2(-uTexel.x, 0.0);
  offs[2] = vec2(0.0, uTexel.y);
  offs[3] = vec2(0.0, -uTexel.y);
  for (int i = 0; i < 4; i++) {
    vec2 uv = vUv + offs[i];
    vec4 n = texture2D(tNormal, uv);
    if (n.a > 1.5) continue;
    float d = linearDepth(uv);
    // Normal crease (both pixels covered by geometry).
    float crease = (n.a > 0.5 && nC.a > 0.5) ? 1.0 - dot(normalize(n.xyz * 2.0 - 1.0), normalize(nC.xyz * 2.0 - 1.0)) : 0.0;
    // Silhouette: geometry next to background, or a depth jump relative to the distance.
    float sil = abs(n.a - nC.a);
    float jump = abs(d - dC) / max(min(d, dC), 0.001);
    edge = max(edge, max(smoothstep(0.25, 0.45, crease), max(sil, smoothstep(0.035, 0.08, jump))));
  }
  // Lines fade into the haze with distance, like the rest of the hall.
  float dist = min(dC, uFar);
  float fade = exp(-uFog * uFog * dist * dist);
  gl_FragColor = vec4(mix(col.rgb, uInk, edge * uStrength * fade), col.a);
}
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** A single mesh that may be left out of the normals by distance: its world sphere (and, if it may move, its own). */
interface FarMesh {
  o: THREE.Mesh;
  s: THREE.Sphere;
  local?: THREE.Sphere;
}

export class InkPass extends Pass {
  private target: THREE.WebGLRenderTarget;
  // Double-sided: belts and chutes are single surfaces; seen from behind they must still
  // hide what is behind them, or its outlines show through and they look transparent.
  private normalMat = InkPass.normals();
  /**
   * The normals material, which also leaves out single instances (a roller, a tray, a robot) beyond
   * `uReach` from the camera: their triangles are moved off screen, so they cost no drawing.
   */
  private static normals(): THREE.MeshNormalMaterial {
    const m = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    const reach = { value: 1e9 };
    m.userData.reach = reach;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uReach = reach;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uReach;').replace(
        '#include <project_vertex>',
        `#include <project_vertex>
#ifdef USE_INSTANCING
        {
          // (The instance's place and size, less its reach: beyond it, off screen.)
          vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float sc = max(length(instanceMatrix[0].xyz), max(length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)));
          if (distance(ip, cameraPosition) - sc > uReach) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }
#endif`,
      );
    };
    return m;
  }
  /** People: drawn into the same buffers with alpha 2, which the edge shader leaves alone. */
  private maskMat = new THREE.MeshNormalMaterial({ opacity: 2 });
  /** Objects on the mask layer (people), drawn in a second render. */
  private masked: THREE.Object3D[] | null = null;
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  /** Objects hidden while normals are drawn (lights, lines, particles, glass, shadows). */
  private skip: THREE.Object3D[] | null = null;
  strength = 1;
  /**
   * Single meshes further than this (metres) get no lines of their own: they are left out of the
   * normals, which saves their draw calls here. What lies behind them still outlines them where
   * they meet it, so far off only their inner creases go (lines fade into the haze there anyway).
   */
  maxDist = Infinity;
  /** How far the camera is from what it looks at: nothing that close is ever left out. */
  focus = 0;
  /** Single meshes that may be left out by distance, with their world bounding spheres. */
  private far: FarMesh[] | null = null;
  /** Instanced meshes, with the size of their geometry (bounding radius) and whether their parts are small. */
  private insts: { o: THREE.InstancedMesh; r: number; small: boolean }[] | null = null;
  private readonly wp = new THREE.Vector3();
  /** Small parts (bolts, lamps, rollers, wheels): no lines of their own further than this (m). */
  detailDist = 35;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    /** Layer of the objects to draw as a mask (no lines on them). */
    private maskLayer = -1,
  ) {
    super();
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.target.depthTexture = new THREE.DepthTexture(1, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tNormal: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        uStrength: { value: 1 },
        uFog: { value: 0.009 },
        uInk: { value: new THREE.Color(0x1d1d1f) },
      },
      vertexShader: VERT,
      fragmentShader: INK_FRAG,
    });
    this.quad = new FullScreenQuad(this.mat);
  }

  /** Device pixels per CSS pixel: lines keep about the same width on screen. */
  pixelRatio = 1;

  override setSize(w: number, h: number): void {
    this.target.setSize(w, h);
    const k = Math.max(1, this.pixelRatio * 0.75);
    (this.mat.uniforms.uTexel!.value as THREE.Vector2).set(k / w, k / h);
  }

  /** Re-collect the objects that must not get outlines (call after adding objects). */
  refresh(): void {
    this.skip = null;
    this.masked = null;
    this.far = null;
    this.insts = null;
  }

  private collectInsts(skip: Set<THREE.Object3D>): { o: THREE.InstancedMesh; r: number; small: boolean }[] {
    const out: { o: THREE.InstancedMesh; r: number; small: boolean }[] = [];
    const m4 = new THREE.Matrix4();
    const sc = new THREE.Vector3();
    this.scene.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (!im.isInstancedMesh || skip.has(im)) return;
      const g = im.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const r = g.boundingSphere!.radius;
      // Small: every part (as placed now) under 0.3 m across, or so.
      let big = 0;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m4);
        sc.setFromMatrixScale(m4);
        big = Math.max(big, r * Math.max(sc.x, sc.y, sc.z));
      }
      out.push({ o: im, r, small: big < 0.3 });
    });
    return out;
  }

  private collectFar(skip: Set<THREE.Object3D>): FarMesh[] {
    const out: FarMesh[] = [];
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || skip.has(m) || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
      const g = m.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      // What stands still: its sphere once; what may move (a truck, a cage, a door): placed each frame.
      const still = !!(m.userData.merged || m.userData.static || m.parent === this.scene);
      out.push({ o: m, s: g.boundingSphere!.clone().applyMatrix4(m.matrixWorld), local: still ? undefined : g.boundingSphere! });
    });
    return out;
  }

  private collect(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.userData.noInk || o.userData.inkMask) out.push(o);
      else if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) out.push(o);
      else if ((o as THREE.Mesh).isMesh) {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[];
        const mats = Array.isArray(m) ? m : [m];
        // Additive glows and see-through panes have no outline.
        if (mats.every((x) => x.blending === THREE.AdditiveBlending || (x.transparent && !x.alphaTest) || x.side === THREE.BackSide)) out.push(o);
      }
    });
    return out;
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    if (!this.skip) this.skip = this.collect();
    const was = this.skip.map((o) => o.visible);
    for (const o of this.skip) o.visible = false;
    // Far single meshes: out of the normals for this frame.
    const hidden: THREE.Object3D[] = [];
    const reach = Math.max(this.maxDist, this.focus * 1.3);
    // (Small things: only up to detailDist, or what the camera looks at.)
    const small = Math.min(reach, Math.max(this.detailDist, this.focus * 1.3));
    const cam = this.camera.position;
    if (!this.far) this.far = this.collectFar(new Set(this.skip));
    for (const { o, s, local } of this.far) {
      if (!o.visible) continue;
      if (local) s.copy(local).applyMatrix4(o.matrixWorld);
      if (s.center.distanceTo(cam) - s.radius > (s.radius < 0.4 ? small : reach)) {
        o.visible = false;
        hidden.push(o);
      }
    }
    // Instanced meshes: left out whole when none of their parts is within reach (small parts: within
    // detailDist); the others lose the parts beyond reach in the shader (see normals).
    if (!this.insts) this.insts = this.collectInsts(new Set(this.skip));
    for (const { o, r, small: isSmall } of this.insts) {
      if (!o.visible || o.count === 0) continue;
      const lim = isSmall ? small : reach;
      if (lim === Infinity) continue;
      const a = o.instanceMatrix.array;
      const w = o.matrixWorld.elements;
      // (Instances are placed in the mesh's own frame; most meshes sit at the origin unturned.)
      const ox = w[12]!;
      const oy = w[13]!;
      const oz = w[14]!;
      let near = false;
      for (let i = 0; i < o.count && !near; i++) {
        const k = i * 16;
        const s = Math.sqrt(Math.max(a[k]! * a[k]! + a[k + 1]! * a[k + 1]! + a[k + 2]! * a[k + 2]!, a[k + 4]! * a[k + 4]! + a[k + 5]! * a[k + 5]! + a[k + 6]! * a[k + 6]!, a[k + 8]! * a[k + 8]! + a[k + 9]! * a[k + 9]! + a[k + 10]! * a[k + 10]!));
        if (s === 0) continue;
        const dx = a[k + 12]! + ox - cam.x;
        const dy = a[k + 13]! + oy - cam.y;
        const dz = a[k + 14]! + oz - cam.z;
        near = Math.sqrt(dx * dx + dy * dy + dz * dz) - r * s <= lim;
      }
      if (!near) {
        o.visible = false;
        hidden.push(o);
      }
    }
    (this.normalMat.userData.reach as { value: number }).value = reach === Infinity ? 1e9 : reach;
    const bg = this.scene.background;
    const fog = this.scene.fog;
    this.scene.background = null;
    this.scene.fog = null;
    this.scene.overrideMaterial = this.normalMat;
    const clear = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    if (this.maskLayer >= 0) {
      // Then the people, on their own layer, as a mask over what is behind them.
      if (!this.masked) {
        const list: THREE.Object3D[] = [];
        this.scene.traverse((o) => o.userData.inkMask && list.push(o));
        this.masked = list;
      }
      // (People further than the reach are left out too: a few pixels tall, in the haze.)
      // (Only those that are shown at all: Father Christmas only at Christmas.)
      const shown = new Set(this.skip.filter((_, k) => was[k]));
      for (const o of this.masked) o.visible = shown.has(o) && (reach === Infinity || o.getWorldPosition(this.wp).distanceTo(cam) < reach);
      const layers = this.camera.layers.mask;
      const auto = renderer.autoClear;
      this.camera.layers.set(this.maskLayer);
      renderer.autoClear = false;
      this.scene.overrideMaterial = this.maskMat;
      renderer.render(this.scene, this.camera);
      this.camera.layers.mask = layers;
      renderer.autoClear = auto;
    }
    renderer.setClearColor(clear, alpha);
    this.scene.overrideMaterial = null;
    this.scene.background = bg;
    this.scene.fog = fog;
    this.skip.forEach((o, k) => (o.visible = was[k]!));
    for (const o of hidden) o.visible = true;
    const u = this.mat.uniforms;
    u.tColor!.value = readBuffer.texture;
    u.uNear!.value = this.camera.near;
    u.uFar!.value = this.camera.far;
    u.uStrength!.value = this.strength;
    if (fog instanceof THREE.FogExp2) u.uFog!.value = fog.density;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.target.dispose();
    this.mat.dispose();
    this.quad.dispose();
  }
}

/** A soft round shadow texture for contact shadows (white centre, fading out). */
export function blobTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * Day shading in flat tones, like the illustration: light on a surface is
 * rounded to three steps. `amount` (0 night … 1 day) is shared by all materials.
 */
export const TOON = { value: 0 };

export function toonify(m: THREE.MeshStandardMaterial): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uToon = TOON;
    // How much of the toon steps this material takes (1: all; less keeps some smooth shading).
    const k = (m.userData.toonK as number | undefined) ?? 1;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uToon;\nconst float uToonK = ${k.toFixed(3)};`)
      .replace(
        '#include <opaque_fragment>',
        `{
          float base = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) + 1e-4;
          float lit = dot(outgoingLight - totalEmissiveRadiance, vec3(0.299, 0.587, 0.114)) / base;
          float q = lit < 0.45 ? 0.7 : (lit < 0.85 ? 0.86 : 1.0);
          outgoingLight = mix(outgoingLight, diffuseColor.rgb * q + totalEmissiveRadiance, uToon * uToonK);
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'toon' + ((m.userData.toonK as number | undefined) ?? 1);
}
