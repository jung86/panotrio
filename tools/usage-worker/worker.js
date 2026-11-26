// 파노체크 사용 현황 기록 서버 (Cloudflare Worker + D1)
//   POST /p          앱이 보내는 작은 기록 {id, hw, app, fw, plat, k:'open'|'meas', n}
//   POST /e          오류 보고 {k:'auto'|'user', id, hw, app, fw, plat, msg, detail, memo}  (자동은 같은 오류를 하루 한 줄로 묶고 횟수만 셈)
//   GET  /api/errors 오류 목록 · POST /api/errors/done {id, done} · POST /api/errors/delete {id}
//   GET  /admin      관리자 화면 (비밀번호 입력)
//   GET  /api/sticks 스틱별 현황 (Authorization: Bearer <ADMIN_TOKEN>)
//   POST /api/note   스틱 메모 {id, note}  (같은 인증)
//   (/api/는 앱 주소 jung86.github.io에서도 비밀번호와 함께 읽을 수 있음: 앱 「허락한 사람」 목록에 버전 표시)
//   POST /api/people 앱의 「허락한 사람」 목록 통째로 바꾸기 {people:[[id, 이름, 상태, 만든 시각], ...]}  (같은 인증)
// 개인 정보는 받지 않음: 스틱 ID, 앱·펌웨어 버전, 스틱 종류, 폰 종류(안드로이드/아이폰/PC)만.
// ADMIN_TOKEN은 코드에 없음: `npx wrangler secret put ADMIN_TOKEN`으로 넣음.
// 텔레그램 알림(선택): `npx wrangler secret put TG_TOKEN`(BotFather가 준 봇 토큰). 봇에게 아무 말이나 보낸 뒤 관리 화면 [텔레그램 연결]을 누르면
//   대화 번호를 찾아 kv 표에 저장(POST /api/tg/link), 새 오류 줄이 생길 때마다 그 대화로 알림. GET /api/tg 상태, POST /api/tg/test 시험.

