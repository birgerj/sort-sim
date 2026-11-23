// A page to work on the game's screens without the hall and without the score
// model: a fake score service that answers every level with the level 4 fixture
// after a second, and a fake director that only runs the clock.
//
//   /shifts-dev.html                 as a new player
//   /shifts-dev.html?done=6          with the first six levels done
//   /shifts-dev.html?reject=1        the score service refuses every plan
//   /shifts-dev.html?clear=1         forget stored progress first
import type { Director, Level, Plan, PlanProblem, Result, ScoreService, Timeline } from '../../shifts/contract';
import levelData from '../../shifts/levels.json' with { type: 'json' };
import fixture from '../../../tests/fixtures/shifts/level4.json' with { type: 'json' };
import { mountShifts } from './index';
import { createProgress, PROGRESS_KEY } from './progress';

const levels = levelData as unknown as Level[];
const params = new URLSearchParams(location.search);

// Sixteen towns to stand in for the chosen country's largest.
const NAMES = ['Amsterdam', 'Rotterdam', 'Den Haag', 'Utrecht', 'Eindhoven', 'Groningen', 'Tilburg', 'Almere', 'Breda', 'Nijmegen', 'Apeldoorn', 'Arnhem', 'Haarlem', 'Enschede', 'Amersfoort', 'Zaanstad'];

if (params.has('clear') || params.has('done')) {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch {
    /* no storage */
  }
}
const progress = createProgress();
const done = Math.min(10, Number(params.get('done') ?? 0));
if (done > 0) {
  progress.markIntroSeen();
  const scores = [1000, 857, 988, 906, 941, 902, 874, 913, 836, 760];
  for (let id = 1; id <= done; id++) {
    const score = scores[id - 1]!;
    const stars = score >= 900 ? 3 : score >= 750 ? 2 : 1;
    progress.record(id, fixture.plan as Plan, { ...(fixture.result as Result), score, stars, badge: id % 3 === 1 });
  }
}

const score: ScoreService = {
  run: () =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        if (params.has('reject')) reject([{ kind: 'noDock', block: 1 }, { kind: 'tooManyPeople', at: 90 }] satisfies PlanProblem[]);
        else resolve({ result: fixture.result as Result, timeline: fixture.timeline as Timeline });
      }, 1000),
    ),
};

/** Runs the shift's clock and nothing else; says what it is asked in the page's corner. */
function fakeDirector(note: HTMLElement): Director {
  let minute = 0;
  let end = 0;
  let speed = 8;
  let timer = 0;
  let last = 0;
  let clockFn: ((m: number) => void) | undefined;
  let doneFn: (() => void) | undefined;
  const stop = () => {
    cancelAnimationFrame(timer);
    timer = 0;
  };
  const finish = () => {
    stop();
    const fn = doneFn;
    doneFn = undefined;
    clockFn?.(end);
    fn?.();
  };
  const tick = (now: number) => {
    minute += ((now - last) / 1000) * speed;
    last = now;
    if (minute >= end) return finish();
    clockFn?.(minute);
    timer = requestAnimationFrame(tick);
  };
  return {
    enter(level) {
      end = level.shiftMinutes;
      note.textContent = `The hall would now show level ${level.id}: doors down, shift starting`;
    },
    play(timeline, onClock, onDone) {
      stop();
      minute = 0;
      end = end || (timeline.buffer.length - 1) * timeline.stepMinutes;
      clockFn = onClock;
      doneFn = onDone;
      last = performance.now();
      note.textContent = 'The 3D hall plays here';
      timer = requestAnimationFrame(tick);
    },
    setSpeed(v) {
      speed = v;
    },
    skip: finish,
    exit() {
      stop();
      doneFn = undefined;
      note.textContent = 'Free simulation (the hall as it was)';
    },
  };
}

const note = document.getElementById('hall-note')!;
const game = mountShifts({
  score,
  director: fakeDirector(note),
  levels,
  cityNames: () => NAMES,
  onFree: () => (document.getElementById('reopen')!.hidden = false),
  progress,
});
document.body.append(game.root);
document.getElementById('reopen')!.addEventListener('click', () => {
  document.getElementById('reopen')!.hidden = true;
  game.open();
});
game.open();
