// Ten Shifts: the planner. One row per city on a time line for the whole shift; blocks are made,
// selected and edited with buttons (and dragged with a mouse). Everything shown comes from the
// briefing's numbers and the plan: fixed costs, how full a block is, docks and people in use and
// a rough buffer guess. No profit, no real buffer figures, no word on trucks being on time: those
// come with the result. This file never touches the score service.
import { CLEARDOWN_MINUTES, CURRENCY, PRICES, RATES, type City, type Level, type Plan, type PlanProblem } from '../../../shifts/contract';
import { arrivalRate, arrivedBy, dockRate, firstParcel, nominalFlow, robotLines } from '../../../shifts/estimate';
import { cityColour, cityName, clock, count, h, mark, money, plural } from './dom';
import { addBlock, canStep, moveBlock, removeBlock, setEnd, setPeople, setRobotCity, setRobots, setStart, stepEnd, stepStart } from './edit';
import { assignDoors, blockCost, busyDockSteps, checkPlan, fixedCosts, goalStanding, mostToEarn, peak, peopleSteps, unservedCities, type Step, capacitySteps, influxSteps } from './rules';

export interface PlannerOptions {
  level: Level;
  cityNames: string[];
  plan: Plan;
  onChange(p: Plan): void;
  onStart(p: Plan): void;
  onBack(): void;
}

interface Selection {
  city: number;
  /** Index in plan.blocks, or null when only the city is selected. */
  block: number | null;
}

const clonePlan = (p: Plan): Plan => ({ blocks: p.blocks.map((b) => ({ ...b })), robotCities: [...p.robotCities], robots: p.robots });