const ORIGINS = ['https://jung86.github.io', 'http://localhost', 'http://127.0.0.1'];
const clip = (v, n) => String(v == null ? '' : v).replace(/[^\w.\-+ ]/g, '').slice(0, n);
const kstDay = t => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return ORIGINS.some(a => o === a || o.startsWith(a + ':')) ? { 'Access-Control-Allow-Origin': o, 'Vary': 'Origin' } : {};
}
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}
// The maker's phone signs in without a password: the app there holds the activation signing key (never leaves the phone)
// and signs "PanoCheck|usage|v1|<expiry ms>". Only the public half is here. Expiry at most 13 h ahead.
const OWNER_PUB = { kty: 'EC', crv: 'P-256', x: 'B-MuKw43LQL2NyuufJfEKH_V0w-LkACSFlJPqlxgp9Y', y: '-pZN7IeNwOK9mTi3DDk4lTnkjqO-Zt0AaEK5YeL95rE' };
let ownerKey = null;
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function sigOk(v) {
  const m = /^(\d{13})\.([A-Za-z0-9_-]{80,90})$/.exec(v); if (!m) return false;
  const exp = +m[1], now = Date.now();
  if (exp < now || exp > now + 13 * 3600e3) return false;
  try {
    ownerKey = ownerKey || await crypto.subtle.importKey('jwk', OWNER_PUB, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, ownerKey, b64u(m[2]), new TextEncoder().encode('PanoCheck|usage|v1|' + exp));
  } catch (e) { return false; }
}
async function authed(req, env) {
  const h = req.headers.get('Authorization') || '';
  if (/^Sig\s+/i.test(h)) return sigOk(h.replace(/^Sig\s+/i, ''));
  const want = env.ADMIN_TOKEN || '';
  const got = h.replace(/^Bearer\s+/i, '');
  if (want.length < 8 || got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}

async function ping(req, env) {
  const h = cors(req);
  if (!h['Access-Control-Allow-Origin'] && req.headers.get('Origin')) return new Response('', { status: 403 });
  let b; try { b = JSON.parse(await req.text()); } catch (e) { return new Response('', { status: 400, headers: h }); }
  let id = clip(b.id, 16).toUpperCase();
  if (!/^[0-9A-F]{8,16}$/.test(id)) id = 'NOSTICK';
  const k = b.k === 'meas' ? 'meas' : 'open';
  const n = Math.max(1, Math.min(50, +b.n || 1));
  const now = Date.now(), day = kstDay(now);
  const hw = clip(b.hw, 8), app = clip(b.app, 24), fw = clip(b.fw, 12), plat = clip(b.plat, 8);
  const o = k === 'open' ? n : 0, m = k === 'meas' ? n : 0;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sticks (id, hw, app, fw, plat, first_seen, last_seen, opens, meas) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8)
      ON CONFLICT(id) DO UPDATE SET hw = COALESCE(NULLIF(?2, ''), hw), app = COALESCE(NULLIF(?3, ''), app), fw = COALESCE(NULLIF(?4, ''), fw),
        plat = COALESCE(NULLIF(?5, ''), plat), last_seen = ?6, opens = opens + ?7, meas = meas + ?8`).bind(id, hw, app, fw, plat, now, o, m),
    env.DB.prepare(`INSERT INTO daily (id, day, opens, meas) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(id, day) DO UPDATE SET opens = opens + ?3, meas = meas + ?4`).bind(id, day, o, m),
  ]);
  return new Response(null, { status: 204, headers: h });
}

let errorsReady = false;
async function errorsTable(env) {
  if (errorsReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS errors (n INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, first INTEGER, stick TEXT, hw TEXT, app TEXT, fw TEXT, plat TEXT,
    k TEXT, msg TEXT, detail TEXT, memo TEXT, cnt INTEGER DEFAULT 1, done INTEGER DEFAULT 0)`).run();
  errorsReady = true;
}
let kvReady = false;
async function kvGet(env, k) {
  if (!kvReady) { await env.DB.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)').run(); kvReady = true; }
  const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?1').bind(k).first(); return r ? r.v : '';
}
async function kvSet(env, k, v) { await kvGet(env, k); await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?1, ?2)').bind(k, String(v)).run(); }
async function tg(env, method, body) {
  const r = await fetch('https://api.telegram.org/bot' + env.TG_TOKEN + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json().catch(() => ({ ok: false }));
}
async function tgSend(env, text) {
  if (!env.TG_TOKEN) return false;
  const chat = env.TG_CHAT || await kvGet(env, 'tg_chat'); if (!chat) return false;
  const r = await tg(env, 'sendMessage', { chat_id: chat, text: text.slice(0, 3500), disable_web_page_preview: true });
  return !!r.ok;
}
async function tgError(env, req, e) {               // one message per new error line; at most 20 an hour so a broken release cannot flood the phone
  try {
    if (!env.TG_TOKEN) return;
    const hr = await env.DB.prepare('SELECT COUNT(*) AS c FROM errors WHERE first > ?1').bind(Date.now() - 3600e3).first();
    if (hr && hr.c > 21) return;
    await peopleTable(env);
    const p = e.stick === 'NOSTICK' ? null : await env.DB.prepare('SELECT name FROM people WHERE id = ?1').bind(e.stick).first();
    const who = (p && p.name ? p.name + ' ' : '') + (e.stick === 'NOSTICK' ? '(스틱 없음)' : '(' + e.stick.slice(0, 4) + '-' + e.stick.slice(4) + ')');
    const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/');
    let m = '[파노체크 오류] ' + (e.k === 'user' ? '사용자가 보냄' : '자동 보고') + '\n' + who + ' · ' + t + '\n' + e.msg +
      (e.memo && e.memo !== e.msg ? '\n메모: ' + e.memo : '') + '\n앱 ' + (e.app || '-') + ' · 펌웨어 ' + (e.fw || '-') + ' · ' + (e.plat || '-') +
      '\n' + new URL(req.url).origin + '/admin';
    if (hr && hr.c === 21) m = '[파노체크] 1시간에 오류가 20개 넘게 들어와서 알림을 잠시 멈춥니다. 관리 화면에서 확인해 주세요.\n' + new URL(req.url).origin + '/admin';
    await tgSend(env, m);
  } catch (x) {}
}
async function tgLink(env) {                         // find the chat of whoever last wrote to the bot, keep it, say hello there
  if (!env.TG_TOKEN) return json({ error: 'token' });
  const u = await tg(env, 'getUpdates', { limit: 50 });
  if (!u.ok) return json({ error: 'badtoken' });
  const ms = (u.result || []).map(x => x.message || x.edited_message || x.channel_post).filter(Boolean);
  const m = ms[ms.length - 1]; if (!m) return json({ error: 'nomsg' });
  await kvSet(env, 'tg_chat', m.chat.id);
  const ok = await tgSend(env, '파노체크 오류 알림이 연결됐어요. 앞으로 새 오류가 들어오면 여기로 알려 드릴게요.');
  return json({ ok, name: m.chat.first_name || m.chat.title || '' });
}
async function tgState(env) { return { token: !!env.TG_TOKEN, chat: !!(env.TG_CHAT || (env.TG_TOKEN && await kvGet(env, 'tg_chat'))) }; }
const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
async function errReport(req, env, ctx) {
  const h = cors(req);
  if (!h['Access-Control-Allow-Origin'] && req.headers.get('Origin')) return new Response('', { status: 403 });
  const raw = await req.text(); if (raw.length > 40000) return new Response('', { status: 413, headers: h });
  let b; try { b = JSON.parse(raw); } catch (e) { return new Response('', { status: 400, headers: h }); }
  await errorsTable(env);
  let id = clip(b.id, 16).toUpperCase(); if (!/^[0-9A-F]{8,16}$/.test(id)) id = 'NOSTICK';
  const k = b.k === 'user' ? 'user' : 'auto', now = Date.now(), msg = txt(b.msg, 300) || '(내용 없음)';
  const day = await env.DB.prepare('SELECT COUNT(*) AS c FROM errors WHERE stick = ?1 AND t > ?2').bind(id, now - 864e5).first();
  if (day && day.c >= (k === 'user' ? 40 : 60)) return new Response('', { status: 429, headers: h });   // one phone cannot flood it
  const app = clip(b.app, 24), vals = [now, id, clip(b.hw, 8), app, clip(b.fw, 12), clip(b.plat, 8), k, msg, txt(b.detail, 12000), txt(b.memo, 500)];
  if (k === 'auto') {                                // same error again within a day: count it on the same line
    const same = await env.DB.prepare('SELECT n FROM errors WHERE k = \'auto\' AND stick = ?1 AND msg = ?2 AND app = ?3 AND t > ?4 ORDER BY n DESC LIMIT 1').bind(id, msg, app, now - 864e5).first();
    if (same) { await env.DB.prepare('UPDATE errors SET cnt = cnt + 1, t = ?2, done = 0 WHERE n = ?1').bind(same.n, now).run(); return new Response(null, { status: 204, headers: h }); }
  }
  await env.DB.prepare('INSERT INTO errors (t, first, stick, hw, app, fw, plat, k, msg, detail, memo) VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)').bind(...vals).run();
  const note = tgError(env, req, { stick: id, k, msg, memo: vals[9], app, fw: vals[4], plat: vals[5] });
  if (ctx && ctx.waitUntil) ctx.waitUntil(note); else await note;
  return new Response(null, { status: 204, headers: h });
}
async function errList(env) {
  await errorsTable(env); await peopleTable(env);
  const r = await env.DB.prepare('SELECT e.*, p.name AS name FROM errors e LEFT JOIN people p ON p.id = e.stick ORDER BY e.t DESC LIMIT 200').all();
  return json({ now: Date.now(), errors: r.results || [], tg: await tgState(env) });
}
let peopleReady = false;
async function peopleTable(env) {                    // made on first use, so no separate migration step
  if (peopleReady) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT, st TEXT, made INTEGER, synced INTEGER)').run();
  peopleReady = true;
}
async function setPeople(req, env) {
  const b = await req.json(), list = Array.isArray(b.people) ? b.people.slice(0, 500) : null;
  if (!list) return json({ error: 'people' }, 400);
  await peopleTable(env);
  const now = Date.now(), rows = [];
  for (const e of list) {
    if (!Array.isArray(e)) continue;
    const id = clip(e[0], 16).toUpperCase(); if (!/^[0-9A-F]{8,16}$/.test(id)) continue;
    rows.push(env.DB.prepare('INSERT OR REPLACE INTO people (id, name, st, made, synced) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(id, String(e[1] || '').replace(/[<>]/g, '').slice(0, 30), clip(e[2], 4), +e[3] || 0, now));
  }
  await env.DB.batch([env.DB.prepare('DELETE FROM people'), ...rows]);   // the app's list is the truth: removed people go away
  return json({ ok: true, n: rows.length });
}
async function sticks(env) {
  const now = Date.now();
  const d7 = kstDay(now - 6 * 864e5), d30 = kstDay(now - 29 * 864e5);
  const r = await env.DB.prepare(`SELECT s.*,
      (SELECT COALESCE(SUM(meas), 0) FROM daily d WHERE d.id = s.id AND d.day >= ?1) AS meas7,
      (SELECT COUNT(*) FROM daily d WHERE d.id = s.id AND d.day >= ?2) AS days30
    FROM sticks s ORDER BY last_seen DESC`).bind(d7, d30).all();
  await peopleTable(env);
  const pp = await env.DB.prepare('SELECT * FROM people').all();
  return json({ now, sticks: r.results || [], people: pp.results || [] });
}

async function route(req, env, ctx) {
    const url = new URL(req.url), p = url.pathname;
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors(req), 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' } });
      if (p === '/p' && req.method === 'POST') return await ping(req, env);
      if (p === '/e' && req.method === 'POST') return await errReport(req, env, ctx);
      if (p === '/admin' || p === '/') return new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } });
      if (p.startsWith('/api/')) {
        if (!(await authed(req, env))) return json({ error: 'auth' }, 401);
        if (p === '/api/sticks' && req.method === 'GET') return await sticks(env);
        if (p === '/api/people' && req.method === 'POST') return await setPeople(req, env);
        if (p === '/api/errors' && req.method === 'GET') return await errList(env);
        if (p === '/api/tg' && req.method === 'GET') return json(await tgState(env));
        if (p === '/api/tg/link' && req.method === 'POST') return await tgLink(env);
        if (p === '/api/tg/test' && req.method === 'POST') return json({ ok: await tgSend(env, '[파노체크] 시험 알림이에요. 잘 왔으면 준비 끝!') });
        if (p === '/api/errors/done' && req.method === 'POST') { const b = await req.json(); await errorsTable(env); await env.DB.prepare('UPDATE errors SET done = ?2 WHERE n = ?1').bind(+b.id || 0, b.done ? 1 : 0).run(); return json({ ok: true }); }
        if (p === '/api/errors/delete' && req.method === 'POST') { const b = await req.json(); await errorsTable(env); await env.DB.prepare('DELETE FROM errors WHERE n = ?1').bind(+b.id || 0).run(); return json({ ok: true }); }
        if (p === '/api/note' && req.method === 'POST') {
          const b = await req.json();
          const note = String(b.note || '').replace(/[<>]/g, '').slice(0, 60);
          await env.DB.prepare('UPDATE sticks SET note = ?2 WHERE id = ?1').bind(clip(b.id, 16), note).run();
          return json({ ok: true });
        }
        if (p === '/api/delete' && req.method === 'POST') {
          const b = await req.json(), id = clip(b.id, 16);
          await env.DB.batch([env.DB.prepare('DELETE FROM sticks WHERE id = ?1').bind(id), env.DB.prepare('DELETE FROM daily WHERE id = ?1').bind(id)]);
          return json({ ok: true });
        }
      }
      return new Response('Not found', { status: 404 });
    } catch (e) {
      return new Response('', { status: 500, headers: cors(req) });
    }
}
export default {
  async fetch(req, env, ctx) {                            // the app's admin screen (jung86.github.io) may read /api/ too, with the password
    const res = await route(req, env, ctx), h = cors(req);
    if (!h['Access-Control-Allow-Origin'] || !new URL(req.url).pathname.startsWith('/api/')) return res;
    const r = new Response(res.body, res);
    for (const k in h) r.headers.set(k, h[k]);
    return r;
  },
};

