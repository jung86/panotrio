# 파노체크 M5StickC Plus2 펌웨어 만들기 (PC에서)

한 소스(PanoTrio.ino)로 S3와 Plus2 둘 다 빌드합니다. `CONFIG_IDF_TARGET_ESP32`이면 Plus2.

## 바뀌는 것 (port_plus2.py)
- IMU: BMI270 대신 MPU6886 (imu_mpu6886.inc). 4 kHz FIFO → 2 kHz로 줄여 저장. FIFO 샘플 크기(6/8바이트)와 속도는 켤 때 직접 재서 맞춤. FIFO가 1 kHz로만 나오면 1 kHz 그대로 씀(그땐 500 Hz 넘는 파노는 진동으로 못 잼, 소리로는 잼).
- 릴레이 핀: G9/G10 → G32/G33 (Grove). Plus2는 Grove 5V를 못 끔.
- USB 전원 판단: 전원 칩이 없어 배터리 4.18 V 넘으면 USB로 봄(추정).
- INFO 끝에 `;HW=P2` → 앱이 `fw/latest-plus2.json`을 씀.
- S3 빌드는 동작이 같아야 함.

## 순서
1. `Documents\motorcleaner\PanoTrio` 를 `PanoTrio-before-p2` 로 통째 복사(백업).
2. `python port_plus2.py PanoTrio\PanoTrio.ino` (imu_mpu6886.inc는 port_plus2.py 옆에 둠).
3. 다른 파일(pano_ota.h 등)에서 `getVBUSVoltage` / `isCharging` 검색 → Plus2에선 배터리 값만 보게 맞춤(배터리 25% 규칙).
4. S3 빌드가 그대로 되는지 확인(지금 FQBN).
5. Plus2 빌드: `esp32:esp32:m5stack_stickc_plus2:PSRAM=enabled,PartitionScheme=default_8MB` (병합 bin도 만들기).
6. 서명: 지금 방식 그대로 `PanoCheck|fw|v1|2.6|SHA256HEX` (S3 파일은 칩 검사에서 Plus2가 거부, 앱도 모델별 파일을 씀).
7. 결과(panocheck-2.6-p2-out):
   - `PanoCheck-2.6-M5StickCPlus2.bin` (병합본, 0x0부터)
   - `fw/PanoCheck-P2-2.6.app.bin`
   - `install/p2/bootloader-2.6.bin` (병합본 0x1000~0x8000), `install/p2/partitions-2.6.bin` (0x8000~0x9000), `install/p2/otadata-2.6.bin` (0xE000~0x10000)
   - `fw/latest-plus2.json` (ver, size, sha256, sig, bin, note)
8. NVS(0x9000~0xE000)는 절대 쓰지 않음. 비공개 키는 PC 밖으로 안 나감.
