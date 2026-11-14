# Balance tools (not shipped)

`solve.py` is the reference score model for Ten Shifts and a search that looks for good plans.
`fixture.py` writes the level data and the test fixtures the app is built against.

    pip install numba numpy
    python3 tools/balance/fixture.py          # src/shifts/levels.json, tests/fixtures/shifts/*
    python3 tools/balance/solve.py 10 400000 4 # level, plans per restart, restarts -> res10.json

The TypeScript model in `src/shifts/model` must give the same profit as `evaluate()` for every plan in
`tests/fixtures/shifts/golden.json` (to the cent). `sim()` is the definition: one-minute steps, in this
order per minute: arrivals, onto belts and tables, the rest into the buffer, buffer back out (150 an hour,
earliest truck first), docks load, robots load, blocks that end hand back what is on their belt.

A plan in the app's shape (`src/shifts/contract.ts`) is turned into the solver's shape by `to_solver()`
in `fixture.py`; that function is also the definition of which door a block gets and how many lines a
robot city opens.

Environment switches used while designing (the defaults are the rules as decided): `GRID`, `MINBLK`,
`ROBOT`, `LINE`, `VSCALE`, `TAG`.
