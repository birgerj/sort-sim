// Helpers for playing Ten Shifts in a headless browser (see scripts/shiftsPlay.mjs).
// The browser package and the browser itself come from the machine: PW_CORE and CHROME say where.
const PW = process.env.PW_CORE || '/tmp/c2pw/node_modules/playwright-core/index.mjs';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
export const URL0 = process.env.SHIFTS_URL || 'http://localhost:5191/?start=game&mute=1';
export const SHOTS = new URL('../shots/test/', import.meta.url).pathname;
export const SIZES = { phone: { width: 390, height: 780 }, desktop: { width: 1440, height: 900 } };

export async function open(size, seed) {
  const { chromium } = await import(PW);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: 1, hasTouch: size === 'phone', isMobile: size === 'phone' });
  if (seed) await ctx.addInitScript((s) => { if (!localStorage.getItem('sortsim.shifts')) localStorage.setItem('sortsim.shifts', s); }, JSON.stringify(seed));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(URL0, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('.sh-root', { timeout: 120000 });
  return { browser, page, errors, size };
}

export const shot = (page, name) => page.screenshot({ path: SHOTS + name + '.png' }).catch((e) => console.log('shot failed', name, e.message));

/** What a player would trip over on the screen as it is now: small buttons, clipped text, things off screen. */
export function audit(page, minButton) {
  return page.evaluate((minButton) => {
    const root = document.querySelector('.sh-root');
    if (!root) return { note: 'no .sh-root' };
    const vw = innerWidth, vh = innerHeight;
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
    const label = (el) => (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName) + ' "' + (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40) + '"';
    const small = [], clipped = [], off = [];
    for (const el of root.querySelectorAll('button, [role=button], a, input, select')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (minButton && (r.height < minButton || r.width < minButton)) small.push(label(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    for (const el of root.querySelectorAll('*')) {
      if (!vis(el)) continue;
      const s = getComputedStyle(el);
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (own && (el.scrollWidth > el.clientWidth + 1) && s.overflowX !== 'visible' && s.overflowX !== 'auto' && s.overflowX !== 'scroll') clipped.push(label(el) + ' ' + el.scrollWidth + '>' + el.clientWidth);
      if (own) { const r = el.getBoundingClientRect(); if (r.right > vw + 1 || r.left < -1) { let p = el.parentElement, scroll = false; while (p && p !== root.parentElement) { const ps = getComputedStyle(p); if (/auto|scroll/.test(ps.overflowX) && p.scrollWidth > p.clientWidth) scroll = true; p = p.parentElement; } if (!scroll) off.push(label(el) + ' x ' + Math.round(r.left) + '…' + Math.round(r.right)); } }
    }
    const text = root.innerText;
    return { small: [...new Set(small)], clipped: [...new Set(clipped)].slice(0, 15), off: [...new Set(off)].slice(0, 15), docWider: document.documentElement.scrollWidth > vw, hasSection: text.includes('§'), otherCurrency: (text.match(/[€$£]/g) || []).join(''), buttons: [...root.querySelectorAll('button')].filter(vis).map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30)), vh };
  }, minButton);
}

export const text = (page) => page.evaluate(() => document.querySelector('.sh-root')?.innerText ?? '');
export const clickText = (page, t, opts = {}) => page.locator('.sh-root button', { hasText: t }).filter({ visible: true }).first().click({ timeout: 60000, ...opts });
