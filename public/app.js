'use strict';
/* ============================================================
   QQ 音乐统一网关 · 管理控制台（原生 ES2020，零框架 / 零打包 / 零外链）
   约定：
   - 管理接口 /admin/*  → 请求头 X-Admin-Token（用户粘贴，存 localStorage）
   - 业务接口 /api/v1/* → Authorization: Bearer <API Token>（仅生成示例）
   - 统一响应 {code:0,message,data} / {code:非0,message}
   ============================================================ */

const TOKEN_KEY = 'qmg_admin_token';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------------- 工具 ---------------- */
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, type = 'info', ms = 3200) {
  const box = $('#toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

async function copyText(text) {
  const t = String(text == null ? '' : text);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(t);
      toast('已复制到剪贴板', 'ok');
      return;
    }
  } catch (e) { /* 回退到 execCommand */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    ok ? toast('已复制到剪贴板', 'ok') : toast('复制失败，请手动复制', 'error');
  } catch (e) {
    toast('复制失败，请手动复制', 'error');
  }
}

function fmtTime(v) {
  if (v == null || v === '') return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtUptime(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    let s = Number(v);
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    const sec = s - m * 60;
    return `${d ? d + ' 天 ' : ''}${h ? h + ' 时 ' : ''}${m} 分 ${sec} 秒`;
  }
  return String(v);
}

function maskToken(t) {
  const s = String(t || '');
  if (!s) return '—';
  if (s.length <= 8) return s.slice(0, 2) + '…';
  return s.slice(0, 8) + '…';
}

function hostBase() { return location.protocol + '//' + location.host; }

