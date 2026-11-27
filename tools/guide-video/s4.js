// 4. 모터클리닝
const { open, quickStick } = require('./lib');
module.exports = async () => {
  const S = await open('s4');
  const p = S.p;
  await quickStick(S);
  await p.click('#tileClean'); await S.wait(1000);
  S.mark('start');
  await S.cap('모터클리닝', '최소 ↔ 최대 전압을 부드럽게 오르내리며 모터를 돌립니다'); await S.wait(3500);
  await S.cap('① 전원공급기를 연결합니다', '방법은 2번 영상과 같습니다'); await S.wait(800);
  await S.tap('#btnDps', 800); await S.tap('.__pick .i', 500); await S.tap('.__pick .p', 1800);
  await S.cap('② 최소·최대 전압과 전류 제한'); await S.wait(500);
  await S.fill('#cMin', '1.5'); await S.fill('#cMax', '3'); await S.fill('#cAmp', '3'); await S.wait(800);
  await S.cap('③ 왕복 1회 시간 · 반복 횟수 · 방향', '역방향·번갈아는 릴레이 보드가 있어야 합니다'); await S.wait(500);
  await S.fill('#cPer', '8'); await S.fill('#cRep', '3'); await S.wait(1500);
  await S.cap('자주 쓰는 설정은 [저장]으로 프리셋'); await S.ring('#cPreSave'); await S.wait(1500);
  await S.cap('④ [▶ 시작]을 누릅니다'); await S.wait(400);
  await S.tap('#btnCStart', 1500);
  await S.cap('전압이 천천히 오르내리고', '파노는 스틱에서 실시간으로 들어옵니다'); await S.wait(4000);
  await S.cap('전압이 천천히 오르내리고', '▶▶ 빠르게 보기'); S.mark('ff1@3');
  await p.waitForFunction(() => !cl.run && !cl.busy, null, { timeout: 120000 });
  S.mark('nf1'); await S.wait(500);
  await S.cap('끝나면 출력이 저절로 꺼집니다', '중간에 멈추려면 [■ 정지]'); await S.wait(4000);
  await S.cap(''); await S.wait(400); S.mark('end');
  return S;
};
