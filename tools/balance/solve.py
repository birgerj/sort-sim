# Reference model and search for Ten Shifts (the campaign game). Not shipped with the app.
# The TypeScript model in src/shifts/model must give the same profit as evaluate() here.
# See README.md in this folder.
import numpy as np, numba as nb, math, random, json, sys, time, copy

import os as _os
PR = dict(rev=1.5, bonus=0.30, late=0.03, left=2.5, dock=25.0, person=30.0, robot=float(_os.environ.get('ROBOT', '11')), line=float(_os.environ.get('LINE', '0')), store=0.15)
SNAP = 15
import os
MINBLK = int(os.environ.get('MINBLK', '60'))
TAG = os.environ.get('TAG', '')
GRID = int(os.environ.get('GRID', '30'))


def allowed(L, d):
    c = L.setdefault('_al', {})
    if d not in c:
        D = L['dests'][d]['d']
        c[d] = sorted(set(range(0, D + 31, GRID)) | {L['first'][d], D})
    return c[d]


def step_time(L, d, t, k):
    a = allowed(L, d)
    i = min(range(len(a)), key=lambda j: abs(a[j] - t))
    return a[max(0, min(len(a) - 1, i + k))]


@nb.njit(cache=True)
def sim(arr, bd, bk, b0, b1, bs, ld, l0, l1, N, store_cap, maint, out0, out1):
    TT = arr.shape[0]
    n = arr.shape[1]
    nbk = len(bd)
    nl = len(ld)
    up = np.zeros(n)
    store = np.zeros(n)
    loaded = np.zeros(n)
    bbuf = np.zeros(nbk)
    btr = np.zeros(nbk)
    bpause = np.zeros(nbk)
    lbuf = np.zeros(nl)
    lx = np.zeros(nl)
    fee = 0.0
    stot = 0.0
    peak = 0.0
    for t in range(TT):
        for i in range(n):
            up[i] += arr[t, i]
        for b in range(nbk):
            if b0[b] <= t < b1[b]:
                i = bd[b]
                x = min(40.0 - bbuf[b], up[i])
                if x > 0:
                    bbuf[b] += x
                    up[i] -= x
        for l in range(nl):
            if l0[l] <= t < l1[l]:
                i = ld[l]
                x = min(20.0 - lbuf[l], up[i])
                if x > 0:
                    lbuf[l] += x
                    up[i] -= x
        for i in range(n):
            if up[i] > 1e-9:
                x = min(up[i], store_cap - stot)
                if x > 0:
                    store[i] += x
                    stot += x
                    up[i] -= x
                    fee += x
        bud = 2.5
        for b in range(nbk):
            if bud <= 0:
                break
            if b0[b] <= t < b1[b]:
                i = bd[b]
                x = min(40.0 - bbuf[b], store[i], bud)
                if x > 0:
                    bbuf[b] += x
                    store[i] -= x
                    stot -= x
                    bud -= x
        for l in range(nl):
            if bud <= 0:
                break
            if l0[l] <= t < l1[l]:
                i = ld[l]
                x = min(20.0 - lbuf[l], store[i], bud)
                if x > 0:
                    lbuf[l] += x
                    store[i] -= x
                    stot -= x
                    bud -= x
        for b in range(nbk):
            if b0[b] <= t < b1[b]:
                if maint[bk[b], t]:
                    continue
                if bpause[b] > 0:
                    bpause[b] -= 1
                    continue
                r = 1.5 if bs[b] == 1 else 170.0 / 60.0
                x = min(bbuf[b], r)
                bbuf[b] -= x
                loaded[bd[b]] += x
                btr[b] += x
                if btr[b] >= 220.0:
                    btr[b] -= 220.0
                    bpause[b] = 10
        if not (out0 <= t < out1) and N > 0:
            fc = N / 3.0
            tot = 0.0
            for l in range(nl):
                lx[l] = 0.0
                if l0[l] <= t < l1[l]:
                    tot += lbuf[l]
            if tot > 0:
                rem = fc
                for l in range(nl):
                    if l0[l] <= t < l1[l]:
                        x = min(lbuf[l], fc * lbuf[l] / tot, 1.0)
                        lbuf[l] -= x
                        loaded[ld[l]] += x
                        lx[l] = x
                        rem -= x
                if rem > 1e-9:
                    for l in range(nl):
                        if l0[l] <= t < l1[l]:
                            x = min(lbuf[l], rem, 1.0 - lx[l])
                            if x > 0:
                                lbuf[l] -= x
                                loaded[ld[l]] += x
                                rem -= x
        for b in range(nbk):
            if t == b1[b] - 1:
                up[bd[b]] += bbuf[b]
                bbuf[b] = 0.0
        for l in range(nl):
            if t == l1[l] - 1:
                up[ld[l]] += lbuf[l]
                lbuf[l] = 0.0
        if stot > peak:
            peak = stot
    return loaded, fee, peak, stot


