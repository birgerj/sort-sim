# Par and balance checks for Ten Shifts, searched in the GAME's plan shape. Not shipped with the app.
#
# The search in solve.py moves door numbers and robot lines freely; the player cannot. Here a plan is the
# contract's plan (blocks with a dock count, a set of robot cities, a fleet size) and every candidate is
# turned into the solver's shape by fixture.to_solver() before it is scored, so the doors and the robot
# lines are exactly the ones the game would give. Par found here is reachable by a player.
#
#   python3 tools/balance/par.py check                    the level 4 example must still give 606.25
#   python3 tools/balance/par.py par <level> <iters> <restarts>
#   python3 tools/balance/par.py price <level> <iters> <restarts>   plain plan against the best per left-behind price
#   python3 tools/balance/par.py badge <level> <iters> <restarts>
#
# Results are kept in tools/balance/out/*.json; best plans in tools/balance/best/. Par itself is written by
# fixture.py from its PAR list.
import json, math, os, random, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import solve, fixture

OUT = os.path.join(HERE, 'out')
BEST = os.path.join(HERE, 'best')


# ---- plans in the contract's shape -------------------------------------------------------------------

def canon(plan):
    """Same plan, blocks in a fixed order and equal blocks merged, so a saved plan always scores the same."""
    seen = {}
    for b in plan['blocks']:
        k = (b['city'], b['start'], b['end'], b['people'])
        seen[k] = seen.get(k, 0) + b['docks']
    return {'blocks': [{'city': c, 'start': s, 'end': e, 'people': p, 'docks': n} for (c, s, e, p), n in sorted(seen.items())],
            'robotCities': sorted(set(plan['robotCities'])), 'robots': plan['robots']}


grid_ok = fixture.startable


def solver_plan(L, plan):
    return fixture.to_solver(L, plan) if grid_ok(L, plan) else None


def score(L, plan, detail=False):
    """Profit of a contract plan, or None when the game would not let it start."""
    p = solver_plan(L, plan)
    return None if p is None else solve.evaluate(L, p, detail)


peaks = fixture.peaks


# ---- the plain plan of the left-behind study ----------------------------------------------------------

def need_rate(L, i):
    """Parcels an hour a city needs loaded to be done by its truck time, starting at its first parcel."""
    d = L['dests'][i]
    return d['v'] / (d['d'] - L['first'][i]) * 60


def plain(L):
    """What a careful player does without tuning anything: steady cities go to the robots, smallest first, while
    the fleet covers what they need (a robot per 20 an hour); every other city, largest first, gets
    ceil(needed rate / 150) docks with two people from its first parcel to its truck time, one dock at a time
    while docks and people last. A city that got no dock at all is left to the robots when some are spare."""
    plan = {'blocks': [], 'robotCities': [], 'robots': 0}
    ds = L['dests']
    rest = []
    for i in sorted(range(len(ds)), key=lambda i: ds[i]['v']):
        need = math.ceil(need_rate(L, i) / 20 - 1e-9)
        if L['robots'] and ds[i]['prof'] == 'flat' and need_rate(L, i) <= 240 and plan['robots'] + need <= L['robots']:
            plan['robotCities'].append(i)
            plan['robots'] += need
        else:
            rest.append(i)
    for i in sorted(rest, key=lambda i: -ds[i]['v']):
        want = math.ceil(need_rate(L, i) / 150 - 1e-9)
        got = 0
        for _ in range(want):
            q = {'blocks': [b for b in plan['blocks'] if b['city'] != i] + [{'city': i, 'start': L['first'][i], 'end': ds[i]['d'], 'people': 2, 'docks': got + 1}],
                 'robotCities': plan['robotCities'], 'robots': plan['robots']}
            if solver_plan(L, q) is None:
                break
            plan, got = q, got + 1
        if got == 0 and L['robots'] and plan['robots'] < L['robots']:
            plan['robotCities'].append(i)
            plan['robots'] = min(L['robots'], plan['robots'] + math.ceil(need_rate(L, i) / 20))
    return canon(plan)


# ---- search ------------------------------------------------------------------------------------------

