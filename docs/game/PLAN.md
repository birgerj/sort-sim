# Build plan

Integration branch: `night-shift-game` (built to `/next/`). Everyone branches from it and works in an own
worktree on `game/<agent>`. Only the coordinator merges and pushes.

| Agent | Builds | Owns (nobody else edits these) |
|---|---|---|
| Coordinator | contract, fixtures, wiring in `src/main.ts` and `src/ui/hud.ts`, removing the old night game, merges | `src/shifts/contract.ts`, `src/main.ts`, `src/ui/hud.ts`, `docs/game/*`, `AGENTS.md`, `README.md` |
| A · model | score model in TypeScript, `LocalScoreService`, plan checks | `src/shifts/model/**`, `src/shifts/levels.ts`, `tests/shiftsModel.test.ts` |
| B · balance | par per level with long runs, star and badge checks, the left-behind price | `tools/balance/**`, `src/shifts/levels.json`, `tests/fixtures/shifts/**` |
| C1 · screens | start, how to play, levels, briefing, result, end score, progress, styles | `src/ui/shifts/**` except `planner/`, `tests/shiftsProgress.test.ts` |
| C2 · planner | planner for desktop and phone, the shift HUD, the rough buffer guess | `src/ui/shifts/planner/**`, `src/shifts/estimate.ts`, `tests/shiftsEstimate.test.ts` |
| D · hall | the `Director` | `src/scene/**`, `src/sim/**`, `tests/shiftsDirector.test.ts` |
| E · test | browser run-through on desktop and phone sizes, screenshots next to the mocks | `tests/e2e/**`, `scripts/gameShots.mjs` |

Seams between agents (fixed, see `src/shifts/contract.ts`):

- C1 exports `mountShifts(deps: { score: ScoreService; director: Director; cityNames(): string[]; onFree(): void }): HTMLElement`
  from `src/ui/shifts/index.ts`. Until the model and the hall are merged, C1 and C2 use a fake score service
  that returns `tests/fixtures/shifts/level4.json` and a fake director that only runs the clock.
- C2 exports `plannerView(level, plan, onChange, onStart): HTMLElement` and `shiftHud(...)` from
  `src/ui/shifts/planner/index.ts`; C1 places them. C1 owns `src/ui/shifts/style.css`; C2 adds
  `src/ui/shifts/planner/planner.css`.
- A exports `LocalScoreService`, `LEVELS: Level[]` and `checkPlan(level, plan): PlanProblem[]` from
  `src/shifts/model/index.ts`.
- D exports `createDirector(scene: Sorter): Director` from `src/scene/director.ts`.

Rules for everyone:

- Read `AGENTS.md` and `docs/game/DESIGN.md` first. No brand or product names anywhere. Plain English.
- Stay inside your own files. Need something in another agent's file or in the contract: write it under
  your name in `docs/game/STATUS.md` (section Requests) and carry on with a local stand-in.
- `npm run typecheck` and `npm test` green before every commit. Commit small, on your own branch. Do not push.
- Update your section of `docs/game/STATUS.md` in your own branch when a task is done or you are blocked.

Order: (0) contract and fixtures, done by the coordinator; (1) all agents in parallel; (2) coordinator
merges, wires `src/main.ts`, removes `src/game/**`, `src/ui/game.ts`, `tests/game.test.ts`; (3) par frozen,
wording and screenshots checked against the mocks, pushed to `night-shift-game`.

Done when: `/next/` opens on the choice between free simulation and the game; the free simulation behaves
as on `main`; all ten levels play from briefing to result on desktop and on a phone; the model reproduces
`tests/fixtures/shifts/golden.json`; the hall shows what the player chose; typecheck, tests and build are green.