def dest(v, a0, a1, d, prof='flat'):
    return dict(v=v, a0=a0, a1=a1, d=d, prof=prof)


def level(n, T, dests, docks, lines=0, robots=0, store=800, maint=(), outage=(0, 0), cap=99, wage=1.0, batch=(), late=None):
    L = dict(n=n, T=T, dests=dests, docks=docks, lines=lines, robots=robots, store=store, maint=maint, outage=outage, cap=cap, wage=wage)
    TT = T + 30
    nd = len(dests)
    arr = np.zeros((TT, nd))
    for i, d in enumerate(dests):
        w = d['a1'] - d['a0']
        v = d['v'] - sum(b[1] for b in batch if b[0] == i)
        if late:
            pass
        if d['prof'] == 'flat':
            arr[d['a0']:d['a1'], i] += v / w
        else:
            third = w // 3
            if d['prof'] == 'early':
                arr[d['a0']:d['a0'] + third, i] += 0.6 * v / third
                arr[d['a0'] + third:d['a1'], i] += 0.4 * v / (w - third)
            else:
                arr[d['a0']:d['a1'] - third, i] += 0.4 * v / (w - third)
                arr[d['a1'] - third:d['a1'], i] += 0.6 * v / third
    for (i, v, t0, t1) in batch:
        arr[t0:t1, i] += v / (t1 - t0)
    if late:  # (total, t0, t1): extra parcels on top of v, spread by volume over destinations still open
        tot, t0, t1 = late
        ok = [i for i, d in enumerate(dests) if d['d'] >= t1 + 60]
        s = sum(dests[i]['v'] for i in ok)
        for i in ok:
            x = round(tot * dests[i]['v'] / s)
            arr[t0:t1, i] += x / (t1 - t0)
            dests[i]['v'] += x
    L['arr'] = arr
    mt = np.zeros((max(docks, 1), TT), dtype=np.bool_)
    for (k, t0, t1) in maint:
        mt[k, t0:t1] = True
    L['mt'] = mt
    L['first'] = [int(np.argmax(arr[:, i] > 0)) for i in range(nd)]
    return L


TIGHT = os.environ.get('TIGHT', '') == '1'


def levels():
    Ls = levels0()
    if TIGHT:
        import solve as _s
        cfg = {5: dict(docks=3), 6: dict(docks=4, maint=((1, 60, 120), (3, 180, 240))), 7: dict(docks=5), 8: dict(docks=6),
               9: dict(docks=6, cap=8), 10: dict(docks=10, cap=14, maint=((2, 120, 180), (7, 300, 360)))}
        for L in Ls:
            c = cfg.get(L['n'])
            if c:
                L.update(c)
                mt = np.zeros((L['docks'], L['T'] + 30), dtype=np.bool_)
                for (k, t0, t1) in L['maint']:
                    mt[k, t0:t1] = True
                L['mt'] = mt
    return Ls


