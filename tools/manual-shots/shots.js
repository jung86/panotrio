// 설명서 그림(manual/*.jpg) 다시 찍기: 저장소 폴더에서 python3 -m http.server 8765, 그다음 node tools/manual-shots/shots.js
// 가짜 스틱·DPS는 tools/guide-video/sim.js를 씀. 결과는 manual/에 바로 저장.
const path = require('path');
const { open, quickStick, quickDps } = require('../guide-video/lib');
const OUT = path.join(__dirname, '..', '..', 'manual');
const shot = async (p, sel, name) => {
  await p.addStyleTag({ content: '#toast{display:none!important}' });
  const l = typeof sel === 'string' ? p.locator(sel).first() : sel;
  await l.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  await l.screenshot({ path: path.join(OUT, name + '.jpg'), quality: 88, type: 'jpeg' });
  console.log('saved', name);
};
const cardOf = (p, sel) => p.locator(sel).locator('xpath=ancestor-or-self::div[contains(concat(" ",normalize-space(@class)," ")," card ")][1]');
function seed() {
  const now = Date.now(), day = 86400000, ck = [], recs = [];
  const M = [
    { n: '하이퍼대시3 #1', hz: 336, i: 0.70, s: [78, 81, 76, 93, 95, 92, 96] },
    { n: '아토믹튠 #2', hz: 318, i: 0.66, s: [88, 86, 90, 89, 91] },
    { n: '토크튠2 #3', hz: 296, i: 0.82, s: [71, 66, 62, 58] }
  ];
  M.forEach((m, mi) => m.s.forEach((sc, k) => {
    const t = now - (m.s.length - k) * 2 * day - mi * 3600000;
    const tag = mi === 0 ? (k < 3 ? 1 : 2) : (k % 2 ? 2 : 1);
    const hz = m.hz * (1 + (sc - 85) / 900), i = m.i * (1 - (sc - 85) / 600);
    ck.unshift({ t, motor: m.n, tag, dur: 30, dir: 0, v: 2.0, vr: 0, i: +i.toFixed(4), icv: +(2 + (100 - sc) / 8).toFixed(2), hz: +hz.toFixed(2), hcv: +(0.3 + (100 - sc) / 40).toFixed(3), drift: 0.4, rpv: +(hz * 30).toFixed(1), bN: k, unstable: false, uw: '', score: sc, pts: sc < 85 ? [['전류 출렁임 (브러시·정류자)', 100 - sc]] : [] });
    recs.unshift({ t: t + 60000, memo: '⏱ ' + ['일반', '청소 전', '청소 후'][tag] + ' 30초', motor: m.n, mode: 2, big: +hz.toFixed(1), vib: +(hz * 1.001).toFixed(1), mic: +(hz * 0.999).toFixed(1), status: 'MATCH', v: 2.0, i: +i.toFixed(3), cond: sc });
  }));
  ck.sort((a, b) => b.t - a.t); recs.sort((a, b) => b.t - a.t);
  return { 'panocheck-condchk': JSON.stringify(ck), 'panotrio-recs': JSON.stringify(recs), 'panotrio-motors': JSON.stringify(M.map(m => m.n)), 'panotrio-motor': M[0].n };
}
(async () => {
  // 홈 · 설치 · 업데이트 창 · 문제 보내기 창 (스틱 연결 전)
  let S = await open('shots', { record: false });
  let p = S.p; await S.wait(2500);
  await shot(p, '#home', 'home');
  await p.click('#tileFw'); await p.waitForSelector('#fwMenu'); await S.wait(600);
  await shot(p, '#fwMenu > div', 'fw-menu');
  await p.click('#fmClose'); await S.wait(300);
  await p.click('#tileReport'); await p.waitForSelector('#repOv'); await S.wait(400);
  await p.locator('#repOv textarea').first().fill('측정 중에 스틱 연결이 자꾸 끊겨요');
  await shot(p, '#repOv > div', 'report');
  await S.close();

  // 파노측정 · 전원공급기 · 컨디션 · 기록
  S = await open('shots', { record: false, seed: seed() }); p = S.p;
  await quickStick(S);
  await p.click('#tileMeasure'); await S.wait(800);
  await quickDps(S);
  await p.evaluate(() => { const i = document.getElementById('psuV'); i.value = '2'; i.dispatchEvent(new Event('change')); });
  await p.evaluate(() => { SIM.vset = 2.0; setInterval(() => { SIM.run = 0; }, 50); });   // 시간이 지나도 속도가 안 오르게 (그래프 평평)
  await p.locator('#psuOut').click(); await S.wait(64000);   // 60초 그래프가 다 차도록
  await shot(p, '#bigCard', 'm-big');
  await shot(p, cardOf(p, '#segMode'), 'm-mode');
  await shot(p, cardOf(p, '#chart'), 'm-chart');
  await shot(p, '#psuCard', 'm-psu');
  await p.locator('#psuOut').click(); await S.wait(2500);
  await p.locator('#ckDur').selectOption('15');
  await p.locator('#ckTag button[data-t="2"]').click(); await S.wait(9000);
  await shot(p, '#condCard', 'm-cond-run');
  await p.waitForFunction(() => !ck && document.getElementById('ckRes').textContent.trim().length > 0, null, { timeout: 60000 }); await S.wait(1500);
  await shot(p, '#condCard', 'm-cond');
  await shot(p, cardOf(p, '#btnCsv'), 'm-recs');
  await p.evaluate(() => { location.hash = '#home'; }); await S.wait(600);
  await p.click('#tileBook'); await S.wait(1500);
  await p.addStyleTag({ content: '#toast{display:none!important}' }); await p.screenshot({ path: path.join(OUT, 'm-book.jpg'), quality: 88, type: 'jpeg' }); console.log('saved m-book');
  await S.close();

  // 모터클리닝 · 길들이기 · 설정
  S = await open('shots', { record: false }); p = S.p;
  await quickStick(S);
  await p.click('#tileClean'); await S.wait(1200);
  await p.evaluate(() => scrollTo(0, 0)); await p.addStyleTag({ content: '#toast{display:none!important}' }); await S.wait(200);
  await p.screenshot({ path: path.join(OUT, 'clean.jpg'), quality: 88, type: 'jpeg', clip: { x: 0, y: 0, width: 390, height: 765 } }); console.log('saved clean');
  await p.evaluate(() => { location.hash = '#breakin'; }); await S.wait(1200);
  await p.evaluate(() => scrollTo(0, 0)); await p.addStyleTag({ content: '#toast{display:none!important}' }); await S.wait(200);
  await p.screenshot({ path: path.join(OUT, 'breakin.jpg'), quality: 88, type: 'jpeg', clip: { x: 0, y: 0, width: 390, height: 765 } }); console.log('saved breakin');
  await p.evaluate(() => { location.hash = '#settings'; }); await S.wait(1500);
  await shot(p, p.locator('#vWt').locator('xpath=ancestor::div[contains(@class,"set-row")][1]'), 'set-wait');
  await shot(p, p.locator('#vClk').locator('xpath=ancestor::div[contains(@class,"set-row")][1]'), 'set-clock');
  console.log('errors:', S.errs);
  await S.close();
})();
