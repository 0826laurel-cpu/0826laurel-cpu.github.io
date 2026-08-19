// 数据层见 js/api.js（全局 Api 对象 + sb 客户端）
let DB = { partners: [], gifts: [], shipments: [] };
let STATS = null;
let DASH = null;
let filterTier = 'all';
let filterCity = 'all';
let searchQ = '';
let charts = {};

// 批量管理状态
let BATCH_MODE = false;
let BATCH_SEL = new Set();

// 我的伙伴页：是否按入驻日期分组（默认开，长列表用折叠消化）
let GROUP_BY_DATE = true;

// 首页按入驻日期分组的折叠状态（内存，按日期 ds 缓存；≥4 人默认折叠）
let COLLAPSED_GROUPS = new Set();

// 返款模块状态（内存，不持久化）
let REBATE_PW = '';
let REBATE_LOGGED_IN = false;
let REBATE_TAB = 'form'; // form | pending | paid | public

const TIER_LABEL = { vip: 'VIP', core: '核心', normal: '普通', sleep: '待激活', new: '新提交' };
const TIER_COLOR = { vip: '#FF6B5C', core: '#7C6CF0', normal: '#FFB36B', sleep: '#9AA0AD', new: '#FF8FA3' };

// 通用复制文本：优先 Clipboard API，失败用 execCommand，最后 fallback prompt
async function copyText(text, okMsg) {
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      if (okMsg) toast(okMsg);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.top = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) { if (okMsg) toast(okMsg); return true; }
  } catch (e) {}
  prompt('请手动复制：', text);
  return false;
}
const STATUS_LABEL = { new: '新提交', contacted: '已联系', active: '活跃' };
const SHIP_STATUS = { pending: '待发货', collected: '已揽收', transit: '运输中', delivering: '派送中', signed: '已签收' };
const SHIP_COLOR = { pending: '#9AA0AD', collected: '#5B7CFA', transit: '#E58A3F', delivering: '#FF8FA3', signed: '#2BB673' };
// 兜底：填了快递单号就不应该再是"待发货"，升级为"已揽收"
function effStatus(s) {
  if (s && s.status === 'pending' && s.trackingNo && String(s.trackingNo).trim() !== '') return 'collected';
  return s ? s.status : '';
}
let SHIPS = [];
const GIFTS = [
  { name: '定制礼盒', price: 128, emoji: '🎁', bg: '#FFEAE5' },
  { name: '精美小样礼', price: 58, emoji: '☕', bg: '#FFF3E0' },
  { name: '电子贺卡', price: 0, emoji: '💌', bg: '#E8EEFF' },
  { name: '鲜花礼遇', price: 168, emoji: '🌸', bg: '#F0E9FF' }
];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function avColor(tier, name) { return TIER_COLOR[tier] || TIER_COLOR[(name ? name.charCodeAt(0) : 0) % 5] || '#FF6B5C'; }
function fmtShipDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), n = new Date();
  const diff = (n - d) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + '天前';
  return d.toISOString().slice(0, 10);
}
function fmtMoney(n) { n = Number(n) || 0; return (Math.round(n * 100) / 100).toString(); }
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function fmtHomeDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const isYesterday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate() - 1;
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const base = `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
  if (isToday) return `今天 · ${base}`;
  if (isYesterday) return `昨天 · ${base}`;
  return base;
}
function fmtDateTime(t) {
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function partnerModelText(p) {
  if (p.platform && p.modelId) return `${esc(p.platform)} · ${esc(p.modelId)}`;
  if (p.modelId) return `模特ID：${esc(p.modelId)}`;
  if (p.platform) return esc(p.platform);
  return esc(p.name || '');
}
function partnerCity(p) {
  const a = p.address || {};
  const city = a.city || a.province || '';
  return city || '未填城市';
}
function money(n) { return '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
function rebateMaskName(name) {
  if (!name || name.length <= 1) return name || '*';
  return name[0] + '*'.repeat(name.length - 1);
}

// ---------- 批量管理 ----------
async function runBatch(label, fn) {
  const ids = Array.from(BATCH_SEL);
  let ok = 0, fail = 0;
  for (const id of ids) {
    try { await fn(id); ok++; }
    catch (e) { console.error(`${label} ${id} 失败:`, e); fail++; }
  }
  BATCH_SEL.clear(); BATCH_MODE = false;
  await loadData(); await loadStats();
  if (fail) toast(`${label}完成：成功 ${ok} 个，失败 ${fail} 个`, { err: fail > 0 });
  else toast(`${label}完成：${ok} 个伙伴`);
  renderPartners();
}
function openBatchTier() {
  const sheet = document.getElementById('sheet-batch');
  sheet.innerHTML = `
    <h3>修改分组（已选 ${BATCH_SEL.size} 个）</h3>
    <div class="tier-row" style="margin-bottom:18px">
      ${[['vip','VIP'],['core','核心'],['normal','普通'],['sleep','待激活'],['new','新提交']].map(([t,l]) => `<button class="chip ${BATCH_TIER_TEMP === t ? 'on' : ''}" data-act="batch-tier-opt" data-tier="${t}">${l}</button>`).join('')}
    </div>
    <button class="btn-primary" data-act="batch-tier-save">确认修改</button>
    <button class="btn-line" data-act="close" data-ov="ov-batch">取消</button>`;
  BATCH_TIER_TEMP = 'normal';
  document.querySelectorAll('#sheet-batch .chip').forEach(c => c.classList.toggle('on', c.dataset.tier === BATCH_TIER_TEMP));
  document.getElementById('ov-batch').classList.add('show');
}
function openBatchStatus() {
  const sheet = document.getElementById('sheet-batch');
  sheet.innerHTML = `
    <h3>修改状态（已选 ${BATCH_SEL.size} 个）</h3>
    <div class="tier-row" style="margin-bottom:18px">
      ${[['new','新提交'],['contacted','已联系'],['active','活跃']].map(([s,l]) => `<button class="chip ${BATCH_STATUS_TEMP === s ? 'on' : ''}" data-act="batch-status-opt" data-status="${s}">${l}</button>`).join('')}
    </div>
    <button class="btn-primary" data-act="batch-status-save">确认修改</button>
    <button class="btn-line" data-act="close" data-ov="ov-batch">取消</button>`;
  BATCH_STATUS_TEMP = 'contacted';
  document.querySelectorAll('#sheet-batch .chip').forEach(c => c.classList.toggle('on', c.dataset.status === BATCH_STATUS_TEMP));
  document.getElementById('ov-batch').classList.add('show');
}

// 批量管理临时值
let BATCH_TIER_TEMP = 'normal';
let BATCH_STATUS_TEMP = 'contacted';

// 兼容层：把旧的 /api/... 路径映射到新的 Supabase Api（渲染逻辑无需改动）
async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : null;
  const seg = path.split('/').filter(Boolean); // ['admin','partners', ...]
  if (seg[1] === 'partners') {
    if (seg[2] && seg[2] !== 'export') {
      const id = Number(seg[2]);
      if (method === 'PUT') { await Api.updatePartner(id, body); return {}; }
      if (method === 'DELETE') { await Api.deletePartner(id); return {}; }
    }
    if (method === 'GET') return { partners: await Api.listPartners() };
    if (method === 'POST') { await Api.createPartner(body); return {}; }
  }
  if (seg[1] === 'gifts' && method === 'POST') { await Api.createGift(body); return {}; }
  if (seg[1] === 'shipments' && method === 'GET') return { shipments: await Api.listShipments() };
  if (seg[1] === 'shipment') {
    if (method === 'POST' && !seg[2]) { await Api.createShipment(body); return {}; }
    if (seg[2] === 'log' && method === 'POST') { const s = await Api.addShipLog(body.id, body); return { shipment: s }; }
    if (seg[2] === 'track') throw new Error('USE_TRACK');
    if (method === 'DELETE' && seg[2]) { await Api.deleteShipment(Number(seg[2])); return {}; }
  }
  if (seg[1] === 'interaction' && method === 'POST') { await Api.createInteraction(body); return {}; }
  if (seg[1] === 'stats' && method === 'GET') return computeStats();
  if (seg[1] === 'dashboard' && method === 'GET') return computeDashboard();
  throw new Error('未知接口 ' + path);
}

let toastTimer;
function toast(msg, opts) {
  const t = document.getElementById('toast');
  opts = opts || {};
  if (opts.html) t.innerHTML = msg; else t.textContent = msg;
  t.classList.add('show');
  if (opts.err) t.classList.add('err'); else t.classList.remove('err');
  clearTimeout(toastTimer);
  const ms = opts.ms || (typeof msg === 'string' && msg.length > 28 ? 4200 : 1600);
  toastTimer = setTimeout(() => { t.classList.remove('show'); t.classList.remove('err'); }, ms);
}

// ---------- 登录 ----------
function showLogin(show) { document.querySelector('.login').classList.toggle('hide', !show); }
async function doLogin(pwd) {
  try {
    await Api.login(pwd);
    showLogin(false); init();
  } catch (e) { toast('登录失败：' + (e.message || '')); }
}
function logout() { Api.logout(); showLogin(true); ['ov-detail', 'ov-add', 'ov-gift'].forEach(id => document.getElementById(id).classList.remove('show')); }

// ---------- 初始化 ----------
// 网络抖动自救：单 RPC 重试 + 单次超时；只对网络类错误重试，业务错立即抛
async function retryRpc(fn, retries, timeoutMs) {
  retries = retries == null ? 2 : retries;
  timeoutMs = timeoutMs == null ? 12000 : timeoutMs;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await withTimeout(fn(), timeoutMs); }
    catch (e) {
      lastErr = e;
      const msg = String(e && e.message || e);
      const transient = /Failed to fetch|NetworkError|timeout|AbortError|TypeError.*fetch|503|502|504|ETIMEDOUT|ENETUNREACH|fetch failed/i.test(msg);
      if (!transient || i >= retries) throw e;
      await new Promise(r => setTimeout(r, 300 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}
// 单次 fetch 包超时（浏览器 fetch 没有内置超时）
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('RPC timeout after ' + ms + 'ms')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
// 全屏 loading：避免首次冷启动 30s 白屏看起来像坏了
function showLoading(msg) {
  let el = document.getElementById('app-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-loading';
    el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.9);z-index:9999;font-size:14px;color:#666;font-family:system-ui,-apple-system,sans-serif;';
    el.innerHTML = '<div style="text-align:center"><div style="width:36px;height:36px;border:3px solid #eee;border-top-color:#FF6B5C;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px"></div><div></div></div>';
    // 注入 spin 关键帧（一次性）
    if (!document.getElementById('app-loading-css')) {
      const s = document.createElement('style');
      s.id = 'app-loading-css';
      s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
  el.querySelector('div div:last-child').textContent = msg || '数据加载中…';
}
function hideLoading() {
  const el = document.getElementById('app-loading');
  if (el) el.style.display = 'none';
}
async function init() {
  showLoading('数据加载中…首次访问可能需要 30–45 秒，请稍候');
  try {
    // 预热：fire-and-forget 一个轻量查询让 DNS/TLS 早建立，后续 loadData 会复用连接
    try { fetch(`${window.SB_URL}/rest/v1/partners?select=id&limit=1`, { headers: { 'apikey': window.SB_ANON, 'Authorization': `Bearer ${window.SB_ANON}` } }); } catch (_) {}
    await loadData();
    renderAll();
  } catch (e) {
    console.error('[init] 致命错误:', e);
    // 致命错误也暴露给 UI 横幅
    window.FETCH_ERR = {
      msgs: [String(e && e.message || e)],
      failedTables: ['init'],
      hasCache: false,
      at: Date.now()
    };
    try { toast('数据加载失败，请刷新'); } catch (_) {}
    // 兜底：缓存里有就用缓存，没有至少 render 一次空态
    const cached = readAdminCache();
    if (cached) { DB = cached.DB; STATS = cached.STATS; DASH = cached.DASH; window.FETCH_ERR.hasCache = true; }
    try { renderAll(); } catch (_) {}
  } finally {
    hideLoading();
  }
}
// 运营后台数据缓存（登录后/刷新秒开；写操作后 loadData 会覆盖；TTL 短保证实时性）
const ADMIN_CACHE_KEY = 'admin_cache';
const ADMIN_CACHE_TTL = 120 * 1000;
function readAdminCache() {
  try {
    const raw = localStorage.getItem(ADMIN_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !c.ts || Date.now() - c.ts > ADMIN_CACHE_TTL) return null;
    return c;
  } catch (e) { return null; }
}
function writeAdminCache() {
  try { localStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify({ ts: Date.now(), DB, STATS, DASH })); } catch (e) {}
}

async function loadData() {
  // ① 缓存兜底：命中即先 render（即使后续远端全挂也不再白屏）
  const cached = readAdminCache();
  if (cached) { DB = cached.DB; STATS = cached.STATS; DASH = cached.DASH; renderAll(); }

  // ② 远端拉新：跨境到 supabase.co（新加坡）抖动大，给充足超时 + 重试预算；最坏走缓存兜底
  const isColdStart = !cached;
  const retries = isColdStart ? 1 : 3;
  const timeoutMs = isColdStart ? 45000 : 25000;
  // 串行拉取：避免 supabase-js 并发复用连接时的内部竞争（偶发 25s 卡死的根因）。
  // 顺序收集结果，保持与解构顺序一致；任一失败照常进入 failed 分支走缓存兜底。
  const tasks = [
    () => Api.listPartners(),
    () => Api.listGifts(),
    () => Api.listShipments(),
    () => Api.listInteractions(),
    () => Api.listDeals()
  ];
  const results = [];
  for (const t of tasks) {
    results.push(
      await retryRpc(t, retries, timeoutMs)
        .then(v => ({ status: 'fulfilled', value: v }), e => ({ status: 'rejected', reason: e }))
    );
  }

  const failed = results.filter(r => r.status === 'rejected');
  // 先清零：成功路径保持 null；只有失败才覆盖
  window.FETCH_ERR = null;
  if (failed.length) {
    const TBL = ['partners','gifts','shipments','interactions','deals'];
    const failedTables = failed.map(r => TBL[results.indexOf(r)]).filter(Boolean);
    const msgs = failed.map(r => {
      const e = r.reason; return (e && e.message) ? String(e.message) : String(e);
    }).slice(0, 3);
    console.warn('[loadData] 部分远端查询失败，保留缓存继续渲染:', msgs);
    // 暴露给 UI：在首页显示真实错误 + 重试入口
    window.FETCH_ERR = {
      msgs,
      failedTables,
      hasCache: !!(DB && DB.partners && DB.partners.length),
      at: Date.now()
    };
    // 无论有没有缓存，都强制 render 一次：让错误横幅出现（缓存分支之前虽然 render 过，但 FETCH_ERR 是后置设置的）
    try { renderAll(); } catch (e) { console.error('[renderAll] 兜底渲染失败', e); }
    if (DB && DB.partners && DB.partners.length) {
      try { toast('数据未刷新（部分请求失败），显示最近缓存'); } catch (_) {}
    }
    return;
  }

  const [partners, gifts, shipments, interactions, deals] = results.map(r => r.value);
  partners.forEach(p => { p.interactions = interactions.filter(i => i.partnerId == p.id); });
  DB = { partners, gifts, shipments, deals };
  STATS = computeStats();
  DASH = computeDashboard();
  // 首次加载时，将人数 ≥4 的日期组默认折叠
  if (COLLAPSED_GROUPS.size === 0) initCollapsedGroups();
  writeAdminCache();
  renderAll();
}
// 手动重试：用户点错误横幅的「重试」按钮时调用；清空错误 → loading → loadData
async function retryLoad() {
  window.FETCH_ERR = null;
  showLoading('重新加载数据…');
  try {
    await loadData();
  } finally {
    hideLoading();
  }
}
function initCollapsedGroups() {
  const dayMap = new Map();
  (DB.partners || []).forEach(p => {
    const ds = fmtDate(p.createdAt);
    if (!ds) return;
    if (!dayMap.has(ds)) dayMap.set(ds, 0);
    dayMap.set(ds, dayMap.get(ds) + 1);
  });
  dayMap.forEach((cnt, ds) => { if (cnt >= 4) COLLAPSED_GROUPS.add(ds); });
}
async function loadStats() { STATS = computeStats(); }
async function loadDashboard() { DASH = computeDashboard(); }

// 客户端计算统计（替代原后端 /admin/stats）
function computeStats() {
  const ps = DB.partners || [];
  return {
    total: ps.length,
    vip: ps.filter(p => p.tier === 'vip').length,
    core: ps.filter(p => p.tier === 'core').length,
    normal: ps.filter(p => p.tier === 'normal').length,
    sleep: ps.filter(p => p.tier === 'sleep').length,
    news: ps.filter(p => p.tier === 'new' || p.status === 'new').length,
    sent: (DB.gifts || []).length,
    budget: 3000,
    used: (DB.gifts || []).reduce((a, g) => a + (Number(g.price) || 0), 0)
  };
}
// 客户端计算看板（替代原后端 /admin/dashboard）
function computeDashboard() {
  const ps = DB.partners || [];
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = (d.getMonth() + 1) + '月';
    const count = ps.filter(p => { const t = new Date(p.createdAt); return t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth(); }).length;
    months.push({ label, count });
  }
  const tierMap = { vip: 'VIP', core: '核心', normal: '普通', sleep: '待激活', new: '新提交' };
  const tierDist = Object.keys(tierMap).map(t => ({ label: tierMap[t], count: ps.filter(p => p.tier === t).length })).filter(x => x.count > 0);
  const totalGifts = (DB.gifts || []).length;
  const pendingContact = ps.filter(p => p.status === 'new' || !p.lastContact || p.source === 'self').length;
  return { totalPartners: ps.length, months, tierDist, totalGifts, pendingContact };
}

function renderAll() {
  // 任一 render 抛错不影响其他（个别数据缺失时仍能展示其他 view）
  const safe = (fn) => { try { fn(); } catch (e) { console.warn('render failed:', e); } };
  safe(renderHome);
  safe(renderPartners);
  safe(renderGift);
  safe(renderInteraction);
  safe(renderMe);
  safe(renderShipTab);
  safe(renderOps);
  safe(renderRebate);
}

function renderStats() {
  if (!STATS) return;
  // 我的页统计
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('me-total', STATS.total); set('me-interact', STATS.sent); set('me-gift', STATS.sent);
}

// ---------- 首页 ----------
function dynamicGreeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了，福利派送官';
  if (h < 11) return '早上好，福利派送官';
  if (h < 14) return '中午好，福利派送官';
  if (h < 18) return '下午好，福利派送官';
  return '晚上好，福利派送官';
}

function renderHome() {
  // 首页只展示「最近入驻」前 N 位（扁平）；完整列表交给「我的伙伴」页
  const ps = DB.partners.slice().sort((a, b) => b.createdAt - a.createdAt);
  // 首页只展示「最近入驻」前 8 位（扁平，不复用日期分组）；完整列表交给「我的伙伴」页
  const RECENT_LIMIT = 8;
  const recentList = ps.slice(0, RECENT_LIMIT);
  const todos = `
    <div class="sec-title">最近入驻 <span class="join-count">${ps.length} 人</span></div>
    ${recentList.length ? recentList.map(p => `
      <div class="join-row" data-act="detail" data-id="${p.id}">
        <div class="av" style="background:${avColor(p.tier, p.name)}">${esc((p.name || '?').slice(0, 1))}</div>
        <div class="info">
          <div class="nm">${esc(p.name)} <span class="tag" style="background:${p.status === 'new' ? '#FFE3EA' : '#FFEAE5'};color:${p.status === 'new' ? '#FF7091' : '#FF6B5C'}">${STATUS_LABEL[p.status] || '新提交'}</span></div>
          <div class="tg">${partnerModelText(p)} · ${partnerCity(p)} · ${p.tier === 'new' ? '新提交' : (TIER_LABEL[p.tier] || '')}</div>
        </div>
        <button class="btn-sm" data-act="detail" data-id="${p.id}">查看</button>
      </div>`).join('') : `<div class="card" style="text-align:center;color:var(--gray);font-size:13px">还没有伙伴入驻 🎉</div>`}
    ${ps.length > RECENT_LIMIT ? `<button class="view-all-btn" data-act="tab" data-tab="partners">查看全部 ${ps.length} 位伙伴 →</button>` : ''}`;

  const d = DASH || {};
  // 失败横幅：把"无声失败"变成"有声错误"——直接显示 Supabase 真实报错 + 重试入口
  const err = window.FETCH_ERR;
  const errBanner = err ? `<div class="err-banner" style="margin:12px 16px 0;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,#FFF1F2,#FFE3EA);border:1px solid #FFCBD2;color:#A0303A;font-size:13px;line-height:1.5;box-sizing:border-box">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:${err.msgs[0] ? '6px' : '0'}">
        <div style="font-weight:600">⚠️ 数据没加载出来（${esc((err.failedTables || []).join('/') || '未知表')}）</div>
        <button id="err-retry" style="border:none;background:#FF6B5C;color:#fff;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;flex-shrink:0">重试</button>
      </div>
      ${err.msgs[0] ? `<div style="opacity:.85;word-break:break-all">${esc(err.msgs.join(' · '))}</div>` : ''}
      <div style="margin-top:4px;opacity:.7;font-size:12px">${err.hasCache ? '已显示最近缓存（120s 内）' : '首次访问无缓存，请检查网络后重试'}</div>
    </div>` : '';
  document.getElementById('view-home').innerHTML = `${errBanner}
    <div class="header">
      <div class="row">
        <div class="hi">${dynamicGreeting()} 👋</div>
        <div class="avatar">福</div>
      </div>
      <div class="sub">用心经营每一段伙伴关系 · 今天也要联系她们哦</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="n" id="st-total">0</div><div class="l">伙伴总数</div></div>
      <div class="stat"><div class="n" id="st-new" style="color:#5B7CFA">0</div><div class="l">本月新增</div></div>
      <div class="stat"><div class="n" id="st-gift" style="color:#E58A3F">0</div><div class="l">已发礼品</div></div>
      <div class="stat"><div class="n" id="st-pending" style="color:#2BB673">0</div><div class="l">待联系</div></div>
    </div>
    <div class="chart-row">
      <div class="chart-card">
        <div class="chart-title">伙伴分层</div>
        <canvas id="chart-tier" width="160" height="160"></canvas>
      </div>
      <div class="chart-card">
        <div class="chart-title">增长趋势</div>
        <canvas id="chart-growth" width="160" height="160"></canvas>
      </div>
    </div>
    <div class="quick">
      <div class="qa" data-act="add"><div class="ic" style="background:#FFEAE5">＋</div><div class="t">新增伙伴</div></div>
      <div class="qa" data-act="tab" data-tab="gift"><div class="ic" style="background:#FFF3E0">🎁</div><div class="t">发礼品</div></div>
      <div class="qa" data-act="tab" data-tab="interaction"><div class="ic" style="background:#E8EEFF">💬</div><div class="t">互动记录</div></div>
        <div class="qa" data-act="tab" data-tab="rebate"><div class="ic" style="background:#E8F5E9">💰</div><div class="t">返款后台</div></div>
        <div class="qa" data-act="tab" data-tab="rebate" data-rebate="public"><div class="ic" style="background:#E3F2FD">📢</div><div class="t">返款公示</div></div>
    </div>
    <div class="sec-title">最近入驻</div>
    ${todos}`;
  // 绑定错误横幅的重试按钮
  const errBtn = document.getElementById('err-retry');
  if (errBtn) errBtn.onclick = () => retryLoad();
  // 填充统计数字
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('st-total', d.totalPartners || 0);
  set('st-new', (d.months && d.months.length) ? d.months[d.months.length - 1].count : 0);
  set('st-gift', d.totalGifts || 0);
  set('st-pending', d.pendingContact || 0);
  // 渲染图表
  renderCharts();
}

let _chartJsPromise = null;
function loadChartJs() {
  // 懒加载图表库：首屏不阻塞登录框，登录后 dashboard 渲染时再按需加载
  if (window.Chart) return Promise.resolve();
  if (!_chartJsPromise) {
    _chartJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'chart.umd.min.js';
      s.async = true;
      s.onload = () => resolve(window.Chart);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return _chartJsPromise;
}

function renderCharts() {
  if (!DASH) return;
  if (typeof Chart === 'undefined') {
    // 图表库未加载：触发懒加载，加载完成后再重画（首屏数据先秒出，图表稍后填充）
    loadChartJs().then(() => renderCharts()).catch(() => {});
    return;
  }
  // 销毁旧图表
  Object.values(charts).forEach(c => { try { c.destroy(); } catch (e) {} });
  charts = {};
  // 分层饼图
  const tierCanvas = document.getElementById('chart-tier');
  if (tierCanvas && DASH.tierDist) {
    const filtered = DASH.tierDist.filter(t => t.count > 0);
    charts.tier = new Chart(tierCanvas, {
      type: 'doughnut',
      data: {
        labels: filtered.map(t => t.label),
        datasets: [{ data: filtered.map(t => t.count), backgroundColor: ['#FF6B5C', '#7C6CF0', '#FFB36B', '#9AA0AD', '#FF8FA3'], borderWidth: 0 }]
      },
      options: { responsive: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 6, boxWidth: 10 } } }, cutout: '62%' }
    });
  }
  // 增长折线
  const growthCanvas = document.getElementById('chart-growth');
  if (growthCanvas && DASH.months) {
    charts.growth = new Chart(growthCanvas, {
      type: 'line',
      data: {
        labels: DASH.months.map(m => m.label),
        datasets: [{ data: DASH.months.map(m => m.count), borderColor: '#FF6B5C', backgroundColor: 'rgba(255,107,92,.12)', fill: true, tension: .35, pointRadius: 3, pointBackgroundColor: '#FF6B5C', borderWidth: 2 }]
      },
      options: { responsive: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { font: { size: 9 } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { font: { size: 9 }, stepSize: 1 }, grid: { color: '#f0f0f0' } } } }
    });
  }
}

// ---------- 运营数据 ----------
function shanghaiTodayStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function renderOps() {
  const ps = DB.partners || [];
  const gifts = DB.gifts || [];
  const ships = DB.shipments || [];
  const todayStr = shanghaiTodayStr();

  // 指标卡
  const checkedToday = ps.filter(p => p.lastCheckin === todayStr).length;
  const everChecked = ps.filter(p => p.lastCheckin).length;
  const invitedIn = ps.filter(p => p.invitedBy && p.invitedBy !== '').length;
  const redeemed = gifts.filter(g => g.note === '积分兑换').length;
  // 本月已签收礼品价值
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const monthSignedValue = ships.filter(s => s.status === 'signed' && (() => { const d = new Date(s.createdAt); return d.getFullYear() === y && d.getMonth() === m; })())
    .reduce((a, s) => a + (Number(s.value) || 0), 0);
  const totalShipValue = ships.reduce((a, s) => a + (Number(s.value) || 0), 0);
  const totalPoints = ps.reduce((a, p) => a + (Number(p.points) || 0), 0);

  const statsHtml = `
    <div class="stats">
      <div class="stat"><div class="n" style="color:#2BB673">${checkedToday}</div><div class="l">今日签到</div></div>
      <div class="stat"><div class="n" style="color:#5B7CFA">${everChecked}</div><div class="l">累计签到</div></div>
      <div class="stat"><div class="n" style="color:#FF6B5C">${invitedIn}</div><div class="l">被邀请入驻</div></div>
      <div class="stat"><div class="n" style="color:#7C6CF0">${redeemed}</div><div class="l">积分兑换</div></div>
      <div class="stat"><div class="n" style="color:#E58A3F">¥${fmtMoney(monthSignedValue)}</div><div class="l">本月签收价值</div></div>
      <div class="stat"><div class="n" style="color:#FF8FA3">¥${fmtMoney(totalShipValue)}</div><div class="l">累计寄出价值</div></div>
    </div>
    <div class="ops-extra">当前全站积分余额合计：<b style="color:#FF6B5C">${totalPoints}</b> 分</div>`;

  // 邀请排行榜 TOP10（含被邀请人明细）
  const codeToName = {}; ps.forEach(p => { if (p.inviteCode) codeToName[p.inviteCode] = { name: p.name, wechat: p.wechat || '', phone: p.phone || '' }; });
  const invMap = {};
  ps.forEach(p => { if (p.invitedBy) { (invMap[p.invitedBy] ||= []).push(p); } });
  const invRank = Object.keys(invMap).map(code => {
    const invitees = invMap[code];
    const inviter = codeToName[code] || { name: code };
    return { code, name: inviter.name, cnt: invitees.length, invitees };
  }).sort((a, b) => b.cnt - a.cnt).slice(0, 10);
  const invHtml = invRank.length ? invRank.map((r, i) => {
    const bodyId = 'inv-body-' + i;
    const subs = r.invitees.map(inv => `
      <div class="ops-row inv-sub">
        <div class="av" style="background:${avColor(inv.tier, inv.name)}">${esc((inv.name || '?').slice(0, 1))}</div>
        <div class="ops-main">
          <div class="ops-nm">${esc(inv.name)}</div>
          <div class="ops-sub">${esc(inv.wechat || inv.phone || '—')}</div>
        </div>
        <div class="ops-time">${fmtDate(inv.createdAt)}</div>
      </div>`).join('');
    return `
    <div class="inv-group">
      <div class="ops-row inv-head" data-act="toggle-inv" data-body="${bodyId}">
        <div class="ops-rank">${i + 1}</div>
        <div class="av" style="background:${avColor('', r.name)}">${esc((r.name || '?').slice(0, 1))}</div>
        <div class="ops-main"><div class="ops-nm">${esc(r.name)} <span class="ops-code">${esc(r.code)}</span></div></div>
        <div class="ops-num">${r.cnt} <span>人</span></div>
        <div class="inv-arrow">▶</div>
      </div>
      <div class="inv-body" id="${bodyId}" style="display:none">${subs}</div>
    </div>`;
  }).join('') : `<div class="card" style="text-align:center;color:var(--gray);font-size:13px">还没有人通过邀请码入驻，分享你的福利页试试 🤝</div>`;

  // 最近兑换记录
  const idToName = {}; ps.forEach(p => { idToName[p.id] = p.name; });
  const redeemList = gifts.filter(g => g.note === '积分兑换')
    .slice().sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 12);
  const redeemHtml = redeemList.length ? redeemList.map(g => `
    <div class="ops-row">
      <div class="av" style="background:#F0E9FF">🎁</div>
      <div class="ops-main"><div class="ops-nm">${esc(idToName[g.partnerId] || '—')}</div><div class="ops-sub">${esc(g.giftName)}</div></div>
      <div class="ops-time">${fmtTime(g.at)}</div>
    </div>`).join('') : `<div class="card" style="text-align:center;color:var(--gray);font-size:13px">还没有伙伴兑换好礼 🎀</div>`;

  // 签到 7 天趋势（HTML 条形）
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const pad = n => String(n).padStart(2, '0');
    const ds = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    trend.push({ ds, label: (d.getMonth() + 1) + '/' + d.getDate(), cnt: ps.filter(p => p.lastCheckin === ds).length });
  }
  const maxCnt = Math.max(1, ...trend.map(t => t.cnt));
  const trendHtml = trend.map(t => `
    <div class="bar-col">
      <div class="bar-val">${t.cnt}</div>
      <div class="bar" style="height:${Math.round(t.cnt / maxCnt * 100)}px;background:${t.ds === todayStr ? '#FF6B5C' : '#FFB36B'}"></div>
      <div class="bar-lab">${t.label}</div>
    </div>`).join('');

  document.getElementById('view-ops').innerHTML = `
    <div class="header">
      <div class="row"><div class="hi">运营数据</div><div class="avatar">数</div></div>
      <div class="sub">签到 · 邀请 · 积分 · 福利成本，一眼掌握增长与活跃</div>
    </div>
    ${statsHtml}
    <div class="sec-title">签到趋势（近 7 天）</div>
    <div class="card"><div class="bar-chart">${trendHtml}</div></div>
    <div class="sec-title">邀请排行榜 TOP 10</div>
    <div class="card">${invHtml}</div>
    <div class="sec-title">最近积分兑换</div>
    <div class="card">${redeemHtml}</div>`;

  // 邀请排行榜展开/收起被邀请人明细
  document.querySelectorAll('[data-act="toggle-inv"]').forEach(el => {
    el.addEventListener('click', () => {
      const body = document.getElementById(el.dataset.body);
      if (!body) return;
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      el.querySelector('.inv-arrow').textContent = isOpen ? '▶' : '▼';
    });
  });
}

// ---------- 返款管理 ----------
function renderRebate() {
  const box = document.getElementById('view-rebate');
  if (!box) return;

  if (!REBATE_LOGGED_IN) {
    box.innerHTML = `
      <div class="header">
        <div class="row"><div class="hi">返款管理</div><div class="avatar">返</div></div>
        <div class="sub">录入返款、查看待返/已返订单、同步返款公示</div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="field"><label>返款后台密码</label>
          <input id="rebate-pw" type="password" placeholder="请输入返款后台密码">
        </div>
        <button class="btn-primary" id="rebate-login-btn">进入返款后台</button>
        <div style="font-size:12px;color:var(--gray);margin-top:10px">密码与私域管理后台独立验证，仅本次会话有效</div>
      </div>`;
    const btn = document.getElementById('rebate-login-btn');
    const input = document.getElementById('rebate-pw');
    if (btn) btn.addEventListener('click', doRebateLogin);
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') doRebateLogin(); });
    return;
  }

  const tabs = [
    ['form', '➕ 录入返款'],
    ['pending', '⏳ 待返款'],
    ['paid', '✅ 已返款'],
    ['public', '📢 返款公示']
  ];
  const tabHtml = `<div class="chips" style="margin-bottom:14px">${tabs.map(([k, l]) =>
    `<button class="chip ${REBATE_TAB === k ? 'on' : ''}" data-act="rebate-tab" data-tab="${k}">${l}</button>`).join('')}</div>`;

  let body = '';
  if (REBATE_TAB === 'form') body = rebateFormHtml(REBATE_PREFILL || {});
  else if (REBATE_TAB === 'pending') body = `<div class="rebate-list" id="rebate-pending-box"><div class="card" style="text-align:center;color:var(--gray);font-size:13px">加载中…</div></div>`;
  else if (REBATE_TAB === 'paid') body = `<div class="rebate-list" id="rebate-paid-box"><div class="card" style="text-align:center;color:var(--gray);font-size:13px">加载中…</div></div>`;
  else if (REBATE_TAB === 'public') body = `<div class="rebate-list" id="rebate-public-box"><div class="card" style="text-align:center;color:var(--gray);font-size:13px">加载中…</div></div>`;

  box.innerHTML = `
    <div class="header">
      <div class="row"><div class="hi">返款管理</div><div class="avatar">返</div></div>
      <div class="sub">录入返款、查看待返/已返订单、同步返款公示</div>
    </div>
    ${tabHtml}
    <div id="rebate-body">${body}</div>
    <button class="btn-line" style="margin-top:10px" data-act="rebate-logout">退出返款后台</button>`;

  // 绑定各子 tab 的专属逻辑
  if (REBATE_TAB === 'form') bindRebateForm();
  if (REBATE_TAB === 'pending') loadRebatePending();
  if (REBATE_TAB === 'paid') loadRebatePaid();
  if (REBATE_TAB === 'public') loadRebatePublic();
}

function rebateFormHtml(prefill = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <div class="card" id="rebate-form-card">
      <div class="field"><label>模特查询码 / 模特ID（可空）</label>
        <input id="r-code" value="${esc(prefill.model_code || '')}" placeholder="如 M001 或模特平台ID"></div>
      <div class="field"><label>展示昵称（公开页会自动脱敏）</label>
        <input id="r-mask" value="${esc(prefill.model_mask || '')}" placeholder="如 小雅"></div>
      <div class="field"><label>模特专属页编号（选填，填后同步到 ta 的福利专属页）</label>
        <input id="r-model-id" value="${esc(prefill.model_id || '')}" placeholder="如 me.html 链接里的编号"></div>
      <div class="field"><label>订单号（私密，仅本人可见）</label>
        <input id="r-order" value="${esc(prefill.order_no || '')}" placeholder="如 JD20260801001"></div>
      <div class="field"><label>事项 / 任务内容</label>
        <input id="r-item" value="${esc(prefill.item || '')}" placeholder="如 618 主推款拍摄"></div>
      <div class="row2">
        <div class="field"><label>返款金额</label>
          <input id="r-amount" type="number" step="0.01" value="${prefill.amount != null ? fmtMoney(prefill.amount) : ''}" placeholder="0.00"></div>
        <div class="field"><label>返款日期</label>
          <input id="r-date" type="date" value="${prefill.rebate_date || today}"></div>
      </div>
      <div class="field"><label>预计返款日期（模特可见）</label>
        <input id="r-expected" type="date" value="${esc(prefill.expected_rebate_date || '')}"></div>
      <div class="field"><label>状态</label>
        <select id="r-status">
          <option value="待返" ${prefill.status === '待返' ? 'selected' : ''}>待返</option>
          <option value="已返" ${(!prefill.status || prefill.status === '已返') ? 'selected' : ''}>已返</option>
          <option value="处理中" ${prefill.status === '处理中' ? 'selected' : ''}>处理中</option>
        </select></div>
      <div class="field"><label>返款凭证（转账截图，状态为「已返」时模特可见）</label>
        <div class="file-wrap">
          <input id="r-voucher" type="file" accept="image/jpeg,image/png,image/webp">
          <label for="r-voucher" class="file-btn">📷 选择转账截图</label>
          <span class="file-name" id="r-voucher-name">未选择文件</span>
        </div>
        <img class="file-preview" id="r-voucher-preview" style="display:none" alt="预览">
      </div>
      <button class="btn-primary" id="r-submit">提交返款记录</button>
      <button class="btn-line" id="r-reset" style="margin-top:6px">重置表单</button>
    </div>`;
}

