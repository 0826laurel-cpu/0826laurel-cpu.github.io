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
const MODEL_DAILY_INC = 12;      // 模特人数每天增加量（每周约 +84，落在 70-100 区间），只增不减
const STATS_START_DATE = new Date('2026-08-11T00:00:00'); // 累计口径起点日

// 累计金额：调快日吞吐，让最低位持续快速滚动；HIST_BASE 已按原 130 万口径平滑修正，避免跳变
const HIST_BASE = 1067000;       // 历史累计基线（元）
const TOTAL_DAILY_INC = 86400;   // 累计金额每日吞吐（元/天）→ 每秒约 +1 元，最低位每秒滚动 1 格

const WEEK_DAILY_INC = 8600;     // 本周新增每日吞吐（元/天），保持原约定（周一~周日封顶约 6 万）

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

// ---- 数字滚轮（odometer）：每位数字独立上下平滑滚动，入场 + 实时持续滚动 ----
(function () {
  const css = `
  .odo{display:inline-flex; align-items:flex-end; line-height:1.1; font-variant-numeric:tabular-nums; font-feature-settings:"tnum";}
  .odo-digit{height:1.1em; overflow:hidden; display:inline-block; vertical-align:bottom;}
  .odo-rail{display:flex; flex-direction:column; transition:transform 1.3s cubic-bezier(.22,.61,.36,1); will-change:transform;}
  .odo-cell{height:1.1em; line-height:1.1; display:flex; align-items:center; justify-content:center;}
  .odo-sep{display:inline-block;}
  `;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();

// 统计数字格式化：统一显示整数（不显示小数点），但 odometer 仍按内部小数做平滑滚动
function statsStr(el, value) {
  const floor = Math.floor(value);
  return (el._isMoney ? '¥' : '') + floor.toLocaleString('zh-CN');
}

// startAtZero: true → 所有数字从 0 开始（入场）；false → 直接定位到目标值（重建/实时）
function buildOdometer(el, value, startAtZero) {
  const str = statsStr(el, value);
  el.innerHTML = '';
  el.classList.add('odo');
  el._railMap = [];
  for (const ch of str) {
    if (ch >= '0' && ch <= '9') {
      const d = document.createElement('span'); d.className = 'odo-digit';
      const rail = document.createElement('span'); rail.className = 'odo-rail';
      // 0-9 + 末尾多一个 0：方便 overshoot/回弹时不会露出空白，也让 9→0 的进位更自然
      for (let i = 0; i <= 10; i++) {
        const c = document.createElement('span'); c.className = 'odo-cell';
        c.textContent = i === 10 ? 0 : i; rail.appendChild(c);
      }
      d.appendChild(rail); el.appendChild(d); el._railMap.push(rail);
    } else {
      const s = document.createElement('span'); s.className = 'odo-sep';
      s.textContent = ch; el.appendChild(s);
    }
  }
  el._str = str;
  // 初始定位：入场从 0 开始，其余情况直接定位到目标值（不播放过渡）
  setRailPositions(el, value, startAtZero ? 0 : null, true);
}

// 设置每一位轨道的 translateY
// basePos: 若指定，则每位从 basePos（该位整数）开始；null 表示用目标值的整数位
// noTransition: true 时关闭 transition（用于初始定位 / 实时驱动）
function setRailPositions(el, value, basePos, noTransition) {
  const str = el._str;
  // 计算小数位数（最后一个 "." 之后的数字个数），用于正确换算最低位的过渡小数
  let decimalPlaces = 0;
  const dotIdx = str.lastIndexOf('.');
  if (dotIdx >= 0) decimalPlaces = str.length - dotIdx - 1;
  const lastUnit = Math.pow(10, decimalPlaces);
  const fracForLast = (value * lastUnit) % 1; // 最低位（最小单位）的过渡小数 0~1
  // 找到最后一位数字的索引
  let lastDigitIdx = -1, idx = 0;
  for (const ch of str) {
    if (ch >= '0' && ch <= '9') lastDigitIdx = idx++;
  }
  idx = 0;
  for (const ch of str) {
    if (ch >= '0' && ch <= '9') {
      const rail = el._railMap[idx];
      const targetDigit = Number(ch);
      // 最低位（角位/个位）叠加过渡小数，实现持续平滑滚动
      const digitWithFrac = targetDigit + (idx === lastDigitIdx ? fracForLast : 0);
      const baseDigit = basePos !== null ? basePos : targetDigit;
      const baseWithFrac = baseDigit + (idx === lastDigitIdx && basePos !== null ? fracForLast : 0);
      if (noTransition) rail.style.transition = 'none';
      rail.style.transform = 'translateY(-' + ((basePos !== null ? baseWithFrac : digitWithFrac) * 1.1) + 'em)';
      idx++;
    }
  }
}

// 滚动/更新到目标值（仅位数/分隔符变化时重建；同长度只换数字可复用轨道）
function rollOdometer(el, value) {
  const str = statsStr(el, value);
  if (el._str !== str) {
    if (el._str && el._str.length === str.length) {
      // 结构没变，仅数字进位（如 1303583→1303584）：复用轨道，避免每秒重建闪烁
      el._str = str;
    } else {
      buildOdometer(el, value, false);
      return;
    }
  }
  setRailPositions(el, value, null, false);
}

let liveTimer = null;
function startLiveTicker() {
  if (liveTimer) cancelAnimationFrame(liveTimer);
  // 关闭 transition，直接用 RAF 驱动，保证实时滚动不抖动
  STATS_KEYS.forEach(k => {
    if (statEl[k] && statEl[k].el && statEl[k].el._railMap) {
      statEl[k].el._railMap.forEach(r => { r.style.transition = 'none'; });
    }
  });
  function tick() {
    const s = computeStats();
    STATS_KEYS.forEach(k => rollOdometer(statEl[k].el, s[k]));
    liveTimer = requestAnimationFrame(tick);
  }
  liveTimer = requestAnimationFrame(tick);
}

function renderStats(s) {
  bindStatEls();
  // 入场：用目标值结构建轨道，但全部停在 0
  STATS_KEYS.forEach(k => {
    statEl[k].el._isMoney = statEl[k].isMoney;
    buildOdometer(statEl[k].el, s[k], true);
  });
  // 强制重排，确保“0”状态已渲染
  void document.body.offsetWidth;
  // 下一帧开启弹性过渡并滚动到真实值（所有数字一起活泼滚入）
  requestAnimationFrame(() => requestAnimationFrame(() => {
    STATS_KEYS.forEach(k => {
      const el = statEl[k].el;
      // overshoot 弹性缓动：先冲过头再弹回，营造活泼老虎机感
      el._railMap.forEach(r => { r.style.transition = 'transform 1.1s cubic-bezier(0.34, 1.45, 0.64, 1)'; });
      rollOdometer(el, s[k]);
    });
    // 入场动画结束后启动持续实时滚动
    setTimeout(startLiveTicker, 1200);
  }));
}

async function loadStats(){
  // 公示台使用按日期计算的值（见文件顶部计算逻辑说明），不直接读取真实订单汇总，
  // 以保证展示数字符合“模特人数 586 起点、每周累计、周一归零”的规则。
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