/* 统一请求封装：自动附带 X-Admin-Token、解析统一响应、错误抛给 toast */
async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers);
  const tok = localStorage.getItem(TOKEN_KEY);
  if (tok) headers['X-Admin-Token'] = tok;

  const o = Object.assign({}, opts, { headers });
  if (o.body !== undefined && o.body !== null && typeof o.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(o.body);
  }

  let res;
  try {
    res = await fetch(path, o);
  } catch (e) {
    toast('网络错误：无法连接服务端（' + (e && e.message || e) + '）', 'error');
    throw new Error('network error');
  }

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    const inp = $('#tokenInput');
    if (inp) inp.value = '';
    setConnected(false);
    toast('管理令牌错误或已失效，已清除，请重新粘贴', 'error', 4000);
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }

  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) {
    try { data = await res.json(); } catch (e) { data = null; }
  }

  // 统一响应信封
  if (data && typeof data === 'object' && !Array.isArray(data) && 'code' in data) {
    if (!res.ok || data.code !== 0) {
      const msg = data.message || ('HTTP ' + res.status);
      toast(msg, 'error');
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data.data !== undefined ? data.data : data;
  }

  if (!res.ok) {
    const msg = 'HTTP ' + res.status + ' ' + res.statusText;
    toast(msg, 'error');
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------------- 全局状态 ---------------- */
const state = {
  connected: false,
  tab: 'overview',
  status: null,
  tokens: [],
  docs: null,
  docsOpen: false,
  docsEps: [],
  exampleCurl: '',
  qr: { identifier: null, timer: null, busy: false },
  cred: null,
  credShown: false
};

function setConnected(v) {
  state.connected = v;
  document.body.classList.toggle('connected', v);
  const dot = $('#connDot');
  if (dot) {
    dot.className = 'dot ' + (v ? 'on' : 'off');
    dot.title = v ? '已连接' : '未连接';
  }
  const dis = $('#disconnectBtn');
  if (dis) dis.classList.toggle('show', v);
  if (!v) stopQrPoll();
}

/* ---------------- 标签页 ---------------- */
function switchTab(name) {
  if (state.tab === name) return;
  if (state.tab === 'login') stopQrPoll();   // 离开登录页停止轮询
  state.tab = name;
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  loadTab(name);
}

function loadTab(name) {
  if (name === 'docs') { loadDocs(); return; }   // docs.json 公开，无需令牌
  if (!state.connected) return;
  if (name === 'overview') loadOverview();
  else if (name === 'tokens') loadTokens();
  else if (name === 'login') loadLogin();
}

/* ---------------- 连接管理 ---------------- */
async function connect(silent) {
  const v = ($('#tokenInput').value || '').trim();
  if (!v) {
    if (!silent) toast('请先粘贴管理令牌', 'error');
    return false;
  }
  localStorage.setItem(TOKEN_KEY, v);
  try {
    const st = await api('/admin/status');
    state.status = st || {};
    setConnected(true);
    renderStatus(state.status);
    if (!silent) toast('已连接管理接口', 'ok');
    loadTab(state.tab);
    return true;
  } catch (e) {
    if (e && e.status !== 401) setConnected(false);
    return false;
  }
}

function disconnect() {
  localStorage.removeItem(TOKEN_KEY);
  $('#tokenInput').value = '';
  setConnected(false);
  toast('已断开管理连接');
}

/* ---------------- 概览 ---------------- */
async function loadOverview() {
  const [a, b] = await Promise.allSettled([
    api('/admin/status'),
    api('/admin/stats')
  ]);
  if (a.status === 'fulfilled') {
    state.status = a.value || {};
    renderStatus(state.status);
  }
  if (b.status === 'fulfilled') renderStats(b.value || {});
}

function renderStatus(st) {
  st = st || {};
  $('#stVersion').textContent = st.version || '—';
  $('#stAuthMode').textContent = st.authMode || '—';
  $('#stUptime').textContent = fmtUptime(st.uptime);

  const total = st.tokenCount, en = st.enabledTokenCount;
  $('#stTokens').textContent = (total != null)
    ? `${total} 个（启用 ${en != null ? en : 0}）`
    : '—';

  $('#stLogin').innerHTML = st.loggedIn
    ? `已登录${st.musicid ? ' · <span class="mono">' + esc(st.musicid) + '</span>' : ''}`
    : '<span class="bad-text">未登录</span>';

  const up = st.upstreamV2 || st.upstream || null;
  const dot = $('#stUpDot');
  if (!up) {
    dot.className = 'dot off';
    $('#stUpHealth').textContent = '未配置';
  } else if (up.healthy) {
    dot.className = 'dot on';
    $('#stUpHealth').textContent = '健康';
  } else {
    dot.className = 'dot err';
    $('#stUpHealth').textContent = '异常';
  }
  $('#stUpUrl').textContent = (up && up.url) || '—';

  // 快速上手中的 AUTH_MODE 说明
  const note = $('#authModeNote');
  if (note) {
    if (st.authMode === 'open') {
      note.innerHTML = '当前 <b>AUTH_MODE = open</b>：业务接口<b>免鉴权</b>，<code>Authorization</code> 头可省略（携带也不会报错）。';
    } else if (st.authMode) {
      note.innerHTML = '当前 <b>AUTH_MODE = ' + esc(st.authMode) + '</b>：业务接口必须携带 <code>Authorization: Bearer &lt;API Token&gt;</code>。';
    } else {
      note.textContent = '未连接时无法读取当前鉴权模式，连接后自动显示。';
    }
  }
}

function renderStats(d) {
  const days = (d.days && typeof d.days === 'object') ? d.days : {};
  const dates = Object.keys(days).sort().reverse();
  $('#daysBody').innerHTML = dates.length
    ? dates.map(k => {
        const v = days[k];
        const total = typeof v === 'number' ? v : Number((v && v.total) || 0);
        return `<tr><td>${esc(k)}</td><td class="num">${total}</td></tr>`;
      }).join('')
    : '<tr class="empty"><td colspan="2">暂无统计数据</td></tr>';

  const toks = (Array.isArray(d.tokens) ? d.tokens : [])
    .slice()
    .sort((a, b) => Number(b.callCount || 0) - Number(a.callCount || 0))
    .slice(0, 10);
  const max = toks.length ? Number(toks[0].callCount || 0) : 0;
  $('#rankBody').innerHTML = toks.length
    ? toks.map((t, i) => {
        const c = Number(t.callCount || 0);
        const pct = max > 0 ? Math.round(c / max * 100) : 0;
        return `<tr>
          <td class="num">${i + 1}</td>
          <td>${esc(t.name || t.id || '—')}</td>
          <td class="num">${c}</td>
          <td class="bar-cell"><span class="bar"><i style="width:${pct}%"></i></span></td>
          <td>${fmtTime(t.lastUsedAt)}</td>
        </tr>`;
      }).join('')
    : '<tr class="empty"><td colspan="5">暂无统计数据</td></tr>';
}

/* ---------------- Token 管理 ---------------- */
async function loadTokens() {
  const d = await api('/admin/tokens');
  state.tokens = (d && Array.isArray(d.tokens))
    ? d.tokens
    : (Array.isArray(d) ? d : []);
  renderTokens();
}

function renderTokens() {
  const rows = state.tokens.map(t => {
    const id = esc(t.id);
    const enabled = t.enabled !== false;
    return `<tr data-id="${id}">
      <td class="name-cell" title="双击编辑名称"><span class="name-text">${esc(t.name || '未命名')}</span></td>
      <td><code>${esc(maskToken(t.token))}</code> <button class="btn mini" data-act="copy">复制</button></td>
      <td><input type="checkbox" class="switch" data-act="toggle" ${enabled ? 'checked' : ''} title="${enabled ? '已启用（点击禁用）' : '已禁用（点击启用）'}"></td>
      <td class="num">${Number(t.callCount || 0)}</td>
      <td>${fmtTime(t.lastUsedAt)}</td>
      <td>${fmtTime(t.createdAt)}</td>
      <td class="ops">
        <button class="btn mini ${enabled ? 'warn' : ''}" data-act="toggle">${enabled ? '禁用' : '启用'}</button>
        <button class="btn mini" data-act="example">使用示例</button>
        <button class="btn mini warn" data-act="rotate">重置令牌</button>
        <button class="btn mini danger" data-act="del">删除</button>
      </td>
    </tr>`;
  }).join('');
  $('#tokensBody').innerHTML = rows ||
    '<tr class="empty"><td colspan="7">暂无 Token，点上方「新建 Token」创建一个</td></tr>';
}

function pickToken(rec) {
  if (typeof rec === 'string') return rec;
  if (rec && typeof rec.token === 'string') return rec.token;
  if (rec && rec.token != null && typeof rec.token === 'object') {
    return rec.token.token ? String(rec.token.token) : JSON.stringify(rec.token, null, 2);
  }
  return rec ? JSON.stringify(rec, null, 2) : '';
}

function showTokenDialog(full) {
  $('#dlgTokenVal').textContent = full || '（服务端未返回令牌值，请刷新列表查看）';
  const dlg = $('#dlgToken');
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
}

async function createToken() {
  const name = ($('#newTokenName').value || '').trim();
  if (!name) { toast('请填写 Token 名称', 'error'); return; }
  try {
    const rec = await api('/admin/tokens', { method: 'POST', body: { name } });
    showTokenDialog(pickToken(rec));
    $('#newTokenName').value = '';
    toast('Token 已创建', 'ok');
    loadTokens().catch(() => {});
  } catch (e) { /* api 已 toast */ }
}

function openExample(t) {
  const full = String(t.token || '');
  const curl = `curl -H "Authorization: Bearer ${full}" ${hostBase()}/api/v1/song/lyric?mid=xxx`;
  state.exampleCurl = curl;
  $('#exampleTitle').textContent = (t.name || 'Token') + ' · 使用示例';
  $('#exampleCode').textContent = curl;
  const dlg = $('#dlgExample');
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
}

function bindTokenTable() {
  const body = $('#tokensBody');
  body.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    if (!tr || !tr.dataset.id) return;
    const id = tr.dataset.id;
    const t = state.tokens.find(x => String(x.id) === id);
    const act = btn.dataset.act;
    const enc = encodeURIComponent(id);
    try {
      if (act === 'copy') {
        if (t && t.token) await copyText(t.token);
        else toast('该 Token 无令牌值', 'error');
      } else if (act === 'toggle') {
        const en = !(t ? t.enabled !== false : true);
        await api('/admin/tokens/' + enc, { method: 'PATCH', body: { enabled: en } });
        toast(en ? '已启用' : '已禁用', 'ok');
        await loadTokens();
      } else if (act === 'rotate') {
        if (!confirm('重置该 Token 的令牌？旧令牌将立即失效，所有使用它的调用都会 401。')) return;
        const rec = await api('/admin/tokens/' + enc + '/rotate', { method: 'POST' });
        showTokenDialog(pickToken(rec));
        toast('令牌已重置', 'ok');
        loadTokens().catch(() => {});
      } else if (act === 'del') {
        if (!confirm('删除该 Token？此操作不可恢复。')) return;
        await api('/admin/tokens/' + enc, { method: 'DELETE' });
        toast('已删除', 'ok');
        await loadTokens();
      } else if (act === 'example') {
        if (t) openExample(t);
      }
    } catch (err) {
      if (act === 'toggle') loadTokens().catch(() => {}); // 失败时恢复开关显示
    }
  });

  body.addEventListener('dblclick', async e => {
    const cell = e.target.closest('.name-cell');
    if (!cell) return;
    const tr = cell.closest('tr');
    const id = tr.dataset.id;
    const t = state.tokens.find(x => String(x.id) === id);
    if (!t) return;
    const old = cell.innerHTML;
    cell.innerHTML = `<input class="inline-input" value="${esc(t.name || '')}" maxlength="64">`;
    const inp = cell.querySelector('input');
    inp.focus(); inp.select();
    let done = false;
    const finish = async save => {
      if (done) return;
      done = true;
      const v = (inp.value || '').trim();
      if (save && v && v !== t.name) {
        try {
          await api('/admin/tokens/' + encodeURIComponent(id), { method: 'PATCH', body: { name: v } });
          toast('名称已更新', 'ok');
          loadTokens().catch(() => {});
          return;
        } catch (err) {
          cell.innerHTML = old;
          return;
        }
      }
      cell.innerHTML = old;
    };
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') finish(true);
      else if (ev.key === 'Escape') finish(false);
    });
    inp.addEventListener('blur', () => finish(true));
  });
}