const ADMIN_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>파노체크 사용 현황</title>
<style>
:root{--bg:#0b0b0c;--card:#141415;--line:#2a2a2e;--fg:#f1f1f1;--mute:#8d8d93;--acc:#f76707;--bad:#ff6b6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,"Malgun Gothic",sans-serif;word-break:keep-all}
main{max-width:1100px;margin:0 auto;padding:16px}h1{font-size:20px;margin:4px 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:14px;margin-bottom:12px}
input,button{font:inherit;border-radius:4px;border:1px solid var(--line);background:#1b1b1d;color:var(--fg);padding:9px 11px}
button{cursor:pointer}button.pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:700}
.sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.sum b{display:block;font-size:24px}
.mute{color:var(--mute);font-size:13px}
.row{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr);gap:4px 10px;padding:11px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}.nm{font-weight:700;font-size:16px}.id{font-family:ui-monospace,Consolas,monospace;font-size:13px;color:var(--mute)}
.tag{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:3px;padding:0 5px;margin-left:6px;color:var(--mute);font-weight:400;vertical-align:2px}
.tag.no{border-color:var(--bad);color:var(--bad)}
.old{color:var(--acc)}.on{color:#69db7c}.none{color:var(--mute)}
.note{border:0;background:transparent;padding:2px 0;width:100%;color:var(--fg);border-bottom:1px dashed var(--line);border-radius:0;font-weight:700}
.del{padding:2px 8px;font-size:12px;margin-top:4px}
.err{padding:10px 0;border-bottom:1px solid var(--line)}.err:last-child{border-bottom:0}.err.done{opacity:.5}
.err .em{font-weight:700;margin:3px 0;word-break:break-all}.err pre{white-space:pre-wrap;word-break:break-all;font:12px/1.4 ui-monospace,Consolas,monospace;background:#0e0e10;border:1px solid var(--line);border-radius:4px;padding:8px;max-height:320px;overflow:auto;display:none}
.err .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.err .acts button{padding:4px 10px;font-size:13px}
#msg{margin-bottom:10px}
</style></head><body><main>
<h1>파노체크 사용 현황</h1>
<div class="card" id="login"><div style="margin-bottom:8px">관리자 비밀번호</div>
<form id="f" style="display:flex;gap:8px"><input id="tk" type="password" autocomplete="current-password" style="flex:1;min-width:0"><button class="pri">보기</button></form>
<div id="err" class="mute" style="margin-top:8px"></div></div>
<div id="view" style="display:none">
<div class="mute" id="msg"></div>
<div class="card sum" id="sum"></div>
<div class="card"><div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap"><div style="flex:1;min-width:160px" class="mute" id="latest"></div><button id="re">새로 고침</button><button id="out">잠그기</button></div>
<div id="list"></div>
<div class="mute" style="margin-top:10px">이름은 앱의 「허락한 사람」 목록에서 옵니다(앱 관리자 화면의 [사용 현황 보기]로 열면 맞춰짐). 주황 글씨는 최신이 아닌 버전입니다. 목록에 없는 스틱은 이름 칸에 직접 메모할 수 있습니다.</div></div>
<div class="card" id="errCard"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><b style="flex:1">오류 <span class="mute" id="errCount"></span></b><label class="mute"><input type="checkbox" id="errAll" style="vertical-align:-2px"> 해결한 것도 보기</label></div>
<div id="errList"></div>
<div class="mute" style="margin-top:8px">[복사]를 누르면 오류 내용이 통째로 복사됩니다. Claude에게 붙여 넣으면 고칠 수 있습니다.</div>
<div id="tgBox" style="margin-top:10px;padding-top:10px;border-top:1px solid #2a2a2e"><b>텔레그램 알림</b> <span class="mute" id="tgSt"></span><div class="acts" style="margin-top:6px"><button id="tgLink">텔레그램 연결</button><button id="tgTest">시험 알림</button></div><div class="mute" id="tgMsg"></div></div></div>
</div></main>
<script>
const $=id=>document.getElementById(id);let tk='';try{tk=localStorage.getItem('pc-admin')||''}catch(e){}
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function ago(t,now){const m=Math.floor((now-t)/60000);if(m<1)return'방금';if(m<60)return m+'분 전';const h=Math.floor(m/60);if(h<24)return h+'시간 전';return Math.floor(h/24)+'일 전'}
function dt(t){const d=new Date(t);return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
const fid=id=>id.slice(0,4)+'-'+id.slice(4);
async function api(p,body){const r=await fetch(p,{method:body?'POST':'GET',headers:Object.assign({Authorization:/^Sig /.test(tk)?tk:'Bearer '+tk},body?{'Content-Type':'application/json'}:{}),body:body?JSON.stringify(body):undefined});if(r.status===401)throw new Error('auth');if(!r.ok)throw new Error('서버 오류 '+r.status);return r.json()}
let pending=null;
function readHash(){try{const q=new URLSearchParams(location.hash.slice(1)),sg=q.get('s');if(sg&&/^\\d{13}\\.[A-Za-z0-9_-]+$/.test(sg))tk='Sig '+sg;const pv=q.get('p');const m=pv&&/^[A-Za-z0-9_-]+$/.test(pv)?[0,pv]:null;if(m){let b=m[1].replace(/-/g,'+').replace(/_/g,'/');while(b.length%4)b+='=';pending=JSON.parse(decodeURIComponent(escape(atob(b))))}}catch(e){pending=null}}
readHash();if(/^Sig /.test(tk))history.replaceState(null,'',location.pathname);addEventListener('hashchange',()=>{readHash();if(/^Sig /.test(tk))history.replaceState(null,'',location.pathname);if(tk)load()});
let latest={};
async function loadLatest(){for(const [k,u] of [['app','https://jung86.github.io/panotrio/app.html'],['s3','https://jung86.github.io/panotrio/fw/latest.json'],['p2','https://jung86.github.io/panotrio/fw/latest-plus2.json']]){try{const r=await fetch(u,{cache:'no-store'});if(!r.ok)continue;const t=await r.text();if(k==='app'){const m=/const APP_BUILD = '([^']+)'/.exec(t);if(m)latest.app=m[1]}else latest[k]=JSON.parse(t).ver}catch(e){}}}
async function load(){
  let d;
  try{
    if(pending){const r=await api('/api/people',{people:pending});pending=null;history.replaceState(null,'',location.pathname);$('msg').textContent='앱의 허락 목록 '+r.n+'명을 맞췄습니다';}
    d=await api('/api/sticks');
  }catch(e){if(e.message==='auth'){$('err').textContent=/^Sig /.test(tk)?'열쇠 확인 시간이 지났습니다. 앱에서 다시 열거나 비밀번호를 넣어 주세요':'비밀번호가 맞지 않습니다';tk='';show(false);try{localStorage.removeItem('pc-admin')}catch(_){};return}$('err').textContent=e.message;show(false);return}
  show(true);const now=d.now,S=d.sticks,P={};(d.people||[]).forEach(p=>P[p.id]=p);
  const byId={};S.forEach(s=>byId[s.id]=s);
  const rows=S.filter(s=>s.id!=='NOSTICK').map(s=>({s,p:P[s.id]}));
  Object.keys(P).forEach(id=>{if(!byId[id])rows.push({s:null,p:P[id]})});
  rows.sort((a,b)=>(b.s?b.s.last_seen:0)-(a.s?a.s.last_seen:0)||((b.p&&b.p.made)||0)-((a.p&&a.p.made)||0));
  if(byId.NOSTICK)rows.push({s:byId.NOSTICK,p:null});
  const listed=Object.keys(P).filter(id=>P[id].st!=='no'),used7=listed.filter(id=>byId[id]&&now-byId[id].last_seen<7*864e5).length;
  const never=listed.filter(id=>!byId[id]).length,act1=S.filter(s=>s.id!=='NOSTICK'&&now-s.last_seen<864e5).length;
  $('sum').innerHTML=(listed.length?'<div><span class="mute">허락한 사람</span><b>'+listed.length+'</b></div><div><span class="mute">7일 안에 쓴 사람</span><b>'+used7+'</b></div><div><span class="mute">한 번도 안 쓴 사람</span><b>'+never+'</b></div>':'<div><span class="mute">기록된 스틱</span><b>'+S.filter(s=>s.id!=='NOSTICK').length+'</b></div>')+'<div><span class="mute">오늘(24시간) 쓴 스틱</span><b>'+act1+'</b></div><div><span class="mute">7일 측정 합계</span><b>'+S.reduce((a,s)=>a+(s.meas7||0),0)+'</b></div>';
  $('latest').textContent='최신: 앱 '+(latest.app||'-')+' · 펌웨어 S3 '+(latest.s3||'-')+(latest.p2?' · Plus2 '+latest.p2:'');
  $('list').innerHTML=rows.map(({s,p})=>{
    const id=s?s.id:p.id;
    let name;
    if(id==='NOSTICK')name='<div class="nm">스틱 없음</div><div class="id">스틱 연결 없이 앱만 연 경우</div>';
    else if(p)name='<div class="nm">'+esc(p.name||'(이름 없음)')+(p.st==='no'?'<span class="tag no">취소됨</span>':'')+'</div><div class="id">'+fid(id)+(s?' · '+(s.hw==='P2'?'Plus2':'S3')+(s.plat?' · '+esc(s.plat):''):'')+'</div>';
    else name='<input class="note" data-id="'+esc(id)+'" value="'+esc(s.note)+'" placeholder="메모 (목록에 없음)"><div class="id">'+fid(id)+' · '+(s.hw==='P2'?'Plus2':'S3')+(s.plat?' · '+esc(s.plat):'')+'</div>';
    if(!s)return '<div class="row"><div>'+name+'</div><div class="none">사용 기록 없음</div><div></div></div>';
    const fwNew=s.hw==='P2'?latest.p2:latest.s3,appOld=latest.app&&s.app&&s.app<latest.app,fwOld=fwNew&&s.fw&&s.fw!==fwNew;
    return '<div class="row"><div>'+name+'</div>'+
      '<div><span class="'+(now-s.last_seen<864e5?'on':'')+'">'+ago(s.last_seen,now)+'</span><div class="mute">'+dt(s.last_seen)+'</div><div class="mute">측정 7일 '+(s.meas7||0)+' · 전체 '+s.meas+'</div></div>'+
      '<div><div class="'+(appOld?'old':'')+'">앱 '+esc(s.app||'-')+'</div><div class="'+(fwOld?'old':'')+'">펌웨어 '+esc(s.fw||'-')+'</div><div class="mute">30일 중 '+(s.days30||0)+'일 사용</div>'+(p?'':'<button class="del" data-del="'+esc(id)+'">기록 삭제</button>')+'</div></div>'}).join('')||'<div class="mute">아직 기록이 없습니다</div>';
  document.querySelectorAll('.note').forEach(i=>i.onchange=async()=>{try{await api('/api/note',{id:i.dataset.id,note:i.value});i.style.borderBottomColor='#69db7c'}catch(e){i.style.borderBottomColor='#ff6b6b'}});
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{if(!confirm(b.dataset.del+' 기록을 지울까요?'))return;await api('/api/delete',{id:b.dataset.del});load()});
  loadErrors();
}
let errs=[];
function errText(e){return '[파노체크 오류 #'+e.n+']\\n사람: '+(e.name||'-')+' ('+(e.stick==='NOSTICK'?'스틱 없음':fid(e.stick))+')\\n시각: '+new Date(e.first).toLocaleString('ko-KR')+(e.cnt>1?' ~ '+new Date(e.t).toLocaleString('ko-KR')+' ('+e.cnt+'회)':'')+'\\n앱 '+(e.app||'-')+' · 펌웨어 '+(e.fw||'-')+' · '+(e.hw==='P2'?'Plus2':'S3')+' · '+(e.plat||'-')+'\\n종류: '+(e.k==='user'?'사용자가 보냄':'자동 보고')+(e.memo?'\\n사용자 메모: '+e.memo:'')+'\\n내용: '+e.msg+(e.detail?'\\n\\n자세히:\\n'+e.detail:'')}
async function loadErrors(){
  let d;try{d=await api('/api/errors')}catch(e){$('errList').innerHTML='<div class="mute">오류 목록을 읽지 못했습니다</div>';return}
  tgShow(d.tg);errs=d.errors||[];const all=$('errAll').checked,open=errs.filter(e=>!e.done).length,shown=errs.filter(e=>all||!e.done);
  $('errCount').textContent=open?'· 안 본 것 '+open+'개':'· 새 오류 없음';
  $('errList').innerHTML=shown.map(e=>'<div class="err'+(e.done?' done':'')+'"><div class="mute">'+esc(e.name||(e.stick==='NOSTICK'?'스틱 없음':fid(e.stick)))+' · '+ago(e.t,d.now)+' · 앱 '+esc((e.app||'-').replace(/^\\d{4}-/,''))+' · 펌웨어 '+esc(e.fw||'-')+'<span class="tag'+(e.k==='user'?' no':'')+'">'+(e.k==='user'?'사용자':'자동')+'</span>'+(e.cnt>1?'<span class="tag">'+e.cnt+'회</span>':'')+'</div>'+
    '<div class="em">'+esc(e.msg)+'</div>'+(e.memo?'<div>메모: '+esc(e.memo)+'</div>':'')+'<pre id="ed'+e.n+'">'+esc(errText(e))+'</pre>'+
    '<div class="acts"><button data-ecopy="'+e.n+'" class="pri">복사</button><button data-emore="'+e.n+'">자세히</button><button data-edone="'+e.n+'">'+(e.done?'다시 열기':'해결')+'</button><button data-edel="'+e.n+'">삭제</button></div></div>').join('')||'<div class="mute">'+(errs.length?'해결 안 된 오류가 없습니다':'아직 오류 보고가 없습니다')+'</div>';
  const byN=n=>errs.find(e=>e.n==n);
  document.querySelectorAll('[data-ecopy]').forEach(b=>b.onclick=async()=>{const t=errText(byN(b.dataset.ecopy));try{await navigator.clipboard.writeText(t);b.textContent='복사됨'}catch(e){const p=$('ed'+b.dataset.ecopy);p.style.display='block';const r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);b.textContent='길게 눌러 복사'}});
  document.querySelectorAll('[data-emore]').forEach(b=>b.onclick=()=>{const p=$('ed'+b.dataset.emore);p.style.display=p.style.display==='block'?'none':'block'});
  document.querySelectorAll('[data-edone]').forEach(b=>b.onclick=async()=>{const e=byN(b.dataset.edone);await api('/api/errors/done',{id:e.n,done:!e.done});loadErrors()});
  document.querySelectorAll('[data-edel]').forEach(b=>b.onclick=async()=>{if(!confirm('이 오류를 지울까요?'))return;await api('/api/errors/delete',{id:+b.dataset.edel});loadErrors()});
}
function tgShow(t){t=t||{};$('tgSt').textContent=!t.token?'· 꺼짐 (서버에 봇 토큰 없음)':t.chat?'· 켜짐':'· 봇에게 아무 말이나 보낸 뒤 [텔레그램 연결]';$('tgLink').style.display=t.token?'':'none';$('tgTest').style.display=t.chat?'':'none'}
$('tgLink').onclick=async()=>{$('tgMsg').textContent='연결 중…';try{const r=await api('/api/tg/link',{});$('tgMsg').textContent=r.ok?'연결됐어요. 텔레그램에 인사 메시지가 왔는지 보세요.':r.error==='nomsg'?'봇에게 먼저 아무 말이나 보내고 다시 눌러 주세요':r.error==='badtoken'?'봇 토큰이 맞지 않아요':'연결하지 못했어요';loadErrors()}catch(e){$('tgMsg').textContent='연결하지 못했어요'}};
$('tgTest').onclick=async()=>{try{const r=await api('/api/tg/test',{});$('tgMsg').textContent=r.ok?'보냈어요':'보내지 못했어요'}catch(e){$('tgMsg').textContent='보내지 못했어요'}};
function show(on){$('login').style.display=on?'none':'';$('view').style.display=on?'':'none'}
$('f').onsubmit=e=>{e.preventDefault();tk=$('tk').value.trim();try{localStorage.setItem('pc-admin',tk)}catch(_){};$('err').textContent='';load()};
$('re').onclick=load;$('errAll').onchange=loadErrors;$('out').onclick=()=>{tk='';try{localStorage.removeItem('pc-admin')}catch(_){};show(false)};
if(pending&&!tk)$('err').textContent='비밀번호를 넣으면 앱의 허락 목록('+pending.length+'명)을 맞춥니다';
loadLatest().then(()=>{if(tk)load()});
</script></body></html>`;
