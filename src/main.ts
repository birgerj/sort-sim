/**
 * Entry point: the hall, the music and the controls, wired together.
 *
 * URL parameters (all optional):
 *   time=day|night|cycle   time of day
 *   camera=auto|fly|follow camera mode
 *   dept=<id>              start at a department (see Sorter.departments())
 *   mute=1                 no start screen, no sound
 *   ui=0                   no controls, no start screen (for recordings and screenshots)
 *   quality=low|high       pixel ratio cap 1 or 2 (default 1.5)
 */
import './ui/style.css';

import { Music } from './audio/music';
import { Sorter } from './scene/sorter';
import { Hud, loadSettings, type TimeMode } from './ui/hud';

const q = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const scene = new Sorter();
app.append(scene.canvas);
const music = new Music();
const settings = loadSettings();

const time = q.get('time');
if (time === 'day' || time === 'night' || time === 'cycle') settings.time = time as TimeMode;
const cam = q.get('camera');
if (cam === 'auto' || cam === 'fly' || cam === 'follow') scene.setControl('cam', cam);
const dept = q.get('dept');
if (dept) scene.visit(dept, true);
const showUi = q.get('ui') !== '0';
const mute = q.get('mute') === '1' || !showUi;
music.setVolume(settings.volume);
music.setMuted(settings.muted);

const hud = new Hud(scene, music, settings, { showStart: showUi && !mute, showUi });
document.body.append(hud.root);

const quality = q.get('quality');
const maxRatio = quality === 'low' ? 1 : quality === 'high' ? 2 : 1.5;
const resize = () => scene.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, maxRatio));
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

let last = performance.now();
function frame(now: number): void {
  // (The first frame's timestamp can be earlier than the start time.)
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  const f = music.frame();
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
  });
  hud.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For the console and the screenshot script.
Object.assign(window, { sortsim: { scene, music, settings, setTod: (t: number) => (tod = t) } });
