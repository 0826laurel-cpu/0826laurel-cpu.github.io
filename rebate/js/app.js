// ============ 公开返款页逻辑（单页长滚动版） ============

/*
 * 核心数据计算逻辑（按 2026-08-12 需求截图约定）：
 *
 * 1. 合作模特人数：只增不减，起点 586 人。
 *    以 2026-08-11 为基准日，之后每过 1 天固定增加 MODEL_DAILY_INC 人。
 *    公式：model_count = 586 + max(0, 今天 - 2026-08-11 的天数) × MODEL_DAILY_INC
 *
 * 2. 其余三个指标按「自然周」累计：
 *    - 一周从周一 00:00:00 开始，到周日 23:59:59 结束。
 *    - 每周一从 0 重新计算，随时间线性增长到本周目标值。
 *    - 本周目标（可按业务需要调整）：
 *        · 累计返款金额 TOTAL_WEEK_TARGET = 15624
 *        · 已结算笔数   COUNT_WEEK_TARGET = 22
 *        · 本周返款     MONTH_WEEK_TARGET = 15624（原“本月返款”语义改为按本周累计）
 *
 * 3. 页面上的“实时滚动” ticker 仅在前述基础值上做小幅随机波动，
 *    用于营造热闹氛围；刷新页面后会重新按日期计算，保证逻辑可预期。
 */

const DEMO = {
  // stats 已改为 computeStats() 按日期动态计算，此处保留结构但不再作为默认展示值
  feed:[
    {mask:'小*', amount:1280, item:'618 主推款拍摄', status:'已返', created_at:'2026-08-11T14:50:00'},
    {mask:'L***', amount:860, item:'日常返款结算', status:'已返', created_at:'2026-08-11T14:20:00'},
    {mask:'阿*', amount:2100, item:'品牌专场直播', status:'已返', created_at:'2026-08-11T13:05:00'},
    {mask:'C****', amount:640, item:'短视频种草', status:'已返', created_at:'2026-08-11T11:40:00'},
    {mask:'糖*', amount:1580, item:'新品上架返款', status:'处理中', created_at:'2026-08-11T10:10:00'},
    {mask:'萌*', amount:920, item:'日常返款结算', status:'已返', created_at:'2026-08-11T09:30:00'},
    {mask:'S****', amount:1760, item:'联名款拍摄', status:'已返', created_at:'2026-08-10T22:15:00'},
    {mask:'七*', amount:530, item:'短视频种草', status:'待返', created_at:'2026-08-10T20:00:00'},
  ],
  leaderboard:[
    {mask:'阿*', total:28600, cnt:21},
    {mask:'L***', total:24100, cnt:18},
    {mask:'小*', total:19900, cnt:16},
    {mask:'糖*', total:17400, cnt:14},
    {mask:'C****', total:15200, cnt:12},
    {mask:'S****', total:13800, cnt:11},
  ],
  // 私密查询示例：输入 M001 或 JD20260801001 可见
  private:[
    {model_code:'M001', model_mask:'小雅', order_no:'JD20260801001', item:'618 主推款拍摄', amount:1280, rebate_date:'2026-08-01', expected_rebate_date:'2026-08-05', status:'已返', voucher_url:''},
    {model_code:'M001', model_mask:'小雅', order_no:'JD20260720007', item:'夏日清仓返款', amount:760, rebate_date:'2026-07-20', expected_rebate_date:'2026-07-25', status:'已返', voucher_url:''},
  ]
};

let sb = null;
try { sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY); } catch(e){ console.warn('Supabase 未连接，使用演示数据', e); }

const money = n => '¥' + Number(n||0).toLocaleString('zh-CN',{maximumFractionDigits:2});
function relTime(t){
  const d = new Date(t), now = Date.now(), s = Math.floor((now-d)/1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s/60)+' 分钟前';
  if (s < 86400) return Math.floor(s/3600)+' 小时前';
  return Math.floor(s/86400)+' 天前';
}
function maskStatus(s){ return s||'待返'; }

// ---- 按日期计算四个公示指标 ----
const MODEL_BASE = 586;          // 合作模特人数起点
const MODEL_DAILY_INC = 3;       // 模特人数每天固定增加量（只增不减）
const MODEL_START_DATE = new Date('2026-08-11T00:00:00'); // 模特人数起点日（北京时间/本地时间）

const TOTAL_WEEK_TARGET = 15624; // 每周累计返款金额目标
const COUNT_WEEK_TARGET = 22;    // 每周已结算笔数目标
const MONTH_WEEK_TARGET = 15624; // 本周返款目标（原“本月返款”按本周累计）

