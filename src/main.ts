/**
 * Entry point: the hall, the music and the controls, wired together.
 *
 * URL parameters (all optional):
 *   time=day|night         time of day (fixed: it does not change by itself)
 *   look=minimal|real      the day's look: a clean drawing, or lit like a photo
 *   camera=fly|follow|walk camera mode (auto: fly)
 *   dept=<id>              start at a department (see Sorter.departments())
 *   mute=1                 no start screen, no sound
 *   ui=0                   no controls, no start screen (for recordings and screenshots)
 *   speed=0.5|1|2|4        belt speed (multiple of 2 m per beat)
 *   night=party|calm|dark  what the night shows (Night effects panel; remembered otherwise)
 *   game=NL-7KQ2M0         play that night (with plan=…&reserve=…: the player's door plan)
 *   quality=low|normal|high  render quality (high: ambient occlusion, sun shadows,
 *                            glossy night floor, depth of field; pixel ratio 1 / 1.5 / 2)
 */
import { setCountry } from './sim/countries';
import './ui/style.css';

import { Music } from './audio/music';
import { Sorter } from './scene/sorter';
import { loadBakedBodies, startLaterWork } from './scene/people';
import { NIGHT_PRESETS, normalizeNightFx } from './scene/nightFx';
import { Hud, loadSettings, saveSettings, type Settings, type TimeMode } from './ui/hud';
import { startCard } from './ui/startCard';
import { Pwa, checkForUpdates } from './ui/pwa';
import { WalkControls } from './ui/walk';
import { GameUi } from './ui/game';
import { ANTICS } from './scene/antics';

const q = new URLSearchParams(location.search);
// First of all: is there a new version? (Offered at the top of the start card as soon as it is found.)
void checkForUpdates();

// When something goes wrong, say so on screen (phones have no console to look in): a script error,
// or the graphics chip dropping the WebGL context (usually out of memory), which leaves a black canvas.
function showProblem(title: string, detail: string): void {
  let box = document.getElementById('problem');
  if (!box) {
    box = document.createElement('div');
    box.id = 'problem';
    box.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;padding:12px 14px;border-radius:10px;background:#2b1b1b;color:#ffd9d9;font:13px/1.4 system-ui,sans-serif;white-space:pre-wrap;max-height:40vh;overflow:auto';
    document.body.append(box);
  }
  box.textContent = `${title}\n${detail}\n\nTry ?quality=low or ?look=minimal in the address, or reload.`;
}
window.addEventListener('error', (e) => {
  // "Script error." without a file comes from a script of another origin (the browser's page
  // translation, an extension): nothing of ours, and nothing to show.
  if (!e.filename && (!e.message || e.message === 'Script error.')) return;
  showProblem('Something went wrong', `${e.message}\n${e.filename?.split('/').pop() ?? ''}:${e.lineno}:${e.colno}`);
});
window.addEventListener('unhandledrejection', (e) => showProblem('Something went wrong', String((e.reason as Error)?.stack ?? e.reason)));
const app = document.getElementById('app')!;
// The loading screen (in index.html) is up; let the browser paint it before the hall is built,
// which keeps the page busy for a few seconds on a phone.
const loading = document.getElementById('loading');
const loadingSay = (text: string) => {
  const m = loading?.querySelector('.msg');
  if (m) m.textContent = text;
};
const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
// The music exists before the hall, so Start (a tap, which browsers need for sound) can start it
// even while the hall is still being built.
const music = new Music();
const showUi = q.get('ui') !== '0';
const mute = q.get('mute') === '1' || !showUi;
// The start card goes up at once; the loading screen behind it stays quiet until Start is
// pressed (and only shows if the hall is not ready by then).
/** The settings the HUD works with, once they are loaded (Start may come before or after). */
let liveSettings: Settings | null = null;
if (showUi && !mute) {
  loading?.classList.add('quiet');
  startCard((sound) => {
    const st = loadSettings();
    st.muted = !sound;
    saveSettings(st);
    if (liveSettings) liveSettings.muted = !sound;
    music.setMuted(!sound);
    if (sound) void music.start();
    loading?.classList.remove('quiet');
  });
}
await nextPaint();
// The people's bodies, made at build time (a few hundred kB), while the loading screen is up.
await loadBakedBodies();
const scene = new Sorter();
app.append(scene.canvas);
scene.canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  showProblem('The graphics were reset (WebGL context lost)', `Quality: ${loadSettings().quality}, look: ${loadSettings().look ?? 'minimal'}. This is usually the device running out of graphics memory.`);
});
scene.canvas.addEventListener('webglcontextrestored', () => location.reload());
const walk = new WalkControls(scene, scene.canvas);
const settings = loadSettings();
liveSettings = settings;

