// A plan's score must not depend on the order its blocks are listed in.
import { expect, test } from 'vitest';
import { LEVELS, simulate } from '../src/shifts/model';
import type { Plan } from '../src/shifts/contract';
import golden from './fixtures/shifts/golden.json';

test('listing a plan backwards gives the same profit', () => {
  for (const it of golden as unknown as { level: number; plan: Plan }[]) {
    const level = LEVELS.find((l) => l.id === it.level)!;
    const back: Plan = { ...it.plan, blocks: [...it.plan.blocks].reverse(), robotCities: [...it.plan.robotCities].reverse() };
    expect(simulate(level, back).result.profit).toBe(simulate(level, it.plan).result.profit);
  }
});
