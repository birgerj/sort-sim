// Plays Ten Shifts levels in a headless browser with the best known plans and reports what a
// player would trip over. Build and serve first: npm run build && npx vite preview --port 5191
//   node scripts/shiftsPlay.mjs <phone|desktop> <first level> <last level> [finish=2,5] [watch=20]
// Levels before the first are seeded as done; every level's planner opens with its best plan
// (tools/balance/best). Levels listed in finish= play to the end at 16×, the others are skipped
// after `watch` seconds. Screenshots go to shots/test/ (not committed).
import { readFileSync } from 'node:fs';
import { open, shot, audit, text, clickText } from './shiftsPlay.lib.mjs';

const [size = 'phone', a = '2', b = a] = process.argv.slice(2);
const opt = Object.fromEntries(process.argv.slice(5).map((s) => s.split('=')));
const first = +a, last = +b;
const finish = (opt.finish || '').split(',').filter(Boolean).map(Number);
const watch = +(opt.watch || 20);
const P = size === 'phone' ? 'p' : 'd';
const best = (n) => JSON.parse(readFileSync(new URL(`../tools/balance/best/level${n}.json`, import.meta.url), 'utf8'));

const seed = { introSeen: true, levels: {} };
for (let n = 1; n <= 10; n++) seed.levels[n] = n < first ? { best: 900, stars: 3, badge: false, attempts: 1, lastPlan: best(n) } : { best: 0, stars: 0, badge: false, attempts: 0, lastPlan: best(n) };

const { browser, page, errors } = await open(size, seed);
const problems = [];
const note = (level, what) => { problems.push(`L${level} ${size}: ${what}`); console.log('  !!', what); };
const look = async (level, name) => {
  await shot(page, `${P}-l${level}-${name}`);
  const r = await audit(page, size === 'phone' ? 40 : 0);
  for (const k of ['small', 'clipped', 'off']) if (r[k]?.length) note(level, `${name} ${k}: ${r[k].join(' ; ')}`);
  if (r.docWider) note(level, `${name}: page wider than the screen`);
  if (r.otherCurrency) note(level, `${name}: other currency sign ${r.otherCurrency}`);
  return r;
};
const hud = () => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const box = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
  const m = q('.shp-hud-meter');
  return { clock: q('.shp-hud-clock')?.textContent, now: +m?.getAttribute('aria-valuenow'), max: +m?.getAttribute('aria-valuemax'), cards: [...document.querySelectorAll('.shp-hud-card')].map((c) => c.textContent).join('|'), gone: q('.shp-hud-gone')?.children.length ?? -1, goneText: q('.shp-hud-gone')?.textContent.slice(0, 200), top: box('.shp-hud-top'), goneBox: box('.shp-hud-gone'), side: box('.shp-hud-side'), bottom: box('.shp-hud-bottom'), autoHidden: q('.shp-hud-auto')?.hidden, pressed: [...document.querySelectorAll('.shp-hud-speed [aria-pressed=true]')].map((x) => x.textContent).join(','), money: q('.shp-hud-money')?.textContent, vh: innerHeight, vw: innerWidth };
});
const fps = (ms) => page.evaluate((ms) => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(+(n * 1000 / (performance.now() - t0)).toFixed(2)); }; requestAnimationFrame(f); }), ms);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('sortsim.shifts') || '{}'));

