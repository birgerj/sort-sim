// People mock (mock-people.html): a modelled worker instead of the generated ones, to judge.
//
// The body and the clips are Quaternius' (CC0), built into public/mock by tools/mockWorker.mjs:
// one 65-bone skeleton, the body at three levels of detail, flat clothing regions (`_region`)
// coloured here per person from the scene's palette. Walking runs on the beat (one step per
// beat, speed from the clip's own stride so the feet do not slide); carrying lays the arms of
// the pick-up's last frame over the walk.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { TOON, toonify } from '../scene/post';

const BPM = 120;
const BEAT = 60 / BPM;
/** Body triangles per level (from the build). */
const LOD_NAMES = ['Body_LOD0', 'Body_LOD1', 'Body_LOD2'];
/** Switch distances (metres), as the scene's people: fine < 6, far > 20. */
const LOD_DIST = [6, 20];

// The scene's palette (people.ts, crowd.ts).
const SKIN = [0xf3d3b5, 0xd9a77e, 0xc68e64, 0x8d5a3b, 0x5c3a24];
const HAIR = [0x2a1d14, 0x4a3221, 0x7a5a3a, 0xc9a26a, 0x1b1b1d, 0x8f8f8f];
const VEST = [0xf2c200, 0xf28c1a, 0xc8e62a];
const SHIRT = [0x2d3a5a, 0x3a3d44, 0x5b6b8a, 0x6b7280];
const TROUSERS = [0x22283f, 0x1d1d1f, 0x3d4b8f, 0x4a4d55];

/** Bones of the upper body: carrying takes these from the pick-up pose, the legs keep walking. */
const UPPER = /^(spine_0[23]|neck|Head|clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)/;

const app = document.body;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.info.autoReset = false;
app.prepend(renderer.domElement);

const scene = new THREE.Scene();
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
scene.background = new THREE.Color(dark ? 0x23252b : 0xe9ebef);
scene.fog = new THREE.Fog(scene.background, 40, 90);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
camera.position.set(2.6, 1.7, 4.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);
controls.enableDamping = true;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a8, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(6, 12, 8);
scene.add(sun);
TOON.value = 1;

// Floor, a work table and roll cages for scale.
const floorMat = new THREE.MeshStandardMaterial({ color: 0xd9dce1, roughness: 0.9 });
toonify(floorMat);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const grid = new THREE.GridHelper(80, 40, 0xb9bec7, 0xc9cdd4);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.5;
grid.position.y = 0.002;
scene.add(grid);
const std = (c: number) => {
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
  toonify(m);
  return m;
};
const table = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.7), std(0x1755fe));
table.position.set(0, 0.86, 0.62);
scene.add(table);
for (const x of [-0.62, 0.62]) for (const z of [0.32, 0.92]) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.84, 0.05), std(0x3a3d44));
  leg.position.set(x, 0.42, z);
  scene.add(leg);
}
for (let i = 0; i < 3; i++) {
  const cage = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.7, 0.7), std(0x2fa58f));
  cage.position.set(-2.6 + i * 0.95, 0.85, -1.8);
  scene.add(cage);
}
const parcelMat = std(0xc49a6c);

// ---- Loading ----
const loader = new GLTFLoader();
const [model, animGltf] = await Promise.all([loader.loadAsync('./mock/worker.glb'), loader.loadAsync('./anims/ual.glb')]);
const clips = new Map(animGltf.animations.map((c) => [c.name, c]));
const clip = (n: string) => clips.get(n)!;

// The walk is in place: the page moves the person. Its speed from the clip's stride: while a
// foot stands on the floor it slides back under the body as far as the body goes forward, so
// the foot's travel front to back, over half a cycle, is the speed that keeps it still.
const walk = clip('Walk_Loop');
let walkSpeed = 0;
{
  const probe = cloneSkinned(model.scene);
  const mx = new THREE.AnimationMixer(probe);
  mx.clipAction(walk).play();
  const foot = probe.getObjectByName('ball_l')!;
  const w = new THREE.Vector3();
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= 40; i++) {
    mx.setTime((walk.duration * i) / 40);
    probe.updateMatrixWorld(true);
    foot.getWorldPosition(w);
    lo = Math.min(lo, w.z);
    hi = Math.max(hi, w.z);
  }
  walkSpeed = (hi - lo) / (walk.duration / 2);
}

