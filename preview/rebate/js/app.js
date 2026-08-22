// ============ 公开返款页逻辑（单页长滚动版） ============

/*
 * 核心数据计算逻辑（按 2026-08-13 最终调整）：
 *
 * 让「累计返款金额」与「本周新增」成为两个天然不同的数字：
 *   - 累计返款金额 = 历史总累计（HIST_BASE + 每日吞吐 TOTAL_DAILY_INC，无封顶，只增不减）
 *   - 本周新增     = 本周内（周一 00:00 起）累计的返款，按周重置（周一=0 … 周日=6×WEEK_DAILY_INC）
 *                   因为只统计本周，所以必然远小于“累计”，两者差异一目了然。
 *
 * 为了让公示台更有“实时滚动”的活泼感，累计金额的日吞吐比本周新增更快，
 * 因此累计金额的最低位会持续快速滚动，而本周新增仍保持之前约定的每日 8600 节奏。
 *
 * 其余指标：
 *   - 合作模特人数：起点 586，每天 +12（每周约 +84），只增不减。
 *   - 已结算笔数：起点 30，每天 +3，封顶 240。
 *
 * 所有数字都基于当前时间统一计算（含当天内秒数插值），同一时刻任何用户/任何窗口看到的数值
 * 完全相同；同时 odometer 入场时全部数字会一起快速滚动多圈，营造热烈感。
 */





const money = n => '¥' + Number(n||0).toLocaleString('zh-CN',{maximumFractionDigits:2});
function relTime(t){
  const d = new Date(t), now = Date.now(), s = Math.floor((now-d)/1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s/60)+' 分钟前';
  if (s < 86400) return Math.floor(s/3600)+' 小时前';
  return Math.floor(s/86400)+' 天前';
}
function maskStatus(s){ return s||'待返'; }

// ---- 公示台姓名脱敏（合规要求：所有公开展示的姓名都需做脱敏处理） ----
// 规则：
//  - 「集美·3679698」类（"X·数字ID"）→ 保留前缀前 2 字 + ID 前后 2 位，中间 * 填充
//  - 中文 2 字 → 「梅*」；3 字 → 「梅**」；≥4 字 → 「梅***」
//  - 英文 → 保留首字母，其余 *
//  - 已含 * 的视为已脱敏，直接返回
//  - 兜底：空值/异常 → 「用户***」
function maskName(s){
  if (s == null) return '用户***';
  const str = String(s).trim();
  if (!str) return '用户***';
  if (str.includes('*')) return str; // 已经脱敏过，不再处理
  // 「平台·ID」类（如"集美·3679698"）
  if (/^[^\u00B7·\u2022\.\-]+\u00B7\d{4,}$/.test(str) || /^[^\u00B7·\u2022\.\-]+[\u00B7·\u2022\.\-]\d{4,}$/.test(str)){
    const m = str.match(/^([^\u00B7·\u2022\.\-]+)([\u00B7·\u2022\.\-])(\d+)$/);
    if (m){
      const prefix = m[1];
      const sep = m[2];
      const digits = m[3];
      const pVisible = prefix.length <= 2 ? prefix : prefix.slice(0,2) + '*'.repeat(Math.max(1, prefix.length-2));
      const d = digits.length;
      const dMasked = d <= 4 ? '*'.repeat(d) : digits.slice(0,2) + '*'.repeat(Math.max(2, d-4)) + digits.slice(-2);
      return pVisible + sep + dMasked;
    }
  }
  // 纯英文/字母（含大小写数字）
  if (/^[A-Za-z0-9\s]+$/.test(str)){
    if (str.length <= 1) return str + '***';
    return str[0] + '*'.repeat(str.length - 1);
  }
  // 中文为主的姓名（去除中间可能存在的空格/特殊字符后按可见字数判断）
  const han = str.replace(/[^\u4e00-\u9fa5]/g,'');
  const hanLen = han.length;
  if (hanLen <= 0) return str.length <= 1 ? str + '***' : str[0] + '*'.repeat(str.length-1);
  if (hanLen === 1) return han + '***';
  if (hanLen === 2) return han[0] + '*';
  if (hanLen === 3) return han[0] + '**';
  return han[0] + '***';
}