/* ---------------- 接口文档 ---------------- */
function hlMark(s) {
  return esc(s)
    .replace(/&lt;管理令牌&gt;/g, '<mark class="hl">&lt;管理令牌&gt;</mark>')
    .replace(/&lt;API Token&gt;/g, '<mark class="hl">&lt;API Token&gt;</mark>');
}

function buildCurl(ep) {
  ep = ep || {};
  if (typeof ep.example === 'string' && ep.example.trim()) return ep.example;
  const hdr = ep.auth === 'bearer' ? ' -H "Authorization: Bearer <API Token>"'
    : ep.auth === 'admin' ? ' -H "X-Admin-Token: <管理令牌>"'
    : '';
  return `curl -X ${String(ep.method || 'GET').toUpperCase()}${hdr} ${hostBase()}${ep.path || ''}`;
}

function authChip(a) {
  if (a === 'bearer') return '<span class="chip auth-bearer">Bearer API Token</span>';
  if (a === 'admin') return '<span class="chip auth-admin">管理令牌</span>';
  if (a === 'none') return '<span class="chip auth-none">公开</span>';
  return `<span class="chip">${esc(a || '—')}</span>`;
}

async function loadDocs(force) {
  if (state.docs && !force) { renderDocs(); return; }
  try {
    const d = await api('/docs.json');
    state.docs = (d && typeof d === 'object') ? d : {};
    renderDocs();
  } catch (e) {
    $('#docsContent').innerHTML = '<div class="card muted">文档加载失败，请检查服务端 /docs.json。</div>';
  }
}