function bindRebateForm(prefill = {}) {
  const input = document.getElementById('r-voucher');
  const name = document.getElementById('r-voucher-name');
  const preview = document.getElementById('r-voucher-preview');
  if (input) {
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) { name.textContent = '未选择文件'; preview.style.display = 'none'; preview.src = ''; return; }
      name.textContent = file.name;
      const reader = new FileReader();
      reader.onload = e => { preview.src = e.target.result; preview.style.display = 'block'; };
      reader.readAsDataURL(file);
    });
  }
  const submit = document.getElementById('r-submit');
  if (submit) submit.addEventListener('click', saveRebate);
  const reset = document.getElementById('r-reset');
  if (reset) reset.addEventListener('click', () => { REBATE_PREFILL = null; renderRebate(); });
}

let REBATE_PREFILL = null;

async function doRebateLogin() {
  const input = document.getElementById('rebate-pw');
  const pw = input ? input.value.trim() : '';
  if (!pw) { toast('请输入密码'); return; }
  try {
    const ok = await Api.checkRebateAdmin(pw);
    if (!ok) { toast('密码错误'); return; }
    REBATE_PW = pw;
    REBATE_LOGGED_IN = true;
    REBATE_TAB = 'form';
    toast('验证成功');
    renderRebate();
  } catch (e) { toast('验证失败：' + e.message, { err: true }); }
}

