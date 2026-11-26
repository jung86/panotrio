// 파노체크 사용 현황 기록 서버 (Cloudflare Worker + D1)
//   POST /p          앱이 보내는 작은 기록 {id, hw, app, fw, plat, k:'open'|'meas', n}
//   GET  /admin      관리자 화면 (비밀번호 입력)
//   GET  /api/sticks 스틱별 현황 (Authorization: Bearer <ADMIN_TOKEN>)
//   POST /api/note   스틱 메모 {id, note}  (같은 인증)
// 개인 정보는 받지 않음: 스틱 ID, 앱·펌웨어 버전, 스틱 종류, 폰 종류(안드로이드/아이폰/PC)만.
// ADMIN_TOKEN은 코드에 없음: `npx wrangler secret put ADMIN_TOKEN`으로 넣음.

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
function authed(req, env) {
  const want = env.ADMIN_TOKEN || '';
  const got = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
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
  return new Response('', { status: 204, headers: h });
}

async function sticks(env) {
  const now = Date.now();
  const d7 = kstDay(now - 6 * 864e5), d30 = kstDay(now - 29 * 864e5);
  const r = await env.DB.prepare(`SELECT s.*,
      (SELECT COALESCE(SUM(meas), 0) FROM daily d WHERE d.id = s.id AND d.day >= ?1) AS meas7,
      (SELECT COUNT(*) FROM daily d WHERE d.id = s.id AND d.day >= ?2) AS days30
    FROM sticks s ORDER BY last_seen DESC`).bind(d7, d30).all();
  return json({ now, sticks: r.results || [] });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname;
    try {
      if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: { ...cors(req), 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
      if (p === '/p' && req.method === 'POST') return await ping(req, env);
      if (p === '/admin' || p === '/') return new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } });
      if (p.startsWith('/api/')) {
        if (!authed(req, env)) return json({ error: 'auth' }, 401);
        if (p === '/api/sticks' && req.method === 'GET') return await sticks(env);
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
.sum{display:flex;gap:10px;flex-wrap:wrap}.sum div{flex:1;min-width:120px}.sum b{display:block;font-size:24px}
.mute{color:var(--mute);font-size:13px}table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:600;white-space:nowrap}
td.id{font-family:ui-monospace,Consolas,monospace;white-space:nowrap}.old{color:var(--acc)}.on{color:#69db7c}
.note{border:0;background:transparent;padding:2px 0;width:100%;min-width:90px;color:var(--fg);border-bottom:1px dashed var(--line);border-radius:0}
.wrap{overflow-x:auto}
@media (max-width:700px){.hide-s{display:none}}
</style></head><body><main>
<h1>파노체크 사용 현황</h1>
<div class="card" id="login"><div style="margin-bottom:8px">관리자 비밀번호</div>
<form id="f" style="display:flex;gap:8px"><input id="tk" type="password" autocomplete="current-password" style="flex:1"><button class="pri">보기</button></form>
<div id="err" class="mute" style="margin-top:8px"></div></div>
<div id="view" style="display:none">
<div class="card sum" id="sum"></div>
<div class="card"><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><div style="flex:1" class="mute" id="latest"></div><button id="re">새로 고침</button><button id="out">잠그기</button></div>
<div class="wrap"><table><thead><tr><th>스틱</th><th>메모</th><th>마지막 사용</th><th>앱</th><th>펌웨어</th><th class="hide-s">측정<br>7일</th><th class="hide-s">사용한 날<br>30일</th><th>측정<br>전체</th><th class="hide-s">열기·연결</th><th class="hide-s">처음</th><th class="hide-s"></th></tr></thead><tbody id="tb"></tbody></table></div>
<div class="mute" style="margin-top:8px">메모 칸을 눌러 누구 스틱인지 적어 두면 저장됩니다. 주황 글씨는 최신이 아닌 버전입니다. "스틱 없음"은 스틱을 연결하지 않고 앱만 연 경우입니다.</div></div>
</div></main>
<script>
const $=id=>document.getElementById(id);let tk='';try{tk=localStorage.getItem('pc-admin')||''}catch(e){}
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function ago(t,now){const m=Math.floor((now-t)/60000);if(m<1)return'방금';if(m<60)return m+'분 전';const h=Math.floor(m/60);if(h<24)return h+'시간 전';const d=Math.floor(h/24);return d+'일 전'}
function dt(t){const d=new Date(t);return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
async function api(p,body){const r=await fetch(p,{method:body?'POST':'GET',headers:Object.assign({Authorization:'Bearer '+tk},body?{'Content-Type':'application/json'}:{}),body:body?JSON.stringify(body):undefined});if(r.status===401)throw new Error('auth');if(!r.ok)throw new Error('서버 오류 '+r.status);return r.json()}
let latest={};
async function loadLatest(){for(const [k,u] of [['app','https://jung86.github.io/panotrio/app.html'],['s3','https://jung86.github.io/panotrio/fw/latest.json'],['p2','https://jung86.github.io/panotrio/fw/latest-plus2.json']]){try{const r=await fetch(u,{cache:'no-store'});if(!r.ok)continue;const t=await r.text();if(k==='app'){const m=/const APP_BUILD = '([^']+)'/.exec(t);if(m)latest.app=m[1]}else latest[k]=JSON.parse(t).ver}catch(e){}}}
async function load(){
  let d;try{d=await api('/api/sticks')}catch(e){if(e.message==='auth'){$('err').textContent='비밀번호가 맞지 않습니다';show(false);try{localStorage.removeItem('pc-admin')}catch(_){};return}$('err').textContent=e.message;return}
  show(true);const now=d.now,S=d.sticks,real=S.filter(s=>s.id!=='NOSTICK');
  const act7=real.filter(s=>now-s.last_seen<7*864e5).length,act1=real.filter(s=>now-s.last_seen<864e5).length;
  $('sum').innerHTML='<div><span class="mute">등록된 스틱</span><b>'+real.length+'</b></div><div><span class="mute">오늘(24시간) 쓴 스틱</span><b>'+act1+'</b></div><div><span class="mute">7일 안에 쓴 스틱</span><b>'+act7+'</b></div><div><span class="mute">7일 측정 합계</span><b>'+S.reduce((a,s)=>a+(s.meas7||0),0)+'</b></div>';
  $('latest').textContent='최신: 앱 '+(latest.app||'-')+' · 펌웨어 S3 '+(latest.s3||'-')+(latest.p2?' · Plus2 '+latest.p2:'');
  $('tb').innerHTML=S.map(s=>{const fwNew=s.hw==='P2'?latest.p2:latest.s3;const appOld=latest.app&&s.app&&s.app<latest.app,fwOld=fwNew&&s.fw&&s.fw!==fwNew;
    const id=s.id==='NOSTICK'?'스틱 없음':s.id.slice(0,4)+'-'+s.id.slice(4);
    return '<tr><td class="id">'+esc(id)+'<div class="mute">'+(s.hw==='P2'?'Plus2':s.id==='NOSTICK'?'':'S3')+(s.plat?' · '+esc(s.plat):'')+'</div></td>'+
    '<td>'+(s.id==='NOSTICK'?'':'<input class="note" data-id="'+esc(s.id)+'" value="'+esc(s.note)+'" placeholder="메모">')+'</td>'+
    '<td class="'+(now-s.last_seen<864e5?'on':'')+'">'+ago(s.last_seen,now)+'<div class="mute">'+dt(s.last_seen)+'</div></td>'+
    '<td class="'+(appOld?'old':'')+'">'+esc(s.app||'-')+'</td><td class="'+(fwOld?'old':'')+'">'+esc(s.fw||'-')+'</td>'+
    '<td class="hide-s">'+(s.meas7||0)+'</td><td class="hide-s">'+(s.days30||0)+'</td><td>'+s.meas+'</td><td class="hide-s">'+s.opens+'</td><td class="hide-s mute">'+dt(s.first_seen)+'</td>'+
    '<td class="hide-s"><button data-del="'+esc(s.id)+'" style="padding:4px 8px;font-size:12px">삭제</button></td></tr>'}).join('');
  document.querySelectorAll('.note').forEach(i=>i.onchange=async()=>{try{await api('/api/note',{id:i.dataset.id,note:i.value});i.style.borderBottomColor='#69db7c'}catch(e){i.style.borderBottomColor='#ff6b6b'}});
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{if(!confirm(b.dataset.del+' 기록을 지울까요?'))return;await api('/api/delete',{id:b.dataset.del});load()});
}
function show(on){$('login').style.display=on?'none':'';$('view').style.display=on?'':'none'}
$('f').onsubmit=e=>{e.preventDefault();tk=$('tk').value.trim();try{localStorage.setItem('pc-admin',tk)}catch(_){};$('err').textContent='';load()};
$('re').onclick=load;$('out').onclick=()=>{tk='';try{localStorage.removeItem('pc-admin')}catch(_){};show(false)};
loadLatest().then(()=>{if(tk)load()});
</script></body></html>`;