function renderDocs() {
  const d = state.docs || {};
  $('#docsTitle').textContent = d.title || '接口文档';
  const groups = Array.isArray(d.groups) ? d.groups : [];
  state.docsEps = [];

  $('#docsNav').innerHTML =
    '<div class="side-title">分组导航</div>' +
    (groups.length
      ? groups.map((g, i) =>
          `<a class="docnav" href="#grp-${i}">${esc((g && (g.name || g.title)) || ('分组 ' + (i + 1)))}</a>`).join('')
      : '<div class="muted">暂无分组</div>');

  $('#docsContent').innerHTML = groups.length
    ? groups.map((g, i) => renderGroup(g, i)).join('')
    : '<div class="card muted">暂无接口数据</div>';
}

function renderGroup(g, i) {
  g = g || {};
  const eps = Array.isArray(g.endpoints) ? g.endpoints : [];
  const rows = eps.map(ep => {
    const idx = state.docsEps.push(Object.assign({}, ep, { curl: buildCurl(ep) })) - 1;
    const m = String((ep && ep.method) || 'GET').toUpperCase();
    const params = (ep && Array.isArray(ep.params)) ? ep.params : [];
    const paramRows = params.map(p =>
      `<tr><td><code>${esc(p.name)}</code></td><td>${p.req ? '<span class="chip req">必填</span>' : '<span class="chip opt">可选</span>'}</td><td>${esc(p.desc || '—')}</td></tr>`
    ).join('');
    const hasDetail = params.length || (ep && ep.example);
    const detail = hasDetail
      ? `<tr class="detail"><td colspan="4">
          ${params.length ? `<div class="ep-sub">参数</div><table class="mini"><thead><tr><th>名称</th><th>必填</th><th>说明</th></tr></thead><tbody>${paramRows}</tbody></table>` : ''}
          ${ep && ep.example ? `<div class="ep-sub">示例（点击复制）</div><pre class="code clickable" data-ep="${idx}" title="点击复制示例">${hlMark(ep.example)}</pre>` : ''}
        </td></tr>`
      : '';
    return `<tr class="ep">
      <td><span class="badge m-${esc(m)}">${esc(m)}</span></td>
      <td class="path"><code data-ep="${idx}" title="点击复制 curl">${esc(ep.path || '')}</code></td>
      <td>${esc(ep.desc || '')}</td>
      <td>${authChip(ep.auth)}</td>
    </tr>${detail}`;
  }).join('');

  const sub = (g.name && g.title) ? `<div class="muted">${esc(g.name)}</div>` : '';
  return `<section class="doc-group" id="grp-${i}">
    <h2>${esc(g.title || g.name || ('分组 ' + (i + 1)))}</h2>${sub}
    <div class="tablewrap"><table class="docs-table">
      <thead><tr><th>方法</th><th>路径</th><th>说明</th><th>鉴权</th></tr></thead>
      <tbody>${rows || '<tr class="empty"><td colspan="4">无接口</td></tr>'}</tbody>
    </table></div>
  </section>`;
}

