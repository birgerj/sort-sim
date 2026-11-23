// Ten Shifts: one colour per city, the same on the game's cards and planner and in the hall
// (the band round a parcel, the boards on the roll cages). Sixteen, then they repeat.
// `src/ui/shifts/style.css` sets the same values as `--sh-city-0` … `--sh-city-15`.

export const CITY_COLOURS: readonly string[] = [
  '#2b7f70', '#a4623a', '#5b4fa8', '#8a6f14', '#2f62a8', '#a23d68', '#4c7d2a', '#7a6042',
  '#1f7892', '#8a3f97', '#a04040', '#6b7422', '#3c53a6', '#2a7a55', '#5a6170', '#9a5a1c',
];

/** The colour of city i as `#rrggbb`. */
export function cityHex(city: number): string {
  const n = CITY_COLOURS.length;
  return CITY_COLOURS[((city % n) + n) % n]!;
}
