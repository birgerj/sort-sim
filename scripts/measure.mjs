// Measures draw calls, triangles and frame time per department and look, headless.
//
//   npm run build && node scripts/measure.mjs [dept ...]
//   MEASURE_LOOKS=minimal,real,night MEASURE_QUALITY=normal MEASURE_FRAMES=12
//
// Per frame it counts every draw (renderBufferDirect) with the pass it belongs to
// (scene, ink, ao, shadow, other) and the object's owner (its nearest named ancestor),
// and times the scene update apart from the drawing. Writes measure/<quality>.json.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4181;
const only = process.argv.slice(2);
const looks = (process.env.MEASURE_LOOKS ?? 'minimal,real,night').split(',');
const quality = process.env.MEASURE_QUALITY ?? 'normal';
const FRAMES = Number(process.env.MEASURE_FRAMES ?? 12);
const WAIT_MS = Number(process.env.MEASURE_WAIT ?? 6000);

mkdirSync('measure', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const out = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  const base = `http://localhost:${PORT}/`;
  await page.goto(`${base}?ui=0&mute=1`);
  await page.waitForFunction(() => 'sortsim' in window);
  const depts = await page.evaluate(() => window.sortsim.scene.departments());
  for (const d of depts) {
    if (only.length && !only.includes(d.id)) continue;
    for (const look of looks) {
      if (d.when === 'night' && look !== 'night') continue;
      const time = look === 'night' ? 'night' : 'day';
      const lk = look === 'real' ? 'real' : 'minimal';
      await page.goto(`${base}?ui=0&mute=1&time=${time}&look=${lk}&quality=${quality}&dept=${encodeURIComponent(d.id)}`);
      await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 240000 });
      await page.waitForTimeout(WAIT_MS);
      const r = await page.evaluate(async (FRAMES) => {
        const s = window.sortsim.scene;
        const gl = s.renderer;
        // Label every object with the scene field (module) that holds it: smallest subtrees first.
        const roots = [];
        const visit = (v, label, depth) => {
          if (!v || typeof v !== 'object' || depth > 2) return;
          if (v.isObject3D) { if (!v.isScene) roots.push([v, label]); return; }
          if (Array.isArray(v)) { for (const x of v.slice(0, 400)) if (x?.isObject3D) roots.push([x, label]); else if (depth < 2 && x && typeof x === 'object') visit(x, label, depth + 1); return; }
          if (v instanceof Map || v.constructor === Object || v.constructor?.name?.length > 0) for (const [k, x] of Object.entries(v)) if (!k.startsWith('_') && k !== 'parent' && k !== 'scene' && k !== 'camera' && k !== 'renderer') visit(x, depth === 0 ? label : `${label}.${k}`, depth + 1);
        };
        for (const [k, v] of Object.entries(s)) if (!['scene', 'camera', 'renderer', 'composer', 'batcher'].includes(k)) visit(v, k, 0);
        const size = (o) => { let n = 0; o.traverse(() => n++); return n; };
        roots.map(([o, l]) => [o, l, size(o)]).sort((a, b) => a[2] - b[2]).forEach(([o, l]) => o.traverse((c) => { c.userData.__m ??= l; }));
        for (const b of s.batcher.list) if (b.mesh) { const p = b.proxies.find((x) => x.userData.__m) ?? b.proxies[0]; let l; for (let q = p; q && !l; q = q.parent) l = q.userData.__m; b.mesh.userData.__m = 'batch:' + (l ?? '?'); }
        const owner = (o) => {
          for (let p = o; p; p = p.parent) if (p.userData.__m) return p.userData.__m;
          const m = Array.isArray(o.material) ? o.material[0] : o.material;
          return `(${o.type} ${o.geometry?.type ?? ''} ${m?.name || m?.type || ''})`;
        };
        let pass = 'scene';
        const acc = { calls: {}, tris: {}, owners: {}, dist: {}, px: {}, small: {} };
        const M = new s.camera.matrix.constructor(), V = s.camera.position.clone();
        const orig = gl.renderBufferDirect.bind(gl);
        gl.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
          const idx = geometry.index;
          let n = idx ? idx.count : geometry.attributes.position?.count ?? 0;
          n = Math.min(n, geometry.drawRange.count);
          if (group) n = Math.min(n, group.count);
          const inst = object.isInstancedMesh ? object.count : geometry.isInstancedBufferGeometry ? geometry.instanceCount : 1;
          const tris = object.isMesh ? (n / 3) * inst : 0;
          acc.calls[pass] = (acc.calls[pass] ?? 0) + 1;
          acc.tris[pass] = (acc.tris[pass] ?? 0) + tris;
          const K = `${pass}|${object.isSkinnedMesh ? 'people' : object.isInstancedMesh ? 'inst:' + owner(object) : 'mesh:' + (geometry.type) + ':' + (Array.isArray(material) ? 'multi' : material.type)}`;
          if (pass === 'scene') {
            // Triangles by distance from the camera and by size on screen (per instance for instanced meshes).
            const cam = s.camera.position;
            const per = n / 3;
            const add = (pos, r, t) => {
              const d = pos.distanceTo(cam);
              const db = d < 10 ? 'a<10m' : d < 25 ? 'b10-25m' : d < 50 ? 'c25-50m' : 'd>50m';
              const px = (r / Math.max(0.1, d)) * 720 / (2 * Math.tan((s.camera.fov * Math.PI) / 360));
              const pb = px < 4 ? 'a<4px' : px < 16 ? 'b4-16px' : px < 64 ? 'c16-64px' : 'd>64px';
              acc.dist[db] = (acc.dist[db] ?? 0) + t;
              acc.px[pb] = (acc.px[pb] ?? 0) + t;
              if (px < 16) acc.small[K] = (acc.small[K] ?? 0) + t;
            };
            geometry.boundingSphere ?? geometry.computeBoundingSphere();
            const bs = geometry.boundingSphere;
            if (object.isInstancedMesh) {
              for (let i = 0; i < object.count; i++) {
                object.getMatrixAt(i, M);
                const sc = M.getMaxScaleOnAxis();
                if (sc === 0) continue;
                V.copy(bs.center).applyMatrix4(M).applyMatrix4(object.matrixWorld);
                add(V, bs.radius * sc * object.matrixWorld.getMaxScaleOnAxis(), per);
              }
            } else if (object.isMesh) {
              V.copy(bs.center).applyMatrix4(object.matrixWorld);
              add(V, bs.radius * object.matrixWorld.getMaxScaleOnAxis(), tris);
            }
          }
          if (pass === 'scene' || pass === 'shadow') {
            const k = K;
            const e = (acc.owners[k] ??= { calls: 0, tris: 0, kind: object.isSkinnedMesh ? 'skinned' : object.isInstancedMesh ? 'instanced' : object.type });
            e.calls++;
            e.tris += tris;
          }
          return orig(camera, scene, geometry, material, object, group);
        };
        const sm = gl.shadowMap;
        const smRender = sm.render.bind(sm);
        sm.render = (...a) => { const p = pass; pass = 'shadow'; try { return smRender(...a); } finally { pass = p; } };
        const comp = s.composer;
        const named = new Map([[s.gtao, 'ao'], [s.ink, 'ink'], [s.bloom, 'bloom'], [s.bokeh, 'bokeh'], [s.grade, 'grade'], [s.smaa, 'smaa']]);
        comp.passes.forEach((p, i) => {
          const label = i === 0 ? 'scene' : named.get(p) ?? `pass${i}`;
          const pr = p.render.bind(p);
          p.render = (...a) => { pass = label; try { return pr(...a); } finally { pass = 'scene'; } };
        });
        let drawMs = 0;
        const cr = comp.render.bind(comp);
        comp.render = (...a) => { const t = performance.now(); gl.getContext().finish(); const r = cr(...a); gl.getContext().finish(); drawMs += performance.now() - t; return r; };
        let totalMs = 0;
        const sr = s.render.bind(s);
        s.render = (...a) => { const t = performance.now(); const r = sr(...a); totalMs += performance.now() - t; return r; };
        // Let FRAMES frames go by.
        const zero = () => { acc.calls = {}; acc.tris = {}; acc.owners = {}; acc.dist = {}; acc.px = {}; acc.small = {}; drawMs = 0; totalMs = 0; };
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        zero();
        for (let i = 0; i < FRAMES; i++) await new Promise((res) => requestAnimationFrame(res));
        const per = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v / FRAMES)]));
        const owners = Object.entries(acc.owners).map(([k, v]) => ({ k, calls: v.calls / FRAMES, tris: Math.round(v.tris / FRAMES), kind: v.kind })).sort((a, b) => b.calls - a.calls);
        let objs = 0, meshes = 0, lods = 0;
        s.scene.traverse((o) => { objs++; if (o.isMesh) meshes++; if (o.isLOD) lods++; });
        return { calls: per(acc.calls), tris: per(acc.tris), dist: per(acc.dist), px: per(acc.px), small: Object.entries(per(acc.small)).sort((a, b) => b[1] - a[1]).slice(0, 12), owners, updateMs: (totalMs - drawMs) / FRAMES, drawMs: drawMs / FRAMES, objs, meshes, lods };
      }, FRAMES);
      r.dept = d.id; r.look = look; r.quality = quality;
      out.push(r);
      const c = r.calls, t = r.tris;
      console.log(`   dist ${JSON.stringify(r.dist)} px ${JSON.stringify(r.px)}`);
      console.log(`${d.id.padEnd(16)} ${look.padEnd(8)} calls ${JSON.stringify(c)}  tris(k) ${JSON.stringify(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v / 1000)])))}  update ${r.updateMs.toFixed(1)} ms`);
      writeFileSync(`measure/${quality}.json`, JSON.stringify(out, null, 1));
    }
  }
} finally {
  await browser.close();
  server.kill();
}
