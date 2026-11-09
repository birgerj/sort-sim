/**
 * Entry point: the hall, the music and the controls, wired together.
 *
 * URL parameters (all optional):
 *   time=day|night|cycle   time of day
 *   camera=auto|fly|follow|walk camera mode
 *   dept=<id>              start at a department (see Sorter.departments())
 *   mute=1                 no start screen, no sound
 *   ui=0                   no controls, no start screen (for recordings and screenshots)
 *   speed=0.5|1|2|4        belt speed (multiple of 2 m per beat)
 *   quality=low|normal|high|ultra  render quality (high: ambient occlusion, sun shadows,
 *                            glossy night floor, depth of field; pixel ratio 1 / 1.5 / 2)
 */
import './ui/style.css';

import { Music } from './audio/music';
import { Sorter } from './scene/sorter';
import { Hud, loadSettings, type TimeMode } from './ui/hud';
import { Pwa } from './ui/pwa';
import { WalkControls } from './ui/walk';
import { ANTICS } from './scene/antics';

const q = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const scene = new Sorter();
app.append(scene.canvas);
const walk = new WalkControls(scene, scene.canvas);
const music = new Music();
const settings = loadSettings();

const time = q.get('time');
if (time === 'day' || time === 'night' || time === 'cycle') settings.time = time as TimeMode;
const cam = q.get('camera');
if (cam === 'auto' || cam === 'fly' || cam === 'follow' || cam === 'walk') scene.setControl('cam', cam);
const speed = Number(q.get('speed') ?? settings.speed);
scene.setBeltSpeed(speed);
const dept = q.get('dept');
if (dept) scene.visit(dept, true);
const rate = Number(q.get('rate'));
if (rate > 0) settings.rate = rate;
const showUi = q.get('ui') !== '0';
const mute = q.get('mute') === '1' || !showUi;
music.setVolume(settings.volume);
music.setMuted(settings.muted);

let hudQuality = () => {};
const hud = new Hud(scene, music, settings, { showStart: showUi && !mute, showUi, onQuality: () => hudQuality() });
document.body.append(hud.root);
const pwa = new Pwa(hud.root, music);
hud.appGroup.append(pwa.install, pwa.fullscreen);

const ql = q.get('quality');
if (ql === 'low' || ql === 'normal' || ql === 'high' || ql === 'ultra') settings.quality = ql;
const resize = () => {
  const dpr = window.devicePixelRatio || 1;
  // Ultra renders at least at 2× (supersampling on ordinary screens) for crisp lines.
  const ratio = settings.quality === 'ultra' ? Math.min(3, Math.max(2, dpr)) : Math.min(dpr, { low: 1, normal: 1.5, high: 2 }[settings.quality]);
  scene.resize(window.innerWidth, window.innerHeight, ratio);
};
scene.setQuality(settings.quality);
hudQuality = () => {
  scene.setQuality(settings.quality);
  resize();
};
window.addEventListener('resize', resize);
resize();

// Time of day: 0 day, 1 night. The cycle holds each for a while, with a slow dusk and dawn.
const CYCLE_S = 240;
let tod = settings.time === 'night' ? 1 : 0;
const targetTod = (t: number) => {
  if (settings.time === 'day') return 0;
  if (settings.time === 'night') return 1;
  const c = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / CYCLE_S);
  return Math.min(1, Math.max(0, (c - 0.25) * 2));
};

// Space pauses the whole simulation (the music, its clock and everything that runs on it).
window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (e.code !== 'Space' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
  e.preventDefault();
  music.setPaused(!music.paused);
  if (music.paused) pwa.say('Paused. Press space to carry on.', 0);
  else pwa.say('Running.', 800);
});

let last = performance.now();
function frame(now: number): void {
  // (The first frame's timestamp can be earlier than the start time.)
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  walk.frame();
  const f = music.frame();
  if (music.paused) {
    f.notes.length = 0;
    hud.update();
    requestAnimationFrame(frame);
    return;
  }
  for (const n of f.notes) scene.note(n.color, n.pitch, n.vel, n.dur, n.role);
  tod += (targetTod(now / 1000) - tod) * Math.min(1, dt * 0.8);
  scene.render({
    dt,
    beats: f.beats,
    playing: true,
    kick: f.kick,
    snare: f.snare,
    hat: f.hat,
    energy: f.energy,
    bass: f.bass,
    pad: f.pad,
    cols: f.cols,
    travelSpeed: 0.4,
    bar: f.bar,
    tod,
    bpm: music.bpm,
  });
  // Hall sounds: effects near the camera, and the belts' hum.
  for (const sd of scene.takeSounds()) music.sfx(sd.kind, sd.vol, sd.n);
  music.setHum(scene.humLevel());
  // The music follows how busy the hub is: 60 BPM ambient at the lowest rate, up to 160 BPM
  // techno with an acid line at the highest; it moves a few BPM per bar.
  const r = Math.max(0, Math.min(1, (scene.rate - 20) / 780));
  music.setTempo(60 + 100 * Math.sqrt(r));
  hud.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For the console and the screenshot script.
Object.assign(window, { sortsim: { scene, music, settings, antics: ANTICS, setTod: (t: number) => (tod = t) } });
