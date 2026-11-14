# Writes the data the app and its tests are built against:
#   src/shifts/levels.json                 the ten levels (arrivals as per-minute segments)
#   tests/fixtures/shifts/level4.json      one full example: level, plan, result, timeline
#   tests/fixtures/shifts/golden.json      plans per level with the profit the model must reproduce
# Run from the repository root:  python3 tools/balance/fixture.py
import json, math, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import solve

NAMES = ['First door', 'Two cities', 'Robots', 'One door, two trucks', 'Staggered wave', 'Tight store', 'Robots down', 'Peak night', 'Holiday rates', 'Full house']
FRESH = ['Plan one dock: start, end, and 1 or 2 people.',
         'A city too big for one trailer. Give it a second dock, or lose ten minutes at each trailer swap.',
         'Put a city on robots and choose the fleet size. One price per robot for the whole shift.',
         'More cities than docks. A dock can switch city in 15 minutes; waiting parcels go to the buffer.',
         'Parcels come in peaks. Start blocks later and change the crew size during the night.',
         'The buffer is small tonight. Choose what you let wait.',
         'Full hall: you need every dock and every robot. The robots are off from 01:00 to 02:00 and one truck leaves early.',
         'A large batch for one city at 01:00. Not everything fits tonight: choose what stays behind.',
         'People cost 50% more and you get 16 at most.',
         'Everything at once: batch, late inbound, small buffer, a limit on people.']
SET = [['Unloading', 'Robots are off', 'Doors'], ['Unloading', 'Robots are off', 'Doors'], ['Unloading', 'Doors'], ['Unloading', 'Robots are off', 'Doors'],
       ['Unloading', 'Doors'], ['Unloading', 'Doors'], ['Unloading', 'Doors'], ['Unloading', 'Doors'], ['Unloading', 'Doors'], ['Unloading', 'Doors']]
BADGE = [('lean', 'One person is enough'), ('oneDock', 'Never more than 2 docks open'), ('noDockSmall', 'Only the biggest city on a dock'), ('lean3', 'Never more than 3 people at work'),
         ('smallFleet', 'At most 6 robots'), ('halfBuffer', 'Buffer never over half full'), ('allOnTime', 'Every truck on time'), ('allOnTime', 'Every truck on time'),
         ('lean12', 'Never more than 12 people at work'), ('allOnTime', 'Every truck on time')]
# Best profit found per level with plans in the game's shape (par.py; see REPORT.md).
PAR = [178, 628, 836, 669, 1689, 2537, 7659, 13560, 11746, 23762]


def level_json(L):
    arr = L['arr']
    cities = []
    for i, d in enumerate(L['dests']):
        segs = []
        col = arr[:, i]
        t = 0
        while t < len(col):
            if col[t] > 0:
                u = t
                while u < len(col) and abs(col[u] - col[t]) < 1e-12:
                    u += 1
                segs.append({'from': t, 'to': u, 'perMinute': float(col[t])})  # unrounded: the app must count the same parcels
                t = u
            else:
                t += 1
        cities.append({'volume': float(col.sum()), 'truck': d['d'], 'arrivals': segs})
    n = L['n']
    out = {'id': n, 'name': NAMES[n - 1], 'shiftMinutes': L['T'], 'cities': cities, 'docks': L['docks'], 'robotsMax': L['robots'], 'bufferCap': L['store'],
           'wageFactor': L['wage'], 'notes': {'fresh': FRESH[n - 1], 'setForYou': SET[n - 1]}, 'par': PAR[n - 1], 'badge': {'id': BADGE[n - 1][0], 'text': BADGE[n - 1][1]}}
    if L['cap'] < 99:
        out['peopleCap'] = L['cap']
    if L['outage'][1] > L['outage'][0]:
        out['robotOutage'] = list(L['outage'])
    return out


def lines_for(L, city):
    """A robot city gets enough lines for its busiest minute (60 an hour each), at most 4."""
    return max(1, min(4, math.ceil(float(L['arr'][:, city].max()) * 60 / 60 - 1e-9)))


def to_solver(L, plan):
    """Contract plan -> solver plan, or None when it is not valid. Doors: a block's docks take, in block order by
    start, the door that last served the same city if free, else the door free longest (15 min after another city)."""
    L['lines'] = 999
    blocks = sorted(plan['blocks'], key=lambda b: (b['start'], b['city']))
    doors = [(-999, -1)] * L['docks']  # (free from, last city)
    out = []
    for b in blocks:
        for _ in range(b['docks']):
            ok = [k for k, (t, c) in enumerate(doors) if (t if c in (b['city'], -1) else t + 15) <= b['start']]
            if not ok:
                return None
            same = [k for k in ok if doors[k][1] == b['city']]
            k = same[0] if same else min(ok, key=lambda k: doors[k][0])
            doors[k] = (b['end'], b['city'])
            out.append([b['city'], k, b['start'], b['end'], b['people']])
    lines = []
    for c in plan['robotCities']:
        lines += [[c, L['first'][c], L['dests'][c]['d']]] * lines_for(L, c)
    p = dict(b=out, l=lines, N=plan['robots'])
    return p if solve.valid(L, p) else None