def rnd_move(L, plan, rng):
    ds = L['dests']
    nd = len(ds)
    q = {'blocks': [dict(b) for b in plan['blocks']], 'robotCities': list(plan['robotCities']), 'robots': plan['robots']}
    B = q['blocks']
    m = rng.random()
    step = rng.choice((1, 1, 1, 2))
    if m < 0.26 and B:  # one edge of a block
        b = rng.choice(B)
        f = rng.choice(('start', 'end'))
        b[f] = solve.step_time(L, b['city'], b[f], rng.choice((-1, 1)) * step)
    elif m < 0.33 and B:  # the whole block earlier or later
        b = rng.choice(B)
        s = rng.choice((-1, 1)) * step
        b['start'] = solve.step_time(L, b['city'], b['start'], s)
        b['end'] = solve.step_time(L, b['city'], b['end'], s)
    elif m < 0.43 and B:  # crew size
        b = rng.choice(B)
        b['people'] = 3 - b['people']
    elif m < 0.55 and B:  # a dock more or less
        j = rng.randrange(len(B))
        B[j]['docks'] += rng.choice((-1, 1))
        if B[j]['docks'] == 0:
            B.pop(j)
    elif m < 0.61 and L['robots']:  # fleet size
        q['robots'] += rng.choice((-1, 1)) * rng.choice((1, 1, 2))
    elif m < 0.67 and L['robots']:  # a city on or off the robots
        d = rng.randrange(nd)
        if d in q['robotCities']:
            q['robotCities'].remove(d)
        else:
            q['robotCities'].append(d)
    elif m < 0.72 and L['robots']:  # a city from docks to robots or back
        d = rng.randrange(nd)
        had = any(b['city'] == d for b in B)
        q['blocks'] = [b for b in B if b['city'] != d]
        if had:
            if d not in q['robotCities']:
                q['robotCities'].append(d)
        else:
            if d in q['robotCities']:
                q['robotCities'].remove(d)
            q['blocks'].append({'city': d, 'start': L['first'][d], 'end': ds[d]['d'], 'people': rng.choice((1, 2)), 'docks': 1})
    elif m < 0.82:  # a new block
        d = rng.randrange(nd)
        al = solve.allowed(L, d)
        t0 = rng.choice([t for t in al if L['first'][d] <= t < ds[d]['d']])
        ends = [t for t in al if t >= t0 + 60]
        if ends:
            t1 = ds[d]['d'] if rng.random() < 0.7 and ds[d]['d'] in ends else rng.choice(ends)
            B.append({'city': d, 'start': t0, 'end': t1, 'people': rng.choice((1, 2)), 'docks': 1})
    elif m < 0.88 and B:  # a block less
        B.pop(rng.randrange(len(B)))
    elif m < 0.96 and B:  # cut a block in two, the second part with another crew or one dock less
        b = rng.choice(B)
        cuts = [t for t in solve.allowed(L, b['city']) if b['start'] + 60 <= t <= b['end'] - 60]
        if cuts:
            cut = rng.choice(cuts)
            tail = dict(b, start=cut)
            b['end'] = cut
            if rng.random() < 0.6:
                tail['people'] = 3 - tail['people']
            else:
                part = tail if rng.random() < 0.5 else b
                part['docks'] -= 1
            q['blocks'] = [x for x in B + [tail] if x['docks'] > 0]
    elif B:  # one dock of a block gets its own block (so it can then be shaped apart)
        b = rng.choice(B)
        if b['docks'] > 1:
            b['docks'] -= 1
            B.append(dict(b, docks=1, people=3 - b['people']))
    return q


def simple_moves(L, plan):
    out = []
    for j, b in enumerate(plan['blocks']):
        for f, dv in (('start', -1), ('start', 1), ('end', -1), ('end', 1)):
            q = {'blocks': [dict(x) for x in plan['blocks']], 'robotCities': plan['robotCities'], 'robots': plan['robots']}
            q['blocks'][j][f] = solve.step_time(L, b['city'], b[f], dv)
            out.append(q)
        q = {'blocks': [dict(x) for x in plan['blocks']], 'robotCities': plan['robotCities'], 'robots': plan['robots']}
        q['blocks'][j]['people'] = 3 - b['people']
        out.append(q)
        for dv in (-1, 1):
            q = {'blocks': [dict(x) for x in plan['blocks']], 'robotCities': plan['robotCities'], 'robots': plan['robots']}
            q['blocks'][j]['docks'] += dv
            q['blocks'] = [x for x in q['blocks'] if x['docks'] > 0]
            out.append(q)
    for dv in (-1, 1):
        out.append({'blocks': plan['blocks'], 'robotCities': plan['robotCities'], 'robots': plan['robots'] + dv})
    for d in range(len(L['dests'])):
        rc = [c for c in plan['robotCities'] if c != d] if d in plan['robotCities'] else plan['robotCities'] + [d]
        out.append({'blocks': plan['blocks'], 'robotCities': rc, 'robots': plan['robots']})
    return out