/* ---------------- 登录管理 ---------------- */
async function loadLogin() {
  try {
    const d = await api('/admin/login/status');
    renderLogin(d || {});
  } catch (e) { /* 已 toast */ }
}

function renderLogin(d) {
  $('#lgState').innerHTML = d.loggedIn
    ? '<span class="chip ok">已登录</span>'
    : '<span class="chip bad">未登录</span>';
  $('#lgExpired').textContent = d.expired == null ? '—' : (d.expired ? '是（建议刷新凭证）' : '否');
  $('#lgMusicid').textContent = d.musicid != null && d.musicid !== '' ? d.musicid : '—';
  $('#lgFile').textContent = d.file || '—';
}

function qrSrc(d) {
  const data = String((d && d.data) || '');
  if (!data) return '';
  if (data.startsWith('data:')) return data;
  const mime = String((d && d.mime) || 'image/png').replace(/^data:/, '');
  return `data:${mime};base64,${data}`;
}

async function getQr() {
  try {
    const d = await api('/admin/login/qrcode', { method: 'POST', body: { type: 'qq' } });
    const id = d && d.identifier;
    if (!id) { toast('服务端未返回二维码标识', 'error'); return; }
    const img = $('#qrImg');
    const src = qrSrc(d);
    if (src) img.src = src; else toast('二维码数据为空', 'error');
    $('#qrId').textContent = id;
    $('#qrBox').classList.add('show');
    $('#qrState').textContent = '二维码已生成，请用手机 QQ 扫描';
    startQrPoll(id);
  } catch (e) { /* 已 toast */ }
}