def to_contract(L, p):
    seen = {}
    for c, k, t0, t1, s in p['b']:
        seen[(c, t0, t1, s)] = seen.get((c, t0, t1, s), 0) + 1
    return {'blocks': [{'city': c, 'start': t0, 'end': t1, 'people': s, 'docks': n} for (c, t0, t1, s), n in sorted(seen.items())],
            'robotCities': sorted(set(l[0] for l in p['l'])), 'robots': p['N']}


def startable(L, plan):
    """The planner's own rules (the rest is checked by to_solver): times on the half hour or exactly on the city's
    first parcel or truck time, at least an hour, robots only in a level that has them."""
    for b in plan['blocks']:
        al = solve.allowed(L, b['city'])
        if b['start'] not in al or b['end'] not in al or b['end'] - b['start'] < 60 or b['docks'] < 1 or b['people'] not in (1, 2):
            return False
    if (plan['robotCities'] or plan['robots']) and L['robots'] == 0:
        return False
    return 0 <= plan['robots'] <= L['robots'] and len(set(plan['robotCities'])) == len(plan['robotCities'])


def make_startable(L, plan):
    """A first-guess plan from solve.py made startable in the game: starts moved up and ends moved down to a time
    the planner offers, blocks shorter than an hour dropped, no robots where the level has none."""
    blocks = []
    for b in plan['blocks']:
        al = solve.allowed(L, b['city'])
        start = min(t for t in al if t >= b['start'])
        end = max(t for t in al if t <= b['end'])
        if end - start >= 60:
            blocks.append(dict(b, start=start, end=end))
    out = {'blocks': blocks, 'robotCities': list(plan['robotCities']), 'robots': plan['robots']}
    if L['robots'] == 0:
        out['robotCities'], out['robots'] = [], 0
    return out


def peaks(plan):
    """Most people at work and most docks open in the same minute. A block is open from its start up to, not
    including, its end; the 15 minutes a dock needs to switch city do not count."""
    ev = []
    for b in plan['blocks']:
        ev.append((b['start'], 1, b['people'] * b['docks'], b['docks']))
        ev.append((b['end'], 0, -b['people'] * b['docks'], -b['docks']))
    ev.sort()  # ends before starts in the same minute
    c = k = pc = pk = 0
    for _, _, dp, dk in ev:
        c += dp
        k += dk
        pc = max(pc, c)
        pk = max(pk, k)
    return pc, pk


def badge_condition(L, bid, plan, r):
    """The level's extra goal, without the score. `r` is evaluate(..., detail=True) of the same plan."""
    ds = L['dests']
    people, docks = peaks(plan)
    if bid == 'lean':
        return people <= 1
    if bid == 'lean3':
        return people <= 3
    if bid == 'lean12':
        return people <= 12
    if bid == 'oneDock':
        return docks <= 2
    if bid == 'noDockSmall':  # the largest city by volume, the first one on a tie
        biggest = max(range(len(ds)), key=lambda i: (ds[i]['v'], -i))
        return all(b['city'] == biggest for b in plan['blocks'])
    if bid == 'smallFleet':
        return plan['robots'] <= 6
    if bid == 'halfBuffer':  # every minute of the shift, not only the 5-minute curve the result shows
        return r['peak'] <= L['store'] / 2 + 1e-9
    if bid == 'allOnTime':  # complete and not late, for every city
        return r['ontime'] == len(ds)
    raise ValueError(bid)


def trace(L, p, step=5):
    ds = L['dests']
    i64 = np.int64
    B = sorted(p['b'], key=lambda b: ds[b[0]]['d'])
    Ln = sorted(p['l'], key=lambda l: ds[l[0]]['d'])
    col = lambda rows, k: np.array([r[k] for r in rows], dtype=i64)
    loaded, buf = [], []
    TT = L['arr'].shape[0]
    for t in range(0, TT + 1, step):
        ld, fee, peak, stot = solve.sim(L['arr'][:max(t, 1)] if t else L['arr'][:1] * 0, col(B, 0), col(B, 1), col(B, 2), col(B, 3), col(B, 4), col(Ln, 0), col(Ln, 1), col(Ln, 2), p['N'], float(L['store']), L['mt'], L['outage'][0], L['outage'][1])
        loaded.append([round(float(x), 1) for x in ld])
        buf.append(round(float(stot), 1))
    return loaded, buf