def climb(L, plan, value):
    best = value(plan)
    while True:
        improved = False
        for q in simple_moves(L, plan):
            v = value(q)
            if v is not None and v > best + 1e-6:
                plan, best, improved = q, v, True
                break
        if not improved:
            return canon(plan), best


def anneal(L, start, iters, seed, value, T0=None):
    """Simulated annealing over contract plans. `value(plan)` is what is maximised (None = not allowed)."""
    rng = random.Random(seed)
    cur, cv = start, value(start)
    if cv is None:
        cur = {'blocks': [], 'robotCities': [], 'robots': 0}
        cv = value(cur)
    best, bv = cur, cv
    # A move in a full hall shifts hundreds of Sorty, in the first levels a few tens: start warmer there.
    T0 = T0 or (25.0 if L['n'] <= 6 else 80.0)
    T1 = 0.3
    for it in range(iters):
        T = T0 * (T1 / T0) ** (it / iters)
        q = rnd_move(L, cur, rng)
        v = value(q)
        if v is None:
            continue
        if v >= cv or rng.random() < math.exp((v - cv) / T):
            cur, cv = q, v
            if v > bv:
                best, bv = q, v
    return climb(L, best, value)


def starts(L):
    """Starting plans for the restarts: the two first-guess plans of solve.py and the plain plan, as far as the
    game allows them."""
    out = []
    for h in (solve.h_sensible, solve.h_safe):
        pl = canon(fixture.to_contract(L, h(L)))
        if L['robots'] == 0:
            pl['robotCities'], pl['robots'] = [], 0
        out.append(pl)
    out.append(plain(L))
    return [p for p in out if score(L, p) is not None] or [{'blocks': [], 'robotCities': [], 'robots': 0}]


def search(L, iters, restarts, value=None, seed0=1000, log=None):
    value = value or (lambda p: score(L, p))
    st = starts(L)
    res = []
    t = time.time()
    for s in range(restarts):
        p, v = anneal(L, st[s % len(st)], iters, seed0 + s, value)
        res.append((v, p))
        if log:
            print(log, 'restart', s, round(v, 2), round(time.time() - t), 's', flush=True)
    res.sort(key=lambda x: -x[0])
    return res


def save(name, data):
    os.makedirs(OUT, exist_ok=True)
    json.dump(data, open(os.path.join(OUT, name), 'w'), indent=1, default=float)


def load(name):
    f = os.path.join(OUT, name)
    return json.load(open(f)) if os.path.exists(f) else None


# ---- badges ------------------------------------------------------------------------------------------

def badge_rule(L, bid):
    """(allowed(plan), shortfall(detail)): the first is a rule on the plan itself, the second counts by how much
    the played shift misses the badge (0 = earned)."""
    ds = L['dests']
    biggest = max(range(len(ds)), key=lambda i: ds[i]['v'])
    yes = lambda plan: True
    none = lambda r: 0.0
    if bid == 'lean':
        return (lambda plan: peaks(plan)[0] <= 1), none
    if bid == 'lean3':
        return (lambda plan: peaks(plan)[0] <= 3), none
    if bid == 'lean12':
        return (lambda plan: peaks(plan)[0] <= 12), none
    if bid == 'oneDock':
        return (lambda plan: peaks(plan)[1] <= 2), none
    if bid == 'noDockSmall':
        return (lambda plan: all(b['city'] == biggest for b in plan['blocks'])), none
    if bid == 'smallFleet':
        return (lambda plan: plan['robots'] <= 6), none
    if bid == 'halfBuffer':  # the highest minute, a little stricter than the 5-minute curve the player sees
        return yes, (lambda r: max(0.0, r['peak'] - L['store'] / 2))
    if bid == 'allOnTime':
        return yes, (lambda r: float(len(ds) - r['ontime']))
    raise ValueError(bid)


def earns(L, bid, plan):
    ok, short = badge_rule(L, bid)
    r = score(L, plan, True)
    return r is not None and ok(plan) and short(r) < 1e-6


def badge_value(L, bid):
    ok, short = badge_rule(L, bid)
    weight = 3.0 if bid == 'halfBuffer' else 400.0  # per parcel over the half / per truck not on time

    def value(plan):
        if not ok(plan):
            return None
        r = score(L, plan, True)
        return None if r is None else r['profit'] - weight * short(r)
    return value


# ---- commands ----------------------------------------------------------------------------------------

def cmd_check(Ls):
    f = json.load(open(os.path.join(ROOT, 'tests/fixtures/shifts/level4.json')))
    v = score(Ls[3], f['plan'])
    print('level 4 example', v)
    assert abs(v - 606.25) < 1e-9
    for L in Ls:
        pl = plain(L)
        print(L['n'], 'plain', round(score(L, pl), 2), 'peaks', peaks(pl), 'robots', pl['robots'], pl['robotCities'])


