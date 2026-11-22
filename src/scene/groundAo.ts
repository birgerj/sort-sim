import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Trial (`?ao=1`): soft shade where things stand on the floor, along the walls and in the
 * corners, only in the realistic day. Off unless asked for, so the other looks compile the
 * shaders they always did.
 *
 * The hall's lights come from everywhere, so the floor is darker wherever something close by
 * hides part of the ceiling: under racks and tables, round machine feet, along a wall. That
 * shade is what makes objects stand on the floor instead of floating over it. It is worked out
 * once, after the build, for everything that stands still (`bakeGroundAo`), kept as a picture
 * of the floor plan, and read by the floor, the walls and the lower part of every object
 * (`groundAo`): one texture read per pixel, nothing per frame.
 */
export const aoOptions = { on: false };
/** How much of the shade shows (follows the realistic day while the trial is on); set by the scene. */
export const AO = { value: 0 };

const WHITE = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
WHITE.needsUpdate = true;
/** The shade over the floor plan: red is how much is hidden (0 open … 1 fully hidden). */
const AO_MAP: { value: THREE.Texture } = { value: WHITE };
/** Where the picture lies on the floor: its centre (x, z) and one over its size. */
const AO_BOX = { value: new THREE.Vector4(0, 0, 0, 0) };

/** Texels per metre of the floor plan. */
const PX_PER_M = 10;
/** The slice above the floor that counts: what hangs higher hides too little to matter. */
const SLICE = 3;
/** The cameras start this far under the floor, so bottoms lying on it are still seen. */
const BELOW = 0.5;

/**
 * Lets a material take the shade: the floor fully, anything standing on it less and less with
 * height (gone at 1.4 m). Indirect light takes all of it and the key light most of it: in a
 * hall that light stands for the roof lights too. Before the bake there is nothing to read and
 * nothing changes.
 */
export function groundAo(m: THREE.MeshStandardMaterial): void {
  if (m.userData.groundAo) return;
  m.userData.groundAo = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uAo = AO;
    sh.uniforms.uAoMap = AO_MAP;
    sh.uniforms.uAoBox = AO_BOX;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAoW;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 aoP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            aoP = instanceMatrix * aoP;
          #endif
          vAoW = (modelMatrix * aoP).xyz;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uAo;\nuniform sampler2D uAoMap;\nuniform vec4 uAoBox;\nvarying vec3 vAoW;')
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        if (uAo > 0.001 && vAoW.y < 1.4) {
          vec2 aoUv = (vAoW.xz - uAoBox.xy) * uAoBox.zw + 0.5;
          if (aoUv.x > 0.0 && aoUv.x < 1.0 && aoUv.y > 0.0 && aoUv.y < 1.0) {
            float aoHid = texture2D(uAoMap, aoUv).r;
            // The floor itself takes most; the sides of what stands on it a little, fading upwards.
            float aoK = mix(0.8, 0.5, smoothstep(0.0, 0.08, vAoW.y)) * (1.0 - smoothstep(0.1, 1.4, vAoW.y));
            float aoShade = uAo * aoK * aoHid;
            reflectedLight.indirectDiffuse *= 1.0 - aoShade;
            reflectedLight.indirectSpecular *= 1.0 - aoShade;
            reflectedLight.directDiffuse *= 1.0 - 0.8 * aoShade;
          }
        }`,
      );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}-gao`;
}

const QUAD_VERT = 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

function target(w: number, h: number, depth: boolean): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, { depthBuffer: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
}

