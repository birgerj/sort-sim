// Body proportions, measured against a modelled human of the same height: shoulder joint at
// about 80 % of the height, chin at 87 %, head 13 % of the height, a short neck between them,
// the hand about 8 %. The body (bodySdf.ts) and the skeleton and gear (people.ts) read these.
export const BODY = {
  /** Shoulders, the slope up to the neck and the neckline raised by this much (m). */
  lift: 0.04,
  /** The head (and everything on it) scaled by this much from the neck joint... */
  head: 1.06,
  /** ...and the neck joint lowered by this much, so the crown stays where it was. */
  drop: 0.012,
  /** The muscles from the neck to the shoulders run up high beside the neck and slope down
   * to the shoulder (0: nearly level, then the shoulder's hump). */
  slope: 1,
  /** Hands scaled from the wrist: about 14 cm wrist to fingertip and 7.7 cm across (a real
   * hand is about 18 and 8.5, but ours are blocky: fuller looks like mittens). */
  hand: 1.4,
};
