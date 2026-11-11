// Animation clips on our own people: motion-captured style clips from a free (CC0) library,
// played on the jointed people of people.ts instead of the generated gait.
//
// The clips are made for another skeleton (65 bones, standing with the arms straight out). At
// load they are carried over to ours once (`loadClips`): for each of our joints, its partner
// bone's turn away from its own rest pose, in world space, is given to our joint from our
// rest pose; arms first turned from straight out to our rest spread so the two rests agree.
// Our left is on -x, theirs on +x: their right side drives our left. The result is a few
// dozen poses per clip (a quaternion per joint and the hip's offset), sampled by `poseClip`.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HIP_Y, REST_SPREAD, type Human } from './people';

type J = 'pelvis' | 'legL' | 'kneeL' | 'footL' | 'legR' | 'kneeR' | 'footR' | 'torso' | 'chest' | 'head' | 'armL' | 'foreL' | 'handL' | 'armR' | 'foreR' | 'handR';
const JOINTS: J[] = ['pelvis', 'legL', 'kneeL', 'footL', 'legR', 'kneeR', 'footR', 'torso', 'chest', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR'];
const PARENT: Record<J, J | null> = {
  pelvis: null,
  legL: 'pelvis',
  kneeL: 'legL',
  footL: 'kneeL',
  legR: 'pelvis',
  kneeR: 'legR',
  footR: 'kneeR',
  torso: 'pelvis',
  chest: 'torso',
  head: 'chest',
  armL: 'chest',
  foreL: 'armL',
  handL: 'foreL',
  armR: 'chest',
  foreR: 'armR',
  handR: 'foreR',
};
/** Their bone for each of our joints, by side: `s` is the side on our -x (their right). */
const SOURCE = (s: string, o: string): Record<J, string> => ({
  pelvis: 'pelvis',
  legL: `thigh_${s}`,
  kneeL: `calf_${s}`,
  footL: `foot_${s}`,
  legR: `thigh_${o}`,
  kneeR: `calf_${o}`,
  footR: `foot_${o}`,
  // (Their spine has three bones: our waist takes the lowest, our chest the top one.)
  torso: 'spine_01',
  chest: 'spine_03',
  head: 'Head',
  armL: `upperarm_${s}`,
  foreL: `lowerarm_${s}`,
  handL: `hand_${s}`,
  armR: `upperarm_${o}`,
  foreR: `lowerarm_${o}`,
  handR: `hand_${o}`,
});
/** The next bone along each arm bone (their rest direction). */
const NEXT = (s: string, o: string): Partial<Record<J, string>> => ({
  armL: `lowerarm_${s}`,
  foreL: `hand_${s}`,
  handL: `middle_01_${s}`,
  armR: `lowerarm_${o}`,
  foreR: `hand_${o}`,
  handR: `middle_01_${o}`,
});

/** A clip carried over to our joints. */
export interface Clip {
  /** Poses over one cycle. */
  n: number;
  /** n × 16 joints × xyzw (local). */
  q: Float32Array;
  /** n × the hip's offset from rest (x, y, z, metres on our scale). */
  hip: Float32Array;
  /** Walking clips: one step's length (metres on our scale); 0 otherwise. */
  step: number;
}

/** The clips, by their name in the library, once loaded. */
export const CLIPS = new Map<string, Clip>();
/** Off with `?clips=0` (the generated gait instead). */
export const clipOptions = { on: true };

const POSES = 48;

/** Load the library and carry its clips over to our joints. Leaves CLIPS empty if it fails. */
export async function loadClips(url: string): Promise<void> {
  if (!clipOptions.on) return;
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const node = (n: string) => {
      const o = root.getObjectByName(n);
      if (!o) throw new Error(`no bone ${n}`);
      return o;
    };
    // Which of their sides is on our -x.
    const s = node('thigh_l').getWorldPosition(new THREE.Vector3()).x < 0 ? 'l' : 'r';
    const o = s === 'l' ? 'r' : 'l';
    const src = SOURCE(s, o);
    const next = NEXT(s, o);

    // Rest: theirs, and ours (everything straight, the arms out by REST_SPREAD).
    const ourRest: Record<J, THREE.Quaternion> = {} as never;
    const restAdj: Record<J, THREE.Quaternion> = {} as never;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const j of JOINTS) {
      const side = j.endsWith('L') && j !== 'pelvis' ? -1 : 1;
      const arm = /^(arm|fore|hand)/.test(j);
      ourRest[j] = arm ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), side * REST_SPREAD) : new THREE.Quaternion();
      const theirs = node(src[j]).getWorldQuaternion(new THREE.Quaternion());
      if (arm) {
        // Turn their straight-out arm to hang as ours does at rest.
        node(src[j]).getWorldPosition(a);
        node(next[j]!).getWorldPosition(b);
        const dir = b.sub(a).normalize();
        const ours = new THREE.Vector3(0, -1, 0).applyQuaternion(ourRest[j]);
        restAdj[j] = new THREE.Quaternion().setFromUnitVectors(dir, ours).multiply(theirs);
      } else restAdj[j] = theirs;
    }
    const restInv = Object.fromEntries(JOINTS.map((j) => [j, restAdj[j].clone().invert()])) as Record<J, THREE.Quaternion>;
    const pelvisRest = node('pelvis').getWorldPosition(new THREE.Vector3());
    const k = HIP_Y / pelvisRest.y;

    const mixer = new THREE.AnimationMixer(root);
    const world: Record<J, THREE.Quaternion> = Object.fromEntries(JOINTS.map((j) => [j, new THREE.Quaternion()])) as never;
    const qs = new THREE.Quaternion();
    const inv = new THREE.Quaternion();
    const foot = node(`foot_${o}`);
    for (const anim of gltf.animations) {
      const act = mixer.clipAction(anim);
      act.play();
      const q = new Float32Array(POSES * JOINTS.length * 4);
      const hip = new Float32Array(POSES * 3);
      let lo = Infinity;
      let hi = -Infinity;
      for (let f = 0; f < POSES; f++) {
        mixer.setTime((anim.duration * f) / POSES);
        root.updateMatrixWorld(true);
        JOINTS.forEach((j, n) => {
          // Their turn from rest, in world space, given to our joint from our rest.
          node(src[j]).getWorldQuaternion(qs);
          world[j].copy(qs).multiply(restInv[j]).multiply(ourRest[j]);
          const p = PARENT[j];
          const local = p ? inv.copy(world[p]).invert().multiply(world[j]) : world[j];
          local.toArray(q, (f * JOINTS.length + n) * 4);
        });
        node('pelvis').getWorldPosition(a).sub(pelvisRest).multiplyScalar(k);
        hip.set([a.x, a.y, a.z], f * 3);
        const z = foot.getWorldPosition(b).z * k;
        lo = Math.min(lo, z);
        hi = Math.max(hi, z);
      }
      act.stop();
      mixer.uncacheAction(anim);
      CLIPS.set(anim.name, { n: POSES, q, hip, step: /Walk|Jog/.test(anim.name) ? hi - lo : 0 });
    }
  } catch (e) {
    console.warn('clips not loaded', e);
    CLIPS.clear();
  }
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const ID = new THREE.Quaternion();
const LEGS = new Set<J>(['legL', 'kneeL', 'footL', 'legR', 'kneeR', 'footR']);