async function saveRebate() {
  const file = document.getElementById('r-voucher')?.files[0];
  const status = document.getElementById('r-status')?.value || '已返';
  let voucherUrl = '';
  try {
    if (file) {
      toast('正在上传凭证…');
      voucherUrl = await Api.uploadRebateVoucher(file);
    }
    const payload = {
      modelCode: document.getElementById('r-code')?.value.trim() || '',
      modelMask: document.getElementById('r-mask')?.value.trim() || '',
      modelId: document.getElementById('r-model-id')?.value.trim() || '',
      orderNo: document.getElementById('r-order')?.value.trim() || '',
      item: document.getElementById('r-item')?.value.trim() || '',
      amount: parseFloat(document.getElementById('r-amount')?.value || '0'),
      rebateDate: document.getElementById('r-date')?.value || null,
      expectedDate: document.getElementById('r-expected')?.value || null,
      status,
      voucherUrl
    };
    if (!payload.modelMask || !payload.orderNo || !payload.item || !payload.amount) {
      toast('请填全：昵称 / 订单号 / 事项 / 金额'); return;
    }
    await Api.addRebate(REBATE_PW, payload);
    toast('✅ 返款记录已提交');
    REBATE_PREFILL = null;
    REBATE_TAB = 'paid';
    renderRebate();
  } catch (e) { toast(e.message || '提交失败', { err: true }); }
}

function renderRebateRows(rows, type) {
  if (!rows.length) return `<div class="card" style="text-align:center;color:var(--gray);font-size:13px">暂无${type === 'pending' ? '待返款' : '已返款'}订单</div>`;
  return rows.map(r => {
    const model = r.model_code ? `（${esc(r.model_code)}）` : '';
    const voucher = (type === 'paid' && r.voucher_url)
      ? `<img src="${esc(r.voucher_url)}" class="rebate-voucher-thumb" onclick="openRebateVoucher('${esc(r.voucher_url)}')" alt="凭证">`
      : '';
    const actions = type === 'pending' ? `
      <div class="rebate-actions">
        <button class="btn-sm" data-act="rebate-pay" data-order="${esc(r.order_no)}">上传返款截图</button>
        <button class="btn-line" style="width:auto;padding:6px 12px" data-act="rebate-edit" data-order="${esc(r.order_no)}">编辑</button>
      </div>` : '';
    return `
      <div class="card rebate-card">
        <div class="rebate-top">
          <div class="rebate-order">${esc(r.order_no || '-')}</div>
          <div class="rebate-amount">${money(r.amount)}</div>
        </div>
        <div class="rebate-meta">
          <span>👤 ${esc(r.model_mask || '匿名')}${model}</span>
          <span>📦 ${esc(r.item || '-')}</span>
        </div>
        <div class="rebate-meta">
          <span>状态：<b style="color:${r.status === '已返' ? '#2BB673' : (r.status === '处理中' ? '#5B7CFA' : '#FF6B5C')}">${esc(r.status || '待返')}</b></span>
          <span>录入：${fmtDateTime(r.created_at)}</span>
        </div>
        ${r.expected_rebate_date ? `<div class="rebate-meta">预计返款：${esc(r.expected_rebate_date)}</div>` : ''}
        ${r.rebate_date ? `<div class="rebate-meta">返款日期：${esc(r.rebate_date)}</div>` : ''}
        ${voucher}
        ${actions}
      </div>`;
  }).join('');
}

async function loadRebatePending() {
  const box = document.getElementById('rebate-pending-box');
  if (!box) return;
  try {
    const rows = await Api.listRebatesPending(REBATE_PW);
    box.innerHTML = renderRebateRows(rows, 'pending');
  } catch (e) { box.innerHTML = `<div class="card" style="text-align:center;color:var(--gray);font-size:13px">加载失败：${esc(e.message)}</div>`; }
}

async function loadRebatePaid() {
  const box = document.getElementById('rebate-paid-box');
  if (!box) return;
  try {
    const rows = await Api.listRebatesPaid(REBATE_PW);
    box.innerHTML = renderRebateRows(rows, 'paid');
  } catch (e) { box.innerHTML = `<div class="card" style="text-align:center;color:var(--gray);font-size:13px">加载失败：${esc(e.message)}</div>`; }
}

async function loadRebatePublic() {
  const box = document.getElementById('rebate-public-box');
  if (!box) return;
  try {
    const [stats, feed, board] = await Promise.all([
      Api.rebatePublicStats().catch(() => null),
      Api.rebatePublicFeed(20).catch(() => []),
      Api.rebatePublicLeaderboard(10).catch(() => [])
    ]);
    const statHtml = stats ? `
      <div class="stats" style="margin-bottom:12px">
        <div class="stat"><div class="n" style="color:#FF6B5C">${money(stats.total_amount || 0)}</div><div class="l">累计返款</div></div>
        <div class="stat"><div class="n" style="color:#5B7CFA">${stats.total_count || 0}</div><div class="l">返款笔数</div></div>
        <div class="stat"><div class="n" style="color:#2BB673">${stats.model_count || 0}</div><div class="l">覆盖模特</div></div>
        <div class="stat"><div class="n" style="color:#E58A3F">${money(stats.month_amount || 0)}</div><div class="l">本月返款</div></div>
      </div>` : '';
    const feedHtml = feed.length ? feed.map(r => `
      <div class="feed-item">
        <span class="fi-emoji">🎉</span>
        <div class="fi-main">
          <div><b>${esc(rebateMaskName(r.mask || r.model_mask || '匿名'))}</b> 收到返款 <span class="fi-amt">${money(r.amount)}</span></div>
          <div class="fi-sub">${esc(r.item || '')} · ${esc(r.status || '已返')} · ${fmtDateTime(r.created_at)}</div>
        </div>
      </div>`).join('') : '<div class="card" style="text-align:center;color:var(--gray);font-size:13px">暂无公示数据</div>';
    const boardHtml = board.length ? board.map((r, i) => `
      <div class="ops-row">
        <div class="ops-rank ${i < 3 ? 'top' : ''}">${i + 1}</div>
        <div class="ops-main"><div class="ops-nm">${esc(rebateMaskName(r.mask || r.model_mask || '匿名'))}</div></div>
        <div class="ops-num">${money(r.total)}<span> · ${r.cnt || 0}笔</span></div>
      </div>`).join('') : '<div class="card" style="text-align:center;color:var(--gray);font-size:13px">暂无排行榜</div>';
    box.innerHTML = `${statHtml}
      <div class="sec-title">最新返款动态</div><div class="card" style="padding:10px 14px">${feedHtml}</div>
      <div class="sec-title">返款排行榜</div><div class="card">${boardHtml}</div>`;
  } catch (e) { box.innerHTML = `<div class="card" style="text-align:center;color:var(--gray);font-size:13px">加载失败：${esc(e.message)}</div>`; }
}

async function fillRebateForPay(orderNo, status) {
  try {
    const rows = await Api.getRebatesByCode(orderNo);
    const r = rows.find(x => x.order_no === orderNo);
    if (!r) { toast('未找到该订单'); return; }
    REBATE_PREFILL = r;
    REBATE_TAB = 'form';
    renderRebate();
    // 等表单渲染完后把状态设为期望的
    setTimeout(() => {
      const st = document.getElementById('r-status');
      if (st && status) st.value = status;
    }, 0);
  } catch (e) { toast(e.message || '加载订单失败', { err: true }); }
}

window.openRebateVoucher = function (url) {
  const box = document.createElement('div');
  box.className = 'voucher-lightbox';
  box.innerHTML = `<img src="${url}" alt="返款凭证">`;
  box.onclick = () => box.remove();
  document.body.appendChild(box);
};

// ---------- 伙伴 ----------
// 单张伙伴卡片（供「我的伙伴」扁平 / 按日期分组两种模式复用）
function partnerCardHtml(p, shipCountMap) {
  const cnt = shipCountMap.get(p.id) || 0;
  const tierTag = p.tier !== 'new' ? `<span class="tag">${TIER_LABEL[p.tier] || ''}</span>` : `<span class="tag" style="background:#FFE3EA;color:#FF7091">新提交</span>`;
  const shipTag = cnt > 0
    ? `<span class="tag" style="background:#E8F5E9;color:#2BB673">🚚 已发货${cnt > 1 ? ' ×' + cnt : ''}</span>`
    : `<span class="tag" style="background:#FFF3E0;color:#E58A3F">📦 待发货</span>`;
  const myShips = (DB.shipments || [])
    .filter(s => s.partnerId === p.id)
    .slice()
    .sort((a, b) => (b.trackingAddedAt || b.createdAt || 0) - (a.trackingAddedAt || a.createdAt || 0));
  const shipsHtml = myShips.length
    ? myShips.map(s => {
        const no = s.trackingNo || '';
        const kd = no
          ? `<button class="act" data-act="copy-track" data-no="${esc(no)}" title="复制单号">📋</button>
             <a class="act" href="https://m.kuaidi100.com/index_all.html?postid=${encodeURIComponent(no)}" target="_blank" rel="noopener" title="快递100">🔎</a>`
          : `<span class="act" title="待承运商分配单号">⏳</span>`;
        return `<div class="ship-mini">
          <span class="carrier">${esc(s.carrier || '未填')}</span>
          <span class="no${no ? '' : ' empty'}">${esc(no || '待分配单号')}</span>
          <span class="st" style="background:${SHIP_COLOR[effStatus(s)] || '#9AA0AD'}">${SHIP_STATUS[effStatus(s)] || ''}</span>
          ${kd}
        </div>`;
      }).join('')
    : '<div class="ship-mini empty">📦 还没发货</div>';
  const trackDate = myShips.length
    ? `<div style="font-size:10px;color:#9AA0AD;margin-top:2px">最新发货：${esc(fmtShipDate(myShips[0].trackingAddedAt || myShips[0].createdAt))}</div>`
    : '';
  const batchCb = BATCH_MODE
    ? `<label class="batch-cb ${BATCH_SEL.has(p.id) ? 'on' : ''}" data-act="batch-check" data-id="${p.id}" onclick="event.stopPropagation()">
        <input type="checkbox" ${BATCH_SEL.has(p.id) ? 'checked' : ''}>
      </label>`
    : '';
  return `<div class="pcard ${BATCH_MODE ? 'batching' : ''} ${BATCH_SEL.has(p.id) ? 'selected' : ''}" data-id="${p.id}">
    <div class="pcard-head" data-act="${BATCH_MODE ? 'batch-check' : 'toggle-pcard'}" data-id="${p.id}">
      ${batchCb}
      <div class="av" style="background:${avColor(p.tier, p.name)}">${esc((p.name || '?').slice(0, 1))}</div>
      <div class="info">
        <div class="nm">${esc(p.name)} ${tierTag} ${shipTag}</div>
        <div class="meta">${partnerModelText(p)} · ${partnerCity(p)}</div>
        <div class="meta sub-line">${esc(p.wechat || '')} · ${p.lastContact || '未联系'} · ${STATUS_LABEL[p.status] || ''}</div>
      </div>
      <div class="pcard-head-act">
        ${p.payout_qr_url
          ? `<img class="qr-thumb" src="${p.payout_qr_url}" data-act="qr-zoom" data-id="${p.id}" title="查看收款码" alt="收款码">`
          : `<span class="qr-none" title="模特尚未上传收款码">无码</span>`}
        <div class="pcard-quick-acts">
          <button class="btn-icon" data-act="rebate-new" data-pid="${p.id}" data-mid="${esc(p.model_id || '')}" data-mname="${esc(p.name || '')}" title="录入返款">💰</button>
          <button class="btn-icon" data-act="ship-new" data-pid="${p.id}" title="发货">📦</button>
          ${hasAddress(p.address) ? `<button class="btn-icon" data-act="copy-address" data-addr="${addrText(p.address, true)}" title="复制地址">📋</button>` : ''}
          <button class="btn-icon" data-act="detail" data-id="${p.id}" title="查看详情">📝</button>
        </div>
        <span class="arrow">▼</span>
      </div>
    </div>
    <div class="pcard-body">
      <div class="ships-summary">
        <div>
          <div class="left">📦 该伙伴 <span class="cnt">${myShips.length}</span> 单发货</div>
          ${trackDate}
        </div>
        <div class="right">
          <button class="btn-add" data-act="rebate-new" data-pid="${p.id}" data-mid="${esc(p.model_id || '')}" data-mname="${esc(p.name || '')}" title="录入返款" style="background:#2BB673;color:#fff">💰 录返款</button>
          <button class="btn-add" data-act="ship-new" data-pid="${p.id}" title="给该伙伴新建发货">➕ 发货</button>
          <button class="btn-detail" data-act="detail" data-id="${p.id}">详情</button>
        </div>
      </div>
      ${shipsHtml}
    </div>
  </div>`;
}