/** A clip with only these bones' tracks (or all but them). */
function only(c: THREE.AnimationClip, test: RegExp, keep: boolean, name: string): THREE.AnimationClip {
  return new THREE.AnimationClip(name, c.duration, c.tracks.filter((t) => test.test(t.name.split('.')[0]!) === keep));
}
/** One frame of a clip as a still pose (each track its value at `time`). */
function pose(c: THREE.AnimationClip, time: number, test: RegExp, name: string): THREE.AnimationClip {
  const tracks = c.tracks
    .filter((t) => test.test(t.name.split('.')[0]!))
    .map((t) => {
      const it = t.createInterpolant();
      const v = Array.from(it.evaluate(time) as ArrayLike<number>);
      const T = t.constructor as new (n: string, times: number[], values: number[]) => THREE.KeyframeTrack;
      return new T(t.name, [0], v);
    });
  return new THREE.AnimationClip(name, 1, tracks);
}
const pickup = clip('PickUp_Table');
const walkLegs = only(walk, UPPER, false, 'walk legs');
const carryArms = pose(pickup, pickup.duration, UPPER, 'carry arms');
const ACTS: Record<string, THREE.AnimationClip[]> = {
  Idle: [clip('Idle_Loop')],
  Walk: [walk],
  Carry: [walkLegs, carryArms],
  'Pick up': [pickup],
  Push: [clip('Push_Loop')],
  Dance: [clip('Dance_Loop')],
  Talk: [clip('Idle_Talking_Loop')],
};
const MOVING = new Set(['Walk', 'Carry']);

// ---- People ----
interface Person {
  root: THREE.Object3D;
  levels: THREE.SkinnedMesh[];
  extras: THREE.Object3D[];
  hair: THREE.SkinnedMesh;
  mat: THREE.MeshStandardMaterial;
  mixer: THREE.AnimationMixer;
  act: string;
  actions: THREE.AnimationAction[];
  parcel: THREE.Mesh | null;
  handL: THREE.Bone;
  handR: THREE.Bone;
  track?: { r: number; a: number; dir: number };
}

/**
 * The body's material: work clothes chosen per pixel from where the point is on the body in
 * its bind pose (standing, arms straight out at shoulder height, 1.81 m tall, facing +z), as
 * the scene's own people do. Colours per person: skin, vest, band, shirt, trousers, boots,
 * gloves, belt.
 */
