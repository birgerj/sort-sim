// Builds the mock worker for mock-people.html from Quaternius' Universal Base Characters (CC0)
// and Universal Animation Library (CC0). Not part of the scene yet: a trial of a modelled body.
//
//   node tools/mockWorker.mjs <folder with Regular_Male_FullBody.gltf, Hair_SimpleParted.gltf, UAL1.glb>
//
// Writes public/mock/worker.glb (body in three levels of detail, eyes, brows, hair; no
// textures: every body vertex carries a clothing region in `_REGION`, coloured per person in
// the page) and public/mock/anims.glb (the clips the mock plays, on the same 65-bone skeleton).
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, weld, resample } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2];
if (!src) throw new Error('usage: node tools/mockWorker.mjs <source folder>');
const io = new NodeIO();
mkdirSync('public/mock', { recursive: true });

/** Clothing regions (the page colours them). */
const R = { skin: 0, vest: 1, band: 2, shirt: 3, trousers: 4, boots: 5, gloves: 6, belt: 7 };
/** Levels of detail: body triangles. */
const LODS = [null, 4200, 1300];

await MeshoptSimplifier.ready;

/** Read a .gltf without its pictures (the page draws flat colours; not all of them are here). */
async function readBare(file) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete m[k];
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    delete m.extensions;
  }
  delete json.extensionsUsed;
  delete json.extensionsRequired;
  const resources = {};
  for (const b of json.buffers ?? []) if (b.uri) resources[b.uri] = new Uint8Array(readFileSync(join(file, '..', b.uri)));
  return io.readJSON({ json, resources });
}

// ---- Body ----
const doc = await readBare(join(src, 'Regular_Male_FullBody.gltf'));
const root = doc.getRoot();
for (const t of root.listTextures()) t.dispose();
const skin = root.listSkins()[0];
const jointNames = skin.listJoints().map((j) => j.getName());
const mats = new Map(root.listMaterials().map((m) => [m.getName(), m]));

const bodyNode = root.listNodes().find((n) => n.getName() === 'RegularMale');
const bodyPrim = bodyNode.getMesh().listPrimitives()[0];

// Only what the page draws: positions, normals, skinning and the region.
const keepOnly = (prim) => {
  for (const s of prim.listSemantics()) if (!['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0'].includes(s)) prim.setAttribute(s, null);
};
for (const n of root.listNodes()) if (n.getMesh()) for (const p of n.getMesh().listPrimitives()) keepOnly(p);

// Region per vertex: from the bone that moves it most, and where it is on the body (bind pose:
// standing, arms out, 1.81 m tall, facing +z).
{
  const pos = bodyPrim.getAttribute('POSITION');
  const jo = bodyPrim.getAttribute('JOINTS_0');
  const we = bodyPrim.getAttribute('WEIGHTS_0');
  const n = pos.getCount();
  const reg = new Float32Array(n);
  const p = [], j = [], w = [];
  for (let i = 0; i < n; i++) {
    pos.getElement(i, p);
    jo.getElement(i, j);
    we.getElement(i, w);
    let k = 0;
    for (let q = 1; q < 4; q++) if (w[q] > w[k]) k = q;
    const name = jointNames[j[k]];
    const [x, y, z] = p;
    let r = R.skin;
    if (/^(thigh|calf)/.test(name)) r = R.trousers;
    else if (/^(foot|ball)/.test(name)) r = y < 0.2 ? R.boots : R.trousers;
    else if (name === 'pelvis' || name === 'root') r = y < 0.93 ? R.trousers : y < 0.99 ? R.belt : R.vest;
    else if (/^spine/.test(name)) r = R.vest;
    else if (/^clavicle/.test(name)) r = Math.abs(x) < 0.2 && y > 1.43 ? R.shirt : R.vest;
    else if (/^upperarm/.test(name)) r = R.shirt;
    else if (/^lowerarm/.test(name)) r = Math.abs(x) > 0.6 ? R.skin : R.shirt;
    else if (/^(hand|index|middle|ring|pinky|thumb)/.test(name)) r = R.gloves;
    // Boots up over the ankle.
    if (/^(calf|foot|ball)/.test(name) && y < 0.17) r = R.boots;
    // The vest: up to the shoulders, open at the neck in a V at the front, armholes; two
    // reflective bands round it.
    if (r === R.vest) {
      if ((y > 1.05 && y < 1.1) || (y > 1.19 && y < 1.24)) r = R.band;
      if (z > 0 && y > 1.3 && Math.abs(x) < (y - 1.3) * 0.55) r = R.shirt;
      if (y > 1.56 || Math.abs(x) > 0.2) r = R.shirt;
    }
    reg[i] = r;
  }
  const acc = doc.createAccessor('region').setType('SCALAR').setArray(reg).setBuffer(pos.getBuffer());
  bodyPrim.setAttribute('_REGION', acc);
}

await doc.transform(weld({ tolerance: 0.0002 }));

