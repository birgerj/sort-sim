// Body proportions that changed: the shoulders sit higher and the head is a little larger, so
// the neck is as short as on a real body (compared with a modelled human of the same height:
// shoulder joint at about 80 % of the height, chin at 87 %, head 13 % of the height).
// `?body=old` in the address gives the old ones (long neck, small head), for comparing.

const old = typeof location !== 'undefined' && new URLSearchParams(location.search).get('body') === 'old';

export const BODY = old
  ? { old, lift: 0, head: 1, drop: 0 }
  : {
      old,
      /** Shoulders, the slope up to the neck and the neckline raised by this much (m). */
      lift: 0.04,
      /** The head (and everything on it) scaled by this much from the neck joint... */
      head: 1.06,
      /** ...and the neck joint lowered by this much, so the crown stays where it was. */
      drop: 0.012,
    };
