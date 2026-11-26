// 6. 기록 · 비교 · CSV
const { open } = require('./lib');
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
    const r = { t, motor: m.n, tag, dur: 30, dir: 0, v: 2.0, vr: 0, i: +i.toFixed(4), icv: +(2 + (100 - sc) / 8).toFixed(2), hz: +hz.toFixed(2), hcv: +(0.3 + (100 - sc) / 40).toFixed(3), drift: 0.4, rpv: +(hz * 30).toFixed(1), bN: k, unstable: false, uw: '', score: sc, pts: sc < 85 ? [['전류 출렁임 (브러시·정류자)', 100 - sc]] : [] };
    ck.unshift(r);
    recs.unshift({ t: t + 60000, memo: '⏱ ' + ['일반', '청소 전', '청소 후'][tag] + ' 30초', motor: m.n, mode: 2, big: +hz.toFixed(1), vib: +(hz * 1.001).toFixed(1), mic: +(hz * 0.999).toFixed(1), status: 'MATCH', v: 2.0, i: +i.toFixed(3), cond: sc });
  }));
  ck.sort((a, b) => b.t - a.t); recs.sort((a, b) => b.t - a.t);
  return { 'panocheck-condchk': JSON.stringify(ck), 'panotrio-recs': JSON.stringify(recs), 'panotrio-motors': JSON.stringify(M.map(m => m.n)), 'panotrio-motor': M[0].n };
}
module.exports = async () => {
  const S = await open('s6', { seed: seed() });
  const p = S.p;
  await S.wait(2300); S.mark('start');
  await S.cap('📊 기록 · 비교', '컨디션 측정 결과가 모터별로 쌓입니다'); await S.wait(3000);
  await S.tap('#tileBook', 1200);
  await S.cap('🏆 모터 순위', '최근 점수 순 · 등급 색으로 표시'); await S.wait(3500);
  await S.cap('모터를 누르면 자세히 봅니다'); await S.wait(400);
  await S.tap(p.locator('#bkRank > *').first(), 1500);
  await S.cap('점수 변화 그래프', '주황 = 청소 전 · 초록 = 청소 후'); await S.scrollTo('#bkDet', 'start'); await S.wait(4000);
  await S.cap('청소 전·후 비교와 지난 측정 목록'); await S.scrollTo('#bkCmp', 'start'); await S.wait(3500);
  await S.cap('📤 결과 카드를 카톡 등으로 공유'); await S.ring('#bkShare'); await S.wait(2200);
  await p.click('#btnBookBack'); await S.wait(800);
  await S.cap('파노측정 화면 아래 [기록] 카드'); await S.wait(300);
  await S.tap('#tileMeasure', 1000);
  await S.scrollTo('#motorSel', 'start'); await S.wait(2500);
  await S.cap('모터 칩을 눌러 그 모터 기록만 보기'); await S.wait(300);
  const chips = p.locator('#fchips > *'); if (await chips.count() > 2) await S.tap(chips.nth(2), 1800);
  if (await chips.count() > 0) await S.tap(chips.nth(0), 1200);
  await S.cap('[CSV 저장]: 엑셀에서 열 수 있는 파일로 저장', '[＋ 지금 값]: 지금 화면의 값을 직접 기록'); await S.ring('#btnCsv'); await S.wait(1000); await S.ring('#btnSave'); await S.wait(2500);
  await S.cap(''); await S.wait(400); S.mark('end');
  return S;
};
