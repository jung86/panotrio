# 설명서 안내 영상 다시 만들기

가짜 스틱(Web Bluetooth)·가짜 DPS(Web Serial)를 넣은 앱을 Playwright로 조작하며 화면을 녹화합니다. 자막과 터치 표시는 화면 안에 그립니다.

1. 저장소 폴더에서 `python3 -m http.server 8765`
2. 이 폴더에서 `node run.js s1 s2 s3 s4 s5 s6` (각 장면 = `sN.js`, 화면 프레임은 `raw/`)
3. `mkdir -p out && python3 enc.py s1 s2 s3 s4 s5 s6` → `out/sN.mp4` (720×1558, H.264). 마크 `ffN@배속`~`nfN` 구간은 빠르게.
4. `manual/video/`의 같은 이름 파일을 바꾸고 포스터(jpg)도 다시 뽑기.

앱 화면 id가 바뀌면 `sN.js`의 선택자를 맞춰야 합니다.
