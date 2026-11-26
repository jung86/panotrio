// Fake stick (Web Bluetooth) + fake DPS power supply (Web Serial) + on-screen helpers for the guide videos
(() => {
  const SIM = window.SIM = { out: false, vset: 0, iset: 3, dir: 0, hz: 0, run: 0, model: 'DPS-150', kf: 1, ifac: 1, inoise: 0.012, hnoise: 0.0025, idle: 'READY', st: '' };
  const rnd = (a) => (Math.random() * 2 - 1) * a;
  // motor: pano follows the supply voltage, wears in slowly while it runs
  setInterval(() => {
    const v = SIM.out ? SIM.vset : 0;
    if (SIM.out && v > 0.4) SIM.run += 0.1;
    const tgt = v > 0.4 ? 166 * SIM.kf * v * (1 + 0.001 * SIM.run) : 0;
    SIM.hz += (tgt - SIM.hz) * 0.25;
    if (SIM.hz < 5 && tgt === 0) SIM.hz = 0;
  }, 100);

  // ---------------- overlay helpers
  const css = document.createElement('style');
  css.textContent = `
  #__cap{position:fixed;left:10px;right:10px;bottom:14px;z-index:2147483646;background:rgba(10,12,16,.88);color:#fff;border:2px solid #e8590c;border-radius:14px;padding:12px 14px;font:800 19px/1.4 "WenQuanYi Zen Hei",sans-serif;text-align:center;box-shadow:0 6px 20px rgba(0,0,0,.5);transition:opacity .25s;pointer-events:none}
  #__cap small{display:block;font-weight:600;font-size:15px;color:#ffd8a8;margin-top:3px}
  #__cap.hide{opacity:0}
  #__tag{position:fixed;top:58px;right:10px;z-index:2147483646;background:#1971c2;color:#fff;border-radius:999px;padding:4px 10px;font:800 14px sans-serif;display:none;pointer-events:none}
  .__ring{position:fixed;z-index:2147483647;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;border:4px solid #ffd43b;background:rgba(255,212,59,.25);pointer-events:none;animation:__r .7s ease-out forwards}
  @keyframes __r{0%{transform:scale(1.6);opacity:0}40%{transform:scale(1);opacity:1}100%{transform:scale(.9);opacity:.9}}
  .__pick{position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding-top:70px}
  .__pick .b{background:#fff;color:#202124;width:340px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.5);font:15px "WenQuanYi Zen Hei",sans-serif;overflow:hidden}
  .__pick .t{padding:16px 16px 8px;font-weight:700;font-size:16px;line-height:1.4}
  .__pick .l{border-top:1px solid #ddd;border-bottom:1px solid #ddd;min-height:120px;max-height:260px}
  .__pick .i{padding:13px 16px;cursor:pointer;display:flex;gap:8px;align-items:center}
  .__pick .i.sel{background:#d2e3fc}
  .__pick .e{padding:40px 16px;color:#5f6368;text-align:center}
  .__pick .k{display:flex;justify-content:flex-end;gap:8px;padding:12px 14px}
  .__pick .k button{border-radius:18px;padding:8px 18px;font:700 14px sans-serif;border:1px solid #dadce0;background:#fff;color:#1a73e8}
  .__pick .k button.p{background:#1a73e8;color:#fff;border-color:#1a73e8}
  .__pick .k button:disabled{background:#e8eaed;color:#9aa0a6;border-color:#e8eaed}`;
  const addCss = () => document.head.appendChild(css);
  if (document.head) addCss(); else document.addEventListener('DOMContentLoaded', addCss);
  window.__cap = (t, sub) => {
    let el = document.getElementById('__cap');
    if (!el) { el = document.createElement('div'); el.id = '__cap'; document.body.appendChild(el); }
    if (!t) { el.classList.add('hide'); return; }
    el.innerHTML = t + (sub ? '<small>' + sub + '</small>' : ''); el.classList.remove('hide');
  };
  window.__tag = (t) => {
    let el = document.getElementById('__tag');
    if (!el) { el = document.createElement('div'); el.id = '__tag'; document.body.appendChild(el); }
    el.textContent = t || ''; el.style.display = t ? 'block' : 'none';
  };
  window.__ring = (x, y) => { const r = document.createElement('div'); r.className = '__ring'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 1100); };

  // a device chooser that looks like the browser's; the runner clicks it
  function picker(title, items, okText) {
    return new Promise((res, rej) => {
      const ov = document.createElement('div'); ov.className = '__pick';
      ov.innerHTML = `<div class="b"><div class="t">${title}</div><div class="l">${items.length ? items.map((x, i) => `<div class="i" data-i="${i}">${x.icon || ''} ${x.name}</div>`).join('') : '<div class="e">호환되는 기기를 찾을 수 없습니다</div>'}</div><div class="k"><button class="c">취소</button><button class="p" disabled>${okText}</button></div></div>`;
      let sel = -1;
      ov.querySelectorAll('.i').forEach(el => el.onclick = () => { ov.querySelectorAll('.i').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); sel = +el.dataset.i; ov.querySelector('.p').disabled = false; });
      ov.querySelector('.c').onclick = () => { ov.remove(); const e = new Error('No device selected.'); e.name = 'NotFoundError'; rej(e); };
      ov.querySelector('.p').onclick = () => { ov.remove(); res(items[sel]); };
      document.body.appendChild(ov);
    });
  }

  // ---------------- fake stick
  const enc = s => new TextEncoder().encode(s);
  const dvOf = u8 => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  function mkChar(uuid, readFn) {
    const ch = new EventTarget();
    ch.uuid = uuid;
    ch.value = null;
    ch.startNotifications = async () => ch;
    ch.stopNotifications = async () => ch;
    ch.readValue = async () => { const v = readFn ? readFn() : new DataView(new ArrayBuffer(0)); ch.value = v; return v; };
    ch.writeValue = ch.writeValueWithResponse = ch.writeValueWithoutResponse = async (b) => { SIM.lastCmd = Array.from(new Uint8Array(b.buffer ? b.buffer : b)); };
    ch.push = (v) => { ch.value = v; ch.dispatchEvent(new Event('characteristicvaluechanged')); };
    return ch;
  }
  const B = '-5c1b-4f2e-9d3a-50a0b0c0d0e1';
  let mode = 2;
  const info = () => `ID=1DD625E0;VER=2.9;ACT=1;RES=OK;LCK=0;UNL=1;BR=170;VM=4;WT=25;HOT=550;MIC=40;DIM=30;OFF=10;PS=1;SB=1;CK=1;C12=0;CB=0;CBR=40;BAT=86;USB=0;OTA=1;CND=1;DIR=${SIM.dir};RLY=0`;
  let lastBig = 0, steady = 0;
  function statFrame() {
    const b = new Uint8Array(20), d = new DataView(b.buffer);
    const on = SIM.out && SIM.hz > 20;
    const big = on ? SIM.hz * (1 + rnd(SIM.hnoise)) : 0;
    if (on) lastBig = big;
    d.setUint8(0, 1); d.setUint8(1, mode); d.setUint8(2, 0); d.setUint8(3, on ? 1 : 0);
    d.setFloat32(4, on ? big : lastBig, true); d.setFloat32(8, on ? big * (1 + rnd(0.003)) : 0, true); d.setFloat32(12, on ? big * (1 + rnd(0.004)) : 0, true);
    d.setUint16(16, on ? 180 + rnd(20) : 3, true); d.setInt8(18, on ? -32 : -70); d.setUint8(19, 0);
    return dvOf(b);
  }
  const chars = {};
  chars.STAT = mkChar('7a1e0002' + B, statFrame);
  chars.TEXT = mkChar('7a1e0003' + B, () => dvOf(enc(SIM.st || SIM.idle)));
  chars.CMD = mkChar('7a1e0004' + B);
  chars.INFO = mkChar('7a1e0005' + B, () => dvOf(enc(info())));
  chars.OTA = mkChar('7a1e0006' + B);
  let prevHz = 0, stTxt = '';
  setInterval(() => {
    if (!SIM.bt) return;
    chars.STAT.push(statFrame());
    const ch = Math.abs(SIM.hz - prevHz); prevHz = SIM.hz;
    const t = (SIM.out && SIM.hz > 20) ? (ch < 1.5 ? 'MATCH' : 'MEASURE') : (lastBig > 0 ? 'HOLD' : SIM.idle);
    if (t !== stTxt) { stTxt = t; chars.TEXT.push(dvOf(enc(t))); }
  }, 250);
  const byUuid = u => Object.values(chars).find(c => c.uuid === u);
  const dev = new EventTarget();
  dev.name = '파노체크-1DD625E0'; dev.id = 'fake-stick';
  dev.gatt = {
    connected: false,
    connect: async () => { await new Promise(r => setTimeout(r, 500)); dev.gatt.connected = true; SIM.bt = true; return dev.gatt; },
    disconnect: () => { dev.gatt.connected = false; SIM.bt = false; },
    getPrimaryService: async () => ({ getCharacteristic: async (u) => { const c = byUuid(u); if (!c) { const e = new Error('no'); e.name = 'NotFoundError'; throw e; } return c; } })
  };
  const bt = {
    getAvailability: async () => true,
    getDevices: async () => [],
    requestDevice: async () => {
      await picker(location.host + '에서 페어링을 요청합니다', [{ name: '파노체크-1DD625E0', icon: '📶' }], '페어링');
      return dev;
    }
  };
  Object.defineProperty(navigator, 'bluetooth', { value: bt, configurable: true });

  // ---------------- fake DPS-150 / DPS100
  let ctl = null;
  const st = { vin: 20.1, ovp: 30.5, ocp: 5.05, prot: 0 };
  const frame = (reg, data) => { const f = [0xF0, 0xA1, reg, data.length, ...data]; let s = reg + data.length; for (const x of data) s += x; f.push(s & 255); return new Uint8Array(f); };
  const f32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); return Array.from(b); };
  const live = () => {
    const v = SIM.out ? SIM.vset : 0;
    const spin = SIM.hz / Math.max(1, 166 * SIM.kf * Math.max(v, 0.1));
    let i = SIM.out ? (v * 0.48 - 0.24) * (spin > 0.9 ? 1 : 1.8) : 0;
    if (SIM.out) i = Math.max(0.05, i) * SIM.ifac * (1 + rnd(SIM.inoise));
    i = Math.min(i, SIM.iset);
    const cc = SIM.out && i >= SIM.iset - 0.001;
    return { v: SIM.out ? v * (1 + rnd(0.001)) : 0, i, p: v * i, cc };
  };
  const send = (u8) => { if (ctl) try { ctl.enqueue(u8); } catch (e) {} };
  function all() {
    const d = new Uint8Array(112), dv = new DataView(d.buffer), L = live();
    dv.setFloat32(0, st.vin, true); dv.setFloat32(4, SIM.vset, true); dv.setFloat32(8, SIM.iset, true);
    dv.setFloat32(12, L.v, true); dv.setFloat32(16, L.i, true); dv.setFloat32(20, L.p, true); dv.setFloat32(24, 31.5, true);
    dv.setFloat32(76, st.ovp, true); dv.setFloat32(80, st.ocp, true);
    d[107] = SIM.out ? 1 : 0; d[108] = st.prot; d[109] = L.cc ? 0 : 1;
    return frame(255, Array.from(d));
  }
  setInterval(() => { if (ctl && SIM.out) { const L = live(); send(frame(195, [...f32(L.v), ...f32(L.i), ...f32(L.p)])); } }, 300);
  function onWrite(a) {
    const cmd = a[1], reg = a[2], data = a.slice(4, 4 + a[3]);
    const fv = () => new DataView(new Uint8Array(data).buffer).getFloat32(0, true);
    if (cmd === 0xA1) {
      if (reg === 222) send(frame(222, Array.from(enc(SIM.model))));
      else if (reg === 255) send(all());
    } else if (cmd === 0xB1) {
      if (reg === 193) SIM.vset = fv();
      else if (reg === 194) SIM.iset = fv();
      else if (reg === 209) st.ovp = fv();
      else if (reg === 210) st.ocp = fv();
      else if (reg === 219) { SIM.out = data[0] === 1; send(frame(219, [data[0]])); }
    }
  }
  function mkPort(vid) {
    return {
      getInfo: () => ({ usbVendorId: vid, usbProductId: 0x5740 }),
      readable: null, writable: null,
      async open() {
        this.readable = new ReadableStream({ start(c) { ctl = c; } });
        this.writable = new WritableStream({ write(ch) { onWrite(Array.from(ch)); } });
      },
      async close() { try { ctl && ctl.close(); } catch (e) {} ctl = null; this.readable = null; SIM.out = false; }
    };
  }
  const ser = new EventTarget();
  ser.getPorts = async () => [];
  ser.requestPort = async (o) => {
    const filtered = !!(o && o.filters && o.filters.length);
    let items;
    if (SIM.model === 'DPS100') items = filtered ? [] : [{ name: 'USB 직렬 장치 (COM4)', vid: 0x1a87 }, { name: 'Bluetooth 직렬 포트 (COM6)', vid: 0 }];
    else items = [{ name: 'DPS-150 (COM3)', vid: 0x2e3c }];
    const it = await picker(location.host + '에서 직렬 포트에 연결하려고 합니다', items.map(x => Object.assign({ icon: '🔌' }, x)), '연결');
    return mkPort(it.vid);
  };
  Object.defineProperty(navigator, 'serial', { value: ser, configurable: true });
})();