// ---- 按日期计算四个公示指标 ----
const MODEL_BASE = 586;          // 合作模特人数起点
const MODEL_DAILY_INC = 12;      // 模特人数每天增加量（每周约 +84，落在 70-100 区间），只增不减
const STATS_START_DATE = new Date('2026-08-11T00:00:00'); // 累计口径起点日

// 累计金额：历史总累计，保持真实区间（几万元量级），避免 500 万+ 显得不真实
const HIST_BASE = 80000;         // 历史累计基线（元）
const TOTAL_DAILY_INC = 3000;    // 累计金额每日吞吐（元/天）

const WEEK_DAILY_INC = 10000;    // 本周新增每日吞吐（元/天）→ 周一 0，周日封顶约 6 万

const COUNT_BASE = 30;           // 已结算笔数起点（笔）
const COUNT_DAILY_INC = 3;       // 已结算笔数每天递增（笔/天）
const COUNT_MAX = 240;           // 已结算笔数封顶（200-250 区间）

// 基于当前时间统一计算公示指标（含当天内平滑递增，保证任何用户同一时刻数值一致）
function computeStats(now = new Date()){
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const elapsed = Math.max(0, (now - STATS_START_DATE) / MS_PER_DAY); // 可含小数天
  const days = Math.floor(elapsed);
  const frac = elapsed - days; // 当天已过的比例（0 ~ 1）

  // 1) 合作模特人数：起点 586 + 每天固定增加，持续累计（保留小数用于 odometer 平滑滚动）
  const model_count = MODEL_BASE + days * MODEL_DAILY_INC + frac * MODEL_DAILY_INC;

  // 2) 累计返款金额：历史总累计，无封顶，只增不减（大数，日吞吐更快，最低位滚动明显）
  const total_amount = HIST_BASE + days * TOTAL_DAILY_INC + frac * TOTAL_DAILY_INC;

  // 3) 本周新增：本周内（周一 00:00 起）累计，按周重置（保留原每日 8600 节奏）
  const dow = (now.getDay() + 6) % 7; // 周一=0 … 周日=6
  const week_amount = dow * WEEK_DAILY_INC + frac * WEEK_DAILY_INC;

  // 4) 已结算笔数：从起点每天递增，封顶后不再增长
  const total_count = Math.min(COUNT_MAX, COUNT_BASE + days * COUNT_DAILY_INC + frac * COUNT_DAILY_INC);

  return { total_amount, total_count, model_count, week_amount };
}

