// Ten Shifts: the shared shapes between the score model, the screens and the hall.
// Times are minutes since the start of the shift (22:00). Money is in Sorty.
// Only the coordinator changes this file (see docs/game/PLAN.md); everyone builds against it.

/** Parcels for one city arriving at a steady rate between two moments. */
export interface Arrival {
  from: number;
  to: number;
  perMinute: number;
}

export interface City {
  /** All parcels for this city tonight (the sum of its arrivals). */
  volume: number;
  /** When its truck is due to leave. */
  truck: number;
  arrivals: Arrival[];
}

export interface Level {
  id: number; // 1…10
  name: string;
  shiftMinutes: number;
  /** City i takes the name of the i-th largest town of the chosen country. */
  cities: City[];
  docks: number;
  /** 0 = robots are out of use in this level. */
  robotsMax: number;
  bufferCap: number;
  /** Most people at work at the same moment; absent = no limit. */
  peopleCap?: number;
  /** 1 = normal pay, 1.5 = 50% more. */
  wageFactor: number;
  /** The fleet stands still between these two moments. */
  robotOutage?: [number, number];
  notes: { fresh: string; setForYou: string[] };
  /** Profit of the best known plan: a level score is 1000 × profit ÷ par. */
  par: number;
  badge: { id: string; text: string };
}

/** One city on one or more docks for a stretch of the night. Start and end are on the half hour,
 *  or exactly on the city's first parcel or its truck time; a block lasts at least an hour. */
export interface Block {
  city: number;
  start: number;
  end: number;
  /** People per dock: one picks and loads alone (90 an hour), two work as picker and loader (170). */
  people: 1 | 2;
  docks: number;
}

export interface Plan {
  blocks: Block[];
  /** Cities that also (or only) go to the robots; their lines open and close by themselves. */
  robotCities: number[];
  /** The fleet for the whole shift. */
  robots: number;
}

export type TruckStatus = 'onTime' | 'late' | 'incomplete';

export interface Result {
  profit: number;
  score: number;
  stars: 0 | 1 | 2 | 3;
  badge: boolean;
  /** All amounts positive; late, left, docks, people, robots and buffer are subtracted. */
  lines: { revenue: number; bonus: number; late: number; left: number; docks: number; people: number; robots: number; buffer: number };
  trucks: { city: number; loaded: number; planned: number; left: number; status: TruckStatus }[];
  /** The buffer every 5 minutes, and the stretches when it was full. */
  buffer: { series: number[]; cap: number; fullRanges: [number, number][] };
}

/** Everything the hall needs to play the shift, sampled every 5 minutes. */
export interface Timeline {
  stepMinutes: 5;
  /** cityLoaded[k][i]: parcels of city i on its trucks after k steps. */
  cityLoaded: number[][];
  buffer: number[];
  /** Blocks with the door the hall gives them (0-based, north docks west to east). */
  blocks: { city: number; door: number; start: number; end: number; people: number }[];
  robotsActive: number[];
  departures: { city: number; at: number; status: TruckStatus }[];
}

/** The only way the screens reach the score model. In phase 2 this becomes a call to a server
 *  that answers after 5 seconds, so nothing in the screens may depend on it being instant. */
export interface ScoreService {
  run(levelId: number, plan: Plan): Promise<{ result: Result; timeline: Timeline }>;
}

/** Why a plan cannot be started (shown in the planner). Checking this gives nothing away: it uses
 *  only what the briefing shows. */
export type PlanProblem =
  | { kind: 'grid'; block: number }
  | { kind: 'tooShort'; block: number }
  | { kind: 'afterTruck'; block: number } // ends more than 30 minutes after the truck time
  | { kind: 'noDock'; block: number } // more docks in use than the level has (15 minutes to switch city)
  | { kind: 'tooManyPeople'; at: number }
  | { kind: 'tooManyRobots' }
  | { kind: 'robotsOff' };

/** What the hall does for the game. The screens call it; src/scene implements it. */
export interface Director {
  /** Leave the free simulation: empty hall, doors down, nothing random. */
  enter(level: Level, cityNames: string[]): void;
  /** Play this shift from its start. onClock is called with the minutes played. */
  play(timeline: Timeline, onClock: (minute: number) => void, onDone: () => void): void;
  /** Shift minutes per real second (the HUD's 1×, 4×, 16× map onto this). 0 = pause. */
  setSpeed(minutesPerSecond: number): void;
  /** Jump to the end of the shift. */
  skip(): void;
  /** Back to the free simulation as it was. */
  exit(): void;
}

/** Prices and rates the briefing may show. The model has its own copy; these are for the screens. */
export const PRICES = { parcel: 1.5, onTime: 0.3, latePer10Min: 0.3, leftBehind: 2.5, dockPerHour: 25, personPerHour: 30, robotPerShiftHour: 11, bufferPerParcel: 0.15 } as const;
export const RATES = { onePerson: 90, twoPeople: 170, robot: 20, trailer: 220, switchMinutes: 15, stepMinutes: 30, minBlockMinutes: 60, maxLateMinutes: 30 } as const;
export const STARS = { one: 500, two: 750, three: 900 } as const;
export const CURRENCY = '§';
