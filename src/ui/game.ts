/**
 * The night-shift game's controls: a second dock at the TOP of the screen (the
 * settings dock stays at the bottom), with the same tabs and panels.
 *
 * - Free run: one tab, "Night shift", opens the briefing.
 * - Briefing: a seed (typed, today's, the world's or random), and the plan: per city
 *   robots or 1–4 north doors, and the store reserve, with the estimate if the
 *   forecast holds. Start rebuilds the hall with the plan's door signs.
 * - The night: clock and score, freeze, 2×, 4×, Status, Moves, End.
 * - 06:00: the debrief.
 */
import type { Music } from '../audio/music';
import { COUNTRIES, COUNTRY } from '../sim/countries';
import { announced, makeNight, type Night } from '../game/night';
import { play, validPlan, MAX_DOORS, NORTH_DOORS, ROBOT_DOORS, SWAP_FROM, type Move, type Plan } from '../game/model';
import { expected, par, RESERVES, shown, standingPlan, type Par } from '../game/par';
import { dailySeed, formatSeed, parseSeed, randomSeed, worldSeed, type NightSeed } from '../game/seed';
import { Session, type Speed } from '../game/session';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const fmt = (n: number) => Math.round(n).toLocaleString('en').replace(/,/g, ' ');
const hhmm = (h: number) => `${String((22 + Math.floor(h)) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const grade = (s: number) => (s >= 950 ? 'S' : s >= 800 ? 'A' : s >= 600 ? 'B' : s >= 300 ? 'C' : 'D');
const ICON = {
  shift: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  freeze: '<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>',
  moves: '<path d="M4 7h11M4 17h7"/><path d="M15 4l3 3-3 3M11 14l3 3-3 3"/>',
  status: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  end: '<path d="M6 6l12 12M18 6L6 18"/>',
};
type Sheet = 'briefing' | 'status' | 'moves' | 'debrief';
const TITLES: Record<Sheet, string> = { briefing: 'Briefing', status: 'Tonight so far', moves: 'Moves', debrief: '06:00 · Shift over' };

export class GameUi {
  readonly root = el('div', 'game');
  private dock = el('nav', 'bar dock gdock');
  private sheet = el('section', 'sheet gsheet');
  private title = el('h2');
  private body = el('div', 'sheet-body');
  private open: Sheet | null = null;
  private session: Session | null;
  private tabs = new Map<string, HTMLButtonElement>();
  private clockTab: { time: HTMLElement; score: HTMLElement } | null = null;
  private lastDraw = 0;
  private lastPanel = 0;
  private lastHour = -1;

  // Briefing state.
  private seed: NightSeed;
  private night!: Night;
  private plan!: Plan;
  private par: Par | null = null;
  private parTimer = 0;

  constructor(private music: Music) {
    this.session = Session.fromUrl();
    this.seed = this.session?.seed ?? dailySeed(COUNTRY, new Date().toISOString().slice(0, 10));
    this.loadSeed(this.seed);
    const head = el('div', 'sheet-head');
    const close = el('button', 'sheet-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.onclick = () => this.show(null);
    head.append(this.title, close);
    this.sheet.append(head, this.body);
    this.dock.setAttribute('aria-label', 'Night shift');
    this.sheet.setAttribute('aria-label', 'Night shift panel');
    this.root.append(this.sheet, this.dock);
    this.buildDock();
    // The caption moves down, under this dock.
    document.body.classList.add('has-game');
    if (this.session) document.body.classList.add('gaming');
  }

  /** Every frame. */
  frame(dt: number): void {
    const s = this.session;
    if (!s) return;
    const frozen = s.speed === 0 || this.music.paused;
    if (!frozen && !s.over) s.advance(dt);
    const now = performance.now();
    if (now - this.lastDraw < 250) return;
    this.lastDraw = now;
    if (s.over && this.open !== 'debrief') {
      this.music.setPaused(false);
      this.show('debrief');
    }
    if (this.clockTab) {
      this.clockTab.time.textContent = s.time;
      this.clockTab.score.textContent = s.over ? `${s.score(s.final())}` : `on course ${s.score(s.projected())}`;
    }
    for (const [id, b] of this.tabs) {
      if (id === 'freeze') b.classList.toggle('on', frozen);
      if (id === '2' || id === '4') b.classList.toggle('on', !frozen && String(s.speed) === id);
    }
    // Status refreshes each second; Moves only when the hour turns (its pickers stay put).
    if (this.open === 'status' && now - this.lastPanel > 1000) {
      this.lastPanel = now;
      this.draw();
    }
    if (this.open === 'moves' && s.hour !== this.lastHour) this.draw();
    this.lastHour = s.hour;
    if (Math.floor(now / 30000) !== Math.floor((now - 250) / 30000)) s.save();
  }

  // ———————————————————————————————— dock

  private tab(id: string, label: string, icon: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'tab');
    b.type = 'button';
    b.title = title;
    b.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;
    b.append(el('span', '', label));
    b.onclick = onClick;
    this.dock.append(b);
    this.tabs.set(id, b);
    return b;
  }

  private buildDock(): void {
    this.dock.replaceChildren();
    this.tabs.clear();
    this.clockTab = null;
    const s = this.session;
    if (!s) {
      this.dock.classList.add('solo');
      this.tab('briefing', 'Night shift', ICON.shift, 'Play a night: plan the doors, then fine-tune the shift', () => this.toggle('briefing'));
      return;
    }
    this.dock.classList.remove('solo');
    // Clock and score (opens the status panel).
    const c = el('button', 'tab clock');
    c.type = 'button';
    c.title = 'Tonight so far';
    const time = el('b', 'big', s.time);
    const score = el('span', '', '');
    c.append(time, score);
    c.onclick = () => this.toggle('status');
    this.dock.append(c);
    this.tabs.set('status', c);
    this.clockTab = { time, score };
    this.tab('freeze', 'Freeze', ICON.freeze, 'Freeze the night (Space): look around and plan, nothing moves', () => this.setSpeed(0));
    const two = this.tab('2', '2×', '', '2× (a night in about 10 min)', () => this.setSpeed(2));
    const four = this.tab('4', '4×', '', '4× (a night in about 5 min)', () => this.setSpeed(4));
    for (const b of [two, four]) b.querySelector('svg')?.remove();
    for (const [b, t] of [[two, '2×'], [four, '4×']] as const) b.prepend(el('b', 'big', t));
    for (const b of [two, four]) b.querySelector('span')!.textContent = 'speed';
    this.tab('moves', 'Moves', ICON.moves, 'Swap a door, send a trailer early, forklifts, hold, release the reserve', () => this.toggle('moves'));
    this.tab('end', 'End', ICON.end, 'Leave the night and go back to the free hall', () => {
      if (s.over || confirm('Leave this night? Your moves are not kept.')) location.href = Session.exitUrl();
    });
  }

  private setSpeed(v: Speed): void {
    const s = this.session!;
    if (v === 0) {
      // Freeze stops the whole hall (music and all), like Space; again carries on.
      const frozen = s.speed === 0 || this.music.paused;
      this.music.setPaused(!frozen);
      if (!frozen) s.setSpeed(0);
      else if (s.speed === 0) s.toggleFreeze();
    } else {
      this.music.setPaused(false);
      s.setSpeed(v);
    }
  }

  private toggle(id: Sheet): void {
    this.show(this.open === id ? null : id);
  }

  private show(id: Sheet | null): void {
    this.open = id;
    for (const [t, b] of this.tabs) if (t !== 'freeze' && t !== '2' && t !== '4') b.classList.toggle('on', t === id);
    this.sheet.classList.toggle('show', !!id);
    if (id) {
      this.title.textContent = TITLES[id];
      this.draw();
    }
  }

  private draw(): void {
    const keepScroll = this.sheet.scrollTop;
    if (this.open === 'briefing') this.drawBriefing();
    if (this.open === 'status') this.drawStatus();
    if (this.open === 'moves') this.drawMoves();
    if (this.open === 'debrief') this.drawDebrief();
    this.sheet.scrollTop = keepScroll;
  }

  // ———————————————————————————————— briefing

  private loadSeed(seed: NightSeed): void {
    this.seed = seed;
    this.night = makeNight(seed);
    this.plan = standingPlan(this.night);
    this.par = null;
    // Par (the 1000 anchor) takes a moment: work it out after the panel is drawn.
    clearTimeout(this.parTimer);
    this.parTimer = window.setTimeout(() => {
      this.par = par(this.night);
      if (this.open === 'briefing') this.draw();
    }, 50);
  }

  private drawBriefing(): void {
    const b = this.body;
    b.replaceChildren();
    const n = this.night;
    const p = this.plan;

    // Seed.
    const seedRow = el('div', 'g-seed');
    const input = el('input');
    input.value = formatSeed(this.seed);
    input.setAttribute('aria-label', 'Night seed, e.g. NL-7KQ2M0');
    input.spellcheck = false;
    input.onchange = () => {
      const s = parseSeed(input.value);
      if (s) {
        this.loadSeed(s);
        this.draw();
      } else input.setCustomValidity('A seed looks like NL-7KQ2M0');
      input.reportValidity();
    };
    const today = new Date().toISOString().slice(0, 10);
    const mk = (label: string, title: string, f: () => NightSeed) => {
      const x = el('button', '', label);
      x.title = title;
      x.onclick = () => {
        this.loadSeed(f());
        this.draw();
      };
      return x;
    };
    seedRow.append(
      input,
      mk('Today', "Today's night for this country", () => dailySeed(this.seed.country, today)),
      mk('World', "The world's night of the day: everyone, one hall", () => worldSeed(today)),
      mk('Random', 'A new night', () => randomSeed(this.seed.country)),
    );
    const country = COUNTRIES.find((c) => c.id === this.seed.country.id)!;
    b.append(
      seedRow,
      el('p', 'g-note', `${country.name} hall · share the seed and others play the same night${country.id !== COUNTRY.id ? ' · starting opens this hall' : ''}`),
    );

    // Announced on the timeline.
    const ann = n.events.filter(announced).map((e) => {
      if (e.kind === 'lateInbound') return `${hhmm(e.hour)} late inbound ≈ ${fmt(e.forecast)}`;
      if (e.kind === 'robotsDown') return `${hhmm(e.hour)}–${hhmm(e.hour + e.hours)} robot maintenance (−${Math.round(e.share * 100)}%)`;
      if (e.kind === 'earlyCutoff') return `05:30 ${n.cities[e.city]!.name} carrier leaves early`;
      return '';
    });
    b.append(el('p', 'g-note', `Announced: ${ann.join(' · ')}. ± = uncertain tonight, either way.`));

    // Counters.
    const north = p.doors.reduce((a, d) => a + d, 0);
    const robots = p.doors.filter((d) => d === 0).length;
    const fleet = n.cities.reduce((a, c, i) => a + (p.doors[i] ? 0 : c.forecast), 0);
    b.append(el('p', 'g-note', `North doors ${north} / ${NORTH_DOORS} · robot cities ${robots} / ${ROBOT_DOORS} · fleet ${fmt(fleet)} / 3 200 a night`));

    // Cities.
    const list = el('div', 'g-cities');
    n.cities.forEach((c, i) => {
      const row = el('div', 'g-city');
      const nm = el('span', 'nm', `${c.name}${c.unsure ? ' ±' : ''}`);
      nm.title = c.name;
      if (c.tag) nm.append(el('span', `tg ${c.tag.startsWith('+') ? 'up' : 'down'}`, c.tag));
      const chips = el('div', 'chips');
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-label', `Plan for ${c.name}`);
      for (let v = 0; v <= MAX_DOORS; v++) {
        const on = p.doors[i] === v;
        const x = el('button', on ? 'on' : '', v === 0 ? 'R' : String(v));
        x.title = v === 0 ? 'Robots (one south door)' : `${v} north door${v > 1 ? 's' : ''}`;
        x.setAttribute('aria-pressed', String(on));
        x.onclick = () => {
          p.doors[i] = v;
          this.draw();
        };
        chips.append(x);
      }
      const per = p.doors[i] ? c.forecast / p.doors[i]! : 0;
      const ld = el('span', `ld${per > 450 ? ' hot' : ''}`, p.doors[i] ? `${fmt(per)}/door` : 'robots');
      row.append(nm, el('span', 'n', fmt(c.forecast)), chips, ld);
      list.append(row);
    });
    b.append(list);

    // Reserve.
    const res = el('div', 'set-row');
    res.append(el('span', 'set-label', 'Store reserve for the late inbound'));
    const ro = el('div', 'set-opts chips');
    for (const r of RESERVES) {
      const x = el('button', p.reserve === r ? 'on' : '', `${Math.round(r * 100)}%`);
      x.onclick = () => {
        p.reserve = r;
        this.draw();
      };
      ro.append(x);
    }
    res.append(ro);
    b.append(res);

    // Estimate.
    const ok = validPlan(p);
    const tiles = el('div', 'g-tiles');
    const tile = (v: string, l: string) => {
      const t = el('div', 'g-tile');
      t.append(el('b', '', v), el('span', '', l));
      tiles.append(t);
    };
    if (ok) {
      const r = play(n, p, [], false);
      tile(`${(r.onTime * 100).toFixed(1)}%`, 'on time if the forecast holds');
      tile(fmt(r.late), 'late parcels');
      tile(String(r.fullTrailers), 'full trailers');
      tile(this.par ? String(shown(expected(n, p), this.par)) : '…', 'plan score (of 1000)');
    } else tile('—', north !== NORTH_DOORS ? `use exactly ${NORTH_DOORS} north doors` : 'at most 20 robot cities');
    b.append(tiles);

    const row = el('div', 'cols2');
    const reset = el('button', '', 'Hall as it stands');
    reset.onclick = () => {
      this.plan = standingPlan(n);
      this.draw();
    };
    const go = el('button', 'primary', 'Start the night');
    go.disabled = !ok;
    go.onclick = () => {
      Session.clearSaved();
      location.href = Session.url(this.seed, p);
    };
    row.append(reset, go);
    b.append(row);
  }

  // ———————————————————————————————— the night

  private drawStatus(): void {
    const s = this.session!;
    const b = this.body;
    b.replaceChildren();
    const r = s.projected();
    const tiles = el('div', 'g-tiles');
    const h = s.hour;
    for (const [v, l] of [
      [String(s.score(r)), 'on course (of 1000)'],
      [fmt(r.lateByHour[h] ?? 0), 'late so far'],
      [String(r.fullByHour[h] ?? 0), 'full trailers so far'],
      [String(s.moves.length), 'moves'],
    ]) {
      const t = el('div', 'g-tile');
      t.append(el('b', '', v!), el('span', '', l!));
      tiles.append(t);
    }
    b.append(tiles, el('h3', 'g-h', 'Signals'));
    for (const e of s.night.events) {
      if (!announced(e) && e.hour > h) continue;
      const row = el('div', 'g-sig');
      const t = el('time', '', hhmm(e.hour));
      const c = (i: number) => s.night.cities[i]!.name;
      const txt =
        e.kind === 'lateInbound'
          ? e.hour <= h
            ? `Late inbound landed: ${fmt(e.actual)} (announced ${fmt(e.forecast)})`
            : `Late inbound due, about ${fmt(e.forecast)}`
          : e.kind === 'robotsDown'
            ? `Robot maintenance for ${e.hours} h: fleet −${Math.round(e.share * 100)}%`
            : e.kind === 'earlyCutoff'
              ? `${c(e.city)}'s last trailer leaves at 05:30`
              : e.kind === 'drift'
                ? `${c(e.city)} runs ${e.delta > 0 ? '+' : '−'}${Math.round(Math.abs(e.delta) * 100)}% against the forecast`
                : `${c(e.city)}: trailer late, doors idle for an hour`;
      row.append(t, el('span', e.hour > h ? 'later' : '', txt));
      b.append(row);
    }
  }

  /** One move block: title, what is left, controls, the effect it would have now, and Do. */
  private moveBlock(title: string, note: string, controls: HTMLElement[], make: () => Move | null, why = ''): HTMLElement {
    const s = this.session!;
    const box = el('div', 'g-move');
    const ttl = el('div', 'ttl');
    ttl.append(el('b', '', title), el('span', '', note));
    const act = el('div', 'act');
    const delta = el('span', 'g-delta');
    const doIt = el('button', 'primary', 'Do it');
    const base = s.score(s.projected());
    const preview = () => {
      const m = make();
      if (!m || why) {
        delta.textContent = why;
        delta.className = 'g-delta';
        doIt.disabled = true;
        return;
      }
      const d = s.score(s.projected([m])) - base;
      delta.textContent = `${d >= 0 ? '+' : ''}${d} expected`;
      delta.className = `g-delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`;
      doIt.disabled = false;
    };
    for (const c of controls) c.addEventListener('change', preview);
    doIt.onclick = () => {
      const m = make();
      if (!m) return;
      s.add(m);
      this.draw();
    };
    act.append(...controls, delta, doIt);
    box.append(ttl, act);
    preview();
    return box;
  }

  private citySelect(filter: (i: number) => boolean, label: string): HTMLSelectElement {
    const s = this.session!;
    const sel = el('select');
    sel.setAttribute('aria-label', label);
    s.night.cities.forEach((c, i) => {
      if (!filter(i)) return;
      const o = el('option', '', `${c.name} (${s.plan.doors[i]})`);
      o.value = String(i);
      sel.append(o);
    });
    return sel;
  }

  private drawMoves(): void {
    const s = this.session!;
    const b = this.body;
    b.replaceChildren();
    const h = s.hour;
    const north = (i: number) => s.plan.doors[i]! > 0;
    b.append(el('p', 'g-note', `${s.time} · the effect is worked out from what you know now. Freeze first to think it over.`));

    const from = this.citySelect(north, 'Take a door from');
    const to = this.citySelect(north, 'Give it to');
    to.selectedIndex = Math.min(1, to.options.length - 1);
    b.append(
      this.moveBlock(
        'Swap a door',
        `${s.left('swap')} left · from ${hhmm(SWAP_FROM)} · dead for 2 h, then half a door`,
        [from, to],
        () => (from.value === to.value ? null : { kind: 'swap', hour: h, from: +from.value, to: +to.value }),
        s.left('swap') <= 0 ? 'used' : h < SWAP_FROM ? `from ${hhmm(SWAP_FROM)}` : '',
      ),
    );
    const goCity = this.citySelect(north, 'City');
    b.append(
      this.moveBlock(
        'Send a full trailer early',
        `${s.left('go')} left · 00:00–01:00 and 04:00–05:00 · ≥90% full`,
        [goCity],
        () => ({ kind: 'go', hour: h, city: +goCity.value }),
        s.left('go') <= 0 ? 'used' : h !== 2 && h !== 6 ? 'not now' : '',
      ),
    );
    b.append(
      this.moveBlock('Forklifts to the robots first', `${s.left('forklift')} left · +15 parcels this hour`, [], () => ({ kind: 'forklift', hour: h }), s.left('forklift') <= 0 ? 'used' : ''),
    );
    const holdCity = this.citySelect(north, 'City');
    const win = h < 4 ? 0 : 1;
    b.append(
      this.moveBlock(
        'Hold trailers 10 min',
        `the ${win ? '06:00' : '02:00'} trailer · +25 parcels, −100 points`,
        [holdCity],
        () => ({ kind: 'hold', city: +holdCity.value, window: win as 0 | 1 }),
        s.moves.some((m) => m.kind === 'hold' && m.city === +holdCity.value && m.window === win) ? 'already held' : '',
      ),
    );
    b.append(
      this.moveBlock(
        'Release the store reserve',
        `now instead of at 02:00 (${Math.round(s.plan.reserve * 100)}% kept)`,
        [],
        () => ({ kind: 'release', hour: h }),
        h >= 4 ? 'already free' : s.moves.some((m) => m.kind === 'release') ? 'done' : '',
      ),
    );
    if (s.moves.length) {
      b.append(el('h3', 'g-h', 'Done tonight'));
      for (const m of s.moves) b.append(el('div', 'g-sig', describe(m, s.night)));
    }
  }

  private drawDebrief(): void {
    const s = this.session!;
    const b = this.body;
    b.replaceChildren();
    const r = s.final();
    const sc = s.score(r);
    const planOnly = s.score(play(s.night, s.plan));
    const head = el('div', 'g-score');
    head.append(el('span', 'g-big', String(sc)), el('span', 'g-grade', grade(sc)));
    b.append(head, el('p', 'g-note', `${s.code} · plan alone ${planOnly}, moves +${sc - planOnly} · 100 = the hall as it stands, 1000 = the best night found`));
    const tiles = el('div', 'g-tiles');
    for (const [v, l] of [
      [`${(r.onTime * 100).toFixed(1)}%`, 'on time'],
      [fmt(r.late), 'late parcels'],
      [String(r.fullTrailers), 'full trailers'],
      [String(s.moves.length), 'moves'],
    ]) {
      const t = el('div', 'g-tile');
      t.append(el('b', '', v!), el('span', '', l!));
      tiles.append(t);
    }
    b.append(tiles);
    const row = el('div', 'cols3');
    const again = el('button', '', 'Same night again');
    again.onclick = () => {
      Session.clearSaved();
      location.href = Session.url(s.seed, s.plan);
    };
    const replan = el('button', '', 'New plan');
    replan.onclick = () => {
      this.session = null;
      document.body.classList.remove('gaming');
      this.loadSeed(s.seed);
      this.buildDock();
      this.show('briefing');
    };
    const free = el('button', 'primary', 'Free run');
    free.onclick = () => (location.href = Session.exitUrl());
    row.append(again, replan, free);
    b.append(row);
  }
}

function describe(m: Move, n: Night): string {
  const c = (i: number) => n.cities[i]!.name;
  const t = 'hour' in m ? `${hhmm(m.hour)} ` : '';
  switch (m.kind) {
    case 'swap':
      return `${t}Door from ${c(m.from)} to ${c(m.to)}`;
    case 'go':
      return `${t}${c(m.city)} trailer sent early`;
    case 'forklift':
      return `${t}Forklifts to the robots`;
    case 'hold':
      return `${c(m.city)} ${m.window ? '06:00' : '02:00'} trailer held 10 min`;
    case 'release':
      return `${t}Store reserve released`;
  }
}