def levels0():
    D = dest
    Ls = []
    Ls.append(level(1, 120, [D(150, 0, 90, 120)], 2))
    Ls.append(level(2, 180, [D(400, 0, 150, 180), D(120, 0, 90, 120)], 4))
    Ls.append(level(3, 240, [D(500, 0, 210, 240), D(60, 0, 180, 210), D(70, 0, 180, 210), D(50, 30, 200, 240)], 4, 4, 6))
    Ls.append(level(4, 240, [D(240, 0, 90, 105), D(200, 0, 200, 240), D(150, 0, 150, 180)], 2))
    Ls.append(level(5, 300, [D(420, 0, 240, 270), D(300, 0, 180, 210, 'early'), D(260, 60, 270, 300, 'late'), D(180, 0, 150, 180), D(140, 30, 240, 270), D(100, 90, 280, 300, 'late')], 6, 6, 10))
    Ls.append(level(6, 360, [D(520, 0, 300, 330), D(380, 0, 200, 240, 'early'), D(320, 90, 330, 360, 'late'), D(260, 0, 180, 210), D(220, 60, 300, 330), D(160, 0, 150, 180, 'early'), D(140, 120, 330, 360), D(100, 100, 300, 330, 'late')], 8, 8, 14, store=250))
    Ls.append(level(7, 360, [D(600, 0, 310, 340), D(480, 0, 220, 250, 'early'), D(400, 60, 330, 360, 'late'), D(340, 0, 130, 150), D(300, 30, 300, 330), D(240, 120, 340, 360, 'late'), D(180, 0, 240, 270), D(140, 0, 180, 210, 'early'), D(120, 100, 320, 350)], 8, 10, 12, outage=(180, 240)))
    Ls.append(level(8, 480, [D(800, 0, 420, 450), D(620, 0, 300, 330, 'early'), D(900, 0, 400, 450), D(480, 120, 450, 480, 'late'), D(380, 0, 240, 270), D(320, 60, 420, 450), D(260, 0, 200, 240, 'early'), D(200, 200, 460, 480, 'late'), D(140, 0, 360, 390), D(100, 150, 450, 480)], 12, 12, 20, batch=((2, 600, 180, 210),)))
    v9 = [820, 680, 560, 500, 440, 400, 360, 320, 280, 260, 220, 160]
    a9 = [0, 0, 30, 0, 60, 0, 90, 30, 120, 0, 150, 60]
    d9 = [450, 300, 480, 240, 420, 360, 480, 330, 450, 210, 480, 390]
    p9 = ['flat', 'early', 'late', 'flat', 'flat', 'early', 'late', 'flat', 'flat', 'early', 'late', 'flat']
    Ls.append(level(9, 480, [D(v9[i], a9[i], d9[i] - 30, d9[i], p9[i]) for i in range(12)], 12, 16, 24, cap=12, wage=1.5))
    v10 = [900, 780, 680, 600, 540, 480, 440, 400, 360, 320, 300, 260, 220, 180, 140, 100]
    a10 = [0, 0, 30, 0, 60, 0, 90, 30, 120, 0, 150, 60, 0, 180, 30, 210]
    d10 = [450, 420, 480, 270, 450, 330, 480, 390, 480, 240, 450, 360, 300, 480, 420, 480]
    p10 = ['flat', 'flat', 'late', 'early', 'flat', 'early', 'late', 'flat', 'flat', 'early', 'late', 'flat', 'early', 'late', 'flat', 'flat']
    ds = [D(v10[i], a10[i], d10[i] - 30, d10[i], p10[i]) for i in range(16)]
    ds[1]['v'] += 500
    Ls.append(level(10, 480, ds, 20, 20, 30, store=400, cap=20, batch=((1, 500, 150, 180),), late=(300, 300, 330)))
    if os.environ.get('BIGSMALL') == '1':
        vb = [1500, 1300, 1300, 1100] + [230] * 10
        ds = [D(vb[i], a10[i], d10[i] - 30, d10[i], p10[i]) for i in range(14)]
        Ls[9] = level(10, 480, ds, 20, 20, 30, store=400, cap=20)
    vs = os.environ.get('VSCALE', '7:2.3,8:3,9:2.5,10:3')
    if vs:
        fs = {int(a.split(':')[0]): float(a.split(':')[1]) for a in vs.split(',')}
        for L in Ls:
            f = fs.get(L['n'])
            if f:
                L['arr'] = L['arr'] * f
                for i, d in enumerate(L['dests']):
                    d['v'] = float(L['arr'][:, i].sum())
                if L['n'] == 9:
                    L['cap'] = 16
                if L['n'] == 10:
                    L['cap'] = 40
    return Ls


