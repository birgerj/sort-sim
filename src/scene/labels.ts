// Many small signs with different text in one draw call: every label is a cell
// of one canvas atlas, drawn on an instanced plane that picks its cell
// (roll cage boards, door screens, projected postcodes).
import * as THREE from 'three';

export interface LabelStyle {
  bg: string;
  fg: string;
  /** Second, smaller line colour. */
  sub?: string;
  border?: string;
}

export class Labels {
  readonly mesh: THREE.InstancedMesh;
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly cols: number;
  private readonly cw: number;
  private readonly ch: number;
  private dirty = false;
  readonly mat: THREE.MeshBasicMaterial;

  /** `count` labels of w × h metres; each cell is cw × ch pixels. */
  constructor(count: number, w: number, h: number, cw: number, ch: number, opts: { transparent?: boolean } = {}) {
    this.cw = cw;
    this.ch = ch;
    this.cols = Math.max(1, Math.floor(2048 / cw));
    const rows = Math.ceil(count / this.cols);
    const c = document.createElement('canvas');
    c.width = this.cols * cw;
    c.height = rows * ch;
    this.g = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: !!opts.transparent, depthWrite: !opts.transparent });
    this.mat = mat;
    const geo = new THREE.PlaneGeometry(w, h);
    const cell = new THREE.InstancedBufferAttribute(new Float32Array(count).map((_, i) => i), 1);
    geo.setAttribute('aCell', cell);
    const cols = this.cols;
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aCell;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>\nvMapUv = vec2((mod(aCell, ${cols}.0) + vMapUv.x) / ${cols}.0, 1.0 - (floor(aCell / ${cols}.0) + 1.0 - vMapUv.y) / ${rows}.0);`,
        );
    };
    // (The shader differs per atlas layout, so it needs its own cache key.)
    mat.customProgramCacheKey = () => `labels-${cols}-${rows}`;
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.userData.noInk = true;
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, hide);
  }

  /** Draw label i: a big first line and an optional smaller second line. */
  set(i: number, main: string, sub: string | null, s: LabelStyle): void {
    const g = this.g;
    const x = (i % this.cols) * this.cw;
    const y = Math.floor(i / this.cols) * this.ch;
    const { cw, ch } = this;
    g.clearRect(x, y, cw, ch);
    if (s.bg !== 'transparent') {
      g.fillStyle = s.bg;
      g.fillRect(x, y, cw, ch);
    }
    if (s.border) {
      g.strokeStyle = s.border;
      g.lineWidth = Math.max(2, ch * 0.05);
      g.strokeRect(x + g.lineWidth / 2 + 1, y + g.lineWidth / 2 + 1, cw - g.lineWidth - 2, ch - g.lineWidth - 2);
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const fit = (text: string, px: number, weight: number) => {
      let size = px;
      do g.font = `${weight} ${size}px system-ui, sans-serif`;
      while (g.measureText(text).width > cw * 0.9 && --size > 8);
    };
    g.fillStyle = s.fg;
    if (sub) {
      fit(main, ch * 0.42, 800);
      g.fillText(main, x + cw / 2, y + ch * 0.36);
      g.fillStyle = s.sub ?? s.fg;
      fit(sub, ch * 0.3, 600);
      g.fillText(sub, x + cw / 2, y + ch * 0.76);
    } else {
      fit(main, ch * 0.62, 800);
      g.fillText(main, x + cw / 2, y + ch * 0.54);
    }
    this.dirty = true;
  }

  /** Brightness (paper signs are dimmed by night; screens are not). */
  dim(v: number): void {
    this.mat.color.setScalar(v);
  }

  place(i: number, m: THREE.Matrix4): void {
    this.mesh.setMatrixAt(i, m);
  }

  /** Once a frame: upload what changed. */
  flush(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.dirty) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
  }
}