function renderPartners() {
  const s = STATS || {};
  // 发货统计（客户端聚合：每个伙伴的发货单数）
  const shipCountMap = new Map();
  (DB.shipments || []).forEach(sh => {
    if (sh.partnerId == null) return;
    shipCountMap.set(sh.partnerId, (shipCountMap.get(sh.partnerId) || 0) + 1);
  });
  const shippedCount = shipCountMap.size;
  const unshippedCount = Math.max(0, (DB.partners || []).length - shippedCount);
  const tiers = [['all', '全部 ' + DB.partners.length], ['vip', 'VIP ' + (s.vip||0)], ['core', '核心 ' + (s.core||0)], ['normal', '普通 ' + (s.normal||0)], ['sleep', '待激活 ' + (s.sleep||0)], ['new', '新提交 ' + (s.news||0)], ['shipped', '🚚 已发货 ' + shippedCount], ['unshipped', '📦 待发货 ' + unshippedCount]];
  const chips = tiers.map(([t, l]) => `<button class="chip ${filterTier === t ? 'on' : ''}" data-act="chip" data-tier="${t}">${l}</button>`).join('');

  // 城市筛选：从地址中提取市/省
  const cityMap = new Map();
  DB.partners.forEach(p => {
    const c = partnerCity(p);
    cityMap.set(c, (cityMap.get(c) || 0) + 1);
  });
  const cityList = Array.from(cityMap.entries()).sort((a, b) => b[1] - a[1]);
  const cityChips = `<button class="chip ${filterCity === 'all' ? 'on' : ''}" data-act="city-chip" data-city="all">全部城市</button>` +
    cityList.map(([c, n]) => `<button class="chip ${filterCity === c ? 'on' : ''}" data-act="city-chip" data-city="${esc(c)}">${esc(c)} ${n}</button>`).join('');

  let list = DB.partners;
  if (filterTier === 'shipped') list = list.filter(p => shipCountMap.has(p.id));
  else if (filterTier === 'unshipped') list = list.filter(p => !shipCountMap.has(p.id));
  else if (filterTier !== 'all') list = list.filter(p => p.tier === filterTier);
  if (filterCity !== 'all') list = list.filter(p => partnerCity(p) === filterCity);
  if (searchQ) list = list.filter(p => (p.name + p.wechat + (p.note || '') + (p.platform || '') + (p.modelId || '')).toLowerCase().includes(searchQ.toLowerCase()));
  list = list.slice().sort((a, b) => b.createdAt - a.createdAt);
  // 卡片渲染：扁平模式直接用 partnerCardHtml；分组模式按入驻日期聚合（组内 ≥4 默认折叠）
  let cards;
  if (GROUP_BY_DATE) {
    const dayMap = new Map();
    list.forEach(p => {
      const ds = fmtDate(p.createdAt);
      if (!ds) return;
      if (!dayMap.has(ds)) dayMap.set(ds, { label: fmtHomeDate(p.createdAt), list: [] });
      dayMap.get(ds).list.push(p);
    });
    cards = dayMap.size ? Array.from(dayMap.entries()).map(([ds, g]) => {
      const collapsed = COLLAPSED_GROUPS.has(ds);
      const rows = g.list.map(p => partnerCardHtml(p, shipCountMap)).join('');
      const expandTip = collapsed && g.list.length > 0
        ? `<div class="join-expand" data-act="group-toggle" data-ds="${esc(ds)}">展开 ${g.list.length} 个伙伴 ▼</div>`
        : '';
      return `<div class="join-group ${collapsed ? 'collapsed' : ''}" data-ds="${esc(ds)}">
        <div class="join-date" data-act="group-toggle" data-ds="${esc(ds)}">
          <span>${esc(g.label)} <span class="join-count">${g.list.length} 人</span></span>
          <span class="join-toggle ${collapsed ? '' : 'open'}">${collapsed ? '▶' : '▼'}</span>
        </div>
        ${collapsed ? expandTip : rows}
      </div>`;
    }).join('') : `<div class="card" style="text-align:center;color:var(--gray);font-size:13px">没有匹配的伙伴</div>`;
  } else {
    cards = list.length ? list.map(p => partnerCardHtml(p, shipCountMap)).join('') : `<div class="card" style="text-align:center;color:var(--gray);font-size:13px">没有匹配的伙伴</div>`;
  }

  const batchBar = BATCH_MODE
    ? `<div class="batch-bar">
        <div class="batch-left">
          <button class="chip" data-act="batch-select-all">全选</button>
          <span class="batch-count">已选 ${BATCH_SEL.size} 个</span>
        </div>
        <div class="batch-right">
          <button class="btn-batch-action danger" data-act="batch-delete">删除</button>
          <button class="btn-batch-action" data-act="batch-tier">改分组</button>
          <button class="btn-batch-action" data-act="batch-status">改状态</button>
          <button class="btn-batch-action ghost" data-act="batch-toggle">完成</button>
        </div>
      </div>`
    : `<div class="pcards-bar">
        <div class="left">点击伙伴行展开看单号，点击「📝」直接看详情</div>
        <div class="right-group">
          <button class="right" data-act="toggle-group-by-date">${GROUP_BY_DATE ? '切换扁平列表' : '按入驻日期分组'}</button>
          <button class="right" data-act="toggle-all">全部展开 / 折叠</button>
          <button class="right batch-btn" data-act="batch-toggle">批量管理</button>
        </div>
      </div>`;
  document.getElementById('view-partners').innerHTML = `
    <div class="sec-title" style="font-size:22px">我的伙伴</div>
    <div class="search">🔍<input id="search-input" placeholder="搜索昵称 / 微信 / 模特ID / 备注" value="${esc(searchQ)}"></div>
    <div class="chips">${chips}</div>
    <div class="chips city-chips">${cityChips}</div>
    ${batchBar}
    ${cards}`;
  const si = document.getElementById('search-input');
  if (si) {
    // 输入过程中不重新渲染，避免 input 被重建失焦；按回车或失焦时触发搜索
    si.addEventListener('keydown', e => {
      if (e.key === 'Enter') { searchQ = e.target.value.trim(); renderPartners(); }
    });
    si.addEventListener('blur', e => {
      const v = e.target.value.trim();
      if (v !== searchQ) { searchQ = v; renderPartners(); }
    });
  }
}

// ---------- 福利 ----------
function renderGift() {
  const pct = STATS ? Math.round(STATS.used / STATS.budget * 100) : 0;
  const cols = [[], []];
  GIFTS.forEach((g, i) => cols[i % 2].push(g));
  const grid = `<div class="gift-grid">${cols.map(c => `<div class="gift-col">${c.map(g => `
    <div class="gift">
      <div class="img" style="background:${g.bg}">${g.emoji}</div>
      <div class="nm">${g.name}</div>
      <div class="meta"><span class="price">${g.price ? '¥' + g.price : '免费'}</span>
      <button class="send" data-act="gift" data-name="${esc(g.name)}" data-price="${g.price}">送出</button></div>
    </div>`).join('')}</div>`).join('')}</div>`;
  const sent = (DB.gifts || []).slice().sort((a, b) => b.at - a.at);
  const sentHtml = sent.length ? sent.map(g => `
    <div class="sent-item"><div class="ic">🎁</div><div class="info"><div class="nm">${esc(g.partnerName)} · ${esc(g.giftName)}</div>
    <div class="mt">${g.note ? esc(g.note) + ' · ' : ''}${fmtTime(g.at)}${g.price ? ' · ¥' + g.price : ''}</div></div></div>`).join('')
    : `<div class="card" style="text-align:center;color:var(--gray);font-size:13px">还没有送出礼品</div>`;

  document.getElementById('view-gift').innerHTML = `
    <div class="hero-card">
      <div class="n">本月已发送 ${STATS ? STATS.sent : 0} 份礼品</div>
      <div class="s">预算 ¥${STATS ? STATS.budget : 3000} / 已用 ¥${STATS ? STATS.used : 0}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>
    <div class="chips" id="gift-tabs">
      <button class="chip on" data-act="gift-tab" data-g="lib">礼品库</button>
      <button class="chip" data-act="gift-tab" data-g="sent">已送出</button>
      <button class="chip" data-act="gift-tab" data-g="code">兑换码</button>
      <button class="chip" data-act="gift-tab" data-g="ship">发货</button>
    </div>
    <div id="gift-body">${grid}</div>`;
  window.__giftGrid = grid; window.__giftSent = sentHtml;
}
function renderGiftBody(g) {
  const body = document.getElementById('gift-body');
  if (!body) return;
  if (g === 'lib') body.innerHTML = window.__giftGrid;
  else if (g === 'sent') body.innerHTML = window.__giftSent;
  else if (g === 'ship') renderShipments();
  else body.innerHTML = `<div class="card" style="text-align:center;color:var(--gray);font-size:13px">电子贺卡类礼品可在此生成兑换码<br>（演示环境：送出「电子贺卡」后自动记录）</div>`;
}

// ---------- 发货 / 物流 ----------
function addrText(a, plain) {
  if (!a || (!a.name && !a.detail)) return '尚未填写收件地址';
  const parts = [a.name, a.phone, [a.province, a.city, a.district].filter(Boolean).join(''), a.detail, a.postal].filter(Boolean);
  return esc(parts.join(plain ? ' ' : ' · '));
}
function hasAddress(a) { return !!(a && (a.name || a.detail)); }

// 发货记录列表渲染（复用：礼品页子 tab + 发货管理 tab）
function shipListItemsHtml(ships) {
  if (!ships.length) return '<div class="card" style="text-align:center;color:var(--gray);font-size:13px">还没有发货记录</div>';
  return ships.map(s => {
    const last = (s.logs && s.logs[0]) ? s.logs[0] : null;
    const trackDate = s.trackingAddedAt ? ' · ' + fmtShipDate(s.trackingAddedAt) : '';
    return `<div class="ship-item">
      <div class="si-top"><div><div class="nm">${esc(s.partnerName)} · ${esc(s.giftName)}</div>
      <div class="mt">${esc(s.carrier || '未填快递')}${s.trackingNo ? ' · 单号 ' + esc(s.trackingNo) + trackDate : ''}</div></div>
      <span class="badge" style="background:${SHIP_COLOR[effStatus(s)] || '#9AA0AD'}">${SHIP_STATUS[effStatus(s)] || effStatus(s)}</span></div>
      ${s.productLink ? `<div class="si-link"><a href="${esc(s.productLink)}" target="_blank" rel="noopener">🔗 拼多多商品链接</a></div>` : ''}
      <div class="si-last">${last ? '最新: ' + esc(last.desc) + ' · ' + fmtTime(last.time) : ''}</div>
      <div class="si-act">
        <button class="btn-sm" data-act="ship" data-id="${s.id}">更新物流</button>
        <button class="btn-line" style="width:auto;padding:6px 12px;color:#FF6B5C" data-act="ship-del" data-id="${s.id}">删除</button>
      </div></div>`;
  }).join('');
}
function shipSkeletonHtml() {
  return `<div class="ship-skeleton">
    <div class="sk-head"><div class="sk-title"></div><div class="sk-circle"></div></div>
    <div class="sk-btn"></div>
    <div class="sk-item"><div class="sk-line"></div><div class="sk-line short"></div></div>
    <div class="sk-item"><div class="sk-line"></div><div class="sk-line short"></div></div>
    <div class="sk-item"><div class="sk-line"></div><div class="sk-line short"></div></div>
  </div>`;
}

async function renderShipments() {
  const body = document.getElementById('gift-body');
  if (!body) return;
  // 复用 DB 缓存秒开；无缓存时再走网络
  const cached = DB.shipments || [];
  if (cached.length) {
    body.innerHTML = `<button class="btn-primary" style="margin-bottom:12px" data-act="ship-new" data-pid="">新建发货</button>${shipListItemsHtml(cached)}`;
    return;
  }
  body.innerHTML = shipSkeletonHtml();
  try {
    const data = await api('/admin/shipments');
    SHIPS = data.shipments || [];
    body.innerHTML = `<button class="btn-primary" style="margin-bottom:12px" data-act="ship-new" data-pid="">新建发货</button>${shipListItemsHtml(SHIPS)}`;
  } catch (e) {
    body.innerHTML = '<div class="card" style="text-align:center;color:var(--gray);font-size:13px">加载失败</div>';
  }
}

// ---------- 发货管理 Tab ----------
function renderShipTabContent(view, ships) {
  SHIPS = ships;
  const pending = ships.filter(s => effStatus(s) !== 'delivered' && effStatus(s) !== 'signed').length;
  view.innerHTML = `
    <div class="header">
      <div class="row">
        <div>
          <div class="hi">发货管理</div>
          <div class="sub">共 ${ships.length} 条发货记录 · ${pending} 条在途中</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="header-refresh" data-act="refresh-ship" title="刷新发货数据">↻</button>
          <div class="avatar" style="background:linear-gradient(135deg,#FF8A6B,#FF6B5C)">📦</div>
        </div>
      </div>
    </div>
    <button class="btn-primary ship-new-main" data-act="ship-new" data-pid="">＋ 新建发货</button>
    ${ships.length ? shipListItemsHtml(ships) : '<div class="card" style="text-align:center;color:var(--gray);font-size:13px">还没有发货记录，点击上方「新建发货」开始</div>'}`;
}
async function renderShipTab() {
  const view = document.getElementById('view-ship');
  if (!view) return;
  // 优先用 DB 缓存（loadData 初始化/刷新时已拉取），切 tab 不再重复请求
  const cached = DB.shipments || [];
  if (cached.length || (DB.partners && DB.partners.length)) {
    renderShipTabContent(view, cached);
    return;
  }
  // 无缓存（如刚登录还没拉完）则展示骨架屏并等待
  view.innerHTML = shipSkeletonHtml();
}