function regionMaterial(cols: number[]): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.75 });
  const u = { value: cols.map((c) => new THREE.Color(c)) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCols = u;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uCols[8];
        varying vec3 vBind;
        int region(vec3 p) {
          float ax = abs(p.x);
          // Arms (out to the side): sleeves to the wrist, gloves beyond.
          if (ax > 0.2 && p.y > 1.3) return ax > 0.66 ? 6 : 3;
          if (p.y < 0.16) return 5;                       // boots, over the ankle
          if (p.y < 0.94) return 4;                       // trousers
          if (p.y < 1.0) return 7;                        // belt
          if (p.y > 1.53) return ax < 0.13 ? 0 : 3;       // neck and head; shoulders
          if (p.y > 1.49) return 3;                       // collar
          // The vest: open V at the front, armholes, two reflective bands.
          if (p.z > 0.0 && p.y > 1.32 && ax < (p.y - 1.32) * 0.6) return 3;
          if (ax > 0.17 && p.y > 1.3) return 3;
          if ((p.y > 1.07 && p.y < 1.11) || (p.y > 1.19 && p.y < 1.23)) return 2;
          return 1;
        }`,
      )
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * uCols[region(vBind)], opacity );');
  };
  m.userData.toonK = 0.45;
  toonify(m);
  m.customProgramCacheKey = () => 'clothes';
  return m;
}

/** A hard hat on the head bone (made here: the pack has none). */
function hardHat(color: number): THREE.Group {
  const g = new THREE.Group();
  const m = std(color);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.112, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m);
  shell.scale.set(1, 0.95, 1.12);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.01, 24), m);
  brim.scale.set(1, 1, 1.2);
  brim.position.z = 0.025;
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.02, 0.2), m);
  ridge.position.y = 0.1;
  g.add(shell, brim, ridge);
  return g;
}

const people: Person[] = [];
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)]!;

function makePerson(k: number): Person {
  const root = cloneSkinned(model.scene);
  const skin = pick(SKIN);
  const vest = k % 4 === 3 ? null : pick(VEST);
  const shirt = pick(SHIRT);
  // Regions: skin, vest, band, shirt, trousers, boots, gloves, belt.
  const mat = regionMaterial([skin, vest ?? shirt, vest ? 0xdfe3e8 : shirt, shirt, pick(TROUSERS), 0x1d1d1f, 0x3a3d44, 0x1d1d1f]);
  const hairMat = std(pick(HAIR));
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1d1d1f });
  const levels: THREE.SkinnedMesh[] = [];
  const extras: THREE.Object3D[] = [];
  let hair!: THREE.SkinnedMesh;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.frustumCulled = false;
    const lv = LOD_NAMES.indexOf(m.name);
    if (lv >= 0) {
      m.material = mat;
      levels[lv] = m;
    } else if (m.name === 'Hair') {
      m.material = hairMat;
      hair = m;
    } else {
      m.material = m.name === 'Eyes' ? eyeMat : hairMat;
      extras.push(m);
    }
  });
  // A hard hat for most (over the hair), set on the head bone where a head stands in the bind pose.
  if (k % 5 !== 4) {
    root.updateMatrixWorld(true);
    const head = root.getObjectByName('Head') as THREE.Bone;
    const hat = hardHat(pick([0xf2c200, 0xffffff, 0x1755fe, 0xe2231a]));
    head.add(hat);
    const inv = new THREE.Matrix4().copy(head.matrixWorld).invert();
    hat.matrix.copy(inv.multiply(new THREE.Matrix4().makeTranslation(0, 1.71, 0.0)));
    hat.matrix.decompose(hat.position, hat.quaternion, hat.scale);
    extras.push(hat);
    hair.visible = false;
    hair.userData.off = true;
  }
  const p: Person = {
    root,
    levels,
    extras,
    hair,
    mat,
    mixer: new THREE.AnimationMixer(root),
    act: '',
    actions: [],
    parcel: null,
    handL: root.getObjectByName('hand_l') as THREE.Bone,
    handR: root.getObjectByName('hand_r') as THREE.Bone,
  };
  scene.add(root);
  people.push(p);
  return p;
}

function setAct(p: Person, act: string): void {
  if (p.act === act) return;
  const old = p.actions;
  p.actions = ACTS[act]!.map((c) => {
    const a = p.mixer.clipAction(c);
    a.reset();
    if (act === 'Pick up') {
      a.setLoop(THREE.LoopPingPong, Infinity);
    }
    // Walking: one step per beat (the clip is two steps).
    if (MOVING.has(act)) a.timeScale = walk.duration / (2 * BEAT);
    a.fadeIn(0.25).play();
    return a;
  });
  for (const a of old) if (!p.actions.includes(a)) a.fadeOut(0.25);
  p.act = act;
  // A parcel in the hands while carrying (and during a pick-up).
  const wants = act === 'Carry' || act === 'Pick up';
  if (wants && !p.parcel) {
    p.parcel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.32), parcelMat);
    scene.add(p.parcel);
  } else if (!wants && p.parcel) {
    scene.remove(p.parcel);
    p.parcel = null;
  }
}

// The front worker, by the table.
const hero = makePerson(0);
hero.root.position.set(0, 0, -0.05);
setAct(hero, 'Idle');

// The crew: walking round ovals at different distances, so all three levels show.
let crewSize = 0;
function setCrew(n: number): void {
  while (people.length - 1 > n) {
    const p = people.pop()!;
    scene.remove(p.root);
    if (p.parcel) scene.remove(p.parcel);
  }
  while (people.length - 1 < n) {
    const k = people.length;
    const p = makePerson(k);
    p.track = { r: 4 + ((k * 7) % 30), a: rnd() * Math.PI * 2, dir: k % 2 ? 1 : -1 };
    setAct(p, k % 3 === 0 ? 'Carry' : 'Walk');
  }
  crewSize = n;
}
setCrew(12);

// ---- Controls ----
let tint = false;
const LOD_TINT = [0x2fa58f, 0xf2a51a, 0xe2231a];
function button(row: string, label: string, on: () => void, active = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.classList.toggle('on', active);
  b.onclick = () => {
    on();
    for (const x of b.parentElement!.querySelectorAll('button')) if (x.dataset.group === b.dataset.group) x.classList.toggle('on', x === b);
  };
  b.dataset.group = row;
  document.getElementById(row)!.append(b);
  return b;
}
for (const a of Object.keys(ACTS)) button('acts', a, () => setAct(hero, a), a === 'Idle');
for (const n of [0, 12, 96]) button('crew', n === 96 ? '96 (scene)' : String(n), () => setCrew(n), n === 12);
const look = document.createElement('button');
look.textContent = 'Toon: on';
look.className = 'on';
look.onclick = () => {
  TOON.value = TOON.value ? 0 : 1;
  look.textContent = `Toon: ${TOON.value ? 'on' : 'off'}`;
  look.classList.toggle('on', !!TOON.value);
};
const tb = document.createElement('button');
tb.textContent = 'Colour by level';
tb.onclick = () => {
  tint = !tint;
  tb.classList.toggle('on', tint);
};
document.getElementById('view')!.append(look, tb);

document.getElementById('loading')!.remove();
document.getElementById('ui')!.hidden = false;
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- Frame ----
const clock = new THREE.Clock();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const counts = [0, 0, 0];
let ms = 16;
const stats = document.getElementById('stats')!;
let statAt = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  const t0 = performance.now();
  counts.fill(0);
  for (const p of people) {
    // Walking round its oval at the clip's own pace.
    if (p.track && MOVING.has(p.act)) {
      const sp = walkSpeed * (walk.duration / (2 * BEAT));
      p.track.a += (p.track.dir * sp * dt) / p.track.r;
      const x = Math.cos(p.track.a) * p.track.r;
      const z = Math.sin(p.track.a) * p.track.r * 0.6 - 6;
      p.root.position.set(x, 0, z);
      // Facing along the oval.
      const tx = -Math.sin(p.track.a) * p.track.dir;
      const tz = Math.cos(p.track.a) * 0.6 * p.track.dir;
      p.root.rotation.y = Math.atan2(tx, tz);
    }
    p.mixer.update(dt);
    // Level of detail by distance; the face only close by.
    const d = p.root.position.distanceTo(camera.position);
    const lv = d < LOD_DIST[0]! ? 0 : d < LOD_DIST[1]! ? 1 : 2;
    counts[lv]!++;
    p.levels.forEach((m, k) => (m.visible = k === lv));
    for (const e of p.extras) e.visible = lv === 0 || e.type === 'Group';
    if (!p.hair.userData.off) p.hair.visible = true;
    p.mat.emissive.setHex(tint ? LOD_TINT[lv]! : 0);
    p.mat.emissiveIntensity = tint ? 0.6 : 0;
  }
  // Parcels held between the hands.
  for (const p of people) {
    if (!p.parcel) continue;
    p.root.updateMatrixWorld(true);
    p.handL.getWorldPosition(a);
    p.handR.getWorldPosition(b);
    p.parcel.position.addVectors(a, b).multiplyScalar(0.5);
    p.parcel.position.y -= 0.02;
    p.parcel.rotation.y = p.root.rotation.y;
  }
  controls.update();
  renderer.info.reset();
  renderer.render(scene, camera);
  ms = ms * 0.95 + (performance.now() - t0) * 0.05;
  if (t0 - statAt > 250) {
    statAt = t0;
    stats.textContent = [
      `people ${people.length}  (close ${counts[0]}, mid ${counts[1]}, far ${counts[2]})`,
      `body triangles per level  ${LOD_NAMES.map((n) => people[0]!.levels[LOD_NAMES.indexOf(n)]!.geometry.index!.count / 3).join(' / ')}`,
      `draw calls ${renderer.info.render.calls}   triangles ${(renderer.info.render.triangles / 1000).toFixed(0)}k`,
      `frame (cpu) ${ms.toFixed(1)} ms   walk ${walkSpeed.toFixed(2)} m/s, 1 step per beat at ${BPM} BPM`,
    ].join('\n');
  }
});

// For the screenshot script.
Object.assign(window, { mock: { people, setAct, setCrew, camera, controls, crewSize: () => crewSize } });