# ---- plan: {'b': [[dest,dock,t0,t1,staff],...], 'l': [[dest,t0,t1],...], 'N': int}
def valid(L, p):
    TT = L['T'] + 30
    ds = L['dests']
    by = {}
    for b in p['b']:
        d, k, t0, t1, s = b
        if not (0 <= t0 < t1 <= min(TT, ds[d]['d'] + 30)) or t1 - t0 < MINBLK or not (0 <= k < L['docks']) or s not in (1, 2):
            return False
        by.setdefault(k, []).append(b)
    for k, bl in by.items():
        bl.sort(key=lambda b: b[2])
        for x, y in zip(bl, bl[1:]):
            if y[2] < x[3] + (SNAP if x[0] != y[0] else 0):
                return False
    if p['l']:
        if L['lines'] == 0:
            return False
        ev = []
        for d, t0, t1 in p['l']:
            if not (0 <= t0 < t1 <= min(TT, ds[d]['d'] + 30)) or t1 - t0 < MINBLK:
                return False
            ev.append((t0, 1))
            ev.append((t1, -1))
        ev.sort()
        c = 0
        for _, e in ev:
            c += e
            if c > L['lines']:
                return False
    if not (0 <= p['N'] <= L['robots']):
        return False
    if L['cap'] < 99:
        ev = []
        for d, k, t0, t1, s in p['b']:
            ev.append((t0, s))
            ev.append((t1, -s))
        ev.sort()
        c = 0
        for _, e in ev:
            c += e
            if c > L['cap']:
                return False
    return True


def evaluate(L, p, detail=False):
    ds = L['dests']
    order = sorted(range(len(p['b'])), key=lambda j: ds[p['b'][j][0]]['d'])
    B = [p['b'][j] for j in order]
    lo = sorted(range(len(p['l'])), key=lambda j: ds[p['l'][j][0]]['d'])
    Lr = [p['l'][j] for j in lo]
    i64 = np.int64
    bd = np.array([b[0] for b in B], dtype=i64)
    bk = np.array([b[1] for b in B], dtype=i64)
    b0 = np.array([b[2] for b in B], dtype=i64)
    b1 = np.array([b[3] for b in B], dtype=i64)
    bs = np.array([b[4] for b in B], dtype=i64)
    ld = np.array([l[0] for l in Lr], dtype=i64)
    l0 = np.array([l[1] for l in Lr], dtype=i64)
    l1 = np.array([l[2] for l in Lr], dtype=i64)
    loaded, fee, peak, _stot = sim(L['arr'], bd, bk, b0, b1, bs, ld, l0, l1, p['N'], float(L['store']), L['mt'], L['outage'][0], L['outage'][1])
    end = [0] * len(ds)
    for b in p['b']:
        end[b[0]] = max(end[b[0]], b[3])
    for l in p['l']:
        end[l[0]] = max(end[l[0]], l[2])
    rev = bon = late = left = 0.0
    ontime = 0
    for i, d in enumerate(ds):
        ld_ = min(d['v'], loaded[i])
        miss = d['v'] - ld_
        if miss < 0.5:
            ld_ = d['v']
            miss = 0
        lm = max(0, end[i] - d['d'])
        rev += ld_ * PR['rev']
        if miss == 0 and lm == 0:
            bon += ld_ * PR['bonus']
            ontime += 1
        late += lm * PR['late'] * ld_
        left += miss * PR['left']
    cd = sum((b[3] - b[2]) / 60 * PR['dock'] for b in p['b'])
    cs = sum((b[3] - b[2]) / 60 * b[4] * PR['person'] * L['wage'] for b in p['b'])
    cr = p['N'] * PR['robot'] * L['T'] / 60 + sum((l[2] - l[1]) / 60 * PR['line'] for l in p['l'])
    cf = fee * PR['store']
    prof = rev + bon - late - left - cd - cs - cr - cf
    if detail:
        return dict(profit=prof, rev=rev, bonus=bon, late=late, left=left, dock=cd, staff=cs, robots=cr, store=cf, peak=peak, ontime=ontime)
    return prof


