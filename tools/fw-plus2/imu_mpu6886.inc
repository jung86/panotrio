// ============================================================================ IMU (MPU6886, M5StickC Plus2)
// The accelerometer runs with its digital filter bypassed (4 kHz output, ~1 kHz bandwidth) and is
// read through the 1 KB FIFO every 10 ms. A half-band filter halves it to 2 kHz, which keeps the
// 250-700 Hz motor range clear of the 1 kHz limit. Layout and rate of the FIFO are measured at start
// (some MPU6886 lots add the temperature to every sample), so nothing depends on a guessed value.
static uint8_t mpuPkt = 6;                            // bytes per FIFO sample
static uint8_t mpuDec = 2;                            // 2 = 4 kHz -> 2 kHz, 1 = store as read
static bool mpuW(uint8_t r, uint8_t v) { return M5.In_I2C.writeRegister8(imuAddr, r, v, IMU_I2C_HZ); }
static uint32_t mpuCount() {
  uint8_t c[2];
  if (!M5.In_I2C.readRegister(imuAddr, 0x72, c, 2, IMU_I2C_HZ)) return 0xFFFF;
  return ((uint32_t)(c[0] & 0x1F) << 8) | c[1];
}
static void mpuFifoReset() { mpuW(0x6A, 0x04); delayMicroseconds(200); mpuW(0x6A, 0x40); }

// 7-tap half-band low-pass (-1 0 9 16 9 0 -1)/32, keeps every second output
struct HalfBand2 {
  int16_t h[7] = { 0 }; uint8_t ph = 0;
  bool push(int16_t v, int16_t& out) {
    memmove(h, h + 1, 6 * sizeof(int16_t)); h[6] = v;
    if ((ph ^= 1) == 0) return false;
    int32_t a = -(int32_t)h[0] + 9 * (int32_t)h[2] + 16 * (int32_t)h[3] + 9 * (int32_t)h[4] - (int32_t)h[6];
    a = (a + 16) >> 5;
    out = (int16_t)(a > 32767 ? 32767 : a < -32768 ? -32768 : a);
    return true;
  }
};
static HalfBand2 mpuHb[3];

static bool imuSetup() {
  imuAddr = 0;
  const uint8_t cand[2] = { 0x68, 0x69 };
  for (int i = 0; i < 2; ++i) {
    if (M5.In_I2C.readRegister8(cand[i], 0x75, IMU_I2C_HZ) == 0x19) { imuAddr = cand[i]; break; }   // WHO_AM_I
  }
  if (!imuAddr) return false;
  bool ok = true;
  ok &= mpuW(0x6B, 0x01); delay(5);                   // PWR_MGMT_1 : awake, best clock
  ok &= mpuW(0x6C, 0x07);                             // PWR_MGMT_2 : accelerometer on, gyro off
  ok &= mpuW(0x38, 0x00);                             // INT_ENABLE : none
  ok &= mpuW(0x1C, 0x08);                             // ACCEL_CONFIG : +-4 g (8192 LSB/g)
  ok &= mpuW(0x1D, 0x08);                             // ACCEL_CONFIG2: filter bypassed -> 4 kHz
  ok &= mpuW(0x23, 0x08);                             // FIFO_EN : accelerometer
  if (!ok) return false;
  delay(20);

  // learn sample size (6 or 8 bytes) and rate: fill for ~20 ms, the right size gives a smooth signal
  mpuFifoReset();
  const int64_t t0 = esp_timer_get_time();
  delay(20);
  const uint32_t cnt = mpuCount();
  const int64_t t1 = esp_timer_get_time();
  uint8_t b[96];
  if (cnt == 0xFFFF || cnt < sizeof(b) || !M5.In_I2C.readRegister(imuAddr, 0x74, b, sizeof(b), IMU_I2C_HZ)) return false;
  float best = 1e30f; uint8_t bestP = 6;
  static const uint8_t kPkt[2] = { 6, 8 };
  for (uint8_t P : kPkt) {
    const int n = sizeof(b) / P; float d = 0;
    for (int k = 1; k < n; ++k)
      for (int a = 0; a < 3; ++a) {
        const int16_t v0 = (int16_t)((b[(k - 1) * P + a * 2] << 8) | b[(k - 1) * P + a * 2 + 1]);
        const int16_t v1 = (int16_t)((b[k * P + a * 2] << 8) | b[k * P + a * 2 + 1]);
        d += fabsf((float)v1 - (float)v0);
      }
    d /= (float)(n - 1);
    if (d < best) { best = d; bestP = P; }
  }
  mpuPkt = bestP;
  const float raw = (float)cnt / (float)mpuPkt * 1e6f / (float)(t1 - t0);
  mpuDec = raw > 2800.0f ? 2 : 1;                     // 4 kHz expected; if the FIFO runs at 1 kHz keep every sample
  accNom = mpuDec == 2 ? 2000.0f : 1000.0f;
  accFs.store(accNom);
  if (Serial) Serial.printf("MPU6886 fifo %u B/sample, %.0f Hz raw, stored %.0f Hz\n", mpuPkt, raw, accNom);
  mpuFifoReset();
  return true;
}

// One FIFO read. Called every 10 ms from imuTask.
static void imuService() {
  static uint8_t  buf[1008];                          // multiple of 6 and 8
  static int64_t  epochUs = 0;
  static uint32_t epochCount = 0;
  static bool     epochSet = false;

  uint32_t len = mpuCount();
  if (len == 0xFFFF) { imuErrors++; return; }
  if (len >= 1000) {                                  // the 1 KB FIFO ran full: samples were lost
    mpuFifoReset();
    imuOverruns++; epochSet = false;
    return;
  }
  len -= len % mpuPkt;
  if (len == 0) return;
  if (len > sizeof(buf)) len = sizeof(buf) - sizeof(buf) % mpuPkt;
  if (!M5.In_I2C.readRegister(imuAddr, 0x74, buf, len, IMU_I2C_HZ)) { imuErrors++; mpuFifoReset(); epochSet = false; return; }
  const int64_t now = esp_timer_get_time();

  uint32_t head = accHead.load(std::memory_order_relaxed);
  const uint32_t mask = accCap - 1;
  for (uint32_t i = 0; i + mpuPkt <= len; i += mpuPkt) {
    const uint8_t* p = buf + i;
    const int16_t v[3] = { (int16_t)((p[0] << 8) | p[1]), (int16_t)((p[2] << 8) | p[3]), (int16_t)((p[4] << 8) | p[5]) };
    int16_t* d = accRing + (size_t)(head & mask) * 3;
    if (mpuDec == 2) {
      int16_t o[3]; bool out = false;
      for (int a = 0; a < 3; ++a) out = mpuHb[a].push(v[a], o[a]);
      if (!out) continue;
      d[0] = o[0]; d[1] = o[1]; d[2] = o[2];
    } else {
      d[0] = v[0]; d[1] = v[1]; d[2] = v[2];
    }
    ++head;
  }
  accHead.store(head, std::memory_order_release);
  // real stored sample rate, measured against the ESP32 clock
  if (!epochSet) { epochUs = now; epochCount = head; epochSet = true; return; }
  const int64_t dt = now - epochUs;
  const bool have = accFsValid.load(std::memory_order_relaxed);
  if ((!have && dt >= 3000000) || dt >= 15000000) {
    float fs = (float)((double)(head - epochCount) * 1e6 / (double)dt);
    if (fs > accNom * 0.8f && fs < accNom * 1.2f) { accFs.store(fs); accFsValid.store(true); }
  }
  if (dt >= 120000000) { epochUs = now; epochCount = head; }
}
