// Ten Shifts: a Christmas decoration in the hall for every badge earned, one per level, from
// small to grand. All ten together are the hall as the Christmas setting dresses it (but for
// the bells in the music, which stay with that setting). Pure: the screens and the hall both
// read this list.

export interface Trophy {
  /** The level whose badge earns it (1…10). */
  level: number;
  /** The kind of decoration (what the hall shows or hides by). */
  id: 'lights' | 'wreaths' | 'canes' | 'garlands' | 'stars' | 'forklifts' | 'trees' | 'gifts' | 'market' | 'snow';
  name: string;
}

export const TROPHIES: readonly Trophy[] = [
  { level: 1, id: 'lights', name: 'Light strings' },
  { level: 2, id: 'wreaths', name: 'Wreaths on the doors' },
  { level: 3, id: 'canes', name: 'Candy canes' },
  { level: 4, id: 'garlands', name: 'Garlands along the walls' },
  { level: 5, id: 'stars', name: 'Stars and roof hangers' },
  { level: 6, id: 'forklifts', name: 'Lights on the forklifts' },
  { level: 7, id: 'trees', name: 'Christmas trees' },
  { level: 8, id: 'gifts', name: 'Hats and presents' },
  { level: 9, id: 'market', name: 'The Christmas market' },
  { level: 10, id: 'snow', name: 'Snow and Father Christmas' },
];

export type Decoration = Trophy['id'];

/**
 * Is a kind of decoration in sight? When Christmas is on (everything), or when the badge of
 * its level has been earned.
 */
export function decorationShown(id: Decoration, christmas: boolean, earnedLevels: Iterable<number>): boolean {
  if (christmas) return true;
  const level = TROPHIES.find((t) => t.id === id)?.level;
  if (level === undefined) return false;
  for (const l of earnedLevels) if (l === level) return true;
  return false;
}
