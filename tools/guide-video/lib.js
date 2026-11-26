const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const APP = 'http://localhost:8765/';
const SIM = fs.readFileSync(path.join(__dirname, 'sim.js'), 'utf8');
async function open(name, { record = true, state, seed } = {}) {
  const b = await chromium.launch();
  const opts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul' };
  if (state) opts.storageState = state;
  const ctx = await b.newContext(opts);
  if (seed) await ctx.addInitScript(sd => { if (!sessionStorage.getItem('__seeded')) { for (const k in sd) localStorage.setItem(k, sd[k]); sessionStorage.setItem('__seeded', '1'); } }, seed);
  await ctx.addInitScript(SIM);
  await ctx.addInitScript(() => { addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('android')); window.alert = () => {}; window.confirm = () => true; });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const t0 = Date.now(), marks = [];
  const frames = [];
  let cdp = null;
  if (record) {
    const dir = path.join(__dirname, 'raw', name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    cdp = await ctx.newCDPSession(p);
    cdp.on('Page.screencastFrame', async f => {
      const fn = path.join(dir, String(frames.length).padStart(6, '0') + '.jpg');
      fs.writeFileSync(fn, Buffer.from(f.data, 'base64'));
      frames.push([fn, (Date.now() - t0) / 1000]);
      try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {}
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
  }
  const S = {
    b, ctx, p, errs, marks,
    mark: (k) => marks.push([k, (Date.now() - t0) / 1000]),
    wait: ms => p.waitForTimeout(ms),
    cap: (t, sub) => p.evaluate(([t, s]) => window.__cap(t, s), [t || '', sub || '']),
    tag: t => p.evaluate(t => window.__tag(t), t || ''),
    async tap(sel, pause = 700) {
      const l = typeof sel === 'string' ? p.locator(sel).first() : sel;
      await l.waitFor({ state: 'visible', timeout: 15000 });
      await l.evaluate(el => { const r = el.getBoundingClientRect(); if (r.top < 60 || r.bottom > innerHeight - 120) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
      await p.waitForTimeout(600);
      const bb = await l.boundingBox();
      await p.evaluate(([x, y]) => window.__ring(x, y), [bb.x + bb.width / 2, bb.y + bb.height / 2]);
      await p.waitForTimeout(450);
      await l.click();
      await p.waitForTimeout(pause);
    },
    async ring(sel) { const l = p.locator(sel).first(); const bb = await l.boundingBox(); await p.evaluate(([x, y]) => window.__ring(x, y), [bb.x + bb.width / 2, bb.y + bb.height / 2]); await p.waitForTimeout(900); },
    async scrollTo(sel, block = 'start') { await p.evaluate(([s, b]) => document.querySelector(s).scrollIntoView({ behavior: 'smooth', block: b }), [sel, block]); await p.waitForTimeout(900); },
    async fill(sel, v, show = true) { const l = p.locator(sel).first(); await l.evaluate(el => { const r = el.getBoundingClientRect(); if (r.top < 60 || r.bottom > innerHeight - 140) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }); await p.waitForTimeout(450); if (show) { const bb = await l.boundingBox(); await p.evaluate(([x, y]) => window.__ring(x, y), [bb.x + bb.width / 2, bb.y + bb.height / 2]); await p.waitForTimeout(350); } await l.fill(String(v)); await l.dispatchEvent('change'); await p.waitForTimeout(250); },
    frames,
    async close() { if (cdp) { try { await cdp.send('Page.stopScreencast'); } catch (e) {} } await ctx.close(); await b.close(); return frames.length ? path.join(__dirname, 'raw', name) : null; }
  };
  await p.goto(APP + 'app.html');
  return S;
}
// quick setup before the part that is kept in the video
async function quickStick(S) {
  await S.p.waitForTimeout(2200);
  await S.p.click('#btnConnect2'); await S.p.click('.__pick .i'); await S.p.click('.__pick .p');
  await S.p.waitForFunction(() => /연결/.test(document.getElementById('homeConn').textContent) && !/안 됨/.test(document.getElementById('homeConn').textContent), null, { timeout: 10000 });
  await S.p.waitForTimeout(800);
}
async function quickDps(S, btn = '#btnPsu') {
  await S.p.click(btn); await S.p.click('.__pick .i'); await S.p.click('.__pick .p');
  await S.p.waitForFunction(() => typeof dps !== 'undefined' && dps.st && dps.st.t, null, { timeout: 10000 });
  await S.p.waitForTimeout(500);
}
module.exports = { open, quickStick, quickDps };