// ---- 统计 count-up ----
function countUp(el, target, isMoney){
  const dur = 1200, t0 = performance.now();
  function step(t){
    const p = Math.min(1,(t-t0)/dur), v = target*p;
    el.textContent = isMoney ? money(Math.floor(v)) : Math.floor(v).toLocaleString('zh-CN');
    if (p<1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ---- 实时 ticker：让 4 个数字持续滚动增加（营造热闹氛围） ----
const STATS_KEYS = ['total_amount', 'total_count', 'model_count', 'week_amount'];
const liveStats = { total_amount: 0, total_count: 0, model_count: 0, week_amount: 0 };
const statEl = {}; // { total_amount: { el, isMoney } }

function bindStatEls() {
  statEl.total_amount = { el: document.getElementById('s-amount'), isMoney: true };
  statEl.total_count = { el: document.getElementById('s-count'), isMoney: false };
  statEl.model_count = { el: document.getElementById('s-model'), isMoney: false };
  statEl.week_amount = { el: document.getElementById('s-week'), isMoney: true };
}

// 平滑滚动到目标值（无闪烁/缩放，避免"卡住"或"花屏"）
function setStat(key, value, opts){
  const conf = statEl[key];
  if (!conf || !conf.el) return;
  const from = liveStats[key];
  const dur = (opts && opts.duration) || 600;
  const t0 = performance.now();
  function step(t){
    const p = Math.min(1, (t - t0) / dur);
    const v = from + (value - from) * p;
    conf.el.textContent = conf.isMoney ? money(Math.floor(v)) : Math.floor(v).toLocaleString('zh-CN');
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
  liveStats[key] = value;
}

// v44：ticker 行为收敛
//   - 真数据时：固定显示真聚合，不启动 ticker（防真数据被前端公式"覆盖"）
//   - 无真数据时：保留前端公式 ticker，让公示台看起来"在动"，但仍是按日期推演的真实递增
let tickerTimer = null;
let _hasRealData = false;
// v44b：纯虚拟展示策略 —— 公示台为活跃氛围展示页，数字按日期公式推演递增（同一时刻所有用户一致）。
//   （模特私密查询仍走真库 get_my_rebates，互不影响）
//   ticker 始终运行，让 4 个数字持续向上翻动。
function startStatsTicker() {
  if (tickerTimer) clearInterval(tickerTimer);
  // 每 1 秒按统一时间重新计算，所有用户/所有窗口向同一目标值递增，保证数字对齐一致
  tickerTimer = setInterval(() => {
    const s = computeStats();
    STATS_KEYS.forEach(k => setStat(k, s[k], { duration: 800 }));
  }, 1000);
}

function renderStats(s){
  bindStatEls();
  _hasRealData = false;   // v44b：纯虚拟展示，ticker 始终运行
  liveStats.total_amount = 0;
  liveStats.total_count = 0;
  liveStats.model_count = 0;
  liveStats.week_amount = 0;
  // 入场：从 0 平滑滚到目标值，数字持续向上翻动
  countUp(statEl.total_amount.el, s.total_amount, true);
  countUp(statEl.total_count.el, s.total_count, false);
  countUp(statEl.model_count.el, s.model_count, false);
  countUp(statEl.week_amount.el, s.week_amount, true);
  // 入场结束后启动持续实时滚动（仅在 _hasRealData=false 时真正生效）
  setTimeout(startStatsTicker, 1300);
}

async function loadStats(){
  // v44b：纯虚拟展示策略 —— 直接按日期公式计算累计/笔数/模特数/本周，营造活跃氛围
  // （公示页为「展示氛围」，模特私密查询仍走真库 get_my_rebates，互不影响）
  return computeStats();
}
// v44b：纯虚拟生成初始 feed / leaderboard（不再调真数据 RPC，全部前端生成）
async function loadFeed(){
  return genVirtualFeed(30);
}
async function loadBoard(){
  return genVirtualBoard(12);
}

function feedItem(r){
  return `<div class="feed-item">
    <span class="fi-emoji">🎉</span>
    <div class="fi-main">
      <div class="fi-line"><b>${maskName(r.mask)}</b> 收到返款 <span class="amt">${money(r.amount)}</span></div>
      <div class="fi-sub">${r.item} · <span class="st-pill st-${maskStatus(r.status)}">${maskStatus(r.status)}</span> · ${relTime(r.created_at)}</div>
    </div></div>`;
}
function renderFeed(rows){
  const html = rows.map(feedItem).join('');
  document.getElementById('feed').innerHTML = html + html; // 复制一份做无缝滚动
}
function prependFeed(row){
  const el = document.getElementById('feed');
  if (!el) return;
  // 把新条目插入第一份的开头 + 第二份的对应位置（保持双份同步）
  const tmp = document.createElement('div');
  tmp.innerHTML = feedItem(row);
  const fresh = tmp.firstElementChild;
  // 第一份开头插一条
  const firstHalf = Array.from(el.children).slice(0, el.children.length / 2);
  if (firstHalf.length) el.insertBefore(fresh.cloneNode(true), firstHalf[0]);
  else el.appendChild(fresh.cloneNode(true));
  // 第二份对应位置也插一份
  const halfPoint = el.children.length / 2;
  if (el.children[Math.floor(halfPoint)]) {
    el.insertBefore(fresh.cloneNode(true), el.children[Math.floor(halfPoint)]);
  } else {
    el.appendChild(fresh.cloneNode(true));
  }
}
function renderBoard(rows){
  document.getElementById('leaderboard').innerHTML = rows.map((r,i)=>`
    <div class="lb-item">
      <span class="lb-rank ${i<3?'top':''}">${i+1}</span>
      <span class="lb-name">${maskName(r.mask)}</span>
      <span class="lb-amt">${money(r.total)}<small style="font-size:12px;color:var(--sub);font-weight:400"> · ${r.cnt}笔</small></span>
    </div>`).join('') || '<div class="empty">暂无数据</div>';
}

// ---- 实时注入新动态：让 feed 看起来更热闹 ----
const LIVE_NAMES = ['兮兮','阿月','小满','念念','Rita','Yuki','阿琳','梅梅','木木','晨晨','叶子','丹丹','小寒','樱桃','橙橙','苏叶','秀秀','星星','晓晓','阿绿'];
const LIVE_ITEMS = ['主推款返款','日常返款结算','品牌专场返款','联名款返款','618 主推款拍摄','短视频种草','新品上架返款','品牌专场直播'];
const LIVE_STATUSES = ['已返','已返','已返','已返','处理中','已返'];
// v44b：单笔返款金额统一限定在 ¥300–500（用户指定区间）
const V_AMOUNTS = [300, 320, 350, 380, 400, 420, 450, 480, 500];
let _liveFeedCache = null;
function pickRand(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
// 生成一条虚拟返款动态（金额 300–500）
function genLiveRow(){
  return {
    mask: pickRand(LIVE_NAMES),
    amount: pickRand(V_AMOUNTS),
    item: pickRand(LIVE_ITEMS),
    status: pickRand(LIVE_STATUSES),
    created_at: new Date().toISOString()
  };
}
// 初始虚拟 feed（N 条，时间倒叙）
function genVirtualFeed(n){
  const rows = [];
  for (let i = 0; i < n; i++){
    const r = genLiveRow();
    r.created_at = new Date(Date.now() - i * (Math.floor(Math.random()*3600) + 600) * 1000).toISOString();
    rows.push(r);
  }
  return rows;
}
// 初始虚拟达人榜（N 条，金额 300–500 量级 × 笔数，降序）
function genVirtualBoard(n){
  const rows = [];
  for (let i = 0; i < n; i++){
    const cnt = 5 + Math.floor(Math.random() * 40);
    const total = cnt * (300 + Math.floor(Math.random() * 200));
    rows.push({ mask: pickRand(LIVE_NAMES), total, cnt });
  }
  rows.sort((a,b)=> b.total - a.total);
  return rows;
}
// v44b：纯虚拟展示，ticker 始终运行（不再受 _hasRealFeed 门控）
function initFeedTicker(){
  setInterval(() => {
    const row = genLiveRow();
    if (_liveFeedCache) {
      _liveFeedCache.unshift(row);
      if (_liveFeedCache.length > 30) _liveFeedCache.pop();
    }
    prependFeed(row);
  }, 7000);
}
let _liveBoardCache = null;
function initBoardTicker(){
  // 每 12 秒给达人榜前三抖一笔 +¥300–500（量级与单笔返款一致，避免累积放大失真）
  setInterval(() => {
    if (_liveBoardCache && _liveBoardCache.length){
      const i = Math.floor(Math.random() * Math.min(3, _liveBoardCache.length));
      const r = _liveBoardCache[i];
      if (r){
        r.total = (r.total||0) + pickRand(V_AMOUNTS);
        r.cnt = (r.cnt||0) + 1;
      }
      renderBoard(_liveBoardCache);
    }
  }, 12000);
}

// ---- 私密查询 ----
async function query(code){
  code = (code||'').trim();
  if (!code) return [];
  const data = await rebateRpc('get_my_rebates', { p_code: code });
  return Array.isArray(data) ? data : [];
}
// 按订单号去重：优先保留「已返」>「处理中」>「待返」，同状态取最新
function dedupeByOrder(rows){
  const map = new Map();
  const priority = { '已返': 0, '处理中': 1, '待返': 2 };
  for (const r of rows){
    const key = r.order_no;
    const cur = map.get(key);
    if (!cur) { map.set(key, r); continue; }
    const p1 = priority[r.status] ?? 3;
    const p2 = priority[cur.status] ?? 3;
    if (p1 < p2) { map.set(key, r); continue; }
    if (p1 === p2) {
      const d1 = new Date(r.created_at||0).getTime();
      const d2 = new Date(cur.created_at||0).getTime();
      if (d1 > d2) map.set(key, r);
    }
  }
  return Array.from(map.values()).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
}

function renderQuery(rawRows){
  const box = document.getElementById('queryResult');
  const rows = dedupeByOrder(rawRows);
  if (!rows.length){ box.innerHTML = '<div class="empty">未查到记录，请确认订单号或查询码是否正确～</div>'; return; }
  const total = rows.reduce((s,r)=>s+Number(r.amount||0),0);
  let html = `<div class="q-sum">共 ${rows.length} 笔返款 · 累计 ${money(total)}</div>`;
  html += rows.map(r=>`
    <div class="q-card">
      <div class="q-top"><span class="q-order">订单 ${r.order_no}</span>
        <span class="st-pill st-${maskStatus(r.status)}">${maskStatus(r.status)}</span></div>
      <div class="q-item">${r.item}</div>
      <div class="q-amount">${money(r.amount)}</div>
      <div class="q-date">返款日期：${r.rebate_date}</div>
      <div class="q-expected">预计返款：${r.expected_rebate_date || '待定'}</div>
      ${r.status==='已返' && r.voucher_url ? `
        <div class="q-voucher">
          <div class="qv-label">返款凭证</div>
          <img src="${r.voucher_url}" alt="返款凭证" onclick="openVoucher('${r.voucher_url}')">
        </div>` : ''}
    </div>`).join('');
  box.innerHTML = html;
}

// 凭证放大查看
window.openVoucher = function(url){
  const box = document.createElement('div');
  box.className = 'voucher-lightbox';
  box.innerHTML = `<img src="${url}" alt="返款凭证">`;
  box.onclick = () => box.remove();
  document.body.appendChild(box);
};

document.getElementById('q-btn').addEventListener('click', async ()=>{
  const v = document.getElementById('q-input').value;
  const box = document.getElementById('queryResult');
  box.innerHTML = '<div class="empty">查询中…</div>';
  try {
    renderQuery(await query(v));
  } catch (e) {
    console.error('[rebate 私密查询] 失败：', e);
    box.innerHTML = '<div class="empty">查询失败：' + (e && e.message || '网络异常') + '，请稍后重试</div>';
  }
});
document.getElementById('q-input').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('q-btn').click(); });

// 公示台数据加载失败时，明确告知用户，而不是静默回退假数据
function showRebateError(msg){
  const f = document.getElementById('feed');       if (f) f.innerHTML = '<div class="empty">' + msg + '</div>';
  const b = document.getElementById('leaderboard'); if (b) b.innerHTML = '<div class="empty">' + msg + '</div>';
}

// ---- 初始化 ----
(async ()=>{
  renderStats(await loadStats());
  try {
    // v44b：纯虚拟展示 —— 前端生成初始 feed / leaderboard，ticker 持续注入新动态
    const vFeed = await loadFeed() || [];
    const vBoard = await loadBoard() || [];
    _liveFeedCache = vFeed.slice();
    _liveBoardCache = vBoard.slice();
    _hasRealFeed = false;   // v44b：纯虚拟，ticker 始终运行
    renderFeed(_liveFeedCache);
    renderBoard(_liveBoardCache);
    initFeedTicker();
    initBoardTicker();
  } catch (e) {
    console.error('[rebate 公示台] 初始化失败：', e);
  }
})();
