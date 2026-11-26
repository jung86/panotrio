// 파노체크: 안드로이드 크롬에서 펌웨어 설치 (Web Serial이 있으면 그것, 없으면 WebUSB + web-serial-polyfill) + esptool-js
// 빌드: npm i esptool-js@0.5.4 web-serial-polyfill@1.0.15 spark-md5@3.0.2 esbuild; npx esbuild tools/phone-flash-src.js --bundle --format=esm --minify --target=chrome100 --outfile=install/phone-flash.js
// manifest.json의 네 조각만 씀 (NVS 0x9000~0xE000는 건드리지 않음 -> 활성화 유지)
import { ESPLoader, Transport, UsbJtagSerialReset, ClassicReset } from "esptool-js";
import { SerialPort as UsbSerialPort } from "web-serial-polyfill";
import SparkMD5 from "spark-md5";

const ESP_VID = 0x303a;                       // M5StickS3 (ESP32-S3 built-in USB)
const CH_VID = 0x1a86;                        // M5StickC Plus2 (CH9102 USB-serial chip)
const USB_FILTERS = [{ vendorId: ESP_VID }, { vendorId: CH_VID }];
const hex = (n) => (n === undefined || n === null ? "?" : "0x" + n.toString(16).padStart(4, "0"));

function bstr(buf) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return s;
}
function withTimeout(p, ms, code) {
  let t;
  return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error(code)), ms); })]).finally(() => clearTimeout(t));
}

export function hasNativeSerial() { return !!navigator.serial; }

// returns { kind:'usb'|'serial', port, usb? }. Android: WebUSB first (Web Serial on Android may list only Bluetooth)
export async function pickDevice(log = () => {}, prefer = "usb") {
  if (navigator.usb && prefer !== "serial") {
    const usb = await navigator.usb.requestDevice({ filters: USB_FILTERS });
    const itfs = usb.configurations && usb.configurations[0]
      ? usb.configurations[0].interfaces.map((f) => f.interfaceNumber + ":" + f.alternates[0].interfaceClass).join(" ") : "?";
    log(`장치(WebUSB) ${usb.productName || ""} VID ${hex(usb.vendorId)} PID ${hex(usb.productId)} 인터페이스 ${itfs}`);
    return { kind: "usb", usb, port: new UsbSerialPort(usb) };
  }
  if (navigator.serial) {
    const port = await navigator.serial.requestPort({ filters: USB_FILTERS.map((f) => ({ usbVendorId: f.vendorId })) });
    const i = port.getInfo ? port.getInfo() : {};
    log(`장치(Web Serial) VID ${hex(i.usbVendorId)} PID ${hex(i.usbProductId)}`);
    return { kind: "serial", port };
  }
  throw new Error("NO_USB");
}