def free_dock(L, p, d, t0, t1, staff):
    for k in range(L['docks']):
        q = dict(b=p['b'] + [[d, k, t0, t1, staff]], l=p['l'], N=p['N'])
        if valid(L, q):
            return k
    return -1


def rate_of(d):
    return d['v'] / (d['a1'] - d['a0']) * 60


def h_safe(L):
    """Every destination its own dock, two people, from first parcel to truck time."""
    p = dict(b=[], l=[], N=0)
    ds = L['dests']
    for i in sorted(range(len(ds)), key=lambda i: -ds[i]['v']):
        d = ds[i]
        placed = False
        for s in (2, 1):
            k = free_dock(L, p, i, L['first'][i], d['d'], s)
            if k >= 0:
                p['b'].append([i, k, L['first'][i], d['d'], s])
                placed = True
                break
        if not placed and L['lines']:
            q = dict(b=p['b'], l=p['l'] + [[i, L['first'][i], d['d']]], N=min(L['robots'], p['N'] + math.ceil(rate_of(d) / 20)))
            if valid(L, q):
                p = q
    return p


def h_sensible(L):
    """A reasonable first plan: small steady flows to robots, then the rest by truck time on a dock
    with as few people as fit; when no dock is free, after the destination that leaves first."""
    p = dict(b=[], l=[], N=0)
    ds = L['dests']
    rest = []
    for i in sorted(range(len(ds)), key=lambda i: ds[i]['v']):
        d = ds[i]
        r = rate_of(d)
        need = math.ceil(r / 20)
        if L['lines'] and r <= 55 and p['N'] + need <= L['robots']:
            q = dict(b=p['b'], l=p['l'] + [[i, L['first'][i], d['d']]], N=p['N'] + need)
            if valid(L, q):
                p = q
                continue
        rest.append(i)
    for i in sorted(rest, key=lambda i: ds[i]['d']):
        d = ds[i]
        t0, t1 = L['first'][i], d['d']
        hours = (t1 - t0) / 60
        placed = False
        for s, cap in ((1, 90), (2, 170)):
            if d['v'] <= cap * hours * 0.92 - (d['v'] // 220) * cap / 6:
                k = free_dock(L, p, i, t0, t1, s)
                if k >= 0:
                    p['b'].append([i, k, t0, t1, s])
                    placed = True
                    break
        if not placed:
            k = free_dock(L, p, i, t0, t1, 2)
            if k >= 0:
                p['b'].append([i, k, t0, t1, 2])
                placed = True
                if d['v'] > 170 * hours * 0.9:
                    for s in (1,):
                        k2 = free_dock(L, p, i, t0, t1, s)
                        if k2 >= 0:
                            p['b'].append([i, k2, t0, t1, s])
        if not placed:
            for b in sorted(p['b'], key=lambda b: b[3]):
                s0 = b[3] + SNAP
                for s in (2, 1):
                    q = dict(b=p['b'] + [[i, b[1], s0, t1, s]], l=p['l'], N=p['N'])
                    if s0 < t1 and valid(L, q):
                        p = q
                        placed = True
                        break
                if placed:
                    break
        if not placed and L['lines']:
            q = dict(b=p['b'], l=p['l'] + [[i, t0, t1]], N=min(L['robots'], p['N'] + math.ceil(rate_of(d) / 20)))
            if valid(L, q):
                p = q
    return p


def simple_moves(L, p):
    out = []
    for j, b in enumerate(p['b']):
        for f, dv in ((2, -1), (2, 1), (3, -1), (3, 1)):
            q = dict(b=[x[:] for x in p['b']], l=p['l'], N=p['N'])
            q['b'][j][f] = step_time(L, b[0], b[f], dv)
            out.append(q)
        q = dict(b=[x[:] for x in p['b']], l=p['l'], N=p['N'])
        q['b'][j][4] = 3 - b[4]
        out.append(q)
    for j, l in enumerate(p['l']):
        for f, dv in ((1, -1), (1, 1), (2, -1), (2, 1)):
            q = dict(b=p['b'], l=[x[:] for x in p['l']], N=p['N'])
            q['l'][j][f] = step_time(L, l[0], l[f], dv)
            out.append(q)
    for dv in (-1, 1):
        out.append(dict(b=p['b'], l=p['l'], N=p['N'] + dv))
    return [q for q in out if valid(L, q)]


def climb(L, p):
    best = evaluate(L, p)
    while True:
        improved = False
        for q in simple_moves(L, p):
            v = evaluate(L, q)
            if v > best + 1e-6:
                p, best, improved = q, v, True
                break
        if not improved:
            return p, best


def rnd_move(L, p, rng):
    ds = L['dests']
    nd = len(ds)
    q = dict(b=[x[:] for x in p['b']], l=[x[:] for x in p['l']], N=p['N'])
    m = rng.random()
    nbk, nl = len(q['b']), len(q['l'])
    step = rng.choice((1, 1, 1, 2, 4)) if GRID == 15 else rng.choice((1, 1, 1, 2))
    if m < 0.30 and nbk:
        b = rng.choice(q['b'])
        f = rng.choice((2, 3))
        b[f] = step_time(L, b[0], b[f], rng.choice((-1, 1)) * step)
    elif m < 0.38 and nbk:
        b = rng.choice(q['b'])
        s = rng.choice((-1, 1)) * step
        b[2] = step_time(L, b[0], b[2], s)
        b[3] = step_time(L, b[0], b[3], s)
    elif m < 0.48 and nbk:
        b = rng.choice(q['b'])
        b[4] = 3 - b[4]
    elif m < 0.58 and nbk:
        b = rng.choice(q['b'])
        b[1] = rng.randrange(L['docks'])
    elif m < 0.66 and nl:
        l = rng.choice(q['l'])
        f = rng.choice((1, 2))
        l[f] = step_time(L, l[0], l[f], rng.choice((-1, 1)) * step)
    elif m < 0.72 and L['robots']:
        q['N'] += rng.choice((-1, 1))
    elif m < 0.78:
        d = rng.randrange(nd)
        hadb = any(b[0] == d for b in q['b'])
        q['b'] = [b for b in q['b'] if b[0] != d]
        q['l'] = [l for l in q['l'] if l[0] != d]
        if hadb and L['lines']:
            q['l'].append([d, L['first'][d], ds[d]['d']])
        else:
            q['b'].append([d, rng.randrange(L['docks']), L['first'][d], ds[d]['d'], rng.choice((1, 2))])
    elif m < 0.85:
        d = rng.randrange(nd)
        t0 = rng.choice([t for t in allowed(L, d) if L['first'][d] <= t < ds[d]['d']])
        if rng.random() < 0.7 or not L['lines']:
            q['b'].append([d, rng.randrange(L['docks']), t0, ds[d]['d'], rng.choice((1, 2))])
        else:
            q['l'].append([d, t0, ds[d]['d']])
    elif m < 0.91 and nbk + nl > 0:
        if nbk and (not nl or rng.random() < 0.7):
            q['b'].pop(rng.randrange(nbk))
        else:
            q['l'].pop(rng.randrange(nl))
    elif m < 0.97 and nbk:
        j = rng.randrange(nbk)
        b = q['b'][j]
        cuts = [t for t in allowed(L, b[0]) if b[2] < t < b[3]]
        if cuts:
            cut = rng.choice(cuts)
            q['b'].append([b[0], b[1], cut, b[3], 3 - b[4]])
            b[3] = cut
    elif nbk >= 2:
        a, b = rng.sample(q['b'], 2)
        a[1], b[1] = b[1], a[1]
    return q


def anneal(L, p0, iters, seed):
    rng = random.Random(seed)
    cur, cv = p0, evaluate(L, p0)
    best, bv = cur, cv
    T0, T1 = 25.0, 0.3
    for it in range(iters):
        T = T0 * (T1 / T0) ** (it / iters)
        q = rnd_move(L, cur, rng)
        if not valid(L, q):
            continue
        v = evaluate(L, q)
        if v >= cv or rng.random() < math.exp((v - cv) / T):
            cur, cv = q, v
            if v > bv:
                best, bv = q, v
    return climb(L, best)


def features(L, p):
    ds = L['dests']
    by = {}
    for b in p['b']:
        by.setdefault(b[1], set()).add(b[0])
    seq = sum(1 for k, s in by.items() if len(s) > 1)
    hb = {}
    for b in p['b']:
        hb.setdefault(b[0], []).append(b)
    hl = {}
    for l in p['l']:
        hl.setdefault(l[0], []).append(l)
    delayed = 0
    hybrid = 0
    multi = 0
    staffchg = 0
    for i in range(len(ds)):
        starts = [b[2] for b in hb.get(i, [])] + [l[1] for l in hl.get(i, [])]
        if starts and min(starts) >= L['first'][i] + 30:
            delayed += 1
        if i in hb and i in hl:
            hybrid += 1
        if len(hb.get(i, [])) > 1:
            multi += 1
            if len(set(b[4] for b in hb[i])) > 1:
                staffchg += 1
    ev = []
    for b in p['b']:
        ev.append((b[2], b[4], 1))
        ev.append((b[3], -b[4], -1))
    ev.sort()
    c = k = pc = pk = 0
    for _, s, e in ev:
        c += s
        k += e
        pc = max(pc, c)
        pk = max(pk, k)
    return dict(blocks=len(p['b']), lines=len(p['l']), N=p['N'], seqDocks=seq, delayed=delayed, hybrid=hybrid, multiBlock=multi, staffChange=staffchg, peakPeople=pc, peakDocks=pk,
                decisions=4 * len(p['b']) + 2 * len(p['l']) + (1 if L['robots'] else 0))


if __name__ == '__main__':
    n = int(sys.argv[1])
    iters = int(sys.argv[2])
    restarts = int(sys.argv[3])
    L = levels()[n - 1]
    t = time.time()
    safe = h_safe(L)
    sens = h_sensible(L)
    tuned, tv = climb(L, sens)
    res = []
    for s in range(restarts):
        start = sens if s % 2 == 0 else safe
        p, v = anneal(L, start, iters, 1000 + s)
        res.append((v, p))
        print(n, 'restart', s, round(v), round(time.time() - t), 's', flush=True)
    res.sort(key=lambda x: -x[0])
    bv, bp = res[0]
    sm = simple_moves(L, bp)
    drops = sorted(1000 * (bv - evaluate(L, q)) / bv for q in sm)
    out = dict(level=n, volume=sum(d['v'] for d in L['dests']), dests=len(L['dests']),
               safe=evaluate(L, safe, True), sensible=evaluate(L, sens, True), tuned=evaluate(L, tuned, True), best=evaluate(L, bp, True),
               restarts=[round(v) for v, _ in res], plan=bp, feat=features(L, bp), featSens=features(L, sens),
               moves=len(sm), free=sum(1 for x in drops if x < 2), d10=sum(1 for x in drops if x > 10), d50=sum(1 for x in drops if x > 50),
               store_cap=L['store'], robots_max=L['robots'], docks=L['docks'], cap=L['cap'], secs=round(time.time() - t))
    json.dump(out, open(f'res{TAG}{n}.json', 'w'), default=float)
    b = out['best']['profit']
    print(n, 'safe', round(1000 * out['safe']['profit'] / b), 'sensible', round(1000 * out['sensible']['profit'] / b), 'tuned', round(1000 * out['tuned']['profit'] / b), 'best', round(b), out['restarts'], out['feat'])