function openShip(ship, pid) {
  const create = !ship;
  const partnersOpts = DB.partners.slice().sort((a, b) => b.createdAt - a.createdAt).map(p =>
    `<option value="${p.id}" ${pid && p.id == pid ? 'selected' : ''}>${esc(p.name)}（${p.tier === 'new' ? '新提交' : (TIER_LABEL[p.tier] || '')}）</option>`).join('');
  if (create) {
    const todayStr = (new Date()).toISOString().slice(0, 10).replace(/-/g, '');
    document.getElementById('sheet-ship').innerHTML = `
      <h3>新建发货</h3>
      <div class="field"><label>选择伙伴 *</label><select id="sh-pid">${partnersOpts}</select></div>
      <div class="field"><label>礼品名称 *</label><input id="sh-gift" value="${todayStr}-模特礼品" readonly style="background:#F7F8FA;color:#5F626A"></div>
      <div class="field"><label>拼多多商品链接（选填）</label><input id="sh-link" placeholder="在拼多多买好后，粘贴商品/订单链接，模特可在专属页一键查看"></div>
      <div class="field"><label>快递公司 *</label><select id="sh-carrier">
        <option value="">请选择快递公司</option>
        <option value="顺丰">顺丰（shunfeng）</option>
        <option value="中通">中通（zhongtong）</option>
        <option value="圆通">圆通（yuantong）</option>
        <option value="韵达">韵达（yunda）</option>
        <option value="申通">申通（shentong）</option>
        <option value="京东">京东（jd）</option>
        <option value="邮政">邮政（youzheng）</option>
        <option value="EMS">EMS（ems）</option>
      </select></div>
      <div class="field"><label>快递单号</label><input id="sh-no" placeholder="填写后伙伴可在专属页查看"></div>
      <div class="field"><label>收件人手机后四位<span style="color:var(--coral)">（必填）</span></label>
        <input id="sh-phone" maxlength="4" inputmode="numeric" placeholder="选伙伴后自动从收件地址取后四位">
        <div style="font-size:11px;color:var(--gray);margin-top:4px">快递100实时查询需要此字段；如未填则无法同步物流</div>
      </div>
      <div class="field"><label>礼品价值（元，必填）<span style="color:var(--coral)">*</span></label><input id="sh-value" type="number" min="0.01" step="0.01" placeholder="填写后才会累计到「累计福利价值」"></div>
      <div class="field"><label>备注 / 首批物流信息</label><textarea id="sh-note" placeholder="如：已揽收，今日发出"></textarea></div>
      <button class="btn-primary" data-act="ship-create">确认发货</button>
      <button class="btn-line" data-act="close" data-ov="ov-ship">取消</button>`;
    // 当选择伙伴时，自动从其地址手机号后四位预填 phone 字段
    setTimeout(() => {
      const ps = document.getElementById('sh-pid');
      const ph = document.getElementById('sh-phone');
      if (!ps || !ph) return;
      const fill = () => {
        const p = DB.partners.find(x => x.id == Number(ps.value));
        if (p && p.address && p.address.phone) {
          const last4 = String(p.address.phone).replace(/\D/g, '').slice(-4);
          if (last4.length === 4) { ph.value = last4; ph.placeholder = '已自动从「' + p.name + '」的手机号取后四位，可改'; }
        } else {
          ph.placeholder = '请手填该伙伴地址手机号的后四位';
        }
      };
      ps.addEventListener('change', fill);
      fill();
    }, 0);
  } else {
    const logs = (ship.logs || []).map(l => `<div class="it"><div class="dot" style="background:${SHIP_COLOR[l.status] || '#FF6B5C'}"></div>
      <div><div class="tt">${esc(l.desc)}</div><div class="ta">${SHIP_STATUS[l.status] || ''} · ${fmtTime(l.time)}</div></div></div>`).join('') || '<div style="color:var(--gray);font-size:13px">暂无轨迹</div>';
    document.getElementById('sheet-ship').innerHTML = `
      <h3>物流更新 · ${esc(ship.partnerName)}</h3>
      <div class="field"><label>快递公司</label><div style="font-size:13px">${esc(ship.carrier || '—')}</div></div>
      <div class="field"><label>快递单号</label><div style="font-size:13px;color:var(--coral)">${esc(ship.trackingNo || '未填')}</div></div>
      <div class="field"><label>当前状态</label><span class="badge" style="background:${SHIP_COLOR[effStatus(ship)] || '#9AA0AD'}">${SHIP_STATUS[effStatus(ship)] || effStatus(ship)}</span></div>
      <div class="field"><label>礼品价值（元）<span style="color:var(--coral)">*</span></label><input id="sh-value2" type="number" min="0.01" step="0.01" value="${Number(ship.value || 0).toFixed(2)}" placeholder="填写后才会累计到「累计福利价值」"></div>
      <div class="field"><label>物流轨迹</label><div class="tl">${logs}</div></div>
      <div class="field"><label>添加节点：状态</label><div class="tier-row" id="sh-status">
        ${Object.keys(SHIP_STATUS).map(k => `<button class="chip ${k === 'transit' ? 'on' : ''}" data-status="${k}">${SHIP_STATUS[k]}</button>`).join('')}
      </div></div>
      <div class="field"><label>节点说明</label><textarea id="sh-desc" placeholder="如：已到达杭州转运中心"></textarea></div>
      <div class="field"><label>修改单号（可选）</label><input id="sh-no2" value="${esc(ship.trackingNo || '')}" placeholder="留空则不修改"></div>
      <div class="field"><label>收件人手机后四位<span style="color:var(--coral)">（必填）</span></label>
        <input id="sh-phone2" maxlength="4" inputmode="numeric" value="${esc(ship.phone || '')}" placeholder="选后会从伙伴地址自动取">
        <div style="font-size:11px;color:var(--gray);margin-top:4px">已自动带出该伙伴地址手机号后四位，可改</div>
      </div>
      <button class="btn-primary" data-act="ship-log" data-id="${ship.id}">添加物流节点</button>
      <button class="btn-ghost" data-act="ship-track" data-id="${ship.id}">同步真实物流（快递100）</button>
      <button class="btn-line" data-act="close" data-ov="ov-ship">关闭</button>`;
    // 自动从该伙伴地址填充手机后四位（如未填）
    setTimeout(() => {
      const ph2 = document.getElementById('sh-phone2');
      if (ph2 && !ph2.value && DB && DB.partners) {
        const p = DB.partners.find(x => x.id == ship.partnerId);
        if (p && p.address && p.address.phone) {
          const last4 = String(p.address.phone).replace(/\D/g, '').slice(-4);
          if (last4.length === 4) ph2.value = last4;
        }
      }
    }, 0);
  }
  document.getElementById('ov-ship').classList.add('show');
}

// ---------- 互动 ----------
function renderInteraction() {
  const all = [];
  DB.partners.forEach(p => (p.interactions || []).forEach(it => all.push(Object.assign({ name: p.name, tier: p.tier }, it))));
  all.sort((a, b) => b.at - a.at);
  const feed = all.slice(0, 14).map(it => `
    <div class="ri"><div class="av" style="background:${avColor(it.tier, it.name)}">${esc((it.name || '?').slice(0, 1))}</div>
    <div class="info"><div class="tx">${esc(it.text)}</div><div class="tm">${fmtTime(it.at)}</div></div></div>`).join('') ||
    `<div class="card" style="text-align:center;color:var(--gray);font-size:13px">暂无互动记录</div>`;
  const reply = STATS ? Math.min(99, 70 + STATS.news) : 89;
  document.getElementById('view-interaction').innerHTML = `
    <div class="sec-title" style="font-size:22px">互动中心</div>
    <div class="stats">
      <div class="stat"><div class="n">${STATS ? STATS.sent + STATS.news : 0}</div><div class="l">本月互动</div></div>
      <div class="stat"><div class="n" style="color:#2BB673">${reply}%</div><div class="l">回复率</div></div>
      <div class="stat"><div class="n" style="color:#5B7CFA">${STATS ? STATS.news : 0}</div><div class="l">新入驻</div></div>
    </div>
    <div class="sec-title">触达工具</div>
    <div class="action"><div class="ic" style="background:#FFEAE5;color:#FF6B5C">1v1</div><div class="info"><div class="nm">1v1 私聊</div><div class="ds">针对重点伙伴发送问候与上新品</div></div></div>
    <div class="action"><div class="ic" style="background:#FFF3E0;color:#E58A3F">群</div><div class="info"><div class="nm">群发消息</div><div class="ds">新品上架 / 节日活动 / 优惠推送</div></div></div>
    <div class="action"><div class="ic" style="background:#E8EEFF;color:#5B7CFA">◇</div><div class="info"><div class="nm">朋友圈 / 活动</div><div class="ds">发布动态 / 启动拼团 / 限时活动</div></div></div>
    <div class="sec-title">最近互动</div>
    <div class="feed">${feed}</div>`;
}

// ---------- 我的 ----------
function renderMe() {
  document.getElementById('view-me').innerHTML = `
    <div class="profile">
      <div class="prow"><div class="av">福</div><div><div class="pname">福利派送官</div><div class="prole">私域主理人 · 高级版</div></div></div>
      <div class="pstats">
        <div><div class="n" id="me-total">0</div><div class="l">伙伴</div></div>
        <div><div class="n" id="me-interact">0</div><div class="l">互动</div></div>
        <div><div class="n" id="me-gift">0</div><div class="l">礼品</div></div>
      </div>
    </div>
    <div class="menu">
      <div class="mi" data-act="tab" data-tab="partners"><div class="ic" style="background:#FFEAE5;color:#FF6B5C">♥</div><div class="nm">我的伙伴</div><div class="ar">›</div></div>
      <div class="mi" data-act="tab" data-tab="gift"><div class="ic" style="background:#FFF3E0;color:#E58A3F">★</div><div class="nm">礼品记录</div><div class="ar">›</div></div>
      <div class="mi" data-act="tab" data-tab="ops"><div class="ic" style="background:#E8F5E9;color:#2BB673">📊</div><div class="nm">运营数据</div><div class="ar">›</div></div>
      <div class="mi" data-act="tab" data-tab="rebate"><div class="ic" style="background:#E8F5E9;color:#2BB673">💰</div><div class="nm">返款管理</div><div class="ar">›</div></div>
      <div class="mi" data-act="export"><div class="ic" style="background:#E8EEFF;color:#5B7CFA">⬇</div><div class="nm">导出伙伴数据 (CSV)</div><div class="ar">›</div></div>
      <div class="mi" data-act="logout"><div class="ic" style="background:#EDEDF0;color:#6B7280">⚙</div><div class="nm">退出登录</div><div class="ar">›</div></div>
    </div>
    <div style="text-align:center;color:var(--gray);font-size:11px;margin-top:18px">合作伙伴入驻页：<br><span style="color:var(--coral)">本机地址/join.html</span></div>`;
}

// ---------- 羊毛情报 / 补贴好物 ----------
let woolPlatform = 'all';
const WOOL_PLATFORMS = ['京东', '淘宝', '拼多多', '抖音', '其他'];
const SCENES = ['新人见面礼', '复购激活', '转介绍答谢', '节日关怀', '日常补给'];
function renderWool() {
  const deals = DB.deals || [];
  const chips = [['all', '全部 ' + deals.length]].concat(
    WOOL_PLATFORMS.map(p => [p, p + ' ' + deals.filter(d => d.platform === p).length])
  ).map(([t, l]) => `<button class="chip ${woolPlatform === t ? 'on' : ''}" data-act="wool-chip" data-p="${t}">${l}</button>`).join('');
  let list = deals.slice();
  if (woolPlatform !== 'all') list = list.filter(d => d.platform === woolPlatform);
  list.sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0) || b.createdAt - a.createdAt);

  const pubCount = deals.filter(d => d.status === 'published').length;
  const draftCount = deals.length - pubCount;
  const cards = list.length ? list.map(d => {
    const off = (d.origPrice > d.dealPrice && d.origPrice > 0) ? `<span class="wool-orig">¥${fmtMoney(d.origPrice)}</span>` : '';
    const disc = (d.origPrice > d.dealPrice && d.origPrice > 0) ? Math.round((1 - d.dealPrice / d.origPrice) * 100) : 0;
    const discTag = disc > 0 ? `<span class="tag" style="background:#E8F5E9;color:#2BB673">省${disc}%</span>` : '';
    const statusTag = d.status === 'published'
      ? `<span class="tag" style="background:#E8EEFF;color:#5B7CFA">已发布</span>`
      : `<span class="tag" style="background:#FFF3E0;color:#E58A3F">草稿</span>`;
    const commTag = d.commissionRate > 0 ? `<span class="tag" style="background:#F0E9FF;color:#7C6CF0">佣${d.commissionRate}%</span>` : '';
    return `<div class="wool-card" data-id="${d.id}">
      <div class="wc-head"><div class="wc-title">${esc(d.title)}</div>${statusTag}</div>
      <div class="wc-meta"><span class="tag">${esc(d.platform || '其他')}</span>${discTag}${commTag}${d.coupon ? `<span class="tag" style="background:#FFEAE5;color:#FF6B5C">${esc(d.coupon)}</span>` : ''}</div>
      <div class="wc-price">${off}<span class="wc-now">¥${fmtMoney(d.dealPrice)}</span></div>
      <div class="wc-act">
        <button class="btn-sm" data-act="wool-publish" data-id="${d.id}" data-pub="${d.status === 'published' ? 0 : 1}">${d.status === 'published' ? '下架' : '发布'}</button>
        <button class="btn-line" style="width:auto;padding:6px 12px;color:#5B7CFA" data-act="wool-edit" data-id="${d.id}">编辑</button>
        <button class="btn-line" style="width:auto;padding:6px 12px;color:#FF6B5C" data-act="wool-del" data-id="${d.id}">删除</button>
      </div>
    </div>`;
  }).join('') : `<div class="card" style="text-align:center;color:var(--gray);font-size:13px">还没有补贴品，点下面「＋ 新增补贴品」开始收集羊毛 🐑</div>`;

  document.getElementById('view-wool').innerHTML = `
    <div class="header">
      <div class="row"><div class="hi">伙伴补给仓</div><div class="avatar">补</div></div>
      <div class="sub">收集低价优质补贴好物，买来派给伙伴 · 换复购与转介绍</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="n" style="color:#2BB673">${pubCount}</div><div class="l">已发布</div></div>
      <div class="stat"><div class="n" style="color:#E58A3F">${draftCount}</div><div class="l">草稿</div></div>
      <div class="stat"><div class="n">${deals.length}</div><div class="l">总计</div></div>
    </div>
    <div class="quick">
      <div class="qa" data-act="wool-add"><div class="ic" style="background:#FFEAE5">＋</div><div class="t">新增补贴品</div></div>
      <div class="qa" data-act="wool-paste"><div class="ic" style="background:#E6F7FF">🔗</div><div class="t">粘贴链接采集</div></div>
      <div class="qa" data-act="wool-pdd"><div class="ic" style="background:#E8F8EE">🐂</div><div class="t">从多多进宝拉品</div></div>
      <div class="qa" data-act="wool-register"><div class="ic" style="background:#EDE7FF">🔐</div><div class="t">生成授权备案链接</div></div>
      <div class="qa" data-act="wool-copy-link"><div class="ic" style="background:#E8EEFF">🔗</div><div class="t">复制分享页</div></div>
      <div class="qa" data-act="wool-share"><div class="ic" style="background:#FFF3E0">📋</div><div class="t">生成文案</div></div>
    </div>
    <div class="chips">${chips}</div>
    ${cards}`;
}