/** One way of a soft blur (a bell curve of 17 samples, `step` texels apart). */
function blurMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { tMap: { value: null }, uStep: { value: new THREE.Vector2() } },
    vertexShader: QUAD_VERT,
    fragmentShader: `
      uniform sampler2D tMap;
      uniform vec2 uStep;
      varying vec2 vUv;
      void main() {
        float sum = 0.0, wsum = 0.0;
        for (int i = -8; i <= 8; i++) {
          float w = exp(-float(i * i) / 18.0);
          sum += w * texture2D(tMap, vUv + uStep * float(i)).r;
          wsum += w;
        }
        gl_FragColor = vec4(vec3(sum / wsum), 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
}

export interface AoBake {
  /** The floor plan to cover (metres). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Objects left out: what moves, and the floor, walls and ceilings themselves. */
  hide: Iterable<THREE.Object3D>;
  /** True inside the hall: everything outside counts as wall. */
  inside: (x: number, z: number) => boolean;
}

/**
 * Works out the shade for everything that is in the scene and visible now.
 *
 * Two looks up at the hall from under the floor, in a slice of 3 m: one that sees the faces
 * pointing down (the lowest underside over every spot: how much room there is above the floor)
 * and one that sees the faces pointing up from behind (the top of the lowest thing there).
 * A spot is hidden most when something stands right on it and less the higher the underside
 * is (a table hides less than a crate). Things that are only a few centimetres thick and lie
 * on the floor (tape, mats, plates) hide nothing. The walls are added as blocks just outside
 * the hall. That is blurred three times, tight for the dark line where things touch the floor,
 * wider for the soft shade round them and widest for the dim of a crowded corner, and the
 * three are added up.
 */
export function bakeGroundAo(renderer: THREE.WebGLRenderer, scene: THREE.Scene, opt: AoBake): void {
  const w = opt.x1 - opt.x0;
  const h = opt.z1 - opt.z0;
  const cx = (opt.x0 + opt.x1) / 2;
  const cz = (opt.z0 + opt.z1) / 2;
  const W = Math.ceil(w * PX_PER_M);
  const H = Math.ceil(h * PX_PER_M);
  const D = SLICE + BELOW;

  // Looking straight up from under the floor: picture x is the hall's x, picture y its z.
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0, D);
  cam.position.set(cx, -BELOW, cz);
  cam.up.set(0, 0, 1);
  cam.lookAt(cx, 1, cz);
  cam.updateMatrixWorld(true);

  // Left out: what was asked for, and anything that is not a solid surface (lines, points,
  // glass, light beams, shadows painted on the floor).
  const hidden: THREE.Object3D[] = [];
  const hide = (o: THREE.Object3D) => {
    if (o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  };
  for (const o of opt.hide) hide(o);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.SkinnedMesh).isSkinnedMesh) return hide(o);
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (o.userData.noAo || mats.some((x) => x.transparent || !x.depthWrite || x.blending !== THREE.NormalBlending)) hide(o);
  });

  // The walls: blocks half a metre square just outside the hall, where a cell next to them is inside.
  const CELL = 0.5;
  const cells: [number, number][] = [];
  for (let x = opt.x0 + CELL / 2; x < opt.x1; x += CELL) {
    for (let z = opt.z0 + CELL / 2; z < opt.z1; z += CELL) {
      if (opt.inside(x, z)) continue;
      if (opt.inside(x + CELL, z) || opt.inside(x - CELL, z) || opt.inside(x, z + CELL) || opt.inside(x, z - CELL)) cells.push([x, z]);
    }
  }
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL, SLICE * 2, CELL), new THREE.MeshBasicMaterial(), cells.length);
  const mat4 = new THREE.Matrix4();
  cells.forEach(([x, z], i) => walls.setMatrixAt(i, mat4.makeTranslation(x, SLICE, z)));
  walls.frustumCulled = false;
  scene.add(walls);
  walls.updateMatrixWorld(true);

  const under = target(W, H, true);
  const tops = target(W, H, true);
  const a = target(W, H, false);
  const b = target(W, H, false);
  const qa = target(Math.ceil(W / 4), Math.ceil(H / 4), false);
  const qb = target(Math.ceil(W / 4), Math.ceil(H / 4), false);
  const qc = target(Math.ceil(W / 4), Math.ceil(H / 4), false);
  const out = target(W, H, false);

  const depthFront = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, side: THREE.FrontSide });
  const depthBack = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, side: THREE.BackSide });

  // (Keep the renderer as it was: this runs in the middle of a frame.)
  const keep = {
    target: renderer.getRenderTarget(),
    colour: renderer.getClearColor(new THREE.Color()),
    alpha: renderer.getClearAlpha(),
    auto: renderer.autoClear,
    shadows: renderer.shadowMap.needsUpdate,
    override: scene.overrideMaterial,
    background: scene.background,
  };
  renderer.shadowMap.needsUpdate = false;
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 1);
  scene.background = null;
  for (const [rt, mat] of [[under, depthFront], [tops, depthBack]] as const) {
    scene.overrideMaterial = mat;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
  }
  scene.overrideMaterial = keep.override;
  scene.background = keep.background;
  scene.remove(walls);
  walls.geometry.dispose();
  walls.dispose();
  for (const o of hidden) o.visible = true;

  // How much each spot is hidden. (The depth pictures hold 1 at the camera … 0 at the end of the
  // slice, and exactly 0 where nothing was seen.)
  const weigh = new THREE.ShaderMaterial({
    uniforms: { tUnder: { value: under.texture }, tTops: { value: tops.texture } },
    vertexShader: QUAD_VERT,
    fragmentShader: `
      uniform sampler2D tUnder;
      uniform sampler2D tTops;
      varying vec2 vUv;
      void main() {
        float u = texture2D(tUnder, vUv).r;
        float t = texture2D(tTops, vUv).r;
        float hid = 0.0;
        if (u > 0.0) {
          float room = max((1.0 - u) * ${D.toFixed(2)} - ${BELOW.toFixed(2)}, 0.0);   // metres between the floor and the underside
          hid = 1.0 - smoothstep(0.05, 1.8, room);
          if (t > 0.0) {
            float top = (1.0 - t) * ${D.toFixed(2)} - ${BELOW.toFixed(2)};
            // Something thin lying on the floor.
            if (top >= room && top < 0.15 && top - room < 0.06) hid *= smoothstep(0.03, 0.15, top);
          }
        }
        gl_FragColor = vec4(vec3(hid), 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const copy = new THREE.ShaderMaterial({
    uniforms: { tMap: { value: null } },
    vertexShader: QUAD_VERT,
    fragmentShader: 'uniform sampler2D tMap;\nvarying vec2 vUv;\nvoid main() { gl_FragColor = vec4(texture2D(tMap, vUv).rgb, 1.0); }',
    depthTest: false,
    depthWrite: false,
  });
  const blur = blurMaterial();
  const add = new THREE.ShaderMaterial({
    uniforms: { tTight: { value: null }, tMid: { value: null }, tWide: { value: null } },
    vertexShader: QUAD_VERT,
    fragmentShader: `
      uniform sampler2D tTight;
      uniform sampler2D tMid;
      uniform sampler2D tWide;
      varying vec2 vUv;
      void main() {
        float hid = clamp(0.5 * texture2D(tTight, vUv).r + 0.6 * texture2D(tMid, vUv).r + 0.7 * texture2D(tWide, vUv).r, 0.0, 1.0);
        gl_FragColor = vec4(vec3(hid), 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(weigh);
  const pass = (mat: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget) => {
    quad.material = mat;
    renderer.setRenderTarget(to);
    quad.render(renderer);
  };
  const blurTo = (from: THREE.WebGLRenderTarget, mid: THREE.WebGLRenderTarget, to: THREE.WebGLRenderTarget, texels: number) => {
    blur.uniforms.tMap!.value = from.texture;
    (blur.uniforms.uStep!.value as THREE.Vector2).set(texels / from.width, 0);
    pass(blur, mid);
    blur.uniforms.tMap!.value = mid.texture;
    (blur.uniforms.uStep!.value as THREE.Vector2).set(0, texels / from.height);
    pass(blur, to);
  };
  pass(weigh, a);
  // Tight: about 0.3 m either way.
  blurTo(a, b, out, 1);
  const tight = out;
  // Middle: the same at a quarter of the size, about 1.2 m either way. Wide: that once more, about 3 m.
  copy.uniforms.tMap!.value = a.texture;
  pass(copy, qa);
  blurTo(qa, qb, qa, 1);
  blurTo(qa, qb, qc, 2.5);
  add.uniforms.tTight!.value = tight.texture;
  add.uniforms.tMid!.value = qa.texture;
  add.uniforms.tWide!.value = qc.texture;
  pass(add, a);

  renderer.setRenderTarget(keep.target);
  renderer.setClearColor(keep.colour, keep.alpha);
  renderer.autoClear = keep.auto;
  renderer.shadowMap.needsUpdate = keep.shadows;

  for (const rt of [under, tops, b, qa, qb, qc, out]) rt.dispose();
  for (const m of [weigh, copy, blur, add, depthFront, depthBack]) m.dispose();
  quad.dispose();

  if (AO_MAP.value !== WHITE) AO_MAP.value.dispose();
  AO_MAP.value = a.texture;
  AO_BOX.value.set(cx, cz, 1 / w, 1 / h);
}
