// ============ 公开首页逻辑 ============
const DEMO = {
  stats:{ total_amount:1286400, total_count:842, model_count:156, month_amount:186500 },
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
    {model_code:'M001', model_mask:'小雅', order_no:'JD20260801001', item:'618 主推款拍摄', amount:1280, rebate_date:'2026-08-01', status:'已返'},
    {model_code:'M001', model_mask:'小雅', order_no:'JD20260720007', item:'夏日清仓返款', amount:760, rebate_date:'2026-07-20', status:'已返'},
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

async function loadStats(){
  if (sb){
    const {data,error} = await sb.rpc('public_stats');
    if (!error && data) return data;
  }
  return DEMO.stats;
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
  countUp(document.getElementById('s-amount'), s.total_amount, true);
  countUp(document.getElementById('s-count'), s.total_count, false);
  countUp(document.getElementById('s-model'), s.model_count, false);
  countUp(document.getElementById('s-month'), s.month_amount, true);
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
function renderQuery(rows){
  const box = document.getElementById('queryResult');
  if (!rows.length){ box.innerHTML = '<div class="empty">未查到记录，请确认订单号或查询码是否正确～</div>'; return; }
  const total = rows.reduce((s,r)=>s+Number(r.amount||0),0);
  let html = '';
  if (rows.length>1) html += `<div class="q-sum">共 ${rows.length} 笔返款 · 累计 ${money(total)}</div>`;
  html += rows.map(r=>`
    <div class="q-card">
      <div class="q-top"><span class="q-order">订单 ${r.order_no}</span>
        <span class="st-pill st-${maskStatus(r.status)}">${maskStatus(r.status)}</span></div>
      <div class="q-item">${r.item}</div>
      <div class="q-amount">${money(r.amount)}</div>
      <div class="q-date">返款日期：${r.rebate_date}</div>
    </div>`).join('');
  box.innerHTML = html;
}

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