const time = q.get('time');
if (time === 'day' || time === 'night') settings.time = time as TimeMode;
const look = q.get('look');
if (look === 'minimal' || look === 'real') settings.look = look;
scene.setRealistic(settings.look === 'real');
const cam = q.get('camera');
if (cam === 'auto' || cam === 'fly' || cam === 'follow' || cam === 'walk') scene.setControl('cam', cam);
const speed = Number(q.get('speed') ?? settings.speed);
scene.setBeltSpeed(speed);
const dept = q.get('dept');
if (dept) scene.visit(dept, true);
const night = q.get('night');
const nightFx = night === 'party' || night === 'calm' || night === 'dark' ? { ...NIGHT_PRESETS[night] } : normalizeNightFx(settings.night);
scene.setNightFx(nightFx);
const rate = Number(q.get('rate'));
if (rate > 0) settings.rate = rate;
music.setVolume(settings.volume);
music.setMuted(settings.muted);

let hudQuality = () => {};
const hud = new Hud(scene, music, settings, { showStart: false, showUi, onQuality: () => hudQuality(), onGame: () => game?.openBriefing() });
document.body.append(hud.root);
// The night-shift game: its own dock at the top of the screen (see ui/game.ts).
const game = showUi ? new GameUi(music, scene) : null;
if (game) document.body.append(game.root);
// Walk and fly controls sit under the menu (an open panel may cover them).
hud.root.prepend(walk.root);
const pwa = new Pwa(hud.root, music);
hud.appGroup.prepend(pwa.install, pwa.fullscreen);

const ql = q.get('quality');
if (ql === 'low' || ql === 'normal' || ql === 'high') settings.quality = ql;
else if (ql === 'ultra') settings.quality = 'high'; // (old links)
const resize = () => {
  const dpr = window.devicePixelRatio || 1;
  const ratio = Math.min(dpr, { low: 1, normal: 1.5, high: 2 }[settings.quality]);
  scene.resize(window.innerWidth, window.innerHeight, ratio);
};
scene.setQuality(settings.quality);
hudQuality = () => {
  scene.setQuality(settings.quality);
  resize();
};
window.addEventListener('resize', resize);
resize();

// Time of day: 0 day, 1 night, as chosen (a switch fades over a moment).
let tod = settings.time === 'night' ? 1 : 0;
const targetTod = () => (settings.time === 'night' ? 1 : 0);

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
    // The hall stands still, but you can still walk, fly and look around.
    scene.renderPaused(dt);
    hud.update();
    game?.frame(dt);
    requestAnimationFrame(frame);
    return;
  }
  for (const n of f.notes) scene.note(n.color, n.pitch, n.vel, n.dur, n.role);
  tod += (targetTod() - tod) * Math.min(1, dt * 0.8);
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
  game?.frame(dt);
  requestAnimationFrame(frame);
}
// Compile the shaders before the first frame (in parallel where the browser can), with the
// loading screen still up; it fades out once the hall has been drawn.
loadingSay('Preparing the graphics…');
await nextPaint();
await scene.warmUp(tod);
requestAnimationFrame((t) => {
  frame(t);
  if (loading) {
    loading.style.opacity = '0';
    setTimeout(() => loading.remove(), 700);
  }
  // Now the fine detail of the people, in spare moments.
  startLaterWork();
});

// For the console and the screenshot script.
Object.assign(window, { sortsim: { scene, music, settings, antics: ANTICS, setTod: (t: number) => (tod = t), setCountry } });
