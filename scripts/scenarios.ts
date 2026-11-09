// Balance check: plays seeds with different player styles and prints the shown
// score (100 = standing plan, no moves; 1000 = par).
//   npx tsx scripts/scenarios.ts [seeds per country] [NL-7KQ2MX …]
import { COUNTRIES } from '../src/sim/countries';
import { makeNight, type Night } from '../src/game/night';
import { play, type Move } from '../src/game/model';
import { bestMoves, bestPlan, par, shown, standingPlan } from '../src/game/par';
import { formatSeed, parseSeed, randomSeed } from '../src/game/seed';
import { Rng } from '../src/sim/rng';

const args = process.argv.slice(2);
const per = Number(args.find((a) => /^\d+$/.test(a)) ?? 4);
const given = args.map(parseSeed).filter((s) => s !== null);
const rng = new Rng(42);
const seeds = given.length ? given : ['nl', 'fi', 'de', 'au'].flatMap((id) => Array.from({ length: per }, () => randomSeed(COUNTRIES.find((c) => c.id === id)!, () => rng.next())));

type Style = { name: string; run: (n: Night) => { doors: number[]; reserve: number; moves: Move[] } };
const styles: Style[] = [
  {
    name: 'Clumsy (no reserve, frees it at 22:00, swaps away a busy door)',
    run: (n) => {
      const p = { ...standingPlan(n), reserve: 0 };
      const busiest = n.cities.findIndex((c) => c.standing > 0);
      const quiet = n.cities.map((c) => c.standing).lastIndexOf(1);
      return { ...p, moves: [{ kind: 'release', hour: 0 }, { kind: 'swap', hour: 4, from: busiest, to: quiet }, { kind: 'hold', city: 1, window: 1 }] };
    },
  },
  { name: 'Passive (standing plan, no moves)', run: (n) => ({ ...standingPlan(n), moves: [] }) },
  { name: 'Reactive (standing plan + 5 best moves)', run: (n) => ({ ...standingPlan(n), moves: bestMoves(n, standingPlan(n), 5) }) },
  { name: 'Planner (best plan, no moves)', run: (n) => ({ ...bestPlan(n), moves: [] }) },
  { name: 'Good (best plan + 3 best moves)', run: (n) => { const p = bestPlan(n); return { ...p, moves: bestMoves(n, p, 3) }; } },
  { name: 'Very good (best plan + 6 best moves)', run: (n) => { const p = bestPlan(n); return { ...p, moves: bestMoves(n, p, 6) }; } },
  { name: 'Max (best plan + up to 10 moves)', run: (n) => { const p = bestPlan(n); return { ...p, moves: bestMoves(n, p, 10) }; } },
];

const sums = styles.map(() => 0);
const onT = styles.map(() => 0);
let useful = 0;
for (const s of seeds) {
  const night = makeNight(s);
  const p = par(night);
  useful += p.moves.length;
  const row: string[] = [];
  styles.forEach((st, k) => {
    const r = st.run(night);
    const res = play(night, { doors: r.doors, reserve: r.reserve }, r.moves);
    const sc = shown(res.raw, p);
    sums[k] += sc;
    onT[k] += res.onTime;
    row.push(String(sc).padStart(5));
  });
  const ev = night.events.map((e) => e.kind).join(',');
  console.log(`${formatSeed(s)}  ${row.join(' ')}   moves at par ${p.moves.length}  ${ev}`);
}
console.log('\nAverage over', seeds.length, 'nights:');
styles.forEach((st, k) => console.log(`  ${String(Math.round(sums[k]! / seeds.length)).padStart(5)}  ${((onT[k]! / seeds.length) * 100).toFixed(1)}% on time  ${st.name}`));
console.log(`  moves that still pay at par: ${(useful / seeds.length).toFixed(1)} on average`);
