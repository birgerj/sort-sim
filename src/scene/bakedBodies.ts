// The bodies under the clothes, made once at build time instead of on every load.
//
// `buildBody` (bodySdf.ts) is pure maths and gives the same mesh every time for a build and
// a level, so the build writes the ones needed at start (3 widths × 3 bellies, the coarse
// and far levels) into one binary file next to the page, and the page reads it at start.
// The fine level (seen only up close, about four times the size) is still made in the
// browser in spare moments after load. Without the file (the dev server, or a failed
// fetch) the bodies are made in the browser as before.
//
// Normals, colours and weights are stored as bytes (plenty for them); positions and the
// part weights the clothes are chosen by stay full floats.
//
// File: a little-endian u32 with the length of a JSON header, the header, padding to 4
// bytes, then the arrays. Header: { [key]: { index: [type, offset, count], attrs: { name:
// [type, size, offset, count] } } }, offsets from the start of the data.
import * as THREE from 'three';
import { buildBody, type BodyLevel } from './bodySdf';

/** The builds people are made in (people.ts rounds to these). */
export const WIDTHS = [0.93, 1.02, 1.11];
export const BELLIES = [0, 0.45, 0.9];
/** The levels baked (the fine one is made after load). */
export const LEVELS: BodyLevel[] = ['coarse', 'far'];
/** How far the hanging arms stand out from the body (radians): just clear of the vest. */
export const REST_SPREAD = 0.1;
export const bodyKey = (w: number, b: number, level: BodyLevel) => `${w}|${b}|${level}`;
export const BODIES_FILE = 'bodies.bin';

type Typed = Float32Array | Uint16Array | Uint32Array | Uint8Array | Int8Array;
const TYPES: Record<string, new (b: ArrayBuffer, o: number, n: number) => Typed> = { f32: Float32Array, u16: Uint16Array, u32: Uint32Array, u8: Uint8Array, i8: Int8Array };
const typeOf = (a: ArrayLike<number>): string =>
  a instanceof Uint16Array ? 'u16' : a instanceof Uint32Array ? 'u32' : a instanceof Uint8Array ? 'u8' : a instanceof Int8Array ? 'i8' : 'f32';
/** Stored as normalized bytes: signed for normals, unsigned for colours and weights; bone numbers as plain bytes. */
const PACK: Record<string, (a: ArrayLike<number>) => Typed> = {
  normal: (a) => Int8Array.from(a, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 127)),
  color: (a) => Uint8Array.from(a, (v) => Math.round(Math.max(0, Math.min(1, v)) * 255)),
  skinWeight: (a) => Uint8Array.from(a, (v) => Math.round(Math.max(0, Math.min(1, v)) * 255)),
  skinIndex: (a) => Uint8Array.from(a),
};
const NORMALIZED = new Set(['normal', 'color', 'skinWeight']);

/** All the bodies as one file (build time, in Node). */
export function encodeBodies(): Uint8Array {
  const header: Record<string, { index: [string, number, number]; attrs: Record<string, [string, number, number, number]> }> = {};
  const chunks: Uint8Array[] = [];
  let off = 0;
  const put = (a: Typed): number => {
    const at = off;
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    chunks.push(bytes);
    off += bytes.byteLength;
    // (Keep every array 4-byte aligned.)
    const pad = (4 - (off % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      off += pad;
    }
    return at;
  };
  for (const w of WIDTHS) for (const b of BELLIES) for (const level of LEVELS) {
    const g = buildBody(w, b, REST_SPREAD, level);
    const idx = g.index!.array as Typed;
    const attrs: Record<string, [string, number, number, number]> = {};
    for (const [name, a] of Object.entries(g.attributes)) {
      const arr = PACK[name] ? PACK[name]!(a.array as ArrayLike<number>) : (a.array as Typed);
      attrs[name] = [typeOf(arr), a.itemSize, put(arr), arr.length];
    }
    header[bodyKey(w, b, level)] = { index: [typeOf(idx), put(idx), idx.length], attrs };
  }
  const json = new TextEncoder().encode(JSON.stringify(header));
  const pad = (4 - ((4 + json.length) % 4)) % 4;
  const out = new Uint8Array(4 + json.length + pad + off);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  let p = 4 + json.length + pad;
  for (const c of chunks) {
    out.set(c, p);
    p += c.byteLength;
  }
  return out;
}

/** Read the file back into geometries, by key. */
export function decodeBodies(buf: ArrayBuffer): Map<string, THREE.BufferGeometry> {
  const len = new DataView(buf).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as Record<string, { index: [string, number, number]; attrs: Record<string, [string, number, number, number]> }>;
  const base = 4 + len + ((4 - ((4 + len) % 4)) % 4);
  const out = new Map<string, THREE.BufferGeometry>();
  for (const [key, h] of Object.entries(header)) {
    const g = new THREE.BufferGeometry();
    for (const [name, [type, size, o, n]] of Object.entries(h.attrs)) {
      const a = new TYPES[type]!(buf, base + o, n);
      g.setAttribute(name, new THREE.BufferAttribute(a, size, NORMALIZED.has(name)));
    }
    const [it, io, n] = h.index;
    g.setIndex(new THREE.BufferAttribute(new TYPES[it]!(buf, base + io, n), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.3);
    out.set(key, g);
  }
  return out;
}