try {
  await page.waitForTimeout(800);
  if (/Skip intro/.test(await text(page))) await clickText(page, 'Skip intro');
  await page.waitForTimeout(500);
  await look(first, '00-levels');
  await page.locator('.sh-tiles > *').nth(first - 1).click();
  for (let n = first; n <= last; n++) {
    console.log(`\n=== level ${n} (${size})`);
    await page.waitForTimeout(600);
    const br = await look(n, '03-briefing');
    if (!br.hasSection) note(n, 'briefing: no § sign');
    await clickText(page, 'Plan the shift');
    await page.waitForTimeout(900);
    await look(n, '04-planner');
    const pt = await text(page);
    console.log('  planner text:', pt.replace(/\n+/g, ' | ').slice(0, 600));
    const verdict = pt.match(/buffer (level|peak|full)|will be late|on time|left behind|too late|fits|profit/gi);
    if (verdict) note(n, 'planner words that may give the result away: ' + [...new Set(verdict)].join(', '));
    // The robot switch: flip the first one and back, and see that the fixed costs or state change.
    if (await page.locator('.shp-fleet').filter({ visible: true }).count()) {
      const state = () => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('sortsim.shifts')).levels) + document.querySelector('[data-key=costs]')?.textContent + document.querySelector('[data-key=robots]')?.getAttribute('aria-checked'));
      try {
        await page.locator('[data-key^=label-]').first().click({ timeout: 10000 });
        await page.waitForTimeout(300);
        await look(n, '05-inspector');
        const s0 = await state();
        await page.locator('[data-key=robots]').click({ timeout: 10000 });
        await page.waitForTimeout(300);
        const s1 = await state();
        await shot(page, `${P}-l${n}-05-robot-switch`);
        if (s1 === s0) note(n, 'robot switch: nothing changed after a tap'); else console.log('  robot switch changes plan, costs or state');
        await page.locator('[data-key=robots]').click({ timeout: 10000 });
        await page.waitForTimeout(300);
        if ((await state()) !== s0) note(n, 'robot switch: off and on again does not give the same plan back');
      } catch (e) { note(n, 'robot switch could not be tapped: ' + e.message.split('\n')[0]); }
    } else console.log('  no robots in this level');
    const planBefore = JSON.stringify((await stored()).levels?.[n]?.lastPlan);
    if (planBefore !== JSON.stringify(best(n))) console.log('  (plan differs from the best plan after the switch test; restoring is up to the run)');
    await page.locator('[data-key=start]').click();
    const tStart = Date.now();
    await page.waitForTimeout(700);
    if (await page.locator('.shp-ask:not([hidden])').count()) { console.log('  asked:', (await page.locator('.shp-ask').innerText()).replace(/\n+/g, ' | ')); await shot(page, `${P}-l${n}-06-ask`); await page.locator('.shp-ask button').last().click(); }
    if (await page.locator('.shp-problems').filter({ visible: true }).count()) { note(n, 'plan refused: ' + (await page.locator('.shp-problems').innerText()).replace(/\n+/g, ' | ')); await look(n, '06-refused'); break; }
    await page.waitForFunction(() => !!document.querySelector('.shp-hud'), null, { polling: 500, timeout: 60000 });
    await page.waitForTimeout(2500);
    const h0 = await hud();
    await look(n, '07-shift-start');
    console.log('  hud at start', JSON.stringify(h0));
    if (!h0.pressed) note(n, 'shift: no speed button shown as chosen at the start');
    await clickText(page, '16×');
    await page.waitForTimeout(6000);
    const h1 = await hud();
    if (!(h1.now > h0.now)) note(n, `shift: clock did not run (${h0.clock} → ${h1.clock})`);
    if (h1.cards === h0.cards) note(n, 'shift: city cards did not change in 6 s at 16×');
    if (h1.bottom && h1.bottom[3] > h1.vh + 1) note(n, 'shift: bottom bar runs off the screen');
    if (h1.side && h1.bottom && h1.side[3] > h1.bottom[1] + 1 && h1.side[0] < h1.bottom[2] && h1.side[2] > h1.bottom[0]) note(n, `shift: city cards overlap the bottom bar (${h1.side} / ${h1.bottom})`);
    if (h1.side && h1.top && h1.side[1] < h1.top[3] - 1 && h1.side[0] < h1.top[2]) note(n, `shift: city cards overlap the top bar (${h1.side} / ${h1.top})`);
    // Tap a city card, then the Auto button.
    try { await page.locator('.shp-hud-card').first().click({ timeout: 40000 }); await page.waitForTimeout(1500); const h = await hud(); await shot(page, `${P}-l${n}-08-city-tapped`); if (h.autoHidden !== false) note(n, 'shift: no Auto button after tapping a city card'); else { await page.locator('.shp-hud-auto').click({ timeout: 40000 }); await page.waitForTimeout(800); console.log('  city card and Auto tapped; Auto hidden again:', (await hud()).autoHidden); } } catch (e) { note(n, 'shift: city card or Auto could not be tapped: ' + e.message.split('\n')[0]); }
    const rate = n === 10 || n === first ? await fps(8000) : null;
    if (rate !== null) console.log(`  frames per second at 16×: ${rate}`);
    // Watch, then finish or skip.
    let endSeen = 0, sawGone = 0, lastShot = 0;
    const until = Date.now() + (finish.includes(n) ? 420000 : watch * 1000);
    while (Date.now() < until) {
      await page.waitForTimeout(300);
      if (!(await page.locator('.shp-hud').count())) break;
      const h = await hud();
      if (h.gone > sawGone) { sawGone = h.gone; if (Date.now() - lastShot > 8000) { lastShot = Date.now(); await shot(page, `${P}-l${n}-09-trucks-gone`); console.log('  departed badges:', h.gone, JSON.stringify(h.goneText), 'box', h.goneBox, 'clock', h.clock); if (h.goneBox && h.top && h.goneBox[1] > h.vh / 2) note(n, 'shift: departed-truck badges are not at the top'); } }
      if (!endSeen && h.now >= h.max) { endSeen = Date.now(); console.log('  clock at the end after', ((endSeen - tStart) / 1000).toFixed(0), 's'); }
      if (/Level score/.test(await text(page))) break;
    }
    const mid = await hud().catch(() => null);
    if (mid?.clock) console.log('  hud before the end', mid.clock, 'gone', mid.gone, mid.money);
    let tSkip = 0;
    if (!/Level score/.test(await text(page))) { await look(n, '10-shift-late'); await page.evaluate(() => { const t = (window.__skip = {}); document.querySelector('.shp-hud-skip').addEventListener('click', () => { t.click = performance.now(); requestAnimationFrame(() => { t.frame = performance.now(); }); }, true); new MutationObserver(() => { if (!t.result && t.click && /Level score/.test(document.querySelector('.sh-root').textContent)) t.result = performance.now(); }).observe(document.querySelector('.sh-root'), { childList: true, subtree: true }); }); tSkip = Date.now(); await page.locator('.shp-hud-skip').click({ timeout: 60000 }); }
    await page.waitForFunction(() => /Level score/.test(document.querySelector('.sh-root')?.innerText || ''), null, { polling: 250, timeout: 90000 });
    const tRes = Date.now();
    if (endSeen) { const d = (tRes - endSeen) / 1000; console.log('  result', d.toFixed(1), 's after the clock reached the end'); if (d > 8) note(n, `finale: result came ${d.toFixed(1)} s after the end of the shift`); }
    if (tSkip) { const t = await page.evaluate(() => window.__skip); const d = (t.result - t.click) / 1000; console.log('  result in the page', d.toFixed(2), 's after the tap on Skip (next frame after', ((t.frame - t.click) / 1000).toFixed(2), 's; the script waited', ((tRes - tSkip) / 1000).toFixed(1), 's in all)'); if (d > 3) note(n, `skip: result came ${d.toFixed(1)} s after the tap`); if (!sawGone) console.log('  (no truck had left before Skip)'); }
    await page.waitForTimeout(700);
    const rr = await look(n, '11-result');
    const rt = await text(page);
    console.log('  result:', rt.replace(/\n+/g, ' | ').slice(0, 700));
    if (!rr.hasSection) note(n, 'result: no § sign');
    if (!/★/.test(rt)) note(n, 'result: no stars');
    for (const w of ['Parcels shipped', 'Docks', 'People', 'Profit']) if (!rt.includes(w)) note(n, `result: no line "${w}"`);
    await page.evaluate(() => document.querySelectorAll('.sh-root *').forEach((e) => { if (e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = 99999; }));
    await page.waitForTimeout(300);
    await look(n, '12-result-bottom');
    const st = (await stored()).levels?.[n];
    console.log('  stored: best', st?.best, 'stars', st?.stars, 'badge', st?.badge);
    if (!(st?.stars >= 1)) note(n, 'no star stored: the next level stays locked');
    if (!(st?.best >= 900 && st?.best <= 1010)) note(n, `best plan scored ${st?.best} in the game`);
    const next = n < 10 ? 'Next level' : /End score|Finish|total/i;
    const btns = rr.buttons.join(' / ');
    console.log('  buttons:', btns);
    if (n === last && n < 10) { await clickText(page, 'All levels'); await page.waitForTimeout(600); await look(n, '13-levels-after'); const locked = await page.evaluate((i) => document.querySelectorAll('.sh-tiles > *')[i]?.textContent, n); console.log('  next tile:', locked); if (/Locked/.test(locked || '')) note(n, 'next level still locked on the levels screen'); break; }
    if (n === 10) { await page.locator('.sh-actions button, .sh-sticky button').last().click(); await page.waitForTimeout(1200); const er = await look(n, '14-end'); const et = await text(page); console.log('  end screen:', et.replace(/\n+/g, ' | ').slice(0, 900)); const all = await stored(); const sum = Object.values(all.levels).reduce((s, l) => s + (l.best || 0), 0); console.log('  sum of best scores in storage:', sum); if (!et.replace(/[,. ]/g, '').includes(String(sum))) note(n, `end screen does not show the total ${sum}`); await page.evaluate(() => document.querySelectorAll('.sh-root *').forEach((e) => { if (e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = 99999; })); await look(n, '15-end-bottom'); break; }
    await clickText(page, 'Next level');
  }
} catch (e) {
  console.log('STOPPED:', e.message.split('\n').slice(0, 14).join(' / '));
  await shot(page, `${P}-fail-${Date.now() % 100000}`);
  console.log((await text(page).catch(() => '')).slice(0, 500).replace(/\n+/g, ' | '));
}
await browser.close();
console.log('\nPage and console errors:', errors.length ? errors : 'none');
console.log('Problems:\n' + (problems.length ? problems.map((p) => ' - ' + p).join('\n') : ' none'));
