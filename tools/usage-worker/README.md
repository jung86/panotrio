# 파노체크 사용 현황 (관리자용)

앱(app.html)이 열릴 때·스틱이 연결될 때·측정을 저장할 때 아주 작은 기록을 이 서버로 보냅니다.
관리자 화면(`https://<워커 주소>/admin`)에서 스틱별로 마지막 사용, 사용 횟수, 앱·펌웨어 버전을 봅니다.

- 보내는 것: 스틱 ID, 앱 버전, 펌웨어 버전, 스틱 종류(S3/Plus2), 폰 종류(Android/iOS/PC), 열기/측정 구분과 횟수.
- 보내지 않는 것: 이름, 전화번호, 위치, 측정값, 메모, 모터 이름.
- 앱의 `USAGE_URL`이 비어 있으면 아무것도 보내지 않습니다. 보내기가 실패해도 앱은 그대로 동작합니다.
- 사용자에게 "사용 기록(스틱 ID·버전)이 제작자에게 전송된다"고 알려 주세요.

## 처음 설치 (한 번만, PC)

1. https://dash.cloudflare.com/sign-up 에서 무료 가입 (이메일 확인까지).
2. 이 폴더에서:
   ```
   npx wrangler login                      # 브라우저에서 [Allow]
   npx wrangler d1 create panocheck-usage  # 나온 database_id를 wrangler.toml에 넣기
   npx wrangler d1 execute panocheck-usage --remote --file schema.sql
   npx wrangler secret put ADMIN_TOKEN     # 관리자 비밀번호 (8자 이상, 저장소에 쓰지 않음)
   npx wrangler deploy                     # 주소 https://panocheck-usage.<이름>.workers.dev
   ```
3. app.html의 `var USAGE_URL = '';` 에 2번의 주소를 넣고(끝에 / 없이) APP_BUILD를 올려 push.

## 무료 한도
Cloudflare 무료: 요청 하루 10만 번, D1 쓰기 하루 10만 줄. 기록 한 번에 2줄 씀 → 하루 수만 번까지 충분.

## 텔레그램 오류 알림 (선택)
새 오류가 들어오면 관리자 텔레그램으로 바로 알림(1시간에 20개까지).
1. 텔레그램에서 @BotFather → `/newbot` → 이름 두 번 입력 → 받은 봇 토큰 복사.
2. PC PowerShell: `npx.cmd wrangler secret put TG_TOKEN` → 토큰 붙여 넣기 (저장소에 쓰지 않음).
3. 텔레그램에서 방금 만든 봇을 열고 아무 말이나 보내기.
4. 관리 화면 「오류」 카드 또는 앱 「허락한 사람」 아래 [텔레그램 연결] → 봇이 인사 메시지를 보내면 끝.

## 비밀번호 바꾸기
`npx wrangler secret put ADMIN_TOKEN` 다시 실행.
