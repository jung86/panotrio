# -*- coding: utf-8 -*-
"""파노체크 펌웨어에 M5StickC Plus2 지원을 넣는 패치 (한 소스로 두 스틱 빌드).
사용: python port_plus2.py PanoTrio.ino   (원본은 PanoTrio.ino.bak-s3 로 보관)
빌드:  S3    : 지금과 같은 FQBN
       Plus2 : esp32:esp32:m5stack_stickc_plus2:PSRAM=enabled,PartitionScheme=default_8MB
같은 소스에서 CONFIG_IDF_TARGET_ESP32 로 Plus2를 구분합니다. S3 빌드 결과는 바뀌지 않아야 합니다
(바뀌는 건 IMU 샘플 속도 범위 검사를 상수로 바꾼 것과 부팅 문구 한 줄뿐, 값은 같음)."""
import sys, shutil, io

path = sys.argv[1]
s = io.open(path, encoding="utf-8").read()
if "PANO_P2" in s:
    print("이미 패치됨"); sys.exit(0)
shutil.copyfile(path, path + ".bak-s3")

def R(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit("찾을 수 없음(%d): %r" % (n, old[:80]))
    s = s.replace(old, new)

# 1) 모델 구분
R('#include "pano_ota.h"\n', '''#include "pano_ota.h"

// One source, two sticks: M5StickS3 (ESP32-S3, BMI270) and M5StickC Plus2 (ESP32-PICO-V3-02, MPU6886,
// PDM microphone, CH9102 USB serial, no power-management chip). The Bluetooth protocol is the same;
// INFO says HW=P2 on the Plus2 so the app picks the Plus2 firmware file for updates.
#if CONFIG_IDF_TARGET_ESP32
#define PANO_P2 1
#else
#define PANO_P2 0
#endif
''')

# 2) 릴레이 핀: Plus2 Grove = G32 / G33
R("static const int RELAY_PIN_A = 9, RELAY_PIN_B = 10;",
  "static const int RELAY_PIN_A = PANO_P2 ? 32 : 9, RELAY_PIN_B = PANO_P2 ? 33 : 10;   // Grove: S3 G9/G10, Plus2 G32/G33")

# Plus2: Grove 5 V can't be switched off; forward still leaves the inputs floating (released for both
# trigger types, and keeps G32/G33 free for a later I2C sensor), same as the S3.

# 3) IMU 샘플 속도 기준값
R("static std::atomic<bool>     accFsValid{ false };\n", '''static std::atomic<bool>     accFsValid{ false };
static float accNom = 1600.0f;                        // nominal stored sample rate (S3 1600 Hz, Plus2 2000 Hz)
''')
R("if (fs > 1300.0f && fs < 1900.0f) { accFs.store(fs); accFsValid.store(true); }",
  "if (fs > accNom * 0.8f && fs < accNom * 1.2f) { accFs.store(fs); accFsValid.store(true); }")

# 4) Plus2 IMU (MPU6886) : S3 imuSetup/imuService는 #if !PANO_P2 로 감쌈
i0 = s.index("static bool imuSetup() {")
i1 = s.index("static void imuTask(void*) {")
s = s[:i0] + "#if !PANO_P2\n" + s[i0:i1] + "#else\n" + io.open(
    __file__.replace("port_plus2.py", "imu_mpu6886.inc"), encoding="utf-8").read() + "#endif\n\n" + s[i1:]

R('bootLine(0, imuOk ? "IMU  ok (1600 Hz)" : "IMU  NOT FOUND", imuOk ? TFT_WHITE : TFT_RED);',
  '{ char t[24]; snprintf(t, sizeof(t), "IMU  ok (%.0f Hz)", accNom); bootLine(0, imuOk ? t : "IMU  NOT FOUND", imuOk ? TFT_WHITE : TFT_RED); }')

# 5) USB 전원 판단: Plus2는 전원 칩이 없어 VBUS를 못 읽음 -> 배터리 전압으로 추정
R("usb = M5.Power.getVBUSVoltage() > 4000;", "usb = usbPowered();")
R("static void powerService(uint32_t now) {", '''// USB power present? S3: VBUS voltage. Plus2 has no power chip: a battery above 4.18 V is taken as charging
// (it reads 4.20-4.25 V while charging; a full battery off USB sinks below 4.18 V within minutes).
static bool usbPowered() {
#if PANO_P2
  return M5.Power.getBatteryVoltage() > 4180;
#else
  return M5.Power.getVBUSVoltage() > 4000;
#endif
}
static void powerService(uint32_t now) {''')

# 6) INFO에 모델 표시
R(';MIC=%.0f", gDevId,', ';MIC=%.0f%s", gDevId,')
R("gClkBr, gMicAmp * 10.0f);", 'gClkBr, gMicAmp * 10.0f, PANO_P2 ? ";HW=P2" : "");')

R("motor \"pano\" checker for M5StickS3 (ESP32-S3)", "motor \"pano\" checker for M5StickS3 (ESP32-S3) and M5StickC Plus2 (ESP32)")

io.open(path, "w", encoding="utf-8").write(s)
left = [l for l in s.splitlines() if "getVBUSVoltage" in l or "isCharging" in l]
print("완료. 남은 VBUS/충전 호출(확인 필요):")
for l in left: print("  ", l.strip())
