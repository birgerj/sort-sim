// A stand-in for the hall's director: it only runs the shift clock. Used until the hall can play a
// shift itself, and wherever the game runs without the 3D scene. The free simulation is left alone.
import type { Director, Timeline } from './contract';

export function clockDirector(): Director {
  let speed = 8; // shift minutes per second
  let minute = 0;
  let end = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let done: (() => void) | null = null;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const finish = () => {
    stop();
    const d = done;
    done = null; // once, whether the clock ran out or the player skipped
    d?.();
  };
  return {
    enter() {
      stop();
      done = null;
    },
    play(timeline: Timeline, onClock, onDone) {
      stop();
      minute = 0;
      // The shift lasts until the last truck has left.
      end = Math.max((timeline.buffer.length - 1) * timeline.stepMinutes - 30, ...timeline.departures.map((d) => d.at));
      done = onDone;
      let last = performance.now();
      timer = setInterval(() => {
        const now = performance.now();
        minute = Math.min(end, minute + ((now - last) / 1000) * speed);
        last = now;
        onClock(minute);
        if (minute >= end) finish();
      }, 50);
    },
    setSpeed(minutesPerSecond: number) {
      speed = Math.max(0, minutesPerSecond);
    },
    skip() {
      finish();
    },
    exit() {
      stop();
      done = null;
    },
  };
}
