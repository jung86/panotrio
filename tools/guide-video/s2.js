// 2. 전원공급기 연결 (DPS-150 / DPS100)
const { open, quickStick } = require('./lib');
module.exports = async () => {
  const S = await open('s2');
  const p = S.p;
  await quickStick(S);
  await p.click('#tileMeasure'); await S.wait(800);
  await p.evaluate(() => document.getElementById('psuCard').scrollIntoView({ block: 'start' })); await S.wait(600);
  S.mark('start');
  await S.tag('DPS-150');
  await S.cap('전원공급기 연결 · DPS-150', '휴대폰 USB-C ↔ DPS-150 Micro USB 데이터선, 전원은 PD 충전기'); await S.wait(3500);
  await S.cap('① 파노측정 화면 ⚡ 카드의 [연결]'); await S.wait(800);
  await S.tap('#btnPsu', 900);
  await S.cap('② 목록에서 DPS-150을 고르고 [연결]'); await S.wait(1200);
  await S.tap('.__pick .i', 600); await S.tap('.__pick .p', 1800);
  await S.cap('카드에 "DPS-150 · 출력 OFF"가 보이면 연결 성공', '한 번 허락하면 다음부터 저절로 연결됩니다'); await S.wait(3200);
  await S.cap('③ 전압·전류 제한을 −/+로 정하고 [출력 켜기]'); await S.wait(600);
  await p.evaluate(() => { const i = document.getElementById('psuV'); i.value = '1.6'; i.dispatchEvent(new Event('change')); });
  for (let k = 0; k < 4; k++) await S.tap('button.stp[data-for="psuV"][data-d="1"]', 250);
  await S.wait(600);
  await S.tap('#psuOut', 2600);
  await S.cap('실제 전압·전류·전력이 실시간으로 보입니다'); await S.wait(3500);
  await S.tap('#psuOut', 1500);
  await S.cap('[끊기]로 연결을 끊습니다'); await S.wait(500);
  await S.tap('#btnPsu', 1500);
  // DPS100
  await p.evaluate(() => { SIM.model = 'DPS100'; }); await S.tag('DPS100');
  await S.cap('DPS100도 같은 방법', 'PC COMM 단자에 데이터선 (제품에 선은 안 들어 있음)'); await S.wait(3500);
  await S.cap('① [연결]을 누릅니다'); await S.wait(600);
  await S.tap('#btnPsu', 1000);
  await S.cap('② 첫 목록에 DPS100이 안 보이면 [취소]'); await S.wait(2200);
  await S.tap('.__pick .c', 1200);
  await S.cap('③ 모든 USB 장치 목록이 다시 뜹니다', '새로 생긴 장치(USB 직렬 장치 등)를 고르고 [연결]'); await S.wait(2400);
  await S.tap('.__pick .i', 700); await S.tap('.__pick .p', 2000);
  await S.cap('"DPS100 · 출력 OFF"와 숫자가 나오면 성공', '"응답이 없습니다"가 뜨면 다른 장치를 골라 보세요'); await S.wait(3800);
  await S.cap(''); await S.tag(''); await S.wait(400); S.mark('end');
  return S;
};