function startQrPoll(id, quiet) {
  stopQrPoll();
  state.qr.identifier = id;
  if (!quiet) $('#qrState').textContent = '等待扫码…（每 2 秒检查一次）';
  state.qr.timer = setInterval(checkQr, 2000);
  checkQr();
}

function stopQrPoll() {
  if (state.qr.timer) clearInterval(state.qr.timer);
  state.qr.timer = null;
}

async function checkQr() {
  if (state.qr.busy || !state.qr.identifier) return;
  if (!state.connected || state.tab !== 'login') { stopQrPoll(); return; }
  state.qr.busy = true;
  try {
    const d = await api('/admin/login/checkQrcode', {
      method: 'POST',
      body: { identifier: state.qr.identifier, type: 'qq' }
    });
    const rawEv = (d && d.event != null) ? d.event : '';
    const ev = String(rawEv).toUpperCase();
    const map = {
      SCAN: '已扫描，待手机确认…',
      CONF: '已确认，等待登录完成…',
      DONE: '✅ 登录成功',
      REFUSE: '❌ 扫码被拒绝',
      TIMEOUT: '⌛ 二维码已超时，请重新获取',
      // 数字枚举兼容（vendor QrLoginEvent: DONE0 SCAN1 CONF2 REFUSE3 TIMEOUT4 OTHER-1）
      '0': '✅ 登录成功',
      '1': '已扫描，待手机确认…',
      '2': '已确认，等待登录完成…',
      '3': '❌ 扫码被拒绝',
      '4': '⌛ 二维码已超时，请重新获取',
      '-1': '状态：等待扫描…'
    };
    $('#qrState').textContent = map[ev] || ('状态：' + (rawEv !== '' ? rawEv : '未知'));
    const isDone = ev === 'DONE' || ev === '0';
    const isStop = ev === 'REFUSE' || ev === 'TIMEOUT' || ev === '3' || ev === '4';
    if (isDone) {
      stopQrPoll();
      toast('QQ 登录成功', 'ok');
      loadLogin();
    } else if (isStop) {
      stopQrPoll();
    }
  } catch (e) {
    if (!state.connected) stopQrPoll();   // 401 时已断开，停止轮询
  } finally {
    state.qr.busy = false;
  }
}

function rawCredStr() {
  const c = state.cred ? state.cred.credential : '';
  if (typeof c === 'string') return c;
  if (c == null) return '';
  try { return JSON.stringify(c, null, 2); } catch (e) { return String(c); }
}

function maskCred(c) {
  if (c != null && typeof c === 'object') {
    try {
      const o = {};
      Object.keys(c).forEach(k => { o[k] = '***'; });
      return JSON.stringify(o, null, 2);
    } catch (e) { return '***'; }
  }
  const s = String(c == null ? '' : c);
  if (s.length <= 14) return s ? '***' : '—';
  return s.slice(0, 8) + '…***…' + s.slice(-6);
}

function renderCred() {
  const shown = state.credShown;
  $('#credVal').textContent = shown ? (rawCredStr() || '—') : maskCred(state.cred ? state.cred.credential : '');
  $('#credToggle').textContent = shown ? '🙈 隐藏敏感值' : '👁 显示敏感值';
}

