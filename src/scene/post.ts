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

export class InkPass extends Pass {
  private target: THREE.WebGLRenderTarget;
  // Double-sided: belts and chutes are single surfaces; seen from behind they must still
  // hide what is behind them, or its outlines show through and they look transparent.
  private normalMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  /** Objects hidden while normals are drawn (lights, lines, particles, glass, shadows). */
  private skip: THREE.Object3D[] | null = null;
  strength = 1;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
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
  }

  private collect(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.userData.noInk) out.push(o);
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
    renderer.setClearColor(clear, alpha);
    this.scene.overrideMaterial = null;
    this.scene.background = bg;
    this.scene.fog = fog;
    this.skip.forEach((o, k) => (o.visible = was[k]!));
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
