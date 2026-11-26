// 파노체크: 안드로이드 크롬에서 WebUSB로 펌웨어 설치 (web-serial-polyfill + esptool-js)
// 빌드: npm i esptool-js@0.5.4 web-serial-polyfill@1.0.15 spark-md5@3.0.2 esbuild; npx esbuild tools/phone-flash-src.js --bundle --format=esm --minify --target=chrome100 --outfile=install/phone-flash.js
// manifest.json의 네 조각만 씀 (NVS 0x9000~0xE000는 건드리지 않음 -> 활성화 유지)
import { ESPLoader, Transport } from "esptool-js";
import { SerialPort as UsbSerialPort } from "web-serial-polyfill";
import SparkMD5 from "spark-md5";

const ESP_VID = 0x303a;

function bstr(buf) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return s;
}

export async function pickDevice() {
  if (!navigator.usb) throw new Error("NO_USB");
  return navigator.usb.requestDevice({ filters: [{ vendorId: ESP_VID }] });
}

// ui: { status(text), progress(0..1), log(text) }
export async function flash(device, ui, manifestUrl = "manifest.json") {
  const say = (t) => ui.status && ui.status(t);
  const log = (t) => ui.log && ui.log(t);

  say("펌웨어 파일 받는 중…");
  const man = await (await fetch(manifestUrl, { cache: "no-cache" })).json();
  const parts = man.builds.find((b) => b.chipFamily === "ESP32-S3").parts;
  const files = [];
  for (const p of parts) {
    if (p.offset >= 0x9000 && p.offset < 0xe000) throw new Error("NVS 영역에 쓰는 조각이 있어 중단");
    const r = await fetch(new URL(p.path, new URL(manifestUrl, location.href)), { cache: "no-cache" });
    if (!r.ok) throw new Error("파일 받기 실패: " + p.path);
    files.push({ data: bstr(await r.arrayBuffer()), address: p.offset });
  }
  const totalAll = files.reduce((a, f) => a + f.data.length, 0);

  say("스틱에 연결하는 중…");
  const port = new UsbSerialPort(device);
  const transport = new Transport(port, false);
  const terminal = { clean() {}, writeLine: (d) => log(d), write: (d) => log(d) };
  const loader = new ESPLoader({ transport, baudrate: 115200, romBaudrate: 115200, terminal });
  let chip;
  try {
    chip = await loader.main();
  } catch (e) {
    try { await transport.disconnect(); } catch (_) {}
    throw new Error("CONNECT:" + (e && e.message || e));
  }
  if (!/ESP32-S3/i.test(chip)) {
    try { await transport.disconnect(); } catch (_) {}
    throw new Error("이 기기는 ESP32-S3가 아닙니다: " + chip);
  }

  say("설치 중… 선을 빼지 마세요");
  const sizes = files.map((f) => f.data.length);
  const before = (i) => sizes.slice(0, i).reduce((a, b) => a + b, 0);
  await loader.writeFlash({
    fileArray: files,
    flashSize: "keep",
    flashMode: "keep",
    flashFreq: "keep",
    eraseAll: false,
    compress: true,
    reportProgress: (i, written, total) => {
      const frac = total ? written / total : 1;
      ui.progress && ui.progress((before(i) + frac * sizes[i]) / totalAll);
    },
    calculateMD5Hash: (img) => SparkMD5.hashBinary(img),
  });
  say("다시 켜는 중…");
  try { await loader.after("hard_reset"); } catch (_) {}
  try { await transport.disconnect(); } catch (_) {}
  ui.progress && ui.progress(1);
  return { chip, version: man.version };
}
