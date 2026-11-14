// The game's server: what it answers to a plan, what it keeps, and how it ranks.
import { expect, test } from 'vitest';
import { App } from '../server/app';
import { Store } from '../server/store';
import type { Plan, Result } from '../src/shifts/contract';
import { LEVELS, simulate } from '../src/shifts/model';
import best1 from '../tools/balance/best/level1.json';
import best2 from '../tools/balance/best/level2.json';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const good = best1 as unknown as Plan;
const poor: Plan = { blocks: [{ ...good.blocks[0]!, people: 2 }], robotCities: [], robots: 0 };

function make(): { app: App; store: Store } {
  let t = 1000;
  const store = new Store(':memory:');
  return { store, app: new App(store, { waitMs: 5000, atOnce: 2, now: () => t++ }) };
}
const play = (app: App, key: string, level: number, plan: Plan, name = 'Ann') => {
  const r = app.run({ level, plan, player: { key, name, country: 'nl' } }, '1.2.3.4');
  app.release(r.held);
  return r;
};

test('a plan gets the model’s own result, after the wait', () => {
  const { app } = make();
  const r = play(app, A, 1, good);
  expect(r.status).toBe(200);
  expect(r.wait).toBe(5000);
  expect((r.body as { result: Result }).result).toEqual(simulate(LEVELS[0]!, good).result);
});

test('a plan that cannot start comes back with its problems and is not held back', () => {
  const { app } = make();
  const r = play(app, A, 1, { blocks: [{ city: 0, start: 7, end: 20, people: 1, docks: 1 }], robotCities: [], robots: 0 });
  expect(r.status).toBe(422);
  expect(r.wait).toBeUndefined();
  expect((r.body as { problems: unknown[] }).problems.length).toBeGreaterThan(0);
});

test('nonsense is refused: unknown level, bad key, a plan of the wrong shape', () => {
  const { app } = make();
  expect(play(app, A, 99, good).status).toBe(400);
  expect(play(app, 'me', 1, good).status).toBe(400);
  expect(app.run({ level: 1, plan: { blocks: 'all' }, player: { key: A } }, 'x').status).toBe(400);
  expect(app.run({ level: 1, plan: { blocks: [{ city: 0, start: 0, end: 60, people: 3, docks: 1 }], robotCities: [], robots: 0 }, player: { key: A } }, 'x').status).toBe(400);
});

test('only so many plans at once from one player', () => {
  const { app } = make();
  const input = { level: 1, plan: good, player: { key: A, name: 'Ann', country: 'nl' } };
  const first = app.run(input, '1.1.1.1');
  const second = app.run(input, '1.1.1.2');
  const third = app.run(input, '1.1.1.3');
  expect([first.status, second.status, third.status]).toEqual([200, 200, 429]);
  app.release(first.held);
  expect(app.run(input, '1.1.1.3').status).toBe(200);
});

test('the best per level is kept, a worse try changes nothing, and totals rank players', () => {
  const { app, store } = make();
  play(app, A, 1, good);
  const top = store.mine(A)[0]!.score;
  play(app, A, 1, poor);
  expect(store.mine(A)[0]!.score).toBe(top);
  play(app, B, 1, poor, 'Bob <b>');
  play(app, B, 2, best2 as unknown as Plan, 'Bob <b>');
  const totals = (app.ranking(null, A).body as { totals: { name: string; total: number; levels: number }[]; rank: number });
  expect(totals.totals.map((t) => t.name)).toEqual(['Bob b', 'Ann']);
  expect(totals.totals[0]!.levels).toBe(2);
  expect(totals.rank).toBe(2);
  const one = app.ranking(1, null).body as { entries: { name: string; score: number }[] };
  expect(one.entries[0]).toMatchObject({ name: 'Ann', score: top });
});