// Levels: the body simplified, keeping region edges (weighted) and its outline.
const bodyMesh = bodyNode.getMesh();
const prim0 = bodyMesh.listPrimitives()[0];
const tris = (prim) => prim.getIndices().getCount() / 3;
console.log('body LOD0', tris(prim0), 'tris,', prim0.getAttribute('POSITION').getCount(), 'vertices');
const posArr = new Float32Array(prim0.getAttribute('POSITION').getArray());
const nrm = prim0.getAttribute('NORMAL').getArray();
const regArr = prim0.getAttribute('_REGION').getArray();
const nv = posArr.length / 3;
const attrs = new Float32Array(nv * 4);
for (let i = 0; i < nv; i++) {
  attrs[i * 4] = nrm[i * 3];
  attrs[i * 4 + 1] = nrm[i * 3 + 1];
  attrs[i * 4 + 2] = nrm[i * 3 + 2];
  attrs[i * 4 + 3] = regArr[i];
}
const levels = [bodyNode];
LODS.forEach((target, lv) => {
  if (!target) return;
  const [idx, err] = MeshoptSimplifier.simplifyWithAttributes(
    new Uint32Array(prim0.getIndices().getArray()),
    posArr,
    3,
    attrs,
    4,
    [0.4, 0.4, 0.4, 2],
    null,
    target * 3,
    0.05,
    [],
  );
  const p = prim0.clone();
  p.setIndices(doc.createAccessor(`lod${lv}`).setType('SCALAR').setArray(idx).setBuffer(prim0.getIndices().getBuffer()));
  const mesh = doc.createMesh(`Body_LOD${lv}`).addPrimitive(p);
  const node = doc.createNode(`Body_LOD${lv}`).setMesh(mesh).setSkin(skin);
  bodyNode.getParentNode()?.addChild(node) ?? root.listScenes()[0].addChild(node);
  console.log(`body LOD${lv}`, idx.length / 3, 'tris, error', err.toFixed(4));
  levels.push(node);
});
bodyNode.setName('Body_LOD0');
bodyMesh.setName('Body_LOD0');

// One plain material for all (the page replaces it).
const plain = doc.createMaterial('Plain').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.8);
for (const n of root.listNodes()) if (n.getMesh()) for (const p of n.getMesh().listPrimitives()) p.setMaterial(plain);
for (const m of mats.values()) m.dispose();

// ---- Hair, on the same skeleton ----
const hairDoc = await readBare(join(src, 'Hair_SimpleParted.gltf'));
const hairNode = hairDoc.getRoot().listNodes().find((n) => n.getMesh());
const hairPrim = hairNode.getMesh().listPrimitives()[0];
keepOnly(hairPrim);
{
  // Re-bind its vertices to the body's joints by name.
  const hj = hairNode.getSkin().listJoints().map((j) => jointNames.indexOf(j.getName()));
  const jo = hairPrim.getAttribute('JOINTS_0');
  const pos = hairPrim.getAttribute('POSITION').getArray();
  const nor = hairPrim.getAttribute('NORMAL').getArray();
  const idx = hairPrim.getIndices().getArray();
  const j = [];
  const ja = new Uint16Array(jo.getCount() * 4);
  for (let i = 0; i < jo.getCount(); i++) {
    jo.getElement(i, j);
    for (let q = 0; q < 4; q++) ja[i * 4 + q] = Math.max(0, hj[j[q]]);
  }
  const buf = root.listBuffers()[0];
  const p = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf))
    .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(ja).setBuffer(buf))
    .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(hairPrim.getAttribute('WEIGHTS_0').getArray())).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buf))
    .setMaterial(plain);
  const node = doc.createNode('Hair').setMesh(doc.createMesh('Hair').addPrimitive(p)).setSkin(skin);
  bodyNode.getParentNode()?.addChild(node) ?? root.listScenes()[0].addChild(node);
  console.log('hair', idx.length / 3, 'tris');
}
await doc.transform(prune(), dedup());
await io.write('public/mock/worker.glb', doc);

// ---- Animations: only the clips the mock plays ----
const KEEP = ['Idle_Loop', 'Walk_Loop', 'PickUp_Table', 'PickUp_Kneeling', 'Push_Loop', 'Dance_Loop', 'Idle_Talking_Loop'];
const anim = await io.read(join(src, 'UAL1.glb'));
const ar = anim.getRoot();
for (const a of ar.listAnimations()) {
  if (KEEP.includes(a.getName())) continue;
  // (Its samplers hold its keyframes: they go with it.)
  for (const sm of a.listSamplers()) sm.dispose();
  for (const c of a.listChannels()) c.dispose();
  a.dispose();
}
for (const n of ar.listNodes()) n.setMesh(null);
for (const m of ar.listMeshes()) m.dispose();
for (const t of ar.listTextures()) t.dispose();
for (const m of ar.listMaterials()) m.dispose();
await anim.transform(prune({ keepLeaves: true }), resample(), prune({ keepLeaves: true }), dedup());
await io.write('public/mock/anims.glb', anim);
console.log('clips', ar.listAnimations().map((a) => a.getName()).join(', '));