// 获取指定日期所在周的周一 00:00:00
function getWeekMonday(d = new Date()){
  const date = new Date(d);
  const day = date.getDay(); // 0=周日, 1=周一, ...
  const diff = day === 0 ? -6 : 1 - day; // 回到本周一
  const mon = new Date(date);
  mon.setDate(date.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

// 基于当前日期计算公示指标（周一 ~ 周日线性累计，模特人数只增不减）
function computeStats(now = new Date()){
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // 1) 合作模特人数：起点 586 + 自基准日起每天固定增加
  const daysSinceBase = Math.floor((now - MODEL_START_DATE) / MS_PER_DAY);
  const model_count = MODEL_BASE + Math.max(0, daysSinceBase) * MODEL_DAILY_INC;

  // 2) 其余三个指标：按自然周线性累计，周一从 0 开始
  const mon = getWeekMonday(now);
  const weekProgress = Math.min(1, Math.max(0, (now - mon) / (7 * MS_PER_DAY)));

  return {
    total_amount: Math.floor(TOTAL_WEEK_TARGET * weekProgress),
    total_count:  Math.floor(COUNT_WEEK_TARGET * weekProgress),
    model_count,
    month_amount: Math.floor(MONTH_WEEK_TARGET * weekProgress)
  };
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
const STATS_KEYS = ['total_amount', 'total_count', 'model_count', 'month_amount'];
const liveStats = { total_amount: 0, total_count: 0, model_count: 0, month_amount: 0 };
const statEl = {}; // { total_amount: { el, isMoney } }

function bindStatEls() {
  statEl.total_amount = { el: document.getElementById('s-amount'), isMoney: true };
  statEl.total_count = { el: document.getElementById('s-count'), isMoney: false };
  statEl.model_count = { el: document.getElementById('s-model'), isMoney: false };
  statEl.month_amount = { el: document.getElementById('s-month'), isMoney: true };
}

// 滚动到目标值（含平滑动画 + 闪烁）
function setStat(key, value, opts = {}) {
  const conf = statEl[key];
  if (!conf || !conf.el) return;
  const from = liveStats[key];
  const dur = opts.duration ?? 800;
  const t0 = performance.now();
  function step(t) {
    const p = Math.min(1, (t - t0) / dur);
    const v = from + (value - from) * p;
    conf.el.textContent = conf.isMoney ? money(Math.floor(v)) : Math.floor(v).toLocaleString('zh-CN');
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
  // 闪烁动画
  conf.el.classList.remove('ticker-flash');
  void conf.el.offsetWidth; // 强制重排，重新触发 animation
  conf.el.classList.add('ticker-flash');
  liveStats[key] = value;
}

let tickerTimer = null;
function startStatsTicker() {
  if (tickerTimer) clearInterval(tickerTimer);
  // 每 2.5 秒一次：金额 +1~30 随机，笔数 1/4 概率 +1，模特 1/12 概率 +1
  tickerTimer = setInterval(() => {
    const inc = Math.floor(Math.random() * 30) + 1;
    setStat('total_amount', liveStats.total_amount + inc);
    setStat('month_amount', liveStats.month_amount + inc);
    if (Math.random() < 0.25) setStat('total_count', liveStats.total_count + 1);
    if (Math.random() < 1/12) setStat('model_count', liveStats.model_count + 1);
  }, 2500);
}

async function loadStats(){
  // 若后端有 public_stats RPC，优先取真实数据；否则按日期规则计算
  if (sb){
    const {data,error} = await sb.rpc('public_stats');
    if (!error && data) return data;
  }
  return computeStats();
}
async function loadFeed(){
  if (sb){
    const {data,error} = await sb.rpc('public_feed',{p_limit:30});
    if (!error && data && data.length) return data;
  }
  return DEMO.feed;
}
async function loadBoard(){
  if (sb){
    const {data,error} = await sb.rpc('public_leaderboard',{p_limit:10});
    if (!error && data && data.length) return data;
  }
  return DEMO.leaderboard;
}

function renderStats(s){
  bindStatEls();
  liveStats.total_amount = s.total_amount;
  liveStats.total_count = s.total_count;
  liveStats.model_count = s.model_count;
  liveStats.month_amount = s.month_amount;
  countUp(statEl.total_amount.el, s.total_amount, true);
  countUp(statEl.total_count.el, s.total_count, false);
  countUp(statEl.model_count.el, s.model_count, false);
  countUp(statEl.month_amount.el, s.month_amount, true);
  startStatsTicker(); // 启动实时滚动 ticker
}
function feedItem(r){
  return `<div class="feed-item">
    <span class="fi-emoji">🎉</span>
    <div class="fi-main">
      <div class="fi-line"><b>${r.mask}</b> 收到返款 <span class="amt">${money(r.amount)}</span></div>
      <div class="fi-sub">${r.item} · <span class="st-pill st-${maskStatus(r.status)}">${maskStatus(r.status)}</span> · ${relTime(r.created_at)}</div>
    </div></div>`;
}
function renderFeed(rows){
  const html = rows.map(feedItem).join('');
  document.getElementById('feed').innerHTML = html + html; // 复制一份做无缝滚动
}
function renderBoard(rows){
  document.getElementById('leaderboard').innerHTML = rows.map((r,i)=>`
    <div class="lb-item">
      <span class="lb-rank ${i<3?'top':''}">${i+1}</span>
      <span class="lb-name">${r.mask}</span>
      <span class="lb-amt">${money(r.total)}<small style="font-size:12px;color:var(--sub);font-weight:400"> · ${r.cnt}笔</small></span>
    </div>`).join('') || '<div class="empty">暂无数据</div>';
}

// ---- 私密查询 ----
async function query(code){
  code = (code||'').trim();
  if (!code) return [];
  if (sb){
    const {data,error} = await sb.rpc('get_my_rebates',{p_code:code});
    if (!error) return data||[];
  }
  return DEMO.private.filter(r => r.model_code===code || r.order_no===code);
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
  document.getElementById('queryResult').innerHTML = '<div class="empty">查询中…</div>';
  renderQuery(await query(v));
});
document.getElementById('q-input').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('q-btn').click(); });

// ---- 初始化 ----
(async ()=>{
  renderStats(await loadStats());
  renderFeed(await loadFeed());
  renderBoard(await loadBoard());
})();