// ui: { status(text), progress(0..1), log(text) }; opts.mode: 'default_reset' (자동) | 'no_reset' (스틱을 직접 다운로드 모드로)
export async function flash(dev, ui, opts = {}) {
  const say = (t) => ui.status && ui.status(t);
  const log = (t) => ui.log && ui.log(t);
  const mode = opts.mode || "default_reset";
  const manifestUrl = opts.manifest || "manifest.json";

  say("펌웨어 파일 받는 중…");
  const man = await (await fetch(manifestUrl, { cache: "no-cache" })).json();
  log(`방식 ${dev.kind}, 모드 ${mode}`);

  say(mode === "no_reset" ? "다운로드 모드 스틱에 연결하는 중…" : "스틱에 연결하는 중…");
  const transport = new Transport(dev.port, false);
  const terminal = { clean() {}, writeLine: (d) => log(d), write: (d) => { if (String(d).trim()) log(d); } };
  const loader = new ESPLoader({ transport, baudrate: 115200, romBaudrate: 115200, terminal, serialOptions: { bufferSize: 64 }, debugLogging: false,
    resetConstructors: {
      usbJTAGSerialReset: (t) => ({ reset: async () => { log("리셋 신호 보냄 (USB-JTAG)"); await new UsbJtagSerialReset(t).reset(); } }),
      classicReset: (t, d) => ({ reset: async () => { log("리셋 신호 보냄 (기본)"); await new ClassicReset(t, d).reset(); } }),
    } });
  const abort = async () => {             // never hang here: close the USB device first (ends pending transfers), then the port
    if (dev.usb && dev.usb.opened) { try { await withTimeout(dev.usb.close(), 3000, "T"); } catch (_) {} }
    try { await withTimeout(transport.disconnect(), 3000, "T"); } catch (_) {}
    if (dev.usb && dev.usb.opened) { try { await withTimeout(dev.usb.close(), 3000, "T"); } catch (_) {} }
  };
  const origConnect = transport.connect.bind(transport);
  transport.connect = async (...a) => {
    log("포트 여는 중…");
    await withTimeout(origConnect(...a), 10000, "OPEN_TIMEOUT");
    log("포트 열림, 스틱을 설치 모드로 바꾸는 중…");
  };
  let chip;
  try {
    chip = await withTimeout(loader.main(mode), 30000, "TIMEOUT");
  } catch (e) {
    log("[연결 실패] " + (e && (e.name ? e.name + ": " : "") + e.message || e));
    await abort();
    throw new Error("CONNECT:" + (e && e.message || e));
  }
  log("칩: " + chip);
  // ESP32-S3 = M5StickS3, ESP32 (PICO-V3-02) = M5StickC Plus2. Each has its own build in manifest.json.
  const family = /ESP32-S3/i.test(chip) ? "ESP32-S3" : (/^ESP32/i.test(chip) && !/^ESP32-(S2|S3|C\d|H\d|P4)/i.test(chip)) ? "ESP32" : "";
  const build = family && man.builds.find((b) => b.chipFamily === family);
  if (!build) { await abort(); throw new Error("지원하지 않는 스틱입니다 (칩: " + chip + ")"); }
  const files = [];
  try {
    for (const p of build.parts) {
      if (p.offset >= 0x9000 && p.offset < 0xe000) throw new Error("NVS 영역에 쓰는 조각이 있어 중단");
      const r = await fetch(new URL(p.path, new URL(manifestUrl, location.href)), { cache: "no-cache" });
      if (!r.ok) throw new Error("파일 받기 실패: " + p.path);
      files.push({ data: bstr(await r.arrayBuffer()), address: p.offset });
    }
  } catch (e) { await abort(); throw e; }
  const totalAll = files.reduce((a, f) => a + f.data.length, 0);
  log(`${family} 파일 ${files.length}개 ${Math.round(totalAll / 1024)} KB`);

  say("설치 중… 선을 빼지 마세요");
  const sizes = files.map((f) => f.data.length);
  const before = (i) => sizes.slice(0, i).reduce((a, b) => a + b, 0);
  let lastP = Date.now();
  const watchdog = setInterval(() => { if (Date.now() - lastP > 30000) { log("[멈춤] 30초 동안 진행 없음"); abort(); } }, 3000);
  try {
    await loader.writeFlash({
      fileArray: files, flashSize: "keep", flashMode: "keep", flashFreq: "keep", eraseAll: false, compress: true,
      reportProgress: (i, written, total) => {
        lastP = Date.now();
        const frac = total ? written / total : 1;
        ui.progress && ui.progress((before(i) + frac * sizes[i]) / totalAll);
      },
      calculateMD5Hash: (img) => SparkMD5.hashBinary(img),
    });
  } finally { clearInterval(watchdog); }
  // 쓰기와 확인(Hash verified)이 끝나면 설치 성공. 다시 켜기(RTS 리셋)는 다운로드 모드에선 안 될 수 있어 기다리지 않음
  ui.progress && ui.progress(1);
  (async () => {
    try { await withTimeout(loader.after("hard_reset"), 4000, "TIMEOUT"); } catch (_) {}
    await abort();
  })();
  return { chip, family, version: man.version };
}
