// me.js — 伙伴专属自助页（底部 Tab 多视图版）
(function () {
  // iframe 内嵌页高度自适应：接收子页面报告的实际高度并调整容器
  const lastHeights = {};
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'setHeight') return;
    const wrap = e.data.page === 'rebate' ? document.getElementById('rebate-wrap') : (e.data.page === 'welfare' ? document.getElementById('welfare-wrap') : null);
    if (!wrap || typeof e.data.height !== 'number' || e.data.height <= 0) return;
    const last = lastHeights[e.data.page] || 0;
    if (Math.abs(e.data.height - last) <= 2) return;
    lastHeights[e.data.page] = e.data.height;
    requestAnimationFrame(function() { wrap.style.height = e.data.height + 'px'; });
  });

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const TOKEN = new URLSearchParams(location.search).get('t') || '';
  // 同步写入本机会话，使「打开 join 链接」也能自动回到本页（两链接互通）
  if (TOKEN) { try { localStorage.setItem('p_token', TOKEN); } catch (e) {} }
  const SHIP_STATUS = { pending: '待发货', collected: '已揽收', transit: '运输中', delivering: '派送中', signed: '已签收', delivered: '已签收' };
  const SHIP_COLOR = { pending: '#9AA0AD', collected: '#5B7CFA', transit: '#E58A3F', delivering: '#FF8FA3', signed: '#2BB673', delivered: '#2BB673' };
  function effStatus(s) {
    if (s && s.status === 'pending' && s.trackingNo && String(s.trackingNo).trim() !== '') return 'collected';
    return s ? s.status : '';
  }
  let PARTNER = null, SHIPS = [], WALL_FEED = [], WALL_STATS = { total_sent: 0, total_receivers: 0, total_signed: 0 };
  let PAYOUT_QR_URL = null;
  let REBATES = []; // 该模特的返款记录（首页「返款进度」用）

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), n = new Date(), diff = (n - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + '天前';
    return d.toISOString().slice(0, 10);
  }
  function fmtWallDate(ts) {
    if (!ts) return '';
    const d = new Date(ts), n = new Date(), y = new Date(n); y.setDate(n.getDate() - 1);
    const same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    const yest = d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate();
    if (same) return '今天';
    if (yest) return '昨天';
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function avColorMe(name) {
    const cs = ['#FF6B5C', '#7C6CF0', '#FFB36B', '#2BB673', '#5B7CFA'];
    let h = 0; for (const ch of (name || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return cs[h % cs.length];
  }
  function normShip(s) {
    if (!s) return s;
    return {
      id: s.id, partnerId: s.partner_id,
      giftName: s.gift_name, carrier: s.carrier,
      trackingNo: s.tracking_no, phone: s.phone,
      status: s.status, logs: s.logs || [],
      trackingAddedAt: s.tracking_added_at,
      productLink: s.product_link || '', productTitle: s.product_title || '',
      value: Number(s.value) || 0,
      createdAt: s.created_at, updatedAt: s.updated_at
    };
  }
  function genModelCode(seed) {
    let x = (seed >>> 0) || 1;
    x = (x + 0x9e3779b9) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    x = Math.imul(x, 0x85ebca6b) >>> 0;
    x = (x ^ (x >>> 13)) >>> 0;
    x = Math.imul(x, 0xc2b2ae35) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    function rnd() { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }
    const len = 6 + Math.floor(rnd() * 3);
    let s = String(1 + Math.floor(rnd() * 9));
    for (let i = 1; i < len; i++) s += String(Math.floor(rnd() * 10));
    return s;
  }
  function generateWallData() {
    const gifts = ['定制礼盒','暖心保温杯','防晒喷雾','补水面膜','精致手链','香薰蜡烛','便携风扇','零食大礼包','护手霜套装','真丝发圈','眼影盘','口红礼盒','毛绒挂件','国潮帆布袋','蓝牙音箱','颈部按摩仪','收纳盒套装','花茶礼盒','手机支架','桌垫'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daySeed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    const startDate = new Date('2026-08-01');
    startDate.setHours(0, 0, 0, 0);
    const diffDays = Math.max(0, Math.floor((today - startDate) / 86400000));
    const activeCount = 8 + (daySeed % 5);
    const activeNames = [];
    const seenCodes = new Set();
    let gi = 0;
    while (activeNames.length < activeCount) {
      const c = genModelCode(daySeed + gi * 7919);
      if (!seenCodes.has(c)) { seenCodes.add(c); activeNames.push(c); }
      gi++;
    }
    const feed = [];
    let feedSigned = 0;
    const seenNames = new Set();
    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const d = new Date(today);
      d.setDate(d.getDate() - dayOffset);
      const dayTs = d.getTime();
      const daySeed2 = daySeed + dayOffset * 13;
      const count = 2 + (daySeed2 % 3);
      for (let i = 0; i < count; i++) {
        const name = activeNames[(daySeed2 + i * 11) % activeNames.length];
        const gift = gifts[(daySeed2 + i * 17 + dayOffset) % gifts.length];
        let status;
        if (dayOffset <= 1) {
          status = (daySeed2 + i) % 2 === 0 ? 'delivering' : 'transit';
        } else {
          status = (daySeed2 + i) % 6 === 0 ? 'transit' : 'signed';
        }
        if (status === 'signed') feedSigned++;
        seenNames.add(name);
        feed.push({ partner_name: name, gift_name: gift, status, created_at: dayTs + i * 3600 * 1000 });
      }
    }
    feed.sort((a, b) => b.created_at - a.created_at);
    const total_sent = Math.max(feed.length, 28 + diffDays * 2 + (daySeed % 5));
    const total_receivers = Math.max(seenNames.size, 8 + diffDays + (daySeed % 3));
    const total_signed = Math.max(feedSigned, 18 + diffDays * 2 + (daySeed % 4));
    return { feed, stats: { total_sent, total_receivers, total_signed } };
  }
  function fmtTrackDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function addrText(a) {
    if (!a || (!a.name && !a.detail)) return '';
    return [a.name, a.phone, [a.province, a.city, a.district].filter(Boolean).join(''), a.detail, a.postal].filter(Boolean).join('\n');
  }
  function addrRowsMarkup(a) {
    const regParts = [a.province, a.city, a.district].filter(Boolean);
    const region = regParts.join(' · ');
    const addrFull = a.detail ? region + (region ? ' · ' : '') + a.detail : region;
    const rows = [];
    if (a.name) rows.push(`<div class="addr-row"><div class="ico">👤</div><div class="text">${esc(a.name)}</div></div>`);
    if (a.phone) rows.push(`<div class="addr-row"><div class="ico">📱</div><div class="text">${esc(a.phone)}</div></div>`);
    if (addrFull) rows.push(`<div class="addr-row full"><div class="ico">📍</div><div class="text">${esc(addrFull)}</div></div>`);
    if (!rows.length) return '';
    return '<div class="addr-list">' + rows.join('') + '</div>';
  }

  // 收款码模块（支付宝）
  function payoutQrMarkup(addrSet) {
    const has = !!PAYOUT_QR_URL;
    const body = has
      ? `<div class="payout-qr-body">
           <div class="payout-qr-thumb"><img id="payout-qr-img" src="${esc(PAYOUT_QR_URL)}" alt="收款码"></div>
           <div class="payout-qr-info">
             <div class="l1">支付宝收款码已上传</div>
             <div class="l2">仅福利派送官可见，方便后续打款</div>
             <div class="payout-qr-actions">
               <button class="btn-mini" id="payout-qr-replace">📷 替换</button>
               <button class="btn-mini danger" id="payout-qr-clear">🗑 删除</button>
             </div>
           </div>
         </div>`
      : `<div class="payout-qr-empty">
           <div class="ico">💳</div>
           <div class="text">
             <div class="l1">上传收款码</div>
             <div class="l2">${addrSet ? '上传后我们后续打款就用这张' : '先填收件地址，再上传收款码，方便后续打款'}</div>
           </div>
           <button class="btn-up" id="payout-qr-upload">📤 上传</button>
         </div>`;
    return `<div class="payout-qr">
      <div class="payout-qr-head">
        <div class="title"><span class="em">支</span>收款码（支付宝）</div>
        <div class="hint">${has ? '已设置' : '为后续打款'}</div>
      </div>
      ${body}
      <input type="file" accept="image/jpeg,image/png,image/webp" class="payout-qr-input" id="payout-qr-input">
      <div id="payout-qr-msg" class="payout-qr-uploading" style="display:none"></div>
    </div>`;
  }
  function showErr(title, hint, detail) {
    const err = document.getElementById('err');
    const viewport = document.getElementById('viewport');
    const tabbar = document.getElementById('tabbar');
    if (viewport) viewport.style.display = 'none';
    if (tabbar) tabbar.style.display = 'none';
    err.style.display = 'block';
    const detailBlock = detail ? '<pre class="err-detail">' + esc(detail) + '</pre>' : '';
    err.innerHTML = '<div class="em">🔒</div><h1>' + esc(title || '链接无效') + '</h1><p class="lead">' + (hint || '请使用完整的专属链接访问本页') + '</p>' + detailBlock + '<button class="btn" id="retryBtn" style="margin-top:18px">刷新重试</button>';
    const retryBtn = document.getElementById('retryBtn');
    if (retryBtn) retryBtn.addEventListener('click', () => { err.style.display = 'none'; if (viewport) viewport.style.display = 'block'; if (tabbar) tabbar.style.display = 'flex'; load(); });
  }
  // 注：旧的「收藏专属链接」卡片已下线（同设备自动登录，链接不再需要手动收藏），
  // 原 toast() 帮助函数随之移除；如后续需要轻量提示，可在 me.html 自行放置 #toast-mini。

  // —— 性能优化：本地缓存（反复打开秒开）+ 收款码懒加载 ——
  const CACHE_TTL = 5 * 60 * 1000;
  function readCache(token) {
    try {
      const raw = localStorage.getItem('me_cache_' + token);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c || !c.ts || Date.now() - c.ts > CACHE_TTL) return null;
      return c;
    } catch (e) { return null; }
  }
  function writeCache(token, data) {
    try { localStorage.setItem('me_cache_' + token, JSON.stringify({ ts: Date.now(), partner: data.partner, ships: data.ships })); } catch (e) {}
  }
  async function loadPayoutQr() {
    try {
      // v38：改用 Api.rpcRace 双链路 fallback（避免 sb.rpc 在浏览器对 Worker 域 CORS 兼容问题）
      const r = await Api.rpcRace('get_my_partner_payout_qr', { p_token: TOKEN });
      if (r && r.ok) { PAYOUT_QR_URL = r.payout_qr_url || null; render(); }
    } catch (e) { console.warn('[loadPayoutQr]', e && (e.message || e)); }
  }

  async function load() {
    if (!TOKEN) { showErr('链接无效', '链接里没有 token。请使用完整的专属链接（应形如 ' + (window.APP_ORIGIN || location.origin) + '/me.html?t=...）。'); return; }
    if (TOKEN === 'TOKEN' || !/^[a-f0-9]{32}$|^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(TOKEN)) { showErr('链接无效', '链接里的 token 不正确（看到了占位符 "TOKEN" 或格式不对）。请使用你收到的<b>真实</b>专属链接，<b>不要手动修改链接</b>。'); return; }
    // v41：移除 v38 之前对 window.sb 的存在性检查 —— 全仓库已迁到 Api.rpcRace（裸 fetch 双链路），
    //      无需依赖 supabase-js SDK，删掉避免在 SDK 缺失/被广告拦截时报"客户端加载失败"假错误。
    try {
      // ① 先读本地缓存，命中则瞬时渲染（模特反复打开自己页 ≈ 0 延迟）
      const cached = readCache(TOKEN);
      if (cached) {
        PARTNER = cached.partner; SHIPS = cached.ships || [];
        render();
      }
      // ② 主数据并行拉取：get_my_partner + my_shipments 同时发，省掉一次往返
      // v38：改用 Api.rpcRace 双链路 fallback（电脑端 sb.rpc 走 Worker 域失败 → 切直连）
      const [pd, sd] = await Promise.all([
        Api.rpcRace('get_my_partner', { p_token: TOKEN }, { noThrowOnFalse: true }),
        Api.rpcRace('my_shipments', { p_token: TOKEN }, { noThrowOnFalse: true })
      ]);
      // pd 形如 {ok:true, partner:{...}, token} / sd 形如 {ok:true, shipments:[...]}（或抛错）
      if (!pd || !pd.ok || !pd.partner) {
        showErr('链接无效', '找不到对应的伙伴记录。可能链接已失效，请联系福利派送官重新发送你的专属链接。' + (pd && pd.error ? ' (' + esc(pd.error) + ')' : ''));
        return;
      }
      if (!sd || !sd.ok) {
        showErr('加载失败', '物流信息加载失败，请稍后刷新重试。' + (sd && sd.error ? ' (' + esc(sd.error) + ')' : ''));
        return;
      }
      PARTNER = pd.partner; SHIPS = ((sd && sd.shipments) || []).map(normShip);
      try { document.title = (PARTNER && PARTNER.name ? PARTNER.name + '模特专属后台' : '模特专属后台'); } catch (e) {}
      const wall = generateWallData();
      WALL_FEED = wall.feed;
      WALL_STATS = wall.stats;
      // ②.5 拉取该模特返款进度（失败不影响主流程，保持空数组即可）
      try { if (PARTNER.model_id) REBATES = (await Api.getRebatesByModel(PARTNER.model_id) || []).map(r => ({ ...r, amount: Number(r.amount) || 0 })); } catch (e) { REBATES = []; }
      writeCache(TOKEN, { partner: PARTNER, ships: SHIPS });
      render();
      // ③ 收款码独立懒加载，不阻塞首屏
      loadPayoutQr();
    } catch (e) {
      const msg = (e && (e.message || e)) || '未知错误';
      const detail = '类型: ' + (e && e.name ? e.name : typeof e) + '\n信息: ' + msg + '\n时间: ' + new Date().toLocaleString();
      showErr('网络异常', '请检查网络后刷新重试。如果反复出现，请截图本页错误详情。', detail);
    }
  }

  function switchTab(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
    const viewport = document.getElementById('viewport');
    if (viewport) viewport.scrollTop = 0;
    // v30：返款 / 福利 tab 都改懒加载，首次激活才发请求，避免主页打开时两 iframe 互相抢资源
    if (name === 'rebate' || name === 'welfare') activateLazyFrame(name);
    // 切回首页时实时刷新返款进度（后台改了状态，模特立刻能看到）
    if (name === 'home') {
      loadRebatesForModel().then(() => { renderHome(); bindEvents(); });
    }
  }

  // 按 model_id 重新拉取该模特返款记录（失败保持现状，不阻塞）
  async function loadRebatesForModel() {
    if (!PARTNER || !PARTNER.model_id) { REBATES = []; return; }
    try {
      const rows = await Api.getRebatesByModel(PARTNER.model_id);
      REBATES = (rows || []).map(r => ({ ...r, amount: Number(r.amount) || 0 }));
    } catch (e) { /* 保持原值 */ }
  }

  function buildShipsHtml() {
    const renderShipItem = s => {
      const logs = (s.logs || []).map(l => `<div class="it"><div class="dot" style="background:${SHIP_COLOR[l.status] || '#FF6B5C'}"></div>
        <div><div class="tt">${esc(l.desc)}</div><div class="ta">${SHIP_STATUS[l.status] || ''} · ${fmtTime(l.time)}</div></div></div>`).join('') || '<div style="color:#9AA0AD;font-size:13px">暂无轨迹</div>';
      const trackNo = s.trackingNo || '';
      const trackDate = s.trackingAddedAt ? `<div class="track-date">📅 单号上传：${esc(fmtTrackDate(s.trackingAddedAt))}</div>` : '';
      const trackBlock = trackNo
        ? `<div class="track">
            <div class="track-label">📮 快递单号</div>
            <div class="track-row">
              <span class="track-no">${esc(trackNo)}</span>
              <button class="track-copy" data-no="${esc(trackNo)}">复制</button>
            </div>
            <a class="track-link" href="https://m.kuaidi100.com/index_all.html?postid=${encodeURIComponent(trackNo)}" target="_blank" rel="noopener">🔎 跳转快递100查询此单 →</a>
            ${trackDate}
          </div>`
        : `<div class="track-empty">📮 快递单号暂未填入（待承运商分配后会自动同步）</div>`;
      const isLive = s.status === 'transit' || s.status === 'delivering';
      const collapseCls = isLive ? '' : ' collapsed';
      return `<div class="ship-item">
        <div class="ship-head${collapseCls}" data-toggle="tl">
          <div class="head-left">
            <span class="toggle-icon">▶</span>
            <div class="nm">${esc(s.giftName)}</div>
          </div>
          <span class="ship-status" style="background:${SHIP_COLOR[effStatus(s)] || '#9AA0AD'}">${SHIP_STATUS[effStatus(s)] || effStatus(s)}</span>
        </div>
        ${trackBlock}
        <div class="carrier-label">承运商：${esc(s.carrier || '未填快递')}</div>
        ${s.productLink ? `<a class="product-link" href="${esc(s.productLink)}" target="_blank" rel="noopener">🔗 查看拼多多商品</a>` : ''}
        <div class="tl${collapseCls}">${logs}</div>
      </div>`;
    };
    const topHtml = SHIPS.slice(0, 3).map(renderShipItem).join('');
    const extrasArr = SHIPS.slice(3);
    const extrasHtml = extrasArr.map(renderShipItem).join('');
    const main = SHIPS.length ? topHtml : '<div style="text-align:center;color:#9AA0AD;font-size:13px;padding:14px">还没有收到礼品发货～</div>';
    return `${main}${extrasArr.length ? `<div class="ship-extras" id="ship-extras" hidden>${extrasHtml}</div>` : ''}`;
  }

  const signedSet = new Set(['signed', 'delivered']);
  function isSigned(s) { return signedSet.has(s && s.status); }
  function buildOverviewHtml() {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    const monthSigned = SHIPS.filter(s => isSigned(s) && (() => { const d = new Date(s.createdAt); return d.getFullYear() === y && d.getMonth() === m; })()).length;
    const pendingCount = SHIPS.filter(s => !isSigned(s)).length;
    // 累计福利价值：只要已发货（无论待收货/运输中/已签收）都计入，因为礼品价值在发货时即产生
    const totalValue = SHIPS.reduce((a, s) => a + (Number(s.value) || 0), 0);
    return `
      <div class="me-card overview-card">
        <div class="block-title">📊 我的福利概览</div>
        <div class="ov-grid">
          <div class="ov"><div class="n">${monthSigned}</div><div class="l">本月已收</div></div>
          <div class="ov"><div class="n">${pendingCount}</div><div class="l">待收货</div></div>
          <div class="ov"><div class="n" style="color:#FF6B5C">¥${totalValue}</div><div class="l">累计福利价值</div></div>
        </div>
      </div>`;
  }

  function buildRebateProgressHtml() {
    if (!REBATES.length) {
      return `<div class="me-card">
        <div class="block-title">💰 我的返款进度</div>
        <div style="text-align:center;color:#9AA0AD;font-size:13px;padding:16px 0">暂无返款任务～<br><span style="color:#C7CAD3">福利派送官在后台录入后，这里会实时显示进度</span><br><span style="color:#C7CAD3">数据会在确认收货隔天更新</span></div>
      </div>`;
    }
    const total = REBATES.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const renderItem = r => {
      const st = r.status || '待返';
      const step = st === '已返' ? 3 : (st === '处理中' ? 2 : 1);
      const color = step === 3 ? '#2BB673' : (step === 2 ? '#5B7CFA' : '#FF6B5C');
      const stepStyle = n => `flex:0 0 auto;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;background:${step >= n ? color : '#F0F1F4'};color:${step >= n ? '#fff' : '#9AA0AD'}`;
      const barStyle = on => `flex:1;height:3px;border-radius:2px;background:${on ? color : '#EDEDF0'}`;
      return `<div style="background:#FAFBFC;border:1px solid #EDEDF0;border-radius:14px;padding:13px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="font-size:14px;font-weight:700">${esc(r.item || '返款任务')}</div>
          <div style="font-size:15px;font-weight:800;color:${color};white-space:nowrap">${money(r.amount)}</div>
        </div>
        <div style="display:flex;gap:10px;margin-top:6px;font-size:12px;color:#9AA0AD">
          <span>📦 订单 ${esc(r.order_no || '-')}</span>
          <span style="color:${color};font-weight:700">${esc(st)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:11px">
          <span style="${stepStyle(1)}">待返</span>
          <span style="${barStyle(step >= 2)}"></span>
          <span style="${stepStyle(2)}">处理中</span>
          <span style="${barStyle(step >= 3)}"></span>
          <span style="${stepStyle(3)}">已返</span>
        </div>
        ${r.expected_rebate_date || r.rebate_date ? `<div style="font-size:11px;color:#9AA0AD;margin-top:8px">${r.expected_rebate_date ? `预计返款日期：${esc(r.expected_rebate_date)}` : `返款日期：${esc(r.rebate_date)}`}</div>` : ''}
        ${r.voucher_url ? `<a href="${esc(r.voucher_url)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px;font-size:12px;color:#5B7CFA;text-decoration:none">🧾 查看返款凭证</a>` : ''}
      </div>`;
    };
    const topHtml = REBATES.slice(0, 3).map(renderItem).join('');
    const extrasArr = REBATES.slice(3);
    const extrasHtml = extrasArr.map(renderItem).join('');
    return `<div class="me-card">
      <div class="block-title">💰 我的返款进度 <span style="font-size:12px;color:#9AA0AD;font-weight:normal;margin-left:6px">共 ${REBATES.length} 笔 · 累计 ${money(total)}</span></div>
      ${topHtml}
      ${extrasArr.length ? `<div class="rp-extras" id="rp-extras" hidden>${extrasHtml}</div>
        <div class="rp-toggle-wrap" id="rp-toggle-wrap"><span class="rp-toggle-more" id="rp-toggle-more">展开 ${extrasArr.length} 笔更多 ▼</span></div>` : ''}
    </div>`;
  }

  function renderHome() {
    const p = PARTNER, a = p.address || {}, addr = addrText(a);
    const lastSeen = Number(p.lastSeenAt) || 0;
    const unseen = SHIPS.filter(s => {
      const t = (s.trackingAddedAt || s.createdAt) ? new Date(s.trackingAddedAt || s.createdAt).getTime() : 0;
      return t > lastSeen;
    }).length;
    const notifyHtml = unseen > 0
      ? `<div class="notify-banner">🎁 你有 <b>${unseen}</b> 件新礼品动态！福利派送官已为你寄出，下拉查看物流动态～</div>`
      : '';

    document.getElementById('view-home').innerHTML = `
      ${notifyHtml}
      <div class="me-card">
        <div class="hero">
          <div class="hero-icon">🎁</div>
          <div class="hero-body">
            <h1>${esc(p.name)}模特专属后台</h1>
            <div class="lead">这是你的私人福利空间 —— 填好收件地址，就能第一时间收到福利派送官亲自寄出的小礼物，并实时查看物流动态～</div>
            <div class="hero-meta"><span class="pulse"></span>福利派送官亲自寄出 · 智能物流同步</div>
          </div>
        </div>
      </div>
      ${buildOverviewHtml()}
      ${buildRebateProgressHtml()}
      <div class="me-card">
        <div class="addr-head">
          <div class="addr-title">收件地址</div>
          ${addr ? '<span class="addr-badge set">✓ 已设置</span>' : '<span class="addr-badge unset">待完善</span>'}
        </div>
        ${addr
          ? `${addrRowsMarkup(a)}
             <button class="btn-edit ghost" id="edit-addr">修改收件地址 <span class="arrow">→</span></button>`
          : `<div class="addr-empty" style="background:linear-gradient(135deg,#FAFBFC,#F6F7F9);border:1px dashed #E5E7EB;border-radius:14px;padding:22px 14px;text-align:center;color:#9AA0AD;font-size:13px">还没填写收件地址<br><span style="color:#C7CAD3">填上后，我们就能给你寄礼物啦 🎀</span></div>
             <button class="btn-edit" id="edit-addr" style="margin-top:12px">现在填写 <span class="arrow">→</span></button>`}
        <div id="addr-form" style="display:none;margin-top:14px">
          <div class="field"><label>收件人 *</label><input id="a-name" value="${esc(a.name || '')}" placeholder="你的姓名"></div>
          <div class="field"><label>手机号 *</label><input id="a-phone" value="${esc(a.phone || '')}" placeholder="11 位手机号"></div>
          <div class="row2">
            <div class="field"><label>省</label><input id="a-prov" value="${esc(a.province || '')}" placeholder="如：浙江"></div>
            <div class="field"><label>市</label><input id="a-city" value="${esc(a.city || '')}" placeholder="如：杭州"></div>
          </div>
          <div class="field"><label>区 / 县</label><input id="a-dist" value="${esc(a.district || '')}" placeholder="如：西湖区"></div>
          <div class="field"><label>详细地址</label><input id="a-detail" value="${esc(a.detail || '')}" placeholder="街道 / 小区 / 门牌"></div>
          <div class="field"><label>邮编（选填）</label><input id="a-postal" value="${esc(a.postal || '')}" placeholder="如：310000"></div>
          <button class="btn" id="save-addr">保存地址</button>
        </div>
        ${payoutQrMarkup(addr)}
      </div>
      <div class="me-card">
        <div class="ship-head-row" id="ship-head-row">
          <div class="block-title">🚚 我的礼品与物流 <span style="font-size:12px;color:#9AA0AD;font-weight:normal;margin-left:6px">共 ${SHIPS.length} 件</span></div>
          ${SHIPS.length > 3 ? `<span class="ship-fold-btn" id="ship-fold-btn">展开 ${SHIPS.length - 3} 条更多 ▼</span>` : ''}
        </div>
        <div class="ship-list" id="ship-list">${buildShipsHtml()}</div>
      </div>
      ${buildWallHtml()}
      <div class="note">本页仅你本人可通过专属链接访问 · 信息仅用于福利发放</div>`;
  }

  function buildWallHtml() {
    const feedItemsHtml = WALL_FEED.length ? WALL_FEED.map(f => {
      const name = f.partner_name || '某位伙伴';
      const gift = f.gift_name || f.product_title || '礼品';
      return `<div class="wall-item">
        <div class="av" style="background:${avColorMe(name)}">${esc(name.slice(0, 1))}</div>
        <div class="wi-body">
          <div class="wi-text">模特 <b>${esc(name)}</b> · ${fmtWallDate(f.created_at)} 收到了 <b>${esc(gift)}</b></div>
          <div class="wi-meta">${SHIP_STATUS[f.status] || ''}</div>
        </div>
      </div>`;
    }).join('') : '<div class="wall-empty">还没有送礼记录，敬请期待 🎀</div>';

    return `
      <div class="me-card wall">
        <div class="block-title">🎉 福利社群动态</div>
        <div class="wall-stats">
          <div class="ws"><div class="n">${WALL_STATS.total_sent}</div><div class="l">已送出礼品</div></div>
          <div class="ws"><div class="n">${WALL_STATS.total_receivers}</div><div class="l">位伙伴已收到</div></div>
          <div class="ws"><div class="n" style="color:#2BB673">${WALL_STATS.total_signed}</div><div class="l">已签收</div></div>
        </div>
        <div class="wall-feed-wrap">
          <div class="wall-feed-track">
            <div class="wall-feed">${feedItemsHtml}</div>
            <div class="wall-feed">${feedItemsHtml}</div>
          </div>
        </div>
        <div class="wall-tip">每一份小礼物，都是我们想离你更近一点 ❤️</div>
      </div>`;
  }

  function renderRebate() {
    // v30：懒加载骨架——避免和福利 iframe 同时抢 6 并发资源，导致切 tab 等待几秒-十几秒
    document.getElementById('view-rebate').innerHTML = `
      <div class="me-card" style="padding:0;border:none;background:transparent;box-shadow:none;margin:0;border-radius:0;">
        <div class="iframe-wrap iframe-lazy" id="rebate-wrap">
          <div class="iframe-skeleton" id="rebate-skel"><div class="sk-spinner"></div><div class="sk-text">返款公示台加载中…</div></div>
          <iframe id="rebate-frame" data-src="rebate/index.html?v=31" title="返款公示台" allow="clipboard-write" scrolling="no"></iframe>
        </div>
      </div>`;
  }

  function renderWelfare() {
    // v30：福利 iframe 同样改懒加载（280KB+，不再拖累首屏）
    document.getElementById('view-welfare').innerHTML = `
      <div class="me-card" style="padding:0;border:none;background:transparent;box-shadow:none;margin:0;border-radius:0;">
        <div class="iframe-wrap iframe-lazy" id="welfare-wrap">
          <div class="iframe-skeleton" id="welfare-skel"><div class="sk-spinner"></div><div class="sk-text">互动福利中心加载中…</div></div>
          <iframe id="welfare-frame" data-src="welfare.html?t=${encodeURIComponent(TOKEN)}&v=12" title="互动福利中心" allow="clipboard-write" scrolling="no"></iframe>
        </div>
      </div>`;
  }

  // v30：首次激活某 tab 时把该 iframe 的 data-src 写到 src；加载完成后移除骨架（保留通用，福利/返款都复用）
  function activateLazyFrame(name){
    const frame = document.getElementById(name + '-frame');
    if (!frame || !frame.dataset.src || frame.getAttribute('src')) return;
    frame.src = frame.dataset.src;
    const skel = document.getElementById(name + '-skel');
    frame.addEventListener('load', () => {
      if (skel) skel.style.display = 'none';
      // 容错：万一 load 事件丢失（罕见），20s 后兜底移除骨架
      setTimeout(() => { if (skel && skel.style.display !== 'none') skel.style.display = 'none'; }, 20000);
    }, { once: true });
  }

  function bindEvents() {
    // 编辑地址
    const editAddr = document.getElementById('edit-addr');
    if (editAddr) {
      editAddr.addEventListener('click', () => {
        document.getElementById('addr-form').style.display = 'block';
        editAddr.style.display = 'none';
      });
    }
    // 保存地址
    const saveAddrBtn = document.getElementById('save-addr');
    if (saveAddrBtn) saveAddrBtn.addEventListener('click', saveAddr);

    // 收款码（支付宝）
    const qrInput = document.getElementById('payout-qr-input');
    const triggerQr = (fn) => { if (qrInput && fn) { qrInput.value = ''; qrInput.onchange = (e) => fn(e.target.files[0]); qrInput.click(); } };
    const upBtn = document.getElementById('payout-qr-upload');
    const replBtn = document.getElementById('payout-qr-replace');
    const clrBtn = document.getElementById('payout-qr-clear');
    if (upBtn) upBtn.addEventListener('click', () => triggerQr(handlePayoutQrSelect));
    if (replBtn) replBtn.addEventListener('click', () => triggerQr(handlePayoutQrSelect));
    if (clrBtn) clrBtn.addEventListener('click', clearPayoutQr);

    // 复制快递单号
    document.querySelectorAll('.track-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const no = btn.dataset.no || '';
        if (!no) return;
        const old = btn.textContent;
        const flash = () => { btn.textContent = '已复制 ✓'; setTimeout(() => btn.textContent = old, 1400); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(no).then(flash).catch(() => prompt('复制此快递单号：', no));
        } else {
          prompt('复制此快递单号：', no);
        }
      });
    });

    // 注：旧的「复制专属链接」按钮已下线（同设备自动登录，不需要手动复制保存链接）

    // 礼品物流：列表级折叠（默认显示前 3 条，更多可展开）
    const shipFoldBtn = document.getElementById('ship-fold-btn');
    const shipExtras = document.getElementById('ship-extras');
    const shipHeadRow = document.getElementById('ship-head-row');
    if (shipFoldBtn && shipExtras) {
      shipFoldBtn.addEventListener('click', () => {
        const expanded = shipExtras.classList.toggle('expanded');
        if (shipHeadRow) shipHeadRow.classList.toggle('expanded', expanded);
        // [hidden] 是浏览器 UA 级样式，必须配合 JS 移除 attribute 才能真正显示
        shipExtras.hidden = !expanded;
        shipFoldBtn.textContent = expanded ? '收起 ▲' : `展开 ${shipExtras.children.length} 条更多 ▼`;
      });
    }

    // 返款进度：列表级折叠（默认显示前 3 笔，更多可展开）
    const rpToggleMore = document.getElementById('rp-toggle-more');
    const rpExtras = document.getElementById('rp-extras');
    const rpToggleWrap = document.getElementById('rp-toggle-wrap');
    if (rpToggleMore && rpExtras) {
      rpToggleMore.addEventListener('click', () => {
        const expanded = rpExtras.classList.toggle('expanded');
        if (rpToggleWrap) rpToggleWrap.classList.toggle('expanded', expanded);
        rpExtras.hidden = !expanded;
        rpToggleMore.textContent = expanded ? '收起 ▲' : `展开 ${rpExtras.children.length} 笔更多 ▼`;
      });
    }

    // 物流轨迹折叠/展开
    document.querySelectorAll('.ship-head[data-toggle="tl"]').forEach(head => {
      head.addEventListener('click', () => {
        const item = head.closest('.ship-item');
        if (!item) return;
        const tl = item.querySelector('.tl');
        if (!tl) return;
        tl.classList.toggle('collapsed');
        head.classList.toggle('collapsed');
      });
    });
  }

  function render() {
    document.getElementById('err').style.display = 'none';
    document.getElementById('viewport').style.display = 'block';
    document.getElementById('tabbar').style.display = 'flex';
    renderHome();
    renderRebate();
    renderWelfare();
    bindEvents();
    switchTab('home');
    // 标记已读（非关键副作用，脚本缺失/失败都要保证主流程不崩）
    if (typeof Api !== 'undefined' && Api && typeof Api.touchSeen === 'function') {
      try { Api.touchSeen(TOKEN); } catch (e) {}
    }
  }

  async function saveAddr() {
    const name = document.getElementById('a-name').value.trim();
    const phone = document.getElementById('a-phone').value.trim();
    if (!name || !phone) { alert('请填写收件人和手机号'); return; }
    const address = {
      name, phone,
      province: document.getElementById('a-prov').value.trim(),
      city: document.getElementById('a-city').value.trim(),
      district: document.getElementById('a-dist').value.trim(),
      detail: document.getElementById('a-detail').value.trim(),
      postal: document.getElementById('a-postal').value.trim()
    };
    try {
      // v38：改用 Api.rpcRace 双链路 fallback
      const data = await Api.rpcRace('update_my_partner_addr', { p_token: TOKEN, p_address: address });
      if (data && data.ok) { alert('地址已保存 ✅'); load(); }
      else alert('保存失败，请重试');
    } catch (e) { alert(e.message || '网络异常，请稍后重试'); }
  }

  // ========== 收款码（支付宝） ==========
  function payoutQrMsg(text, show = true) {
    const el = document.getElementById('payout-qr-msg');
    if (!el) return;
    el.textContent = text;
    el.style.display = show ? 'block' : 'none';
  }

  // 把图片压缩到最长边 1200px 并转 base64 dataURL（控制大小）
  async function compressImageToDataUrl(file, maxDim = 1200, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
            else { width = Math.round(width * (maxDim / height)); height = maxDim; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          // jpeg 压缩更小；保留 PNG 走 png (二维码通常更小)
          const isPng = (file.type || '').includes('png');
          const dataUrl = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', quality);
          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handlePayoutQrSelect(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { alert('图片太大，请压缩到 8MB 以内再试'); return; }
    payoutQrMsg('上传处理中…');
    try {
      const dataUrl = await compressImageToDataUrl(file);
      if (dataUrl.length > 500000) {
        // 二次压缩
        const dataUrl2 = await compressImageToDataUrl(file, 900, 0.7);
        if (dataUrl2.length > 500000) { alert('图片太大，请换张更小的图'); payoutQrMsg('', false); return; }
        await savePayoutQrToServer(dataUrl2);
      } else {
        await savePayoutQrToServer(dataUrl);
      }
    } catch (e) {
      console.error(e);
      alert('图片处理失败：' + (e.message || e));
      payoutQrMsg('', false);
    }
  }

  async function savePayoutQrToServer(dataUrl) {
    payoutQrMsg('上传中…');
    console.log('[payout-qr] sending RPC', { p_token_len: (TOKEN || '').length, dataUrl_len: (dataUrl || '').length, dataUrl_prefix: (dataUrl || '').slice(0, 30) });
    try {
      // v38：改用 Api.rpcRace 双链路 fallback
      const data = await Api.rpcRace('update_my_partner_payout_qr', {
        p_token: TOKEN, p_payout_qr_url: dataUrl
      });
      console.log('[payout-qr] RPC result', { data });
      if (!data || !data.ok) throw new Error(JSON.stringify(data) || '保存失败');
      PAYOUT_QR_URL = dataUrl;
      payoutQrMsg('已上传 ✅');
      setTimeout(() => { render(); bindEvents(); }, 600);
    } catch (e) {
      const msg = (e && (e.message || e)) || '未知错误';
      alert('上传失败：' + msg + '\n\n请确认 Supabase 已执行 supabase_partner_payout_qr.sql');
      console.error('[payout-qr] FULL ERROR', e);
      payoutQrMsg('', false);
    }
  }

  async function clearPayoutQr() {
    if (!confirm('确定删除收款码？后续打款会受阻。')) return;
    payoutQrMsg('删除中…');
    try {
      // v38：改用 Api.rpcRace 双链路 fallback
      const data = await Api.rpcRace('update_my_partner_payout_qr', {
        p_token: TOKEN, p_payout_qr_url: null
      });
      if (!data || !data.ok) throw new Error((data && data.error) || '删除失败');
      PAYOUT_QR_URL = null;
      payoutQrMsg('已删除');
      setTimeout(() => { render(); bindEvents(); }, 400);
    } catch (e) {
      alert('删除失败：' + (e.message || e));
      payoutQrMsg('', false);
    }
  }

  // Tab 切换
  // v30：touchstart 时立即预加载目标 tab 的 iframe，让手指按下就开始下载（相比 click 早 ~100-300ms），
  //        等到 click 触发 switchTab 时资源往往已经到本地，切 tab 体感秒开
  const tabbar = document.getElementById('tabbar');
  tabbar.addEventListener('touchstart', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const name = tab.dataset.tab;
    if (name === 'rebate' || name === 'welfare') activateLazyFrame(name);
  }, { passive: true });
  // mouseover 也算桌面端体验（hover 预加载）
  tabbar.addEventListener('mouseover', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const name = tab.dataset.tab;
    if (name === 'rebate' || name === 'welfare') activateLazyFrame(name);
  });
  tabbar.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    switchTab(tab.dataset.tab);
  });

  load();
})();
