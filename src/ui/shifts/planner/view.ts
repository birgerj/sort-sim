// Ten Shifts: the planner. One row per city on a time line for the whole shift; blocks are made,
// selected and edited with buttons (and dragged with a mouse). Everything shown comes from the
// briefing's numbers and the plan: fixed costs, how full a block is, docks and people in use and
// a rough buffer guess. No profit, no real buffer figures, no word on trucks being on time: those
// come with the result. This file never touches the score service.
import { CURRENCY, PRICES, RATES, type Level, type Plan, type PlanProblem } from '../../../shifts/contract';
import { arrivedBy, dockRate, firstParcel, nominalFlow, robotLines, roughBuffer } from '../../../shifts/estimate';
import { cityColour, cityName, clock, count, h, mark, money, plural } from './dom';
import { addBlock, canStep, moveBlock, removeBlock, setDocks, setEnd, setPeople, setRobotCity, setRobots, setStart, stepEnd, stepStart } from './edit';
import { assignDoors, blockCost, busyDockSteps, checkPlan, fixedCosts, goalStanding, mostToEarn, peak, peopleSteps, unservedCities, type Step } from './rules';

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
const BUFFER_WORDS = ['empty', 'some', 'a lot'] as const;

export function plannerView(o: PlannerOptions): HTMLElement {
  const { level, cityNames } = o;
  const name = (c: number) => cityName(cityNames, c);
  const span = level.shiftMinutes + RATES.maxLateMinutes; // blocks may run half an hour past the last truck
  const hasRobots = level.robotsMax > 0;
  // Rows in the order the trucks leave: the night reads from top to bottom.
  const order = level.cities.map((_, i) => i).sort((a, b) => level.cities[a]!.truck - level.cities[b]!.truck || a - b);

  let plan = clonePlan(o.plan);
  let sel: Selection | null = null;
  let asking = false; // the "start without these cities?" question is open
  let pph = 64; // pixels per hour on the time line
  let quietClick = false; // a drag just ended: the click that follows is not a tap on the row

  // Many cities: lower rows, so more of the night is in view at once.
  const dense = level.cities.length > 8;
  const root = h('div', { class: `shp-planner${dense ? ' shp-dense' : ''}` });
  const side = h('aside', { class: 'shp-side', 'aria-label': 'Orders' });
  const scroll = h('div', { class: 'shp-scroll', tabindex: '0', role: 'group', 'aria-label': 'Time line of the shift' });
  const grid = h('div', { class: 'shp-grid' });
  scroll.append(grid);
  const fleet = h('div', { class: 'shp-fleet' });
  const legend = h('div', { class: 'shp-legend' });
  const board = h('section', { class: 'shp-board', 'aria-label': 'Plan' }, scroll, fleet, legend);
  const insp = h('aside', { class: 'shp-insp', 'aria-label': 'Selected block' });
  const bar = h('footer', { class: 'shp-bar' });
  const ask = h('div', { class: 'shp-ask', hidden: true });
  root.append(
    h('header', { class: 'shp-head' },
      h('div', { class: 'shp-title' }, mark(),
        h('div', {}, h('h1', {}, h('span', { class: 'shp-wide', text: 'Level ' }), `${level.id} · ${level.name}`), h('p', {}, 'Planning · ', h('span', { class: 'shp-wide', text: 'take your time, no clock is running' }), h('span', { class: 'shp-narrow', text: 'no clock running' })))),
      h('button', { class: 'shp-btn', type: 'button', text: 'Briefing', onclick: () => o.onBack() })),
    h('div', { class: 'shp-main' }, side, board, insp),
    bar,
    ask,
  );

  const isPhone = () => root.clientWidth > 0 && root.clientWidth <= 760;
  const labelWidth = () => (isPhone() ? 76 : 104);

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
  }

  /** A tap on a city: an unplanned one gets its starter block, a planned one is selected. */
  function tapCity(city: number): void {
    const first = plan.blocks.findIndex((b) => b.city === city);
    if (first < 0 && !plan.robotCities.includes(city)) {
      const made = addBlock(level, plan, city);
      commit(made.plan, { city, block: made.index });
      grid.querySelector(`[data-key="block-${made.index}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else select({ city, block: sel?.city === city && sel.block !== null ? sel.block : first >= 0 ? first : null }, true);
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
      case 'grid': return cap(`${of(p.block)}start and end go on a half hour, the first parcel or the truck time.`);
      case 'tooShort': return cap(`${of(p.block)}a block lasts at least an hour.`);
      case 'afterTruck': return cap(`${of(p.block)}ends more than 30 minutes after the truck time (${clock(level.cities[plan.blocks[p.block]!.city]!.truck)}).`);
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
    pph = Math.max(phone ? 58 : 60, Math.floor((room / (span / 60)) * 100) / 100);
    const x = (t: number) => (t / 60) * pph;
    const trackW = Math.ceil(x(span));
    root.classList.toggle('shp-has-sel', !!sel);

    drawSide(problems, flow.left);
    drawGrid();
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
      const orders = h('div', { class: 'shp-orders' });
      for (const c of order) {
        const city = level.cities[c]!;
        const short = (left[c] ?? 0) >= 0.5 && cityState(c) !== 'not planned';
        orders.append(
          h('button', { class: `shp-order${sel?.city === c ? ' is-sel' : ''}`, type: 'button', style: `--c:${cityColour(c)}`, 'data-key': `order-${c}`, 'aria-pressed': String(sel?.city === c), onclick: () => tapCity(c) },
            h('span', { class: 'shp-order-top' }, h('b', { text: name(c) }), h('span', { class: 'shp-num', text: count(city.volume) })),
            h('span', { class: `shp-order-sub${short ? ' is-warn' : ''}` }, h('span', { class: 'shp-wide', text: `truck ${clock(city.truck)} · ${cityState(c)}` }), h('span', { class: 'shp-narrow', text: `${count(city.volume)} · ${clock(city.truck)}` }))),
        );
      }
      const goal = plan.blocks.length || plan.robotCities.length ? goalStanding(level, plan) : null;
      const parts = [
        h('div', { class: 'shp-cap', text: 'ORDERS · TAP TO PLAN' }),
        orders,
        list.length
          ? h('div', { class: 'shp-problems', role: 'status' },
              h('div', { class: 'shp-problems-head', text: `${plural(list.length, 'problem', 'problems')} to solve before the shift can start` }),
              ...list.map((p, i) => {
                const b = problemBlock(p);
                return h('button', { class: 'shp-problem', type: 'button', 'data-key': `problem-${i}`, text: problemText(p), onclick: () => (b !== null ? select({ city: plan.blocks[b]!.city, block: b }, true) : fleet.querySelector<HTMLElement>('input')?.focus()) });
              }))
          : null,
        h('div', { class: `shp-goal${goal ? (goal.ok ? ' is-ok' : ' is-off') : ''}` }, h('b', { text: 'Extra goal: ' }), `${level.badge.text}.`, goal ? ` ${goal.text}` : ''),
        h('div', { class: 'shp-tip' }, h('b', { text: 'Tip. ' }), 'Tap an order for a starter block from its first parcel to its truck. Then change it with the buttons, or drag its ends: steps of half an hour.'),
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
      rows.push(h('div', { class: 'shp-row shp-hours-row' }, h('div', { class: 'shp-label', style: `width:${labelW}px` }), hours));

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
        const blockH = dense ? 34 : phone ? 38 : 46;
        const onRobots = hasRobots && plan.robotCities.includes(c);
        const height = Math.max(1, laneEnd.length) * (blockH + 4) + 6 + (onRobots ? 12 : 0);
        const first = firstParcel(city);
        const lastIn = Math.max(...city.arrivals.map((a) => a.to));
        const track = h('div', { class: `shp-track shp-city${sel?.city === c ? ' is-sel' : ''}`, style: `width:${trackW}px;height:${height}px;--c:${cityColour(c)}`,
          onclick: (e: Event) => {
            if (quietClick || e.target !== track) return;
            tapCity(c);
          } },
          h('div', { class: 'shp-after', style: `left:${x(level.shiftMinutes)}px` }),
          h('div', { class: 'shp-inflow', style: `left:${x(first)}px;width:${x(lastIn) - x(first)}px`, title: `Parcels come in ${clock(first)}–${clock(lastIn)}` }),
          h('div', { class: 'shp-truck', style: `left:${x(city.truck)}px`, title: `Truck ${clock(city.truck)}` }),
        );
        if (!mine.length && !onRobots) track.append(h('span', { class: 'shp-hint', style: `left:${x(first) + 10}px`, text: 'Tap to plan' }));
        if (onRobots) {
          track.append(h('div', { class: 'shp-robots-band', style: `left:${x(first)}px;width:${x(city.truck) - x(first)}px;top:${height - 13}px`, title: `Robot lines ${clock(first)}–${clock(city.truck)}` }, h('span', { text: 'robots' })));
        }
        const notes: string[] = [];
        for (const { b, i } of mine) {
          const f = flow.blocks[i]!;
          const reach = f.loaded + f.waitingAtEnd;
          const fill = f.capacity > 0 ? reach / f.capacity : 0;
          const w = Math.max(18, x(b.end) - x(b.start));
          const people = b.people === 1 ? '1 person' : '2 people';
          const docks = plural(b.docks, 'dock', 'docks');
          const label = w >= 236 ? `${blockRange(i)} · ${docks} · ${people}` : w >= 122 ? `${docks} · ${people}` : b.docks === 1 && w >= 62 ? people : `${b.docks}×${b.people}`;
          const bad = badBlocks.get(i);
          if (bad) notes.push(...bad.map((t) => (mine.length > 1 ? `${blockRange(i)}: ${t}` : t)));
          track.append(
            h('button', { class: `shp-block${sel?.block === i ? ' is-sel' : ''}${bad ? ' is-bad' : ''}`, type: 'button', 'data-key': `block-${i}`,
              style: `left:${x(b.start)}px;width:${w}px;top:${3 + lane.get(i)! * (blockH + 4)}px;height:${blockH}px`,
              'aria-pressed': String(sel?.block === i),
              'aria-label': `${name(c)}, ${blockRange(i)}, ${docks}, ${people} per dock, ${Math.round(Math.min(fill, 9.99) * 100)}% full${bad ? `. Problem: ${bad.join(' ')}` : ''}`,
              onpointerdown: (e: PointerEvent) => startDrag(e, i),
              onclick: () => select({ city: c, block: i }) },
              h('span', { class: 'shp-block-text', text: label }),
              h('span', { class: `shp-fill${fill > 1.005 ? ' is-over' : ''}` }, h('span', { style: `width:${Math.min(100, Math.round(fill * 100))}%` }))),
          );
        }
        const isBad = mine.some((e) => badBlocks.has(e.i));
        rows.push(
          h('div', { class: 'shp-row', 'data-key': `row-${c}` },
            h('button', { class: `shp-label shp-city-label${sel?.city === c ? ' is-sel' : ''}`, type: 'button', style: `width:${labelW}px;--c:${cityColour(c)}`, 'data-key': `label-${c}`, onclick: () => tapCity(c), title: `${name(c)} · ${count(city.volume)} parcels · truck ${clock(city.truck)}` },
              h('b', { text: name(c) }), h('span', { text: phone ? clock(city.truck) : `truck ${clock(city.truck)}` })),
            h('div', { class: 'shp-cell' }, track, notes.length ? h('div', { class: `shp-note${isBad ? ' is-bad' : ''}`, style: `width:${trackW}px`, text: notes.join(' ') }) : null)),
        );
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

      const guess = roughBuffer(level, plan);
      const buf = h('div', { class: 'shp-track shp-buffer', style: `width:${trackW}px`, role: 'img', 'aria-label': `Buffer, rough guess per hour: ${guess.map((g, k) => `${clock(k * 60)} ${BUFFER_WORDS[g]}`).join(', ')}` });
      guess.forEach((g, k) => {
        const from = k * 60;
        const to = Math.min(level.shiftMinutes, from + 60);
        buf.append(h('div', { class: `shp-buf shp-buf-${g}`, style: `left:${x(from) + 1}px;width:${x(to) - x(from) - 3}px`, title: `${clock(from)}–${clock(to)}: ${BUFFER_WORDS[g]}` }));
      });
      strips.append(strip('Buffer', 'rough guess', buf));
      rows.push(strips);
      grid.style.width = `${labelW + trackW + 6}px`;
      grid.replaceChildren(...rows);
      // The hours, the city names and the strips stay in place over the rows: keep a block that is
      // scrolled into view clear of them.
      scroll.style.scrollPadding = `26px 8px ${strips.offsetHeight + 6}px ${labelW + 6}px`;

      legend.replaceChildren(
        h('span', {}, h('i', { class: 'shp-key-fill' }), 'how full a block is: the work that can reach it against what its crew can load'),
        h('span', {}, h('i', { class: 'shp-key-buf shp-buf-0' }), h('i', { class: 'shp-key-buf shp-buf-1' }), h('i', { class: 'shp-key-buf shp-buf-2' }), 'buffer: empty, some or a lot per hour; the real figures come with the result'),
        level.docks <= 6 ? h('span', {}, h('i', { class: 'shp-key-switch' }), 'a dock switching city, 15 min') : h('span', { text: '3×2 on a short block: 3 docks with 2 people each' }),
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
        insp.replaceChildren(h('div', { class: 'shp-cap', text: 'NOTHING SELECTED' }), h('p', { class: 'shp-muted', text: 'Tap an order or a block to plan it. A city can have several blocks, and robots as well.' }));
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
          h('div', {}, h('div', { class: 'shp-cap', text: b ? (own.length > 1 ? `SELECTED BLOCK · ${own.findIndex((e) => e.k === i) + 1} OF ${own.length}` : 'SELECTED BLOCK') : 'SELECTED CITY' }), h('h2', { style: `--c:${cityColour(c)}`, text: name(c) })),
          cost ? h('b', { class: 'shp-num shp-insp-cost', text: money(cost.docks + cost.people) }) : null,
          h('button', { class: 'shp-btn shp-close', type: 'button', 'data-key': 'close', 'aria-label': 'Close', text: 'Close', onclick: () => select(null) })),
        h('div', { class: 'shp-muted shp-num shp-insp-city', text: `${count(city.volume)} parcels · first ${clock(firstParcel(city))} · truck ${clock(city.truck)}` }),
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
            ...stepper('Docks', String(b.docks), 'docks', b.docks > 1 ? () => go(setDocks(level, plan, i, b.docks - 1)) : null, b.docks < level.docks ? () => go(setDocks(level, plan, i, b.docks + 1)) : null, 'One dock fewer', 'One dock more'),
          ),
        );
        const bad = badBlocks.get(i);
        if (bad) parts.push(h('div', { class: 'shp-alert', role: 'alert', text: bad.join(' ') }));
        const reach = f.loaded + f.waitingAtEnd;
        parts.push(
          h('div', { class: 'shp-facts shp-num shp-wide' },
            h('div', {}, h('b', { text: 'Work: ' }), `about ${count(reach)} parcels can reach this block (${count(arrivedBy(city, b.end))} are in by ${clock(b.end)}).`),
            h('div', {}, h('b', { text: 'Crew: ' }), `${dockRate(b.people)} an hour${b.docks > 1 ? ` on each of ${b.docks} docks` : ''}, ${count(f.capacity)} in this block.`),
            h('div', {}, h('b', { text: 'Cost: ' }), `${money(cost!.docks + cost!.people)} (dock ${count(cost!.docks)} · people ${count(cost!.people)}).`)),
          h('div', { class: 'shp-facts shp-num shp-narrow' }, `Work about ${count(reach)} · crew can load ${count(f.capacity)}`),
        );
      } else if (!own.length) {
        parts.push(h('p', { class: 'shp-muted', text: hasRobots && plan.robotCities.includes(c) ? 'This city goes to the robots only. Add a block to give it a dock as well.' : 'No block yet.' }));
      } else {
        parts.push(h('p', { class: 'shp-muted', text: `${plural(own.length, 'block', 'blocks')}. Tap one on the time line to change it.` }));
      }
      const foot = h('div', { class: 'shp-insp-foot' });
      parts.push(foot);
      if (hasRobots) {
        const on = plan.robotCities.includes(c);
        const lines = robotLines(city);
        foot.append(
          h('button', { class: 'shp-switch-btn', type: 'button', role: 'switch', 'aria-checked': String(on), 'data-key': 'robots', onclick: () => commit(setRobotCity(level, plan, c, !on)) },
            h('span', { class: 'shp-switch-knob', 'aria-hidden': 'true' }),
            h('span', {}, h('b', { class: 'shp-wide', text: 'Robots for this city' }), h('b', { class: 'shp-narrow', text: 'Robots' }), h('small', { text: on ? `${plural(lines, 'line', 'lines')}, open ${clock(firstParcel(city))}–${clock(city.truck)}, up to ${lines * 60} an hour` : 'Off. A city can have docks and robots.' }))),
        );
      }
      foot.append(
        h('div', { class: 'shp-actions' },
          h('button', { class: 'shp-btn', type: 'button', 'data-key': 'add', text: own.length ? 'Add block' : 'Add a block', onclick: () => {
            const made = addBlock(level, plan, c);
            commit(made.plan, { city: c, block: made.index });
          } }),
          b && i !== null ? h('button', { class: 'shp-btn', type: 'button', 'data-key': 'remove', text: phone ? 'Remove' : 'Remove block', onclick: () => {
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
      bar.replaceChildren(
        h('div', { class: 'shp-money' },
          cell('Docks', money(costs.docks), 'shp-wide'),
          cell('People', money(costs.people), 'shp-wide'),
          hasRobots ? cell('Robots', money(costs.robots), 'shp-wide') : null,
          cell('Buffer', 'after the shift', 'shp-wide'),
          cell(phone && !problems.length ? 'Fixed costs, buffer comes later' : 'Fixed costs', money(costs.total)),
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
    new ResizeObserver(() => {
      const w = scroll.clientWidth + root.clientWidth * 10000;
      if (w !== lastWidth) {
        lastWidth = w;
        render();
      }
    }).observe(root);
  }
  render();
  return root;
}