def run(L, plan, par):
    p = to_solver(L, plan)
    if p is None:
        return None
    r = solve.evaluate(L, p, True)
    ds = L['dests']
    loaded, buf = trace(L, p)
    final = loaded[-1]
    end = {}
    for b in p['b']:
        end[b[0]] = max(end.get(b[0], 0), b[3])
    for l in p['l']:
        end[l[0]] = max(end.get(l[0], 0), l[2])
    trucks, deps = [], []
    for i, d in enumerate(ds):
        v = float(L['arr'][:, i].sum())
        ld = min(v, final[i])
        left = end.get(i, d['d'])
        miss = v - ld
        status = 'incomplete' if miss >= 0.5 else ('late' if left > d['d'] else 'onTime')
        trucks.append({'city': i, 'loaded': round(ld), 'planned': d['d'], 'left': left, 'status': status})
        deps.append({'city': i, 'at': left, 'status': status})
    cap = L['store']
    full, start = [], None
    for k, x in enumerate(buf):
        if x >= cap - 0.5 and start is None:
            start = k * 5
        if x < cap - 0.5 and start is not None:
            full.append([start, k * 5]); start = None
    if start is not None:
        full.append([start, (len(buf) - 1) * 5])
    profit = round(float(r['profit']))
    score = max(0, round(1000 * profit / par))
    badge = score >= 500 and badge_condition(L, BADGE[L['n'] - 1][0], plan, r)
    result = {'profit': profit, 'score': score, 'stars': 3 if score >= 900 else 2 if score >= 750 else 1 if score >= 500 else 0, 'badge': bool(badge),
              'lines': {'revenue': round(float(r['rev'])), 'bonus': round(float(r['bonus'])), 'late': round(float(r['late'])), 'left': round(float(r['left'])),
                        'docks': round(float(r['dock'])), 'people': round(float(r['staff'])), 'robots': round(float(r['robots'])), 'buffer': round(float(r['store']))},
              'trucks': trucks, 'buffer': {'series': buf, 'cap': cap, 'fullRanges': full}}
    timeline = {'stepMinutes': 5, 'cityLoaded': loaded, 'buffer': buf,
                'blocks': [{'city': b[0], 'door': b[1], 'start': b[2], 'end': b[3], 'people': b[4]} for b in p['b']],
                'robotsActive': [0 if L['outage'][0] <= t < L['outage'][1] else p['N'] for t in range(0, L['arr'].shape[0] + 1, 5)], 'departures': deps}
    return result, timeline, float(r['profit'])


if __name__ == '__main__':
    Ls = solve.levels()
    os.makedirs('tests/fixtures/shifts', exist_ok=True)
    js = [level_json(L) for L in Ls]
    json.dump(js, open('src/shifts/levels.json', 'w'), indent=1)
    L = Ls[3]
    plan = {'blocks': [{'city': 0, 'start': 0, 'end': 105, 'people': 2, 'docks': 1}, {'city': 2, 'start': 60, 'end': 180, 'people': 1, 'docks': 1}, {'city': 1, 'start': 120, 'end': 240, 'people': 2, 'docks': 1}], 'robotCities': [], 'robots': 0}
    res, tl, _ = run(L, plan, PAR[3])
    json.dump({'level': js[3], 'plan': plan, 'result': res, 'timeline': tl}, open('tests/fixtures/shifts/level4.json', 'w'), indent=1)
    golden = []
    fresh = solve.levels()  # to_solver opens every robot line in the levels above; the first guesses need the levels as designed
    for L, L0 in zip(Ls, fresh):
        for name, h in (('safe', solve.h_safe), ('sensible', solve.h_sensible)):
            pl = make_startable(L, to_contract(L0, h(L0)))
            assert startable(L, pl), (L['n'], name)
            out = run(L, pl, PAR[L['n'] - 1])
            assert out, (L['n'], name)
            if out:
                golden.append({'level': L['n'], 'name': name, 'plan': pl, 'profit': round(out[2], 2), 'lines': out[0]['lines'], 'trucks': out[0]['trucks']})
    golden.append({'level': 4, 'name': 'example', 'plan': plan, 'profit': round(run(Ls[3], plan, PAR[3])[2], 2), 'lines': res['lines'], 'trucks': res['trucks']})
    json.dump(golden, open('tests/fixtures/shifts/golden.json', 'w'), indent=1)
    print('levels', len(js), 'golden', len(golden), 'level4 profit', res['profit'], res['lines'])
    for g in golden:
        print(g['level'], g['name'], g['profit'])