const FRESH_KEY = 'sortsim.shifts.fresh';
function freshSeen(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(FRESH_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}
const seenFresh = (id: number): boolean => freshSeen().includes(id);
function rememberFresh(id: number): void {
  try {
    localStorage.setItem(FRESH_KEY, JSON.stringify([...new Set([...freshSeen(), id])]));
  } catch {
    /* no storage: it shows again next time */
  }
}

export function plannerView(o: PlannerOptions): HTMLElement {
  const { level, cityNames } = o;
  const name = (c: number) => cityName(cityNames, c);
  const span = level.shiftMinutes + Math.max(RATES.maxLateMinutes, CLEARDOWN_MINUTES); // room for the last truck's cleardown
  const hasRobots = level.robotsMax > 0;
  // Rows in the order the trucks leave: the night reads from top to bottom.
  const order = level.cities.map((_, i) => i).sort((a, b) => level.cities[a]!.truck - level.cities[b]!.truck || a - b);

  // A block is one dock. (An older saved plan may still hold blocks of several docks: those become
  // as many single ones side by side, which the score model counts as the same plan.)
  let plan = clonePlan(o.plan);
  plan.blocks = plan.blocks.flatMap((b) => Array.from({ length: Math.max(1, b.docks) }, () => ({ ...b, docks: 1 })));
  let sel: Selection | null = null;
  let asking = false; // the "start without these cities?" question is open
  let costsOpen = false; // the cost breakdown above the bottom bar is open
  let pph = 64; // pixels per hour on the time line
  let quietClick = false; // a drag just ended: the click that follows is not a tap on the row

  // Many cities: lower rows, so more of the night is in view at once.
  const dense = level.cities.length > 8;
  const root = h('div', { class: `shp-planner${dense ? ' shp-dense' : ''}` });
  const side = h('aside', { class: 'shp-side', 'aria-label': 'Plan notes' });
  const scroll = h('div', { class: 'shp-scroll', tabindex: '0', role: 'group', 'aria-label': 'Time line of the shift' });
  const grid = h('div', { class: 'shp-grid' });
  scroll.append(grid);
  const fleet = h('div', { class: 'shp-fleet' });
  const legend = h('div', { class: 'shp-legend' });
  const board = h('section', { class: 'shp-board', 'aria-label': 'Plan' }, scroll, fleet, legend);
  // Profit needed for one, two and three stars (half, three quarters and nine tenths of the level's par).
  const targets = [0.5, 0.75, 0.9].map((f) => Math.round(level.par * f));
  // What is new in this level: shown until the player closes it, once per level.
  let freshOpen = !!level.notes.fresh && !seenFresh(level.id);
  const insp = h('aside', { class: 'shp-insp', 'aria-label': 'Selected city or block' });
  const bar = h('footer', { class: 'shp-bar' });
  const ask = h('div', { class: 'shp-ask', hidden: true });
  const main = h('div', { class: 'shp-main' }, side, board, insp);
  root.append(
    h('header', { class: 'shp-head' },
      h('div', { class: 'shp-title' }, mark(),
        h('div', {}, h('h1', {}, h('span', { class: 'shp-wide', text: 'Level ' }), `${level.id} · ${level.name}`), h('p', { title: 'Profit to beat for one, two and three stars' }, h('span', { class: 'shp-wide', text: 'Profit to beat · ' }), targets.map((t, i) => `${'★'.repeat(i + 1)} ${money(t)}`).join(' · ')))),
      h('button', { class: 'shp-btn', type: 'button', text: 'Briefing', onclick: () => o.onBack() })),
    main,
    bar,
    ask,
  );

  const isPhone = () => root.clientWidth > 0 && root.clientWidth <= 760;
  const labelWidth = () => (isPhone() ? 92 : 140);

  /** Takes a changed plan: remember it, tell the owner, draw again. */
  function commit(next: Plan, select?: Selection | null): void {
    plan = next;
    if (select !== undefined) sel = select;
    o.onChange(clonePlan(plan));
    render();
  }

  function select(next: Selection | null, reveal = false): void {
    sel = next;
    render();
    if (reveal && sel) {
      const el = sel.block !== null ? grid.querySelector(`[data-key="block-${sel.block}"]`) : grid.querySelector(`[data-key="row-${sel.city}"]`);
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (sel && insp.classList.contains('is-inline')) {
      // The city's line to the top, its details right under it.
      scroll.style.scrollPaddingBottom = '6px';
      grid.querySelector(`[data-key="row-${sel.city}"]`)?.scrollIntoView({ block: 'start', inline: 'nearest' });
    }
  }

  /** A tap on a city's label or its empty line: its details open, or close when they were open. */
  function tapCity(city: number): void {
    if (sel?.city === city && sel.block === null) select(null);
    else select({ city, block: null }, true);
  }

  /** A first (or another) dock block for a city, selected so it can be changed at once. */
  function addDock(city: number): void {
    const made = addBlock(level, plan, city);
    commit(made.plan, { city, block: made.index });
    grid.querySelector(`[data-key="block-${made.index}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Robots on or off for a city. A switched-on city with no robots would do nothing: the fleet gets enough for its lines. */
  function toggleRobots(city: number): void {
    const on = plan.robotCities.includes(city);
    let next = setRobotCity(level, plan, city, !on);
    if (!on && next.robots === 0) next = setRobots(level, next, robotLines(level.cities[city]!) * Math.ceil(60 / RATES.robot));
    commit(next, { city, block: sel?.city === city ? sel.block : null });
  }

  /** A small standing figure: one per person on a dock. */
  function figure(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'shp-fig');
    svg.setAttribute('viewBox', '0 0 8 14');
    svg.setAttribute('width', '8');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 0a2.2 2.2 0 1 1 0 4.4A2.2 2.2 0 0 1 4 0ZM1.6 5.4h4.8A1.6 1.6 0 0 1 8 7v3H6.6v4H1.4v-4H0V7a1.6 1.6 0 0 1 1.6-1.6Z');
    svg.append(path);
    return svg;
  }

  function blockRange(i: number): string {
    const b = plan.blocks[i]!;
    return `${clock(b.start)}–${clock(b.end)}`;
  }

  /** What is wrong, in words; `short` leaves out which block (for the note next to the block). */
  function problemText(p: PlanProblem, short = false): string {
    const of = (i: number) => (short ? '' : `${name(plan.blocks[i]?.city ?? 0)} ${blockRange(i)}: `);
    const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
    switch (p.kind) {
      case 'grid': return cap(`${of(p.block)}start and end go on a half hour, the first parcel or the cut-off.`);
      case 'tooShort': return cap(`${of(p.block)}a block lasts at least an hour.`);
      case 'afterTruck': return cap(`${of(p.block)}ends after the cut-off (${clock(level.cities[plan.blocks[p.block]!.city]!.truck)}).`);
      case 'noDock': return cap(`${of(p.block)}no dock free. The hall has ${plural(level.docks, 'dock', 'docks')}, and a dock needs 15 minutes to switch city.`);
      case 'tooManyPeople': return `More than ${level.peopleCap} people at work from ${clock(p.at)}.`;
      case 'tooManyRobots': return `The fleet is larger than tonight's ${plural(level.robotsMax, 'robot', 'robots')}.`;
      case 'robotsOff': return 'Robots are off tonight.';
    }
  }

  /** The block a problem points at (for people: the first block open at that moment). */
  function problemBlock(p: PlanProblem): number | null {
    if ('block' in p) return p.block;
    if (p.kind === 'tooManyPeople') {
      const i = plan.blocks.findIndex((b) => b.start <= p.at && p.at < b.end);
      return i >= 0 ? i : null;
    }
    return null;
  }

  // ---- dragging with a mouse (touch scrolls the time line; buttons do everything too) ----
  function startDrag(ev: PointerEvent, index: number): void {
    if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
    const el = ev.currentTarget as HTMLElement;
    const box = el.getBoundingClientRect();
    const edge = Math.min(10, box.width / 4);
    const mode = ev.clientX - box.left < edge ? 'start' : box.right - ev.clientX < edge ? 'end' : 'move';
    const base = clonePlan(plan);
    const orig = base.blocks[index]!;
    const x0 = ev.clientX;
    let moved = false;
    ev.preventDefault();
    const move = (e: PointerEvent) => {
      const dx = e.clientX - x0;
      if (!moved && Math.abs(dx) < 4) return;
      moved = true;
      const dt = (dx / pph) * 60;
      const next = mode === 'start' ? setStart(level, base, index, orig.start + dt) : mode === 'end' ? setEnd(level, base, index, orig.end + dt) : moveBlock(level, base, index, orig.start + dt);
      const a = next.blocks[index]!;
      const b = plan.blocks[index]!;
      if (a.start !== b.start || a.end !== b.end) commit(next, { city: orig.city, block: index });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      root.classList.remove('shp-dragging');
      quietClick = true;
      setTimeout(() => (quietClick = false), 0);
      if (!moved) select({ city: orig.city, block: index });
    };
    root.classList.add('shp-dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // ---- drawing ----
  function render(): void {
    // Whatever had the focus gets it back after the redraw, so the keyboard keeps working.
    const active = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement.dataset.key : undefined;
    if (sel && sel.block !== null && !plan.blocks[sel.block]) sel = { city: sel.city, block: null };

    const problems = checkPlan(level, plan);
    const doors = assignDoors(level, plan.blocks);
    const flow = nominalFlow(level, plan);
    const costs = fixedCosts(level, plan);
    const badBlocks = new Map<number, string[]>();
    for (const p of problems) {
      if ('block' in p) badBlocks.set(p.block, [...(badBlocks.get(p.block) ?? []), problemText(p, true)]);
    }
    const phone = isPhone();
    const labelW = labelWidth();
    const room = (scroll.clientWidth || (phone ? 340 : 640)) - labelW - 6;
    // A phone shows a shift of up to about six hours whole; a longer one scrolls sideways.
    pph = Math.max(phone ? (span <= 400 ? 34 : 58) : 60, Math.floor((room / (span / 60)) * 100) / 100);
    const x = (t: number) => (t / 60) * pph;
    const trackW = Math.ceil(x(span));
    // When a city's parcels come in, and how many at a time: the same scale for every city of
    // the level, so a big wave looks big. This is what the briefing gives, not a result.
    const topRate = Math.max(1, ...level.cities.flatMap((c) => c.arrivals.map((a) => arrivalRate(c, (a.from + a.to) / 2))));
    const waveShape = (city: City, from: number, to: number, hgt: number): SVGSVGElement => {
      const left = x(from);
      const w = Math.max(1, x(to) - left);
      let d = `M0 ${hgt}`;
      for (let m = from; m < to; m += 5) {
        const y = hgt - Math.max(1.5, (arrivalRate(city, m + 2.5) / topRate) * (hgt - 1));
        d += ` L${(x(m) - left).toFixed(1)} ${y.toFixed(1)} L${(x(Math.min(to, m + 5)) - left).toFixed(1)} ${y.toFixed(1)}`;
      }
      d += ` L${w.toFixed(1)} ${hgt} Z`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'shp-wave');
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(hgt));
      svg.setAttribute('style', `left:${left}px`);
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.append(path);
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `Parcels come in ${clock(from)}–${clock(to)}`;
      svg.append(title);
      return svg;
    };
    root.classList.toggle('shp-has-sel', !!sel);

    if (!phone || !sel) {
      insp.classList.remove('is-inline');
      insp.style.width = '';
    }
    drawSide(problems, flow.left);
    drawGrid();
    if (!insp.isConnected || (!insp.classList.contains('is-inline') && insp.parentElement !== main)) main.append(insp);
    drawFleet();
    drawInspector();
    drawBar();
    drawAsk();
    if (active) {
      let el = root.querySelector<HTMLButtonElement>(`[data-key="${active}"]`);
      // A stepper button that just reached its limit cannot hold the focus: its partner takes it.
      if (el?.disabled) el = el.parentElement?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? null;
      el?.focus({ preventScroll: true });
    }

    function cityState(c: number): string {
      const blocks = plan.blocks.filter((b) => b.city === c).length;
      const robots = hasRobots && plan.robotCities.includes(c);
      if (!blocks && !robots) return 'not planned';
      const how = blocks && robots ? 'docks + robots' : robots ? 'robots' : 'planned';
      if (robots && !blocks && plan.robots === 0) return 'robots · no fleet yet';
      // No verdict on whether the city fits: the block's fill bar is all the planner gives away.
      return how;
    }

    function drawSide(list: PlanProblem[], left: number[]): void {
      void left;
      const goal = plan.blocks.length || plan.robotCities.length ? goalStanding(level, plan) : null;
      const parts = [
        freshOpen
          ? h('div', { class: 'shp-fresh' }, h('span', {}, h('b', { text: 'New in this level. ' }), level.notes.fresh),
              h('button', { class: 'shp-fresh-x', type: 'button', 'aria-label': 'Close', text: '✕', onclick: () => { freshOpen = false; rememberFresh(level.id); render(); } }))
          : null,
        list.length
          ? h('div', { class: 'shp-problems', role: 'status' },
              h('div', { class: 'shp-problems-head', text: `${plural(list.length, 'problem', 'problems')} to solve before the shift can start` }),
              ...list.map((p, i) => {
                const b = problemBlock(p);
                return h('button', { class: 'shp-problem', type: 'button', 'data-key': `problem-${i}`, text: problemText(p), onclick: () => (b !== null ? select({ city: plan.blocks[b]!.city, block: b }, true) : fleet.querySelector<HTMLElement>('input')?.focus()) });
              }))
          : null,
        h('div', { class: `shp-goal${goal ? (goal.ok ? ' is-ok' : ' is-off') : ''}` }, h('b', { text: 'Badge: ' }), `${level.badge.text}.`, goal ? ` ${goal.text}` : ''),
        h('div', { class: 'shp-tip' }, h('b', { text: 'Tip. ' }), 'Every city has one line. Add a dock or robots in the line, tap a bar to change it, or drag its ends: steps of half an hour. Tap a city name for its robots and more docks.'),
      ];
      side.replaceChildren(...parts.filter((p): p is HTMLDivElement => !!p));
    }

    function strip(title: string, sub: string, content: HTMLElement, cls = ''): HTMLElement {
      return h('div', { class: `shp-row shp-strip ${cls}` },
        h('div', { class: 'shp-label', style: `width:${labelW}px` }, h('b', { text: title }), h('span', { text: sub })),
        content);
    }

    /** A count through the night as bars against a limit; red where it goes over. */
    function profile(steps: Step[], cap: number, what: string): HTMLElement {
      const top = Math.max(cap, peak(steps), 1);
      const el = h('div', { class: 'shp-track shp-profile', style: `width:${trackW}px`, role: 'img', 'aria-label': `${what}: at most ${peak(steps)} of ${cap}` });
      for (const s of steps) {
        el.append(h('div', { class: `shp-bar-step${s.value > cap ? ' is-over' : ''}`, style: `left:${x(s.from)}px;width:${Math.max(1, x(s.to) - x(s.from))}px;height:${(s.value / top) * 100}%`, title: `${clock(s.from)}–${clock(s.to)}: ${s.value} of ${cap}` }));
      }
      el.append(h('div', { class: 'shp-capline', style: `bottom:${(cap / top) * 100}%` }));
      return el;
    }

    function drawGrid(): void {
      const rows: HTMLElement[] = [];
      // Hour marks.
      const hours = h('div', { class: 'shp-track shp-hours', style: `width:${trackW}px` });
      for (let t = 0; t <= span; t += 60) hours.append(h('span', { style: `left:${x(t)}px`, text: clock(t) }));
      rows.push(h('div', { class: 'shp-row shp-hours-row' }, h('div', { class: 'shp-label', style: `width:${labelW}px`, title: 'What the planned crews can load, against the parcels for the city' }, h('span', { text: 'capacity / total' })), hours));

      for (const c of order) {
        const city = level.cities[c]!;
        const mine = plan.blocks.map((b, i) => ({ b, i })).filter((e) => e.b.city === c).sort((p, q) => p.b.start - q.b.start || p.i - q.i);
        // Blocks that overlap sit under each other.
        const laneEnd: number[] = [];
        const lane = new Map<number, number>();
        for (const { b, i } of mine) {
          let k = laneEnd.findIndex((e) => e <= b.start);
          if (k < 0) k = laneEnd.length;
          laneEnd[k] = b.end;
          lane.set(i, k);
        }
        const blockH = dense || phone ? 40 : 46; // a finger needs 40
        const onRobots = hasRobots && plan.robotCities.includes(c);
        const WAVE = 16; // the strip under the blocks that shows when this city's parcels come in
        const height = Math.max(1, laneEnd.length) * (blockH + 4) + 6 + (onRobots ? 12 : 0) + WAVE;
        const first = firstParcel(city);
        const lastIn = Math.max(...city.arrivals.map((a) => a.to));
        const track = h('div', { class: `shp-track shp-city${sel?.city === c ? ' is-sel' : ''}`, style: `width:${trackW}px;height:${height}px;--c:${cityColour(c)}`,
          onclick: (e: Event) => {
            if (quietClick || e.target !== track) return;
            tapCity(c);
          } },
          h('div', { class: 'shp-after', style: `left:${x(level.shiftMinutes)}px` }),
          h('div', { class: 'shp-clear', style: `left:${x(city.truck)}px;width:${x(city.truck + CLEARDOWN_MINUTES) - x(city.truck)}px`, title: `Cleardown: the ${CLEARDOWN_MINUTES} minutes after the cut-off, the crew loads the last parcels and cages` }),
          waveShape(city, first, lastIn, WAVE),
          h('div', { class: 'shp-truck', style: `left:${x(city.truck)}px`, title: `Cut-off ${clock(city.truck)}` }),
        );
        if (!mine.length && !onRobots) {
          track.append(
            h('div', { class: 'shp-adds', style: `left:${Math.max(4, Math.min(x(first) + 6, trackW - (hasRobots ? 170 : 86)))}px` },
              h('button', { class: 'shp-add', type: 'button', 'data-key': `add-dock-${c}`, 'aria-label': `Add a dock for ${name(c)}`, text: '+ Dock', onclick: () => addDock(c) }),
              hasRobots ? h('button', { class: 'shp-add', type: 'button', 'data-key': `add-robots-${c}`, 'aria-label': `Let robots load ${name(c)}`, text: '+ Robots', onclick: () => toggleRobots(c) }) : null),
          );
        } else if (!mine.length) {
          track.append(h('span', { class: 'shp-hint', style: `left:${x(first) + 10}px;top:${(blockH + 4) / 2}px`, text: plan.robots ? 'robots only' : 'robots only · no fleet yet' }));
        }
        if (onRobots) {
          track.append(h('div', { class: 'shp-robots-band', style: `left:${x(first)}px;width:${x(city.truck) - x(first)}px;top:${height - 13 - WAVE}px`, title: `Robot lines ${clock(first)}–${clock(city.truck)}` }, h('span', { text: 'robots' })));
        }
        const notes: string[] = [];
        for (const { b, i } of mine) {
          const f = flow.blocks[i]!;
          const reach = f.loaded + f.waitingAtEnd;
          const fill = f.capacity > 0 ? reach / f.capacity : 0;
          const w = Math.max(18, x(b.end) - x(b.start));
          const people = b.people === 1 ? '1 person' : '2 people';
          const docks = plural(b.docks, 'dock', 'docks');
          const label = w >= 150 ? blockRange(i) : '';
          const figs = h('span', { class: 'shp-figs' }, figure(), b.people === 2 ? figure() : null);
          const bad = badBlocks.get(i);
          if (bad) notes.push(...bad.map((t) => (mine.length > 1 ? `${blockRange(i)}: ${t}` : t)));
          track.append(
            h('button', { class: `shp-block${sel?.block === i ? ' is-sel' : ''}${bad ? ' is-bad' : ''}`, type: 'button', 'data-key': `block-${i}`,
              style: `left:${x(b.start)}px;width:${w}px;top:${3 + lane.get(i)! * (blockH + 4)}px;height:${blockH}px`,
              'aria-pressed': String(sel?.block === i),
              'aria-label': `${name(c)}, ${blockRange(i)}, ${docks}, ${people} per dock, ${Math.round(Math.min(fill, 9.99) * 100)}% full${bad ? `. Problem: ${bad.join(' ')}` : ''}`,
              onpointerdown: (e: PointerEvent) => startDrag(e, i),
              onclick: () => select({ city: c, block: i }) },
              h('span', { class: 'shp-block-text' }, figs, label ? h('span', { text: label }) : null),
              h('span', { class: `shp-fill${fill > 1.005 ? ' is-over' : ''}` }, h('span', { style: `width:${Math.min(100, Math.round(fill * 100))}%` }))),
          );
        }
        const isBad = mine.some((e) => badBlocks.has(e.i));
        // What this city's dock crews can load in their planned hours (a limit, not a forecast).
        const room = Math.round(mine.reduce((a, e) => a + flow.blocks[e.i]!.capacity, 0));
        const open = sel?.city === c;
        rows.push(
          h('div', { class: 'shp-row', 'data-key': `row-${c}` },
            h('button', { class: `shp-label shp-city-label${sel?.city === c ? ' is-sel' : ''}`, type: 'button', style: `width:${labelW}px;--c:${cityColour(c)}`, 'data-key': `label-${c}`, onclick: () => tapCity(c), title: `${name(c)} · room for ${count(room)}${onRobots ? ' and robots' : ''} · ${count(city.volume)} parcels · cut-off ${clock(city.truck)}`, 'aria-expanded': String(open) },
              h('b', {}, name(c), h('i', { class: 'shp-chev', 'aria-hidden': 'true', text: open ? '▾' : '▸' })), h('span', { class: 'shp-num shp-room' }, ...(onRobots && !mine.length ? ['robots'] : [h('em', { text: count(room) }), onRobots ? (phone ? ' + R' : ' + robots') : '']), ` / ${count(city.volume)}`),
            ),
            h('div', { class: 'shp-cell' }, track, notes.length ? h('div', { class: `shp-note${isBad ? ' is-bad' : ''}`, style: `width:${trackW}px`, text: notes.join(' ') }) : null)),
        );
        // On a phone the details open right under the city's own line.
        if (open && phone) {
          insp.classList.add('is-inline');
          insp.style.width = `${Math.max(240, scroll.clientWidth - 2)}px`;
          insp.style.setProperty('--c', cityColour(c));
          rows.push(insp);
        }
      }

      // Docks: door by door in a small hall, as a count in a large one.
      const busy = busyDockSteps(plan, doors);
      const dockPeak = peak(busy);
      let docksEl: HTMLElement;
      if (level.docks <= 6) {
        const short = doors.short.some((n) => n > 0);
        docksEl = h('div', { class: 'shp-track shp-doors', style: `width:${trackW}px;height:${(level.docks + (short ? 1 : 0)) * 12 + 8}px`, role: 'img', 'aria-label': `Docks in use: at most ${dockPeak} of ${level.docks}` });
        for (const u of doors.uses) {
          if (u.switchFrom !== undefined && u.switchFrom < u.start) docksEl.append(h('div', { class: 'shp-switch', style: `left:${x(u.switchFrom)}px;width:${x(u.start) - x(u.switchFrom)}px;top:${5 + u.door * 12}px`, title: 'A dock switching city, 15 minutes' }));
          docksEl.append(h('div', { class: 'shp-door', style: `left:${x(u.start)}px;width:${x(u.end) - x(u.start)}px;top:${5 + u.door * 12}px;background:${cityColour(u.city)}`, title: `${name(u.city)} ${clock(u.start)}–${clock(u.end)}` }));
        }
        plan.blocks.forEach((b, i) => {
          if (doors.short[i]) docksEl.append(h('div', { class: 'shp-door is-over', style: `left:${x(b.start)}px;width:${x(b.end) - x(b.start)}px;top:${5 + level.docks * 12}px`, title: `${name(b.city)}: no dock free` }));
        });
      } else docksEl = profile(busy, level.docks, 'Docks in use');
      const strips = h('div', { class: 'shp-strips' }, strip('Docks', phone ? `${dockPeak} of ${level.docks}` : `peak ${dockPeak} of ${level.docks}`, docksEl, dockPeak > level.docks ? 'is-bad' : ''));

      if (level.peopleCap !== undefined) {
        const ppl = peopleSteps(plan);
        strips.append(strip('People', phone ? `${peak(ppl)} of ${level.peopleCap}` : `peak ${peak(ppl)} of ${level.peopleCap}`, profile(ppl, level.peopleCap, 'People at work'), peak(ppl) > level.peopleCap ? 'is-bad' : ''));
      }

      // One diagram instead of a buffer forecast: what comes in against what the plan can load,
      // both per hour. Where the grey rises above the line the buffer fills; the player does the sum.
      const inflow = influxSteps(level);
      const canLoad = capacitySteps(level, plan);
      const top = Math.max(1, ...inflow.map((q) => q.value), ...canLoad.map((q) => q.value));
      const H = 56;
      const y = (v: number) => (H - 2 - (v / top) * (H - 6)).toFixed(1);
      const area = inflow.map((q) => `M${x(q.from)},${H} V${y(q.value)} H${x(q.to)} V${H} Z`).join(' ');
      let linePath = '';
      let at = 0;
      for (const q of canLoad) {
        if (q.from > at) linePath += `${linePath ? ' L' : 'M'}${x(at)},${y(0)} L${x(q.from)},${y(0)}`;
        linePath += `${linePath ? ' L' : 'M'}${x(q.from)},${y(q.value)} L${x(q.to)},${y(q.value)}`;
        at = q.to;
      }
      if (at < level.shiftMinutes) linePath += `${linePath ? ' L' : 'M'}${x(at)},${y(0)} L${x(level.shiftMinutes)},${y(0)}`;
      const flowEl = h('div', { class: 'shp-track shp-flow', style: `width:${trackW}px;height:${H}px`, role: 'img',
        'aria-label': `Parcels coming in per hour against what the plan can load per hour. Most coming in: ${count(Math.max(0, ...inflow.map((q) => q.value)))}. Most the plan can load: ${count(Math.max(0, ...canLoad.map((q) => q.value)))}.` });
      // (Our own numbers only; nothing from outside goes into this markup.)
      flowEl.innerHTML = `<svg width="${trackW}" height="${H}" viewBox="0 0 ${trackW} ${H}" aria-hidden="true"><path class="shp-flow-in" d="${area}"/><path class="shp-flow-can" d="${linePath}" fill="none"/></svg>`;
      flowEl.append(h('span', { class: 'shp-flow-top shp-num', text: `${count(top)} an hour` }));
      strips.append(strip('Flow', phone ? 'in vs can' : 'in against can load', flowEl));
      rows.push(strips);
      grid.style.width = `${labelW + trackW + 6}px`;
      grid.replaceChildren(...rows);
      // The hours, the city names and the strips stay in place over the rows: keep a block that is
      // scrolled into view clear of them.
      scroll.style.scrollPadding = `26px 8px ${strips.offsetHeight + 6}px ${labelW + 6}px`;

      legend.replaceChildren(
        h('span', {}, h('i', { class: 'shp-key-fill' }), 'how full a block is: the work that can reach it against what its crew can load'),
        h('span', {}, h('i', { class: 'shp-key-in' }), 'parcels coming in per hour'),
        h('span', {}, h('i', { class: 'shp-key-can' }), 'what docks and robots can load per hour'),
        ...(level.docks <= 6 ? [h('span', {}, h('i', { class: 'shp-key-switch' }), 'a dock switching city, 15 min')] : []),
      );
    }

    function stepper(label: string, value: string, key: string, less: (() => void) | null, more: (() => void) | null, lessLabel: string, moreLabel: string): HTMLElement[] {
      return [
        h('div', { class: 'shp-field', text: label }),
        h('div', { class: 'shp-stepper', role: 'group', 'aria-label': label },
          h('button', { class: 'shp-sq', type: 'button', 'aria-label': lessLabel, 'data-key': `${key}-less`, disabled: !less, onclick: () => less?.(), text: '−' }),
          h('b', { class: 'shp-num', 'aria-live': 'polite', text: value }),
          h('button', { class: 'shp-sq', type: 'button', 'aria-label': moreLabel, 'data-key': `${key}-more`, disabled: !more, onclick: () => more?.(), text: '+' })),
      ];
    }

    function drawInspector(): void {
      if (!sel) {
        insp.replaceChildren(h('div', { class: 'shp-cap', text: 'NOTHING SELECTED' }), h('p', { class: 'shp-muted', text: 'Tap a city or a dock bar to change it. A city can have several docks, and robots as well.' }));
        return;
      }
      const c = sel.city;
      const city = level.cities[c]!;
      const i = sel.block;
      const b = i !== null ? plan.blocks[i]! : null;
      const own = plan.blocks.map((blk, k) => ({ blk, k })).filter((e) => e.blk.city === c);
      const parts: (HTMLElement | null)[] = [];
      const cost = b ? blockCost(level, b) : null;
      parts.push(
        h('div', { class: 'shp-insp-head' },
          h('div', {}, h('div', { class: 'shp-cap', text: b ? (own.length > 1 ? `DOCK ${own.findIndex((e) => e.k === i) + 1} OF ${own.length}` : 'DOCK') : 'CITY' }), h('h2', { style: `--c:${cityColour(c)}`, text: name(c) })),
          cost ? h('b', { class: 'shp-num shp-insp-cost', text: money(cost.docks + cost.people) }) : null,
          h('button', { class: 'shp-btn shp-close', type: 'button', 'data-key': 'close', 'aria-label': 'Close', text: 'Close', onclick: () => select(null) })),
        h('div', { class: 'shp-muted shp-num shp-insp-city', text: `${count(city.volume)} parcels · first ${clock(firstParcel(city))} · cut-off ${clock(city.truck)}` }),
      );
      if (b && i !== null) {
        const go = (next: Plan) => commit(next);
        const f = nominalFlow(level, plan).blocks[i]!;
        parts.push(
          h('div', { class: 'shp-controls' },
            ...stepper('Start', clock(b.start), 'start', canStep(level, plan, i, 'start', -1) ? () => go(stepStart(level, plan, i, -1)) : null, canStep(level, plan, i, 'start', 1) ? () => go(stepStart(level, plan, i, 1)) : null, 'Start earlier', 'Start later'),
            ...stepper('End', clock(b.end), 'end', canStep(level, plan, i, 'end', -1) ? () => go(stepEnd(level, plan, i, -1)) : null, canStep(level, plan, i, 'end', 1) ? () => go(stepEnd(level, plan, i, 1)) : null, 'End earlier', 'End later'),
            h('div', { class: 'shp-field', text: 'People' }),
            h('div', { class: 'shp-stepper', role: 'group', 'aria-label': 'People per dock' },
              h('button', { class: 'shp-pick', type: 'button', 'data-key': 'people-1', 'aria-pressed': String(b.people === 1), 'aria-label': '1 person per dock', text: '1', onclick: () => go(setPeople(plan, i, 1)) }),
              h('button', { class: 'shp-pick', type: 'button', 'data-key': 'people-2', 'aria-pressed': String(b.people === 2), 'aria-label': '2 people per dock', text: '2', onclick: () => go(setPeople(plan, i, 2)) })),
          ),
        );
        const bad = badBlocks.get(i);
        if (bad) parts.push(h('div', { class: 'shp-alert', role: 'alert', text: bad.join(' ') }));
        const reach = f.loaded + f.waitingAtEnd;
        parts.push(
          h('div', { class: 'shp-facts shp-num shp-wide' },
            h('div', {}, h('b', { text: 'Parcels: ' }), `about ${count(reach)} are there to load during this block (${count(arrivedBy(city, b.end))} of ${count(city.volume)} are in by ${clock(b.end)}).`),
            h('div', {}, h('b', { text: 'Crew: ' }), `${b.people === 2 ? '2 people load' : '1 person loads'} ${dockRate(b.people)} an hour: room for ${count(f.capacity)} in this block.`),
            h('div', {}, h('b', { text: 'Cost: ' }), `${money(cost!.docks + cost!.people)} (dock ${count(cost!.docks)} · people ${count(cost!.people)}).`)),
          h('div', { class: 'shp-facts shp-num shp-narrow' }, `About ${count(reach)} parcels to load here · room for ${count(f.capacity)}`),
        );
      } else if (!own.length) {
        parts.push(h('p', { class: 'shp-muted', text: hasRobots && plan.robotCities.includes(c) ? 'Robots load this city. A dock is only needed if they cannot keep up.' : 'Nothing planned yet: add a dock' + (hasRobots ? ', or switch on robots.' : '.') }));
      } else {
        parts.push(h('p', { class: 'shp-muted', text: `${plural(own.length, 'dock', 'docks')} planned. Tap one on the time line to change it, or add another.` }));
      }
      const foot = h('div', { class: 'shp-insp-foot' });
      parts.push(foot);
      if (hasRobots) {
        const on = plan.robotCities.includes(c);
        const lines = robotLines(city);
        foot.append(
          h('button', { class: 'shp-switch-btn', type: 'button', role: 'switch', 'aria-checked': String(on), 'data-key': 'robots', onclick: () => toggleRobots(c) },
            h('span', { class: 'shp-switch-knob', 'aria-hidden': 'true' }),
            h('span', {}, h('b', { class: 'shp-wide', text: 'Robots for this city' }), h('b', { class: 'shp-narrow', text: 'Robots' }), h('small', { text: on ? (plan.robots ? `On · ${clock(firstParcel(city))}–${clock(city.truck)} · up to ${Math.min(lines * 60, plan.robots * RATES.robot)} an hour, shared with other robot cities. Docks are extra.` : 'On, but the fleet is 0: set robots below.') : 'Off. Robots load without a dock or people.' }))),
        );
      }
      foot.append(
        h('div', { class: 'shp-actions' },
          h('button', { class: 'shp-btn', type: 'button', 'data-key': 'add', text: 'Add dock', onclick: () => addDock(c) }),
          b && i !== null ? h('button', { class: 'shp-btn', type: 'button', 'data-key': 'remove', text: phone ? 'Remove' : 'Remove dock', onclick: () => {
            const rest = removeBlock(plan, i);
            const other = rest.blocks.findIndex((blk) => blk.city === c);
            commit(rest, { city: c, block: other >= 0 ? other : null });
          } }) : null),
      );
      insp.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
    }

    function drawFleet(): void {
      fleet.hidden = !hasRobots;
      if (!hasRobots) return;
      const set = (n: number) => commit(setRobots(level, plan, n));
      const cities = plan.robotCities.length;
      const input = h('input', { type: 'range', min: '0', max: String(level.robotsMax), step: '1', value: String(plan.robots), 'aria-label': 'Robots in the fleet', 'data-key': 'fleet-range' });
      // (Draw again only when the slider is let go, so it is not replaced under the finger.)
      input.addEventListener('input', () => {
        plan = setRobots(level, plan, Number(input.value));
        out.textContent = `${plan.robots} of ${level.robotsMax}`;
      });
      input.addEventListener('change', () => set(Number(input.value)));
      const out = h('b', { class: 'shp-num', text: `${plan.robots} of ${level.robotsMax}` });
      const over = plan.robots > level.robotsMax;
      fleet.replaceChildren(
        h('div', { class: 'shp-fleet-name' }, h('b', { text: 'Robots' }), h('span', { class: 'shp-num', text: `${money(PRICES.robotPerShiftHour * (level.shiftMinutes / 60))} each for the shift` })),
        h('button', { class: 'shp-sq', type: 'button', 'aria-label': 'One robot fewer', 'data-key': 'fleet-less', disabled: plan.robots <= 0, text: '−', onclick: () => set(plan.robots - 1) }),
        input,
        h('button', { class: 'shp-sq', type: 'button', 'aria-label': 'One robot more', 'data-key': 'fleet-more', disabled: plan.robots >= level.robotsMax, text: '+', onclick: () => set(plan.robots + 1) }),
        h('div', { class: `shp-fleet-info${over || (cities > 0 && plan.robots === 0) ? ' is-warn' : ''}` }, out,
          h('span', { class: 'shp-num', text: cities === 0 ? (plan.robots ? 'no city on robots yet' : 'switch a city to robots in its panel') : plan.robots === 0 ? `${plural(cities, 'city', 'cities')} on robots, no fleet yet` : `${plural(cities, 'city', 'cities')} · ${count(plan.robots * RATES.robot)} an hour${level.robotOutage ? ` · off ${clock(level.robotOutage[0])}–${clock(level.robotOutage[1])}` : ''}` })),
      );
    }

    function drawBar(): void {
      const cell = (label: string, value: string, cls = '') => h('div', { class: `shp-cell-money ${cls}` }, h('span', { text: label }), h('b', { class: 'shp-num', text: value }));
      const blocked = problems.length > 0;
      const dockPeak = peak(busyDockSteps(plan, doors));
      const peoplePeak = peak(peopleSteps(plan));
      // The fixed costs open into how they add up: hours × price, from the plan alone.
      const hours = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;
      const dockHours = plan.blocks.reduce((a, b) => a + (b.docks * (b.end - b.start)) / 60, 0);
      const personHours = plan.blocks.reduce((a, b) => a + (b.docks * b.people * (b.end - b.start)) / 60, 0);
      const wage = PRICES.personPerHour * level.wageFactor;
      const line = (label: string, how: string, value: string) => h('div', { class: 'shp-costs-row shp-num' }, h('span', { text: label }), h('span', { class: 'shp-costs-how', text: how }), h('b', { text: value }));
      const breakdown = costsOpen
        ? h('div', { class: 'shp-costs', id: 'shp-costs' },
            line('Docks', `${hours(dockHours)} × ${money(PRICES.dockPerHour)}`, money(costs.docks)),
            line('People', `${hours(personHours)} × ${money(wage)}`, money(costs.people)),
            hasRobots ? line('Robots', `${plan.robots} × ${money(PRICES.robotPerShiftHour * (level.shiftMinutes / 60))} a shift`, money(costs.robots)) : null,
            line('Buffer', `${CURRENCY} ${PRICES.bufferPerParcel.toFixed(2)} a parcel`, 'after the shift'),
            h('div', { class: 'shp-costs-row shp-costs-sum shp-num' }, h('span', { text: 'Fixed costs' }), h('span'), h('b', { text: money(costs.total) })))
        : null;
      const total = h('button', { class: 'shp-cell-money shp-costs-toggle', type: 'button', 'data-key': 'costs', 'aria-expanded': String(costsOpen), 'aria-controls': 'shp-costs',
        onclick: () => {
          costsOpen = !costsOpen;
          drawBar();
          bar.querySelector<HTMLElement>('[data-key="costs"]')?.focus({ preventScroll: true });
        } },
        h('span', { text: `Fixed costs ${costsOpen ? '▾' : '▸'}` }), h('b', { class: 'shp-num', text: money(costs.total) }));
      bar.replaceChildren(
        ...(breakdown ? [breakdown] : []),
        h('div', { class: 'shp-money' },
          cell('Docks', `${dockPeak} of ${level.docks}`, `shp-narrow shp-count${dockPeak > level.docks ? ' is-bad' : ''}`),
          cell('People', level.peopleCap !== undefined ? `${peoplePeak} of ${level.peopleCap}` : String(peoplePeak), `shp-narrow shp-count${level.peopleCap !== undefined && peoplePeak > level.peopleCap ? ' is-bad' : ''}`),
          cell('Docks', money(costs.docks), 'shp-wide'),
          cell('People', money(costs.people), 'shp-wide'),
          hasRobots ? cell('Robots', money(costs.robots), 'shp-wide') : null,
          cell('Buffer', 'after the shift', 'shp-wide'),
          total,
          cell('Most you can earn', money(mostToEarn(level)), 'shp-wide'),
          cell('Result', 'after the shift', 'shp-wide')),
        h('div', { class: 'shp-go' },
          blocked ? h('button', { class: 'shp-blocked', type: 'button', 'data-key': 'blocked', text: plural(problems.length, 'problem', 'problems'), title: problems.map((p) => problemText(p)).join('\n'),
            onclick: () => {
              const b = problemBlock(problems[0]!);
              if (b !== null) select({ city: plan.blocks[b]!.city, block: b }, true);
            } }) : null,
          h('button', { class: 'shp-btn shp-start', type: 'button', 'data-key': 'start', disabled: blocked, 'aria-describedby': blocked ? 'shp-why' : null, text: 'Start shift', onclick: start }),
          blocked ? h('span', { id: 'shp-why', class: 'shp-hidden', text: `Solve ${plural(problems.length, 'problem', 'problems')} first: ${problems.map((p) => problemText(p)).join(' ')}` }) : null),
      );
    }

    function start(): void {
      if (checkPlan(level, plan).length) return;
      if (unservedCities(level, plan).length) {
        asking = true;
        render();
        ask.querySelector<HTMLElement>('[data-key="ask-back"]')?.focus();
      } else o.onStart(clonePlan(plan));
    }

    function drawAsk(): void {
      const missing = unservedCities(level, plan);
      if (!asking || !missing.length) {
        asking = false;
        ask.hidden = true;
        ask.replaceChildren();
        return;
      }
      const names = missing.map(name);
      const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      const parcels = missing.reduce((s, c) => s + level.cities[c]!.volume, 0);
      const close = () => {
        asking = false;
        render();
        bar.querySelector<HTMLElement>('[data-key="start"]')?.focus();
      };
      ask.hidden = false;
      ask.replaceChildren(
        h('div', { class: 'shp-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'shp-ask-title', 'aria-describedby': 'shp-ask-text',
          onkeydown: (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
          } },
          h('h2', { id: 'shp-ask-title', text: names.length === 1 ? `${list} has no dock and no robots` : `${names.length} cities have no dock and no robots` }),
          h('p', { id: 'shp-ask-text', text: `${list}: ${count(parcels)} parcels will stay behind, at ${CURRENCY} ${PRICES.leftBehind.toFixed(2)} each. Start the shift anyway?` }),
          h('div', { class: 'shp-actions' },
            h('button', { class: 'shp-btn', type: 'button', 'data-key': 'ask-back', text: 'Back to the plan', onclick: close }),
            h('button', { class: 'shp-btn shp-start', type: 'button', 'data-key': 'ask-go', text: 'Start shift', onclick: () => {
              asking = false;
              o.onStart(clonePlan(plan));
            } }))),
      );
    }
  }

  // The time line fills the width it gets: draw again when that changes (also the first time,
  // once the view is on the page).
  let lastWidth = -1;
  if (typeof ResizeObserver !== 'undefined') {
    // Drawing again changes sizes, so it waits for the next frame: redrawing inside the observer's
    // own callback makes the browser report a "ResizeObserver loop" error.
    let pending = 0;
    new ResizeObserver(() => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const w = scroll.clientWidth + root.clientWidth * 10000;
        if (w !== lastWidth) {
          lastWidth = w;
          render();
        }
      });
    }).observe(root);
  }
  render();
  return root;
}