def cmd_par(Ls, n, iters, restarts):
    L = Ls[n - 1]
    res = search(L, iters, restarts, log=f'level {n}')
    v, p = res[0]
    old = load(f'par{n}.json')
    runs = (old['runs'] if old else []) + [{'iters': iters, 'restarts': [round(x, 2) for x, _ in res]}]
    if old and old['profit'] >= v:
        v, p = old['profit'], old['plan']
    save(f'par{n}.json', {'level': n, 'profit': v, 'plan': p, 'runs': runs, 'detail': score(L, p, True), 'peaks': peaks(p)})
    os.makedirs(BEST, exist_ok=True)
    json.dump(p, open(os.path.join(BEST, f'level{n}.json'), 'w'), indent=1)
    print('level', n, 'best', round(v, 2), [round(x) for x, _ in res])


def cmd_price(Ls, n, iters, restarts):
    """The plain plan against the best plan, per price of a parcel left behind. The price is only changed inside
    this process; the rules in solve.py stay as decided."""
    L = Ls[n - 1]
    pl = plain(L)
    keep = solve.PR['left']
    rows = load(f'price{n}.json') or {}
    known = load(f'par{n}.json')
    for price in (2.5, 2.0, 1.5, 1.0):
        solve.PR['left'] = price
        res = search(L, iters, restarts, seed0=2000, log=f'level {n} price {price}')
        bv, bp = res[0]
        # Any plan stays valid at another price: also take the best plan known from the other prices.
        for other in [r['bestPlan'] for r in rows.values()] + ([known['plan']] if known else []):
            ov = score(L, other)
            if ov > bv:
                bv, bp = ov, other
        r = score(L, pl, True)
        rows[str(price)] = {'price': price, 'plain': r['profit'], 'plainLeft': r['left'] / price, 'best': bv, 'bestLeft': score(L, bp, True)['left'] / price,
                            'score': 1000 * r['profit'] / bv, 'restarts': [round(x, 2) for x, _ in res], 'bestPlan': bp}
        print('level', n, 'price', price, 'plain', round(r['profit']), 'best', round(bv), 'score', round(1000 * r['profit'] / bv), flush=True)
    solve.PR['left'] = keep
    # A better plan found at one price may beat the best of another: make the table consistent.
    for price, row in rows.items():
        solve.PR['left'] = float(price)
        for other in rows.values():
            ov = score(L, other['bestPlan'])
            if ov > row['best']:
                row['best'], row['bestPlan'] = ov, other['bestPlan']
                row['bestLeft'] = score(L, other['bestPlan'], True)['left'] / float(price)
        row['score'] = 1000 * row['plain'] / row['best']
    solve.PR['left'] = keep
    save(f'price{n}.json', rows)
    save(f'plain{n}.json', {'plan': pl, 'peaks': peaks(pl), 'detail': score(L, pl, True)})


def cmd_badge(Ls, n, iters, restarts):
    L = Ls[n - 1]
    bid = fixture.BADGE[n - 1][0]
    par = load(f'par{n}.json')
    res = search(L, iters, restarts, value=badge_value(L, bid), seed0=3000, log=f'level {n} badge {bid}')
    good = [(score(L, p), p) for _, p in res if earns(L, bid, p)]
    good.sort(key=lambda x: -x[0])
    out = {'level': n, 'badge': bid, 'par': par['profit'] if par else None, 'parPlanEarns': earns(L, bid, par['plan']) if par else None,
           'plainEarns': earns(L, bid, plain(L)), 'plainProfit': score(L, plain(L)),
           'found': bool(good), 'profit': good[0][0] if good else None, 'plan': good[0][1] if good else None,
           'closest': None if good else score(L, res[0][1], True), 'closestPlan': None if good else res[0][1]}
    save(f'badge{n}.json', out)
    print('level', n, bid, 'with badge', out['profit'], 'par', out['par'], 'par plan earns it', out['parPlanEarns'], 'plain earns it', out['plainEarns'], out['closest'])


if __name__ == '__main__':
    Ls = solve.levels()
    cmd = sys.argv[1]
    a = [int(x) for x in sys.argv[2:]]
    if cmd == 'check':
        cmd_check(Ls)
    elif cmd == 'par':
        cmd_par(Ls, *a)
    elif cmd == 'price':
        cmd_price(Ls, *a)
    elif cmd == 'badge':
        cmd_badge(Ls, *a)
