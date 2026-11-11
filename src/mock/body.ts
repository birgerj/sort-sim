// Trial page: our people's proportions, old (`?body=old`) and new, each next to a modelled
// human (Quaternius' Universal Base Characters, CC0) scaled to the same height, with lines at
// its crown, chin and shoulder joint. Without `?pane` the page shows two panes, old and new.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildHuman, startLaterWork, type Human } from '../scene/people';
import { REST_SPREAD } from '../scene/people';
import type { FloorKit } from '../scene/floor';
import { BODY } from '../scene/proportions';

const params = new URLSearchParams(location.search);
const VIEWS = ['Front', 'Side', 'Three-quarter', 'Heads'] as const;
type View = (typeof VIEWS)[number];

if (!params.has('pane')) {
  // ---- The two panes and the view buttons ----
  const panes = document.createElement('div');
  panes.id = 'panes';
  const frames = ['old', 'new'].map((b) => {
    const f = document.createElement('iframe');
    f.src = `?pane=1&body=${b}`;
    f.title = b === 'old' ? 'Old proportions' : 'New proportions';
    panes.append(f);
    return f;
  });
  const bar = document.createElement('div');
  bar.id = 'bar';
  const buttons = VIEWS.map((v, i) => {
    const b = document.createElement('button');
    b.textContent = v;
    b.className = i === 0 ? 'on' : '';
    b.onclick = () => {
      for (const x of buttons) x.className = x === b ? 'on' : '';
      for (const f of frames) f.contentWindow?.postMessage({ view: v }, '*');
    };
    bar.append(b);
    return b;
  });
  document.body.append(panes, bar);
} else {
  // ---- One pane ----
  const loading = document.createElement('div');
  loading.id = 'loading';
  loading.textContent = 'Building…';
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.textContent = BODY.old ? 'Old: long neck, small head' : 'New: shoulders up 4 cm, head 6 % larger';
  const legend = document.createElement('div');
  legend.id = 'legend';
  legend.innerHTML = 'Reference (grey, same height):<br><i style="background:#e2231a"></i>crown<br><i style="background:#1755fe"></i>chin<br><i style="background:#2fa58f"></i>shoulder joint';
  document.body.append(loading, tag, legend);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 5);
  scene.add(sun);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  camera.position.set(0, 1, 3);

  const kit = {
    std: (color: number, rough = 0.8, metal = 0, day?: number) => new THREE.MeshStandardMaterial({ color: day ?? color, roughness: rough, metalness: metal }),
    put: (o: THREE.Object3D) => scene.add(o),
    blobUnder: () => {},
    blob: () => {},
  } as unknown as FloorKit;

  const H = 1.784;
  const loader = new GLTFLoader();
  const model = await loader.loadAsync('./mock/worker.glb');

  // The reference, grey, in the middle.
  const ref = model.scene;
  const grey = new THREE.MeshStandardMaterial({ color: 0xc4c8cf, roughness: 0.7 });
  ref.traverse((o) => {
    if (/Body_LOD[12]/.test(o.name)) o.visible = false;
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = grey;
  });
  const refHolder = new THREE.Group();
  refHolder.add(ref);
  scene.add(refHolder);
  // Both stand as ours do at rest: straight, the arms down and out by REST_SPREAD (the model
  // is made with its arms straight out: turned down about the shoulder, in world space).
  ref.updateMatrixWorld(true);
  for (const side of ['l', 'r']) {
    const bone = ref.getObjectByName(`upperarm_${side}`)!;
    const out = ref.getObjectByName(`lowerarm_${side}`)!.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3()));
    const sg = Math.sign(out.x);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -sg * (Math.PI / 2 - REST_SPREAD));
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(parent.multiply(turn.multiply(world)));
    ref.updateMatrixWorld(true);
  }
  // Scale it to our height as it stands, and mark its crown, chin and shoulder joint.
  ref.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(ref, true);
  const k = H / box.max.y;
  ref.scale.setScalar(k);
  ref.updateMatrixWorld(true);
  const wy = (n: string) => ref.getObjectByName(n)!.getWorldPosition(new THREE.Vector3()).y;
  // (Chin: 2.5 cm below the head bone on the model, at its own scale of 1.81 m.)
  const lines: [number, number][] = [
    [H, 0xe2231a],
    [wy('Head') - 0.025 * (H / 1.81), 0x1755fe],
    [(wy('upperarm_l') + wy('upperarm_r')) / 2, 0x2fa58f],
  ];
  for (const [y, c] of lines) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.5, y, 0.5), new THREE.Vector3(1.5, y, 0.5)]);
    scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: c })));
  }

  // Ours: a worker and a planner in a suit either side, at the same height.
  const people: Human[] = [
    buildHuman(kit, { shirt: 0x3f4a5c, trousers: 0x2b2f3a, vest: 0xf2c200, skin: 0xe8c4a0, hair: 0x3a2a1c, hairStyle: 0, build: { height: 1, width: 1.02, belly: 0 } }),
    buildHuman(kit, { shirt: 0x2b2f3a, trousers: 0x2b2f3a, suit: { tie: 0xb3122a }, skin: 0xc68e62, hair: 0x1d1d1f, hairStyle: 1, build: { height: 1, width: 0.93, belly: 0 } }),
  ];
  const holders = [refHolder];
  people.forEach((h, i) => {
    const g = new THREE.Group();
    g.position.x = i === 0 ? -0.62 : 0.62;
    g.add(h.root);
    scene.add(g);
    holders.push(g);
  });
  startLaterWork();

  let view: View = 'Front';
  const resize = () => {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h);
    const heads = view === 'Heads';
    const span = heads ? 0.7 : 2.25;
    const cy = heads ? 1.5 : 0.98;
    const a = w / h;
    camera.left = (-span / 2) * a;
    camera.right = (span / 2) * a;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    // (Close: people show their fine level within 6 m.)
    camera.position.set(0, cy, 3);
    camera.lookAt(0, cy, 0);
    camera.updateProjectionMatrix();
  };
  const setView = (v: View) => {
    view = v;
    const ry = v === 'Side' ? Math.PI / 2 : v === 'Three-quarter' ? 0.6 : 0;
    for (const g of holders) g.rotation.y = ry;
    resize();
  };
  addEventListener('resize', resize);
  addEventListener('message', (e) => {
    if (VIEWS.includes(e.data?.view)) setView(e.data.view);
  });
  setView('Front');
  loading.remove();

  renderer.setAnimationLoop(() => {
    for (const h of people) {
      h.root.updateMatrixWorld(true);
    }
    renderer.render(scene, camera);
  });
}
