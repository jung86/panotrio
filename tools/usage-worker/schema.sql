-- 파노체크 사용 현황 (스틱별 한 줄 + 날짜별 횟수)
CREATE TABLE IF NOT EXISTS sticks (
  id TEXT PRIMARY KEY,          -- 스틱 ID (8자리 16진수) 또는 'NOSTICK'
  hw TEXT, app TEXT, fw TEXT, plat TEXT,
  first_seen INTEGER, last_seen INTEGER,
  opens INTEGER DEFAULT 0,      -- 앱 열기·스틱 연결
  meas INTEGER DEFAULT 0,       -- 측정(기록 저장·컨디션 측정)
  note TEXT DEFAULT '',         -- 관리자 메모 (누구 스틱인지)
  dev TEXT                      -- 폰 기종 · OS · 브라우저 (예: Android 14 · SM-S918N · Chrome 131), 예전 DB엔 워커가 처음 쓸 때 붙임
);
CREATE TABLE IF NOT EXISTS daily (
  id TEXT, day TEXT, opens INTEGER DEFAULT 0, meas INTEGER DEFAULT 0,
  PRIMARY KEY (id, day)
);