function openDealAdd() {
  document.getElementById('sheet-deal').innerHTML = dealFormHtml(null);
  document.getElementById('ov-deal').classList.add('show');
}
function openDealEdit(id) {
  const d = (DB.deals || []).find(x => x.id == id);
  if (!d) return;
  document.getElementById('sheet-deal').innerHTML = dealFormHtml(d);
  document.getElementById('ov-deal').classList.add('show');
}
function dealFormHtml(d) {
  const isEdit = !!d;
  const v = (k) => d ? esc((d[k] === 0 || d[k]) ? String(d[k]) : '') : '';
  const PLAT = ['京东', '淘宝', '拼多多', '抖音', '其他'];
  return `
    <h3>${isEdit ? '编辑补贴品' : '新增补贴品'}</h3>
    <div class="field"><label>商品标题 *</label><input id="d-title" value="${v('title')}" placeholder="如：9.9 元包邮·抽纸 30 包"></div>
    <div class="field"><label>平台</label><select id="d-platform">${PLAT.map(p => `<option value="${p}" ${d && d.platform === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    <div class="field"><label>原价（元）</label><input id="d-orig" type="number" step="0.01" value="${v('origPrice')}" placeholder="如 39.9"></div>
    <div class="field"><label>补贴价 / 到手价（元）*</label><input id="d-deal" type="number" step="0.01" value="${v('dealPrice')}" placeholder="如 9.9"></div>
    <div class="field"><label>券 / 活动说明</label><input id="d-coupon" value="${v('coupon')}" placeholder="如：满50减10 / 百亿补贴"></div>
    <div class="field"><label>佣金比例（%，选填）</label><input id="d-comm" type="number" step="0.1" value="${v('commissionRate')}" placeholder="如 5"></div>
    <div class="field"><label>推广 / 购买链接 *</label><input id="d-promo" value="${v('promoUrl')}" placeholder="https://..."></div>
    <div class="field"><label>图片链接（选填）</label><input id="d-img" value="${v('imageUrl')}" placeholder="https://...jpg"></div>
      <div class="field"><label>备注（选填）</label><textarea id="d-remark" placeholder="选品心得 / 提醒">${v('remark')}</textarea></div>
      <div class="field"><label>派发场景</label><select id="d-scene">${[''].concat(SCENES).map(s => `<option value="${s}" ${d && d.scene === s ? 'selected' : ''}>${s || '未分类'}</option>`).join('')}</select></div>
      <div class="field"><label>派发价值（选填）</label><input id="d-dist" value="${v('distValue')}" placeholder="如：1 次新客触达 / 1 次复购激活"></div>
    ${isEdit ? `<button class="btn-primary" data-act="deal-save" data-id="${d.id}">保存修改</button>` : `<button class="btn-primary" data-act="deal-save">保存并设为草稿</button>`}
    <button class="btn-line" data-act="close" data-ov="ov-deal">取消</button>`;
}
async function saveDeal(id) {
  const b = {
    title: document.getElementById('d-title').value.trim(),
    platform: document.getElementById('d-platform').value,
    origPrice: document.getElementById('d-orig').value,
    dealPrice: document.getElementById('d-deal').value,
    coupon: document.getElementById('d-coupon').value.trim(),
    commissionRate: document.getElementById('d-comm').value,
    promoUrl: document.getElementById('d-promo').value.trim(),
    imageUrl: document.getElementById('d-img').value.trim(),
    remark: document.getElementById('d-remark').value.trim(),
    scene: document.getElementById('d-scene').value,
    distValue: document.getElementById('d-dist').value.trim(),
    status: 'draft'
  };
  if (!b.title) { toast('请填写商品标题'); return; }
  if (!b.dealPrice && b.dealPrice !== '0') { toast('请填写补贴价'); return; }
  if (!b.promoUrl) { toast('请填写推广链接'); return; }
  try {
    if (id) await Api.updateDeal(Number(id), b);
    else await Api.createDeal(b);
    document.getElementById('ov-deal').classList.remove('show');
    toast(id ? '已保存' : '已新增（草稿）');
    await loadData();
  }   catch (e) { toast(e.message || '保存失败', { err: true }); }
}

// ---------- 粘贴拼多多链接采集（手动引入平台补贴好物，伙伴自购） ----------
function openPddPaste() {
  document.getElementById('sheet-paste').innerHTML = `
    <h3>粘贴拼多多链接采集 🔗</h3>
    <div class="sub" style="margin:-4px 0 10px">从 9.9特卖 / 5折购 / 百亿补贴 等页面，点进具体商品 → 「分享 → 复制链接」，每行粘贴一个。系统优先按 goods_sign 自动补全标题/到手价/主图；若链接是 ?ps= 短链（不含 goods_sign），会尝试解析出商品 ID 并允许你手动填写价格后保存。购买链接即你粘贴的链接，伙伴点开自己去拼多多买。</div>
    <div class="field"><label>拼多多商品链接（每行一个）</label><textarea id="paste-links" rows="6" placeholder="https://mobile.yangkeduo.com/goods2.html?ps=...&#10;https://mobile.yangkeduo.com/goods.html?goods_id=...&#10;可粘贴多个，每行一个"></textarea></div>
    <div class="field"><label>派发场景（统一应用到本批）</label><select id="paste-scene">${[''].concat(SCENES).map(s => `<option value="${s}">${s || '未分类'}</option>`).join('')}</select></div>
    <button class="btn-primary" data-act="paste-fetch">解析并补全</button>
    <div id="paste-preview" class="pp-list"></div>
    <button class="btn-primary" data-act="paste-save" id="paste-save-btn" style="display:none">存入补贴品（草稿）</button>
    <button class="btn-line" data-act="close" data-ov="ov-paste">取消</button>`;
  document.getElementById('ov-paste').classList.add('show');
}
function extractParam(s, key) {
  const m = s.match(new RegExp(key + '=([^&\\s"\')]+)', 'i'));
  return m ? decodeURIComponent(m[1]) : '';
}
function renderPastePreview(items) {
  const box = document.getElementById('paste-preview');
  if (!items.length) { box.innerHTML = ''; return; }
  box.innerHTML = items.map((it, i) => {
    const img = it.imageUrl ? `<img src="${esc(it.imageUrl)}" alt="" onerror="this.style.display='none'">` : '🛍️';
    const status = it.ok
      ? `<span class="tag" style="background:#E8F5E9;color:#2BB673">已自动补全</span>`
      : `<span class="tag" style="background:#FFF3E0;color:#E58A3F">${it.err ? '需手填：' + esc(String(it.err).slice(0, 18)) : '需手动填写标题/价格'}</span>`;
    const meta = (it.goodsId || it.gs) ? `<div class="muted" style="font-size:11px;margin-top:4px">${it.gs ? 'goods_sign 已识别' : 'goods_id ' + it.goodsId}</div>` : '';
    return `<label class="pp-item">
      <input type="checkbox" class="paste-ck" data-i="${i}" checked>
      <div class="pp-img">${img}</div>
      <div class="pp-info">
        <input class="paste-title" data-i="${i}" value="${esc(it.title)}" placeholder="商品标题（必填）">
        <div style="display:flex;gap:6px;margin-top:6px">
          <input class="paste-price" data-i="${i}" type="number" step="0.01" value="${it.dealPrice}" placeholder="到手价" style="flex:1;min-width:0">
          <input class="paste-ori" data-i="${i}" type="number" step="0.01" value="${it.origPrice}" placeholder="原价" style="flex:1;min-width:0">
        </div>
        ${status}${meta}
      </div>
    </label>`;
  }).join('');
}

// ---------- 从多多进宝拉品（Edge Function 签名代理） ----------
function openPddImport() {
  window.__pddPage = 1; window.__pddParams = null; window.__pddAction = 'search'; window.__pddOffset = 0;
  document.getElementById('sheet-pdd').innerHTML = `
    <h3>从多多进宝拉品 🐂</h3>
    <div class="sub" style="margin:-4px 0 10px">自动拉取补贴好物并转成你的推广链接，一键入库为草稿</div>
    <div class="field">
      <label>数据源</label>
      <select id="p-source">
        <option value="search" selected>关键词搜索（pdd.ddk.goods.search）</option>
        <option value="recommend-hot">实时热销榜（平台官方频道）</option>
        <option value="recommend-daily">今日销量榜（平台官方频道）</option>
        <option value="search-featured">官方直推爆款（精选爆品）</option>
      </select>
      <span class="muted" style="font-size:12px">实时热销榜/今日销量榜是多多进宝官方频道，质量相对高、引流SKU少</span>
    </div>
    <div class="field" id="p-keyword-wrap"><label>关键词</label><input id="p-keyword" placeholder="如：补贴 / 9.9 / 纸巾 / 洗衣液"></div>
    <div class="field row2">
      <div style="flex:1"><label>拉取数量</label><input id="p-count" type="number" value="20" min="1" max="50"></div>
      <div style="flex:1" id="p-sort-wrap"><label>排序</label><select id="p-sort">
        <option value="9">券后价低到高</option><option value="10">券后价高到低</option><option value="5">佣金优先</option><option value="3">销量优先</option><option value="0">综合</option>
      </select></div>
    </div>
    <div class="field row2">
      <div style="flex:1"><label>到手价最低（元）</label><input id="p-min-price" type="number" value="3" min="0" max="50" step="0.5"></div>
      <div style="flex:1"><label>到手价封顶（元）</label><input id="p-max-price" type="number" value="5" min="1" max="50" step="0.5"></div>
    </div>
    <div class="field row2">
      <div style="flex:1" id="p-activity-wrap"><label>活动类型</label><select id="p-activity">
        <option value="">全部补贴/券</option><option value="7" selected>百亿补贴（平台官方补贴）</option><option value="10851">千万补贴</option><option value="4">秒杀</option><option value="10913">招商礼金</option><option value="10564">官方直推爆款</option>
      </select></div>
      <div style="flex:1;display:flex;align-items:flex-end"><label class="ck"><input type="checkbox" id="p-coupon"> 只看有优惠券</label></div>
    </div>
    <div class="field"><span class="muted" style="font-size:12px">提示：百亿补贴是补贴价本身、非店铺券，建议不勾选“只看有优惠券”以拉到更多；实时热销榜/今日销量榜是平台官方频道，质量更稳。</span></div>
    <button class="btn-primary" data-act="pdd-fetch">拉取候选</button>
    <div id="pdd-cands" class="pp-list"></div>
    <button class="btn-primary" data-act="pdd-import" id="pdd-import-btn" style="display:none">入库选中（草稿）</button>
    <button class="btn-line" data-act="pdd-more" id="pdd-more-btn" style="display:none">换一批 / 加载更多</button>
    <button class="btn-line" data-act="close" data-ov="ov-pdd">取消</button>`;
  document.getElementById('ov-pdd').classList.add('show');
  document.getElementById('p-source').addEventListener('change', e => {
    const isRec = String(e.target.value).startsWith('recommend-');
    const isFeatured = e.target.value === 'search-featured';
    const kw = document.getElementById('p-keyword-wrap');
    const sort = document.getElementById('p-sort-wrap');
    const act = document.getElementById('p-activity-wrap');
    if (kw) kw.style.display = isRec ? 'none' : 'block';
    if (sort) sort.style.display = isRec ? 'none' : 'block';
    if (act) act.style.display = (isRec || isFeatured) ? 'none' : 'block';
  });
}

// 生成多多进宝 API 层授权备案链接（解决 60001）
async function openPddRegister() {
  const sheet = document.getElementById('sheet-pdd');
  sheet.innerHTML = `
    <h3>生成授权备案链接 🔐</h3>
    <div class="sub" style="margin:-4px 0 10px">多多进宝要求每个 PID 完成一次 API 层授权备案，转链接口才能用。点下方按钮生成授权短链，在手机/浏览器打开并完成登录即生效（授权一次即可，长期有效）。</div>
    <button class="btn-primary" id="pdd-reg-btn">生成授权短链</button>
    <div id="pdd-reg-result" class="pp-list"></div>
    <button class="btn-line" data-act="close" data-ov="ov-pdd">关闭</button>`;
  document.getElementById('ov-pdd').classList.add('show');
  const btn = document.getElementById('pdd-reg-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true; const old = btn.textContent; btn.textContent = '生成中…';
    try {
      const res = await Api.fetchPdd({ action: 'register' });
      if (!res || !res.ok) { toast('生成失败：' + (res?.error || '未知错误'), { err: true }); btn.disabled = false; btn.textContent = old; return; }
      const u = res.urls || {};
      const openUrl = u.short_url || u.mobile_short_url || u.url || u.mobile_url || '';
      const box = document.getElementById('pdd-reg-result');
      if (!openUrl) { box.innerHTML = '<div class="muted">未返回链接，请确认 Edge Function 已部署并配置了 PDD_PID</div>'; btn.disabled = false; btn.textContent = old; return; }
      box.innerHTML = `<div class="pp-item" style="cursor:default">
        <div class="pp-info">
          <div class="pp-title">① 打开下面链接完成授权</div>
          <div class="pp-meta"><a href="${openUrl}" target="_blank" rel="noopener" style="color:#5B7CFA;word-break:break-all">${esc(openUrl)}</a></div>
          <button class="btn-line" id="pdd-copy-link" style="width:auto;padding:4px 10px;color:#5B7CFA;margin-top:6px">复制链接</button>
        </div>
      </div>
      <div class="muted" style="padding:8px 0">② 打开后按提示登录/确认，再回到「从多多进宝拉品」即可正常入库转链。</div>`;
      document.getElementById('pdd-copy-link').addEventListener('click', () => {
        const t = openUrl;
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => toast('已复制')).catch(() => prompt('复制此链接：', t));
        else prompt('复制此链接：', t);
      });
    } catch (e) { toast(e.message || '生成失败', { err: true }); }
    btn.disabled = false; btn.textContent = old;
  });
}

function filterPddByPrice(list, min, max) {
  return (list || []).filter(g => {
    const d = Number(g.deal_price) || 0;
    if (min > 0 && d < min) return false;
    if (max > 0 && d > max) return false;
    return true;
  });
}

function renderPddCandidates(list, append) {
  const box = document.getElementById('pdd-cands');
  if (!append) { window.__pddCands = []; box.innerHTML = ''; }
  if (!list || !list.length) {
    if (!append) box.innerHTML = '<div class="muted">没有匹配的商品，换个关键词试试</div>';
    return;
  }
  window.__pddCands = (window.__pddCands || []).concat(list);
  const all = window.__pddCands;
  box.innerHTML = `<div class="pp-bar"><label class="ck"><input type="checkbox" id="pdd-all" checked> 全选</label><span class="muted">共 ${all.length} 件（已加载）</span></div>` +
    all.map((g, i) => {
      const coupon = g.coupon ? `<span class="tag" style="background:#FFEAE5;color:#FF6B5C">券${g.coupon}</span>` : '';
      const comm = g.commission_rate ? `<span class="tag" style="background:#F0E9FF;color:#7C6CF0">佣${g.commission_rate}%</span>` : '';
      const sale = g.sales_tip ? `<span class="muted">${esc(g.sales_tip)}</span>` : '';
      return `<label class="pp-item">
        <input type="checkbox" class="pdd-ck" data-i="${i}" checked>
        <img src="${g.image_url}" alt="" onerror="this.style.display='none'">
        <div class="pp-info">
          <div class="pp-title">${esc(g.title)}</div>
          <div class="pp-meta">${coupon}${comm}<span class="tag" style="background:#E8F5E9;color:#2BB673">到手¥${fmtMoney(g.deal_price)}</span>${sale}</div>
        </div>
      </label>`;
    }).join('');
  document.getElementById('pdd-all').addEventListener('change', e => {
    document.querySelectorAll('.pdd-ck').forEach(c => { c.checked = e.target.checked; });
  });
}

async function importPddSelected(btn) {
  const list = window.__pddCands || [];
  const sel = list.filter((_, i) => { const c = document.querySelector('.pdd-ck[data-i="' + i + '"]'); return c && c.checked; });
  if (!sel.length) { toast('请至少勾选 1 件'); return; }
  btn.disabled = true; btn.textContent = '转链入库中…';
  try {
    const pr = await Api.fetchPdd({ action: 'promote', goodsList: sel });
    const urls = (pr && pr.ok) ? (pr.urls || {}) : {};
    if (pr && !pr.ok) toast('转链失败：' + (pr.error || '') + '（商品仍会入库，推广链接需手动补）', { err: true });
    const rows = sel.map(g => ({
      title: g.title, platform: '拼多多',
      origPrice: Number(g.orig_price) || 0, dealPrice: Number(g.deal_price) || 0,
      coupon: g.coupon ? String(g.coupon) : '', commissionRate: Number(g.commission_rate) || 0,
      promoUrl: urls[String(g.goods_sign || g.external_id)] || '', imageUrl: g.image_url || '', remark: '', status: 'draft', sortOrder: 0
    }));
    for (const r of rows) await Api.createDeal(r);
    document.getElementById('ov-pdd').classList.remove('show');
    toast('已入库 ' + rows.length + ' 件（草稿）🐂');
    await loadData();
  } catch (e) { toast(e.message || '入库失败', { err: true }); }
  btn.disabled = false; btn.textContent = '入库选中（草稿）';
}

// ---------- 详情 ----------
function openDetail(id) {
  const p = DB.partners.find(x => x.id == id);
  if (!p) return;
  const gifts = (DB.gifts || []).filter(g => g.partnerId == id);
  const tl = (p.interactions || []).slice().sort((a, b) => b.at - a.at).map(it => `
    <div class="it"><div class="dot"></div><div><div class="tt">${esc(it.text)}</div><div class="ta">${fmtTime(it.at)}</div></div></div>`).join('') ||
    `<div style="color:var(--gray);font-size:13px">暂无记录</div>`;
  const glog = gifts.length ? gifts.slice().sort((a, b) => b.at - a.at).map(g => `
    <div class="it"><div class="dot" style="background:#E58A3F"></div><div><div class="tt">送出「${esc(g.giftName)}」${g.note ? '· ' + esc(g.note) : ''}</div><div class="ta">${fmtTime(g.at)}${g.price ? ' · ¥' + g.price : ''}</div></div></div>`).join('') : '';
  document.getElementById('sheet-detail').innerHTML = `
    <div class="detail-head">
      <div class="av" style="background:${avColor(p.tier, p.name)}">${esc((p.name || '?').slice(0, 1))}</div>
      <div><div class="nm">${esc(p.name)}</div><div class="mt">${esc(p.wechat || '')} · ${p.tier === 'new' ? '新提交' : (TIER_LABEL[p.tier] || '')} · ${STATUS_LABEL[p.status] || ''}</div></div>
    </div>
    <div class="detail-actions-top">
      <button class="btn-primary detail-act-main" data-act="ship-new" data-pid="${p.id}">📦 发货</button>
      ${hasAddress(p.address) ? `<button class="btn-line detail-act-sub" data-act="copy-address" data-addr="${addrText(p.address, true)}">📋 复制地址</button>` : ''}
    </div>
    <div class="field"><label>备注</label><div style="font-size:13px;color:var(--ink)">${esc(p.note || '—')}</div></div>
    <div class="field"><label>标签</label><div>${(p.tags && p.tags.length) ? p.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('') : '<span style="color:var(--gray);font-size:12px">无</span>'}</div></div>
    <div class="field"><label>来源</label><div style="font-size:13px;color:var(--ink)">${p.source === 'self' ? '伙伴自主入驻' : '手动录入'}</div></div>
    <div class="field"><label>互动时间线</label><div class="tl">${tl}</div></div>
    ${glog ? `<div class="field"><label>礼物流水</label><div class="tl">${glog}</div></div>` : ''}
    <div class="field"><label>收件地址</label>
      <div style="font-size:13px;color:var(--ink)">${addrText(p.address)}</div>
      ${hasAddress(p.address) ? `<button class="btn-line" style="width:auto;padding:5px 10px;color:var(--coral);margin-top:6px;font-size:12px" data-act="copy-address" data-addr="${addrText(p.address, true)}" data-name="${esc((p.name || ''))}">📋 一键复制地址</button>` : ''}
    </div>
    <div class="field"><label>专属链接（发给伙伴：自助填地址 / 看物流）</label>
      <div style="font-size:12px;color:var(--coral);word-break:break-all">${(/^[a-f0-9]{32}$|^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.token || '')) ? ((window.APP_ORIGIN || location.origin) + '/me.html?t=' + esc(p.token)) : '<span style="color:#E5454F">⚠️ 该伙伴的 token 异常，请重新保存伙伴信息后再复制</span>'}</div>
      <button class="btn-line" style="width:auto;padding:6px 12px;color:var(--coral);margin-top:6px" data-act="copy-link" data-token="${esc(p.token)}">复制链接发给伙伴</button></div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn-primary" style="flex:1;background:#E58A3F" data-act="gift" data-pid="${p.id}">🎁 送礼品</button>
      <button class="btn-line" style="flex:1;color:var(--coral);border:1px solid var(--coral-light)" data-act="edit" data-id="${p.id}">编辑资料</button>
    </div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn-line" style="flex:1;color:#5B7CFA;border:1px solid #E8EEFF" data-act="interact" data-id="${p.id}">记互动</button>
      <button class="btn-line" style="flex:1;color:var(--gray)" data-act="del" data-id="${p.id}">删除伙伴</button>
    </div>`;
  document.getElementById('ov-detail').classList.add('show');
}

// ---------- 收款码放大 ----------
function openQrZoom(id) {
  const p = DB.partners.find(x => x.id == id);
  if (!p) return;
  if (!p.payout_qr_url) { toast('该伙伴尚未上传收款码', { err: true }); return; }
  const sheet = document.getElementById('sheet-qr');
  sheet.innerHTML = `
    <h3>💰 ${esc(p.name)} 的收款码</h3>
    <div class="qr-zoom-wrap"><img class="qr-zoom-img" src="${p.payout_qr_url}" alt="收款码"></div>
    <div class="qr-zoom-tip">支付宝收款码 · 仅福利派送官可见，方便后续打款</div>
    <div class="qr-zoom-acts">
      <button class="btn-add" data-act="copy-link" data-token="${esc(p.token || '')}">📋 复制福利页链接</button>
      <button class="btn-line" data-act="close" data-ov="ov-qr">关闭</button>
    </div>`;
  document.getElementById('ov-qr').classList.add('show');
}

// ---------- 新增伙伴 ----------
function openAdd() {
  document.getElementById('sheet-add').innerHTML = `
    <h3>新增伙伴</h3>
    <div class="field"><label>昵称 *</label><input id="a-name" placeholder="如：阿May"></div>
    <div class="field"><label>微信号</label><input id="a-wechat" placeholder="微信号 / 手机号"></div>
    <div class="field"><label>手机（选填）</label><input id="a-phone" placeholder="11 位手机号"></div>
    <div class="field"><label>分层</label>
      <div class="tier-row" id="a-tier">
        ${['vip', 'core', 'normal', 'sleep'].map((t, i) => `<button class="chip ${i === 2 ? 'on' : ''}" data-tier="${t}">${TIER_LABEL[t]}</button>`).join('')}
      </div></div>
    <div class="field"><label>备注</label><textarea id="a-note" placeholder="特征 / 偏好 / 待办"></textarea></div>
    <button class="btn-primary" data-act="add-save">保存</button>
    <button class="btn-line" data-act="close" data-ov="ov-add">取消</button>`;
  document.getElementById('ov-add').classList.add('show');
}

// ---------- 送礼 ----------
let giftSel = null;
function openGift(name, price, pid) {
  const opts = GIFTS.map(g => `<div class="gift-opt ${name && g.name === name ? 'sel' : ''}" data-act="gift-opt" data-name="${esc(g.name)}" data-price="${g.price}" data-emoji="${g.emoji}" data-bg="${g.bg}">
    <div class="gi" style="background:${g.bg}">${g.emoji}</div><div class="gn">${g.name}</div><div class="gp">${g.price ? '¥' + g.price : '免费'}</div></div>`).join('');
  const sel = pid ? `<input type="hidden" id="g-pid" value="${pid}">` : `
    <div class="field"><label>选择伙伴 *</label><select id="g-pid">
      ${DB.partners.slice().sort((a, b) => b.createdAt - a.createdAt).map(p => `<option value="${p.id}">${esc(p.name)}（${p.tier === 'new' ? '新提交' : TIER_LABEL[p.tier] || ''}）</option>`).join('')}
    </select></div>`;
  document.getElementById('sheet-gift').innerHTML = `
    <h3>送出礼品</h3>
    ${sel}
    <div class="field"><label>选择礼品</label>${opts}</div>
    <div class="field"><label>祝福语 / 备注</label><textarea id="g-note" placeholder="写一句暖心的话…"></textarea></div>
    <button class="btn-primary" data-act="gift-save">确认送出</button>
    <button class="btn-line" data-act="close" data-ov="ov-gift">取消</button>`;
  giftSel = name ? { name, price: Number(price) } : null;
  document.getElementById('ov-gift').classList.add('show');
}

// ---------- 编辑伙伴 ----------
function openEdit(id) {
  const p = DB.partners.find(x => x.id == id);
  if (!p) return;
  document.getElementById('sheet-edit').innerHTML = `
    <h3>编辑伙伴</h3>
    <div class="field"><label>昵称 *</label><input id="e-name" value="${esc(p.name)}" placeholder="如：阿May"></div>
    <div class="field"><label>微信号</label><input id="e-wechat" value="${esc(p.wechat || '')}" placeholder="微信号 / 手机号"></div>
    <div class="field"><label>手机（选填）</label><input id="e-phone" value="${esc(p.phone || '')}" placeholder="11 位手机号"></div>
    <div class="field"><label>分层</label>
      <div class="tier-row" id="e-tier">
        ${['vip', 'core', 'normal', 'sleep', 'new'].map(t => `<button class="chip ${p.tier === t ? 'on' : ''}" data-tier="${t}">${TIER_LABEL[t]}</button>`).join('')}
      </div></div>
    <div class="field"><label>状态</label>
      <div class="tier-row" id="e-status">
        ${[['new','新提交'],['contacted','已联系'],['active','活跃']].map(([k,l]) => `<button class="chip ${p.status === k ? 'on' : ''}" data-status="${k}">${l}</button>`).join('')}
      </div></div>
    <div class="field"><label>标签（逗号分隔）</label><input id="e-tags" value="${esc((p.tags || []).join(', '))}" placeholder="如：VIP, 高复购"></div>
    <div class="field"><label>备注</label><textarea id="e-note" placeholder="特征 / 偏好 / 待办">${esc(p.note || '')}</textarea></div>
    <button class="btn-primary" data-act="edit-save" data-id="${p.id}">保存修改</button>
    <button class="btn-line" data-act="close" data-ov="ov-edit">取消</button>`;
  document.getElementById('ov-edit').classList.add('show');
}

// ---------- 手动互动记录 ----------
function openInteract(id) {
  const p = DB.partners.find(x => x.id == id);
  if (!p) return;
  document.getElementById('sheet-interact').innerHTML = `
    <h3>添加互动记录 · ${esc(p.name)}</h3>
    <div class="field"><label>互动类型</label>
      <div class="tier-row" id="i-type">
        ${[['note','备注'],['call','通话'],['wechat','微信'],['visit','拜访'],['gift','送礼']].map(([k,l],i) => `<button class="chip ${i===0?'on':''}" data-type="${k}">${l}</button>`).join('')}
      </div></div>
    <div class="field"><label>互动内容 *</label><textarea id="i-text" placeholder="如：微信聊了新品，对方很感兴趣"></textarea></div>
    <div class="field"><label>更新状态（可选）</label>
      <div class="tier-row" id="i-status">
        <button class="chip" data-status="">不变</button>
        ${[['contacted','已联系'],['active','活跃']].map(([k,l]) => `<button class="chip" data-status="${k}">${l}</button>`).join('')}
      </div></div>
    <button class="btn-primary" data-act="interact-save" data-id="${p.id}">保存记录</button>
    <button class="btn-line" data-act="close" data-ov="ov-interact">取消</button>`;
  document.getElementById('ov-interact').classList.add('show');
}

// ---------- 事件 ----------
function switchTab(name, opts) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  if (name === 'home') renderHome();
  if (name === 'ship') renderShipTab();
  if (name === 'ops') renderOps();
  if (name === 'rebate') {
    if (opts && opts.rebateTab) REBATE_TAB = opts.rebateTab;
    renderRebate();
  }
}
async function exportCsv() {
  try {
    const rows = [['昵称', '微信号', '手机', '分层', '状态', '标签', '备注', '来源', '创建时间']];
    (DB.partners || []).forEach(p => rows.push([
      p.name, p.wechat, p.phone, p.tier, p.status, (p.tags || []).join('/'), p.note, p.source,
      p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : ''
    ]));
    const csv = '﻿' + rows.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'partners.csv'; a.click();
    toast('已导出 CSV');
  } catch (e) { toast('导出失败'); }
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  try {
    if (act === 'tab') switchTab(el.dataset.tab, { rebateTab: el.dataset.rebate || 'form' });
    else if (act === 'group-toggle') {
      const ds = el.dataset.ds;
      if (COLLAPSED_GROUPS.has(ds)) COLLAPSED_GROUPS.delete(ds); else COLLAPSED_GROUPS.add(ds);
      renderPartners();
    }
    else if (act === 'rebate-tab') { REBATE_TAB = el.dataset.tab; renderRebate(); }
    else if (act === 'rebate-logout') { REBATE_LOGGED_IN = false; REBATE_PW = ''; REBATE_TAB = 'form'; renderRebate(); }
    else if (act === 'rebate-pay') { await fillRebateForPay(el.dataset.order, '已返'); }
    else if (act === 'rebate-edit') { await fillRebateForPay(el.dataset.order, null); }
    else if (act === 'add') openAdd();
    else if (act === 'detail') openDetail(el.dataset.id);
    else if (act === 'rebate-new') {
      // 直接从伙伴卡片发起：URL 参数预填 model_id，避免"复制链接→再粘"的链路
      const mid = el.dataset.mid || '';
      const mname = el.dataset.mname || '';
      const origin = (window.APP_ORIGIN || location.origin).replace(/\/$/, '');
      const u = new URL(origin + '/rebate/admin.html');
      if (mid) u.searchParams.set('model', mid);
      if (mname) u.searchParams.set('name', mname);
      // 提示用户：需要后台密码
      const target = u.toString();
      // 在新窗口打开（避免污染当前后台 tab）；若已登录则弹 toast
      window.open(target, '_blank');
      toast('已为「' + (mname || mid) + '」打开录入窗口，记得输后台密码');
    }
    else if (act === 'qr-zoom') openQrZoom(el.dataset.id);
    else if (act === 'gift') {
      if (el.dataset.pid) openGift(null, 0, el.dataset.pid);
      else openGift(el.dataset.name, el.dataset.price, null);
    }
    else if (act === 'gift-tab') {
      document.querySelectorAll('#gift-tabs .chip').forEach(c => c.classList.toggle('on', c === el));
      renderGiftBody(el.dataset.g);
    }
    else if (act === 'gift-opt') {
      document.querySelectorAll('.gift-opt').forEach(o => o.classList.remove('sel'));
      el.classList.add('sel');
      giftSel = { name: el.dataset.name, price: Number(el.dataset.price) };
    }
    else if (act === 'gift-save') {
      const pid = document.getElementById('g-pid').value;
      if (!pid) { toast('请选择伙伴'); return; }
      if (!giftSel) { toast('请选择礼品'); return; }
      await api('/admin/gifts', { method: 'POST', body: JSON.stringify({ partnerId: pid, giftName: giftSel.name, price: giftSel.price, note: document.getElementById('g-note').value }) });
      document.getElementById('ov-gift').classList.remove('show');
      toast('已送出 🎁'); await loadData(); await loadStats();
    }
    else if (act === 'add-save') {
      const tierEl = document.querySelector('#a-tier .chip.on');
      const body = { name: document.getElementById('a-name').value.trim(), wechat: document.getElementById('a-wechat').value.trim(), phone: document.getElementById('a-phone').value.trim(), tier: tierEl ? tierEl.dataset.tier : 'normal', note: document.getElementById('a-note').value.trim() };
      if (!body.name) { toast('请填写昵称'); return; }
      await api('/admin/partners', { method: 'POST', body: JSON.stringify(body) });
      document.getElementById('ov-add').classList.remove('show');
      toast('已新增伙伴'); await loadData(); await loadStats();
    }
    else if (act === 'del') {
      if (!confirm('确定删除该伙伴？此操作不可恢复')) return;
      await api('/admin/partners/' + el.dataset.id, { method: 'DELETE' });
      document.getElementById('ov-detail').classList.remove('show');
      toast('已删除'); await loadData(); await loadStats();
    }
    else if (act === 'chip') { filterTier = el.dataset.tier; renderPartners(); }
    else if (act === 'city-chip') { filterCity = el.dataset.city; renderPartners(); }
    else if (act === 'export') exportCsv();
    else if (act === 'logout') logout();
    else if (act === 'close') document.getElementById(el.dataset.ov).classList.remove('show');
    else if (act === 'toggle-pcard') {
      const card = el.closest('.pcard');
      if (card) card.classList.toggle('open');
    }
    else if (act === 'toggle-all') {
      const cards = document.querySelectorAll('#view-partners .pcard');
      if (!cards.length) return;
      const anyOpen = Array.from(cards).some(c => c.classList.contains('open'));
      cards.forEach(c => c.classList.toggle('open', !anyOpen));
    }
    else if (act === 'toggle-group-by-date') {
      GROUP_BY_DATE = !GROUP_BY_DATE;
      renderPartners();
    }
    else if (act === 'batch-toggle') {
      BATCH_MODE = !BATCH_MODE;
      if (!BATCH_MODE) BATCH_SEL.clear();
      renderPartners();
    }
    else if (act === 'batch-check') {
      const id = Number(el.dataset.id);
      if (BATCH_SEL.has(id)) BATCH_SEL.delete(id); else BATCH_SEL.add(id);
      renderPartners();
    }
    else if (act === 'batch-select-all') {
      const visibleIds = (DB.partners || [])
        .filter(p => {
          if (filterTier === 'shipped') return shipCountMap.has(p.id);
          if (filterTier === 'unshipped') return !shipCountMap.has(p.id);
          if (filterTier !== 'all') return p.tier === filterTier;
          return true;
        })
        .filter(p => filterCity === 'all' || partnerCity(p) === filterCity)
        .filter(p => !searchQ || (p.name + p.wechat + (p.note || '') + (p.platform || '') + (p.modelId || '')).toLowerCase().includes(searchQ.toLowerCase()))
        .map(p => p.id);
      const allSelected = visibleIds.every(id => BATCH_SEL.has(id));
      if (allSelected) visibleIds.forEach(id => BATCH_SEL.delete(id));
      else visibleIds.forEach(id => BATCH_SEL.add(id));
      renderPartners();
    }
    else if (act === 'batch-delete') {
      if (BATCH_SEL.size === 0) { toast('请先选择伙伴'); return; }
      if (!confirm(`确定删除选中的 ${BATCH_SEL.size} 个伙伴？此操作不可恢复`)) return;
      await runBatch('删除伙伴', async id => { await api('/admin/partners/' + id, { method: 'DELETE' }); });
    }
    else if (act === 'batch-tier') {
      if (BATCH_SEL.size === 0) { toast('请先选择伙伴'); return; }
      openBatchTier();
    }
    else if (act === 'batch-status') {
      if (BATCH_SEL.size === 0) { toast('请先选择伙伴'); return; }
      openBatchStatus();
    }
    else if (act === 'batch-tier-opt') {
      BATCH_TIER_TEMP = el.dataset.tier;
      document.querySelectorAll('#sheet-batch .chip').forEach(c => c.classList.toggle('on', c === el));
    }
    else if (act === 'batch-tier-save') {
      await runBatch('修改分组', async id => { await Api.updatePartner(id, { tier: BATCH_TIER_TEMP }); });
      document.getElementById('ov-batch').classList.remove('show');
    }
    else if (act === 'batch-status-opt') {
      BATCH_STATUS_TEMP = el.dataset.status;
      document.querySelectorAll('#sheet-batch .chip').forEach(c => c.classList.toggle('on', c === el));
    }
    else if (act === 'batch-status-save') {
      await runBatch('修改状态', async id => { await Api.updatePartner(id, { status: BATCH_STATUS_TEMP }); });
      document.getElementById('ov-batch').classList.remove('show');
    }
    else if (act === 'copy-track') {
      const no = el.dataset.no || '';
      if (!no) return;
      const flash = () => { const old = el.textContent; el.textContent = '✓'; setTimeout(() => el.textContent = old, 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(no).then(flash).catch(() => prompt('复制此单号：', no));
      } else {
        prompt('复制此单号：', no);
      }
    }
    else if (act === 'ship-new') openShip(null, el.dataset.pid ? Number(el.dataset.pid) : '');
    else if (act === 'ship') { const s = SHIPS.find(x => x.id == el.dataset.id); if (s) openShip(s); }
    else if (act === 'ship-create') {
      const pid = document.getElementById('sh-pid').value;
      const giftName = document.getElementById('sh-gift').value.trim();
      const value = Number(document.getElementById('sh-value').value || 0);
      if (!pid) { toast('请选择伙伴'); return; }
      if (!giftName) { toast('请填写礼品名称'); return; }
      if (!value || value <= 0) { toast('请填写礼品价值，否则累计福利价值无法增加'); return; }
      await api('/admin/shipment', { method: 'POST', body: JSON.stringify({
        partnerId: pid, giftName, carrier: document.getElementById('sh-carrier').value.trim(),
        trackingNo: document.getElementById('sh-no').value.trim(), phone: document.getElementById('sh-phone').value.trim(),
        note: document.getElementById('sh-note').value.trim(),
        productLink: document.getElementById('sh-link').value.trim(),
        value
      }) });
      document.getElementById('ov-ship').classList.remove('show');
      toast('已发货 📦'); await loadData();
    }
    else if (act === 'ship-log') {
      const stEl = document.querySelector('#sh-status .chip.on');
      const status = stEl ? stEl.dataset.status : 'transit';
      const value = Number(document.getElementById('sh-value2').value || 0);
      if (!value || value <= 0) { toast('请填写礼品价值，否则累计福利价值无法增加'); return; }
      const r = await api('/admin/shipment/log', { method: 'POST', body: JSON.stringify({
        id: el.dataset.id, status, desc: document.getElementById('sh-desc').value.trim(),
        trackingNo: document.getElementById('sh-no2').value.trim(), value
      }) });
      toast('已更新物流'); openShip(r.shipment); await loadData();
    }
    else if (act === 'ship-del') {
      if (!confirm('确定删除该发货记录？')) return;
      await api('/admin/shipment/' + el.dataset.id, { method: 'DELETE' });
      document.getElementById('ov-ship').classList.remove('show');
      toast('已删除'); await loadData();
    }
    else if (act === 'refresh-ship') {
      const btn = el;
      btn.classList.add('spin');
      try { await loadData(); toast('已刷新'); }
      catch (e) { toast('刷新失败：' + (e.message || ''), { err: true }); }
      finally { btn.classList.remove('spin'); }
    }
    else if (act === 'copy-link') {
      const raw = (el.dataset.token || '').trim();
      // 防御：token 缺失/是占位符/格式不对时直接拦截。token 格式 = 32 位 hex 或标准 UUID (8-4-4-4-12)
      const TOKEN_RE = /^[a-f0-9]{32}$|^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
      if (!raw || raw === 'TOKEN' || !TOKEN_RE.test(raw)) {
        toast('该伙伴的 token 异常，无法生成链接。请到数据库核对或重新保存伙伴信息。', { err: true });
        return;
      }
      const link = (window.APP_ORIGIN || location.origin) + '/me.html?t=' + raw;
      try { await navigator.clipboard.writeText(link); toast('已复制专属链接'); }
      catch (e) { prompt('复制此链接发给伙伴：', link); }
    }
    else if (act === 'copy-address') {
      const text = (el.dataset.addr || '').trim();
      await copyText(text, '已复制收件地址');
    }
    else if (act === 'edit') openEdit(el.dataset.id);
    else if (act === 'interact') openInteract(el.dataset.id);
    else if (act === 'wool-add') openDealAdd();
    else if (act === 'wool-paste') openPddPaste();
    else if (act === 'wool-pdd') openPddImport();
    else if (act === 'wool-register') openPddRegister();
    else if (act === 'pdd-fetch') {
      const source = document.getElementById('p-source').value || 'search';
      const count = Math.min(50, Math.max(1, Number(document.getElementById('p-count').value) || 20));
      const minPrice = Number(document.getElementById('p-min-price').value) || 0;
      const maxPrice = Number(document.getElementById('p-max-price').value) || 0;
      const withCoupon = document.getElementById('p-coupon').checked;
      const base = { count, minPrice, maxPrice, withCoupon };
      let req, params;
      if (source === 'search' || source === 'search-featured') {
        const keyword = (document.getElementById('p-keyword').value || '').trim();
        const sortType = Number(document.getElementById('p-sort').value) || 0;
        const activityVal = source === 'search-featured' ? '10564' : document.getElementById('p-activity').value;
        const activityTags = activityVal ? [Number(activityVal)] : [];
        params = Object.assign({}, base, { keyword, sortType, pageSize: count, activityTags });
        req = Object.assign({ action: 'search', page: 1 }, params);
      } else {
        const channelType = source === 'recommend-hot' ? 5 : 1;
        params = Object.assign({}, base, { channelType, limit: count, offset: 0 });
        req = Object.assign({ action: 'recommend' }, params);
      }
      window.__pddAction = req.action;
      window.__pddParams = params;
      window.__pddPage = 1;
      window.__pddOffset = 0;
      const b = el; b.disabled = true; const old = b.textContent; b.textContent = '拉取中…';
      try {
        const res = await Api.fetchPdd(req);
        if (!res || !res.ok) { toast('拉取失败：' + (res?.error || '未知错误'), { err: true }); }
        else {
          const list = filterPddByPrice(res.list || [], minPrice, maxPrice);
          renderPddCandidates(list, false);
          const has = list.length > 0;
          document.getElementById('pdd-import-btn').style.display = has ? 'block' : 'none';
          document.getElementById('pdd-more-btn').style.display = has ? 'block' : 'none';
        }
      } catch (e) { toast(e.message || '拉取失败', { err: true }); }
      b.disabled = false; b.textContent = old;
    }
    else if (act === 'pdd-more') {
      const p = window.__pddParams;
      if (!p) return;
      const b = el; b.disabled = true; const old = b.textContent; b.textContent = '加载中…';
      try {
        let res;
        if (window.__pddAction === 'recommend') {
          window.__pddOffset = (window.__pddOffset || 0) + (p.count || 20);
          res = await Api.fetchPdd(Object.assign({ action: 'recommend' }, p, { offset: window.__pddOffset }));
        } else {
          window.__pddPage = (window.__pddPage || 1) + 1;
          res = await Api.fetchPdd(Object.assign({ action: 'search', page: window.__pddPage }, p));
        }
        if (!res || !res.ok) { toast('加载失败：' + (res?.error || '未知错误'), { err: true }); }
        else {
          const list = filterPddByPrice(res.list || [], p.minPrice || 0, p.maxPrice || 0);
          renderPddCandidates(list, true);
          if (!list.length) toast('没有更多了');
        }
      } catch (e) { toast(e.message || '加载失败', { err: true }); }
      b.disabled = false; b.textContent = old;
    }
    else if (act === 'pdd-import') { await importPddSelected(el); }
    else if (act === 'paste-fetch') {
      const raw = document.getElementById('paste-links').value || '';
      const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!lines.length) { toast('请粘贴至少一个链接'); return; }
      const b = el; b.disabled = true; const old = b.textContent; b.textContent = '解析中…';
      try {
        const items = [];
        for (const line of lines) {
          let resolved = null;
          let sign = extractParam(line, 'goods_sign') || extractParam(line, 'goodsSign');
          let goodsId = extractParam(line, 'goods_id');
          // 如果没有 goods_sign，尝试走 Edge Function 解析短链（?ps=... 会 307 跳转到带 goods_id 的长链）
          if (!sign) {
            try {
              resolved = await Api.fetchPdd({ action: 'resolve', url: line });
              if (resolved && resolved.ok) {
                if (resolved.goodsSign) sign = resolved.goodsSign;
                if (resolved.goodsId && !goodsId) goodsId = resolved.goodsId;
              }
            } catch (e) { /* 解析失败继续走手动填写 */ }
          }
          const base = { url: line, title: '', dealPrice: '', origPrice: '', imageUrl: '', gs: sign || '', goodsId: goodsId || '', ok: false, err: '' };
          if (sign) {
            try {
              const res = await Api.fetchPdd({ action: 'detail', goodsSign: sign });
              if (res && res.ok && res.item) {
                const it = res.item;
                items.push({ url: line, title: it.title || '', dealPrice: it.deal_price || '', origPrice: it.orig_price || '', imageUrl: it.image_url || '', gs: sign, goodsId: it.goods_id || goodsId || '', ok: true, mall: it.mall_name || '' });
                continue;
              } else { base.err = (res && res.error) || '解析失败'; }
            } catch (e) { base.err = e.message || '解析失败'; }
          } else {
            base.err = goodsId ? 'goods_sign 缺失，请手动填写' : '链接无 goods_sign/goods_id';
          }
          items.push(base);
        }
        window.__pasteItems = items;
        renderPastePreview(items);
        document.getElementById('paste-save-btn').style.display = items.length ? 'block' : 'none';
        const auto = items.filter(i => i.ok).length;
        const manual = items.length - auto;
        if (!auto && manual) toast('这些链接不含 goods_sign，已提取商品ID，请手动填写标题和价格后保存', { err: true });
        else if (manual) toast(`已自动补全 ${auto} 件，${manual} 件需手动填写后保存`);
      } catch (e) { toast(e.message || '解析失败', { err: true }); }
      b.disabled = false; b.textContent = old;
    }
    else if (act === 'paste-save') {
      const items = window.__pasteItems || [];
      const b = el; b.disabled = true; const old = b.textContent; b.textContent = '保存中…';
      let okN = 0, skip = 0;
      try {
        const boxes = Array.from(document.querySelectorAll('.paste-ck:checked'));
        const scene = document.getElementById('paste-scene') ? document.getElementById('paste-scene').value : '';
        for (const box of boxes) {
          const i = Number(box.dataset.i);
          const it = items[i]; if (!it) { skip++; continue; }
          const title = (document.querySelector('.paste-title[data-i="' + i + '"]')?.value || '').trim() || it.title || '';
          const deal = parseFloat(document.querySelector('.paste-price[data-i="' + i + '"]')?.value || '') || it.dealPrice || 0;
          const ori = parseFloat(document.querySelector('.paste-ori[data-i="' + i + '"]')?.value || '') || it.origPrice || 0;
          if (!title) { skip++; continue; }
          await Api.createDeal({
            title, platform: '拼多多', origPrice: ori || '', dealPrice: deal || '', coupon: '',
            commissionRate: 0, promoUrl: it.url, imageUrl: it.imageUrl || '', remark: '粘贴采集', scene, status: 'draft'
          });
          okN++;
        }
        document.getElementById('ov-paste').classList.remove('show');
        toast(`已存入 ${okN} 件补贴品（草稿）${skip ? '，跳过 ' + skip + ' 件未填标题' : ''}`);
        await loadData();
      } catch (e) { toast(e.message || '保存失败', { err: true }); }
      b.disabled = false; b.textContent = old;
    }
    else if (act === 'wool-edit') openDealEdit(el.dataset.id);
    else if (act === 'wool-chip') { woolPlatform = el.dataset.p; renderWool(); }
    else if (act === 'wool-del') {
      if (!confirm('确定删除该补贴品？此操作不可恢复')) return;
      try { await Api.deleteDeal(Number(el.dataset.id)); toast('已删除'); await loadData(); }
      catch (e) { toast(e.message || '删除失败', { err: true }); }
    }
    else if (act === 'wool-publish') {
      try { await Api.publishDeal(Number(el.dataset.id), el.dataset.pub === '1'); toast(el.dataset.pub === '1' ? '已发布 🐑' : '已下架'); await loadData(); }
      catch (e) { toast(e.message || '操作失败', { err: true }); }
    }
    else if (act === 'wool-copy-link') {
      const link = (window.APP_ORIGIN || location.origin) + '/deals.html';
      try { await navigator.clipboard.writeText(link); toast('已复制分享页链接：' + link); }
      catch (e) { prompt('复制此链接发到群：', link); }
    }
    else if (act === 'wool-share') {
      const pub = (DB.deals || []).filter(d => d.status === 'published').sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0));
      if (!pub.length) { toast('还没有已发布的补贴品'); return; }
      const lines = ['【今日羊毛情报】手慢无 👇'];
      pub.forEach((d, i) => {
        lines.push((i + 1) + '. ' + d.title + ' — 到手 ¥' + fmtMoney(d.dealPrice) + (d.coupon ? '（' + d.coupon + '）' : '') + ' · ' + d.platform);
        if (d.promoUrl) lines.push('   👉 ' + d.promoUrl);
      });
      lines.push('—— 更多捡漏见：' + (window.APP_ORIGIN || location.origin) + '/deals.html');
      const text = lines.join('\n');
      try { await navigator.clipboard.writeText(text); toast('已生成 ' + pub.length + ' 条分享文案，去群里粘贴吧'); }
      catch (e) { prompt('复制文案到群：', text); }
    }
    else if (act === 'deal-save') { await saveDeal(el.dataset.id ? Number(el.dataset.id) : null); }
    else if (act === 'edit-save') {
      const tierEl = document.querySelector('#e-tier .chip.on');
      const statusEl = document.querySelector('#e-status .chip.on');
      const tags = document.getElementById('e-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const body = {
        name: document.getElementById('e-name').value.trim(),
        wechat: document.getElementById('e-wechat').value.trim(),
        phone: document.getElementById('e-phone').value.trim(),
        tier: tierEl ? tierEl.dataset.tier : 'normal',
        status: statusEl ? statusEl.dataset.status : 'contacted',
        tags, note: document.getElementById('e-note').value.trim()
      };
      if (!body.name) { toast('请填写昵称'); return; }
      await api('/admin/partners/' + el.dataset.id, { method: 'PUT', body: JSON.stringify(body) });
      document.getElementById('ov-edit').classList.remove('show');
      toast('已保存修改'); await loadData(); await loadDashboard();
      openDetail(el.dataset.id);
    }
    else if (act === 'interact-save') {
      const typeEl = document.querySelector('#i-type .chip.on');
      const statusEl = document.querySelector('#i-status .chip.on');
      const text = document.getElementById('i-text').value.trim();
      if (!text) { toast('请填写互动内容'); return; }
      await api('/admin/interaction', { method: 'POST', body: JSON.stringify({
        partnerId: el.dataset.id, text, type: typeEl ? typeEl.dataset.type : 'note',
        status: statusEl ? statusEl.dataset.status : ''
      }) });
      document.getElementById('ov-interact').classList.remove('show');
      toast('已记录互动'); await loadData(); await loadDashboard();
      openDetail(el.dataset.id);
    }
    else if (act === 'ship-track') {
      toast('正在同步物流…');
      try {
        const s = SHIPS.find(x => x.id == el.dataset.id);
        if (!s) throw new Error('未找到该发货记录');
        const phoneEl = document.getElementById('sh-phone2');
        const phone = (phoneEl && phoneEl.value.trim()) || s.phone || '';
        const res = await Api.trackShipment(s, phone);
        if (res && res.ok) {
          const logs = res.shipment.logs || [];
          const status = logs.some(l => l.desc && /签收/.test(l.desc)) ? 'delivered' : 'transit';
          await Api.saveShipLogs(s.id, logs);
          toast('物流已同步 ✅');
          await loadData();
          openShip(Object.assign({}, s, { logs, status }));
        }
        else toast('同步失败：' + (res && res.message ? res.message : '未知错误'), { err: true });
      } catch (e) {
        if (e.message === 'NO_KD100') toast('未配置快递100实时查询：请在后台手动添加物流节点（已降级为手填模式）', { err: true });
        else toast(e.message || '同步失败', { err: true });
      }
    }
  } catch (err) {
    if (err.message !== 'unauthorized') toast(err.message || '操作失败');
  }
});

// 分层选择（新增弹窗）
document.addEventListener('click', e => {
  const c = e.target.closest('#a-tier .chip');
  if (c) { document.querySelectorAll('#a-tier .chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); }
});
document.addEventListener('click', e => {
  const c = e.target.closest('#sh-status .chip');
  if (c) { document.querySelectorAll('#sh-status .chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); }
});
// 编辑弹窗选择
document.addEventListener('click', e => {
  const c = e.target.closest('#e-tier .chip, #e-status .chip');
  if (c) { c.parentElement.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); }
});
// 互动弹窗选择
document.addEventListener('click', e => {
  const c = e.target.closest('#i-type .chip, #i-status .chip');
  if (c) { c.parentElement.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); }
});

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

document.getElementById('login-btn').addEventListener('click', () => doLogin(document.getElementById('login-pwd').value));
document.getElementById('login-pwd').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(e.target.value); });
document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('show'); }));

// 启动：检查已有登录态
(async () => {
  try {
    const session = await Api.getSession();
    if (session) { showLogin(false); init(); }
    else { showLogin(true); }
  } catch (e) { showLogin(true); }
})();