/**
 * Pose a person from a clip at `phase` (0…1 over the clip). `legs` < 1 shortens the stride:
 * the legs' turns are scaled down towards standing (walking slower than the clip).
 */
export function poseClip(h: Human, c: Clip, phase: number, legs = 1): void {
  const x = (((phase % 1) + 1) % 1) * c.n;
  const f0 = Math.floor(x) % c.n;
  const f1 = (f0 + 1) % c.n;
  const t = x - Math.floor(x);
  JOINTS.forEach((j, n) => {
    qa.fromArray(c.q, (f0 * JOINTS.length + n) * 4);
    qb.fromArray(c.q, (f1 * JOINTS.length + n) * 4);
    qa.slerp(qb, t);
    if (legs < 1 && LEGS.has(j)) qa.copy(qb.copy(ID).slerp(qa, legs));
    (h[j] as THREE.Object3D).quaternion.copy(qa);
  });
  const hx = c.hip[f0 * 3]! + (c.hip[f1 * 3]! - c.hip[f0 * 3]!) * t;
  const hy = c.hip[f0 * 3 + 1]! + (c.hip[f1 * 3 + 1]! - c.hip[f0 * 3 + 1]!) * t;
  h.pelvis.position.set(hx, HIP_Y + hy * Math.max(legs, 0.5), 0);
}
