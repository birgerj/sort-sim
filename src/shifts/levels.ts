// The ten levels of Ten Shifts, the same for every player. The numbers are written by
// tools/balance/fixture.py into levels.json; this file only gives them their type.
import type { Level } from './contract';
import data from './levels.json';

export const LEVELS: Level[] = data as Level[];