async function viewCred() {
  try {
    const d = await api('/admin/login/credential?raw=1');
    state.cred = d || {};
    state.credShown = false;
    $('#credPanel').classList.add('show');
    $('#credFile').textContent = (d && d.file) || '—';
    renderCred();
  } catch (e) { /* 已 toast */ }
}

/* ---------------- 事件绑定 / 初始化 ---------------- */
function bindEvents() {
  // 标签页
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('.tab');
    if (b && b.dataset.tab) switchTab(b.dataset.tab);
  });

  // 管理令牌
  $('#connectBtn').addEventListener('click', () => connect(false));
  $('#disconnectBtn').addEventListener('click', disconnect);
  $('#tokenInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); connect(false); }
  });

  // 概览
  $('#refreshOverview').addEventListener('click', () => loadOverview());

  // Token 管理
  $('#createTokenBtn').addEventListener('click', createToken);
  $('#newTokenName').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); createToken(); }
  });
  bindTokenTable();

  // 文档
  $('#docsOpenBtn').addEventListener('click', () => {
    state.docsOpen = true;
    $('#view-docs').classList.add('docs-open');
    loadDocs();
  });
  $('#docsRefreshBtn').addEventListener('click', () => loadDocs(true));
  $('#docsContent').addEventListener('click', e => {
    const el = e.target.closest('[data-ep]');
    if (!el) return;
    const ep = state.docsEps[Number(el.dataset.ep)];
    if (ep && ep.curl) copyText(ep.curl);
  });

  // 登录管理
  $('#lgRefresh').addEventListener('click', loadLogin);
  $('#qrGetBtn').addEventListener('click', getQr);
  $('#btnRefreshCred').addEventListener('click', async () => {
    try {
      await api('/admin/login/refresh', { method: 'POST' });
      toast('已请求刷新凭证', 'ok');
      loadLogin();
    } catch (e) { /* 已 toast */ }
  });
  $('#btnLogout').addEventListener('click', async () => {
    if (!confirm('确定退出当前 QQ 登录？')) return;
    try {
      await api('/admin/login/logout', { method: 'POST' });
      stopQrPoll();
      toast('已退出登录', 'ok');
      loadLogin();
    } catch (e) { /* 已 toast */ }
  });
  $('#btnClearCred').addEventListener('click', async () => {
    if (!confirm('确定清空本地凭证文件？清空后需要重新扫码登录。')) return;
    try {
      await api('/admin/login/credential', { method: 'DELETE' });
      toast('凭证已清空', 'ok');
      state.cred = null;
      $('#credPanel').classList.remove('show');
      loadLogin();
    } catch (e) { /* 已 toast */ }
  });
  $('#btnViewCred').addEventListener('click', viewCred);
  $('#credToggle').addEventListener('click', () => {
    state.credShown = !state.credShown;
    renderCred();
  });
  $('#credCopy').addEventListener('click', () => {
    const s = rawCredStr();
    if (!s) { toast('暂无可复制的凭证', 'error'); return; }
    copyText(s);
  });

  // 弹层
  $('#dlgTokenCopy').addEventListener('click', () => copyText($('#dlgTokenVal').textContent));
  $('#dlgTokenClose').addEventListener('click', () => $('#dlgToken').close());
  $('#exampleCopy').addEventListener('click', () => copyText(state.exampleCurl));
  $('#exampleClose').addEventListener('click', () => $('#dlgExample').close());

  // 轮询清理：页面隐藏时停止
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopQrPoll();
    } else if (state.qr.identifier && state.tab === 'login' && !state.qr.timer && state.connected) {
      startQrPoll(state.qr.identifier, true);  // 回到前台恢复轮询
    }
  });
  window.addEventListener('pagehide', stopQrPoll);
}

function init() {
  bindEvents();
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) {
    $('#tokenInput').value = saved;
    connect(true);   // 静默恢复连接（服务端不可用时仅显示未连接）
  }
}

init();
