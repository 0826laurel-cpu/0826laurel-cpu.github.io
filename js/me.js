// me.js — 伙伴专属自助页（调用 Supabase RPC，按 token 隔离）
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TOKEN = new URLSearchParams(location.search).get('t') || '';
  const SHIP_STATUS = { pending: '待发货', collected: '已揽收', transit: '运输中', delivering: '派送中', signed: '已签收' };
  const SHIP_COLOR = { pending: '#9AA0AD', collected: '#5B7CFA', transit: '#E58A3F', delivering: '#FF8FA3', signed: '#2BB673' };
  // 兜底：填了快递单号就不应再显示"待发货"，升级为"已揽收"
  function effStatus(s) {
    if (s && s.status === 'pending' && s.trackingNo && String(s.trackingNo).trim() !== '') return 'collected';
    return s ? s.status : '';
  }
  let PARTNER = null, SHIPS = [], WALL_FEED = [], WALL_STATS = { total_sent: 0, total_receivers: 0, total_signed: 0 };
  let MODEL_REBATES = [];
  const REBATE_STATUS = { '已返': '已返', '处理中': '处理中', '待返': '待返' };
  const REBATE_COLOR = { '已返': '#2BB673', '处理中': '#E58A3F', '待返': '#9AA0AD' };
  const money = n => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  let INVITE_STATS = { invited_count: 0 };

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), n = new Date(), diff = (n - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + '天前';
    return d.toISOString().slice(0, 10);
  }
  // 送礼墙日期：今天 / 昨天 / M/D（随真实时间每日更新）
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
  // 基于 seed 生成 6/7/8 位随机模特编号，每位 0-9 均匀分布，首位 1-9
  function genModelCode(seed) {
    // 先对 seed 做一次散列混合，避免连续 seed 产生相关输出
    let x = (seed >>> 0) || 1;
    x = (x + 0x9e3779b9) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    x = Math.imul(x, 0x85ebca6b) >>> 0;
    x = (x ^ (x >>> 13)) >>> 0;
    x = Math.imul(x, 0xc2b2ae35) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    function rnd() { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }
    const len = 6 + Math.floor(rnd() * 3); // 6/7/8 位随机
    let s = String(1 + Math.floor(rnd() * 9)); // 首位 1-9，避免前导 0
    for (let i = 1; i < len; i++) s += String(Math.floor(rnd() * 10));
    return s;
  }
  // 福利社群动态：每天自动生成热闹的模拟送礼记录（日期/模特编号每天更新；累计数字逐日累增）
  function generateWallData() {
    const gifts = ['定制礼盒','暖心保温杯','防晒喷雾','补水面膜','精致手链','香薰蜡烛','便携风扇','零食大礼包','护手霜套装','真丝发圈','眼影盘','口红礼盒','毛绒挂件','国潮帆布袋','蓝牙音箱','颈部按摩仪','收纳盒套装','花茶礼盒','手机支架','桌垫'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daySeed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    // 以 2026-08-01 为运营起点，计算累计天数，让顶部统计数字逐日自然累增
    const startDate = new Date('2026-08-01');
    startDate.setHours(0, 0, 0, 0);
    const diffDays = Math.max(0, Math.floor((today - startDate) / 86400000));
    // 每天换一批活跃模特编号（8–12 个，随机六/七/八位），保证“编号每天更新”
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
      const count = 2 + (daySeed2 % 3); // 每天 2–4 条
      for (let i = 0; i < count; i++) {
        const name = activeNames[(daySeed2 + i * 11) % activeNames.length];
        const gift = gifts[(daySeed2 + i * 17 + dayOffset) % gifts.length];
        // 今天/昨天多为运输/派送中，更早的基本已签收，营造真实物流感
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
    // 顶部统计：基于运营天数累增，同时不低于 feed 实际产生的数量
    const total_sent = Math.max(feed.length, 28 + diffDays * 2 + (daySeed % 5));
    const total_receivers = Math.max(seenNames.size, 8 + diffDays + (daySeed % 3));
    const total_signed = Math.max(feedSigned, 18 + diffDays * 2 + (daySeed % 4));
    return {
      feed,
      stats: { total_sent, total_receivers, total_signed }
    };
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
  // 美化的地址分组：姓名 / 电话 / 地址各一行带图标
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
  function showErr(title, hint) {
    const el = document.getElementById('err');
    el.style.display = 'block';
    el.innerHTML = '<div class="em">🔒</div><h1>' + esc(title || '链接无效') + '</h1><p class="lead">' + (hint || '请使用完整的专属链接访问本页') + '</p>';
  }

  async function load() {
    if (!TOKEN) { showErr('链接无效', '链接里没有 token。请使用完整的专属链接（应形如 ' + location.origin + '/me.html?t=...）。'); return; }
    if (TOKEN === 'TOKEN' || !/^[a-f0-9]{32}$|^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(TOKEN)) { showErr('链接无效', '链接里的 token 不正确（看到了占位符 "TOKEN" 或格式不对）。请使用你收到的<b>真实</b>专属链接，<b>不要手动修改链接</b>。'); return; }
    try {
      const { data: pd, error: e1 } = await sb.rpc('get_my_partner', { p_token: TOKEN });
      if (e1 || !pd || !pd.ok) { showErr('链接无效', '找不到对应的伙伴记录。可能链接已失效，请联系福利派送官重新发送你的专属链接。'); return; }
      const { data: sd, error: e2 } = await sb.rpc('my_shipments', { p_token: TOKEN });
      if (e2) { showErr('加载失败', '物流信息加载失败，请稍后刷新重试。'); return; }
      PARTNER = pd.partner; SHIPS = ((sd && sd.shipments) || []).map(normShip);
      // 返款进度：按专属页编号自动拉取该模特的全部返款（失败不阻断主流程）
      try {
        const { data: rbd, error: e4 } = await sb.rpc('get_my_rebates_by_model', { p_model_id: pd.partner.model_id });
        if (!e4) MODEL_REBATES = rbd || [];
      } catch (e4) { /* 不影响主流程 */ }
      // 邀请统计：拿到「我邀请了几位好友」，失败不阻断主流程
      try {
        const { data: isd, error: e3 } = await sb.rpc('my_invite_stats', { p_token: TOKEN });
        if (!e3 && isd && isd.ok) INVITE_STATS = isd;
      } catch (e3) { /* 不影响主流程 */ }
      // 福利社群动态：使用每天自动生成的模拟热闹数据（日期/名字每日更新）
      const wall = generateWallData();
      WALL_FEED = wall.feed;
      WALL_STATS = wall.stats;
      render();
    } catch (e) { showErr('网络异常', '请检查网络后刷新重试。'); }
  }

  function render() {
    const p = PARTNER, a = p.address || {}, addr = addrText(a);
    const lastSeen = Number(p.lastSeenAt) || 0;
    const unseen = SHIPS.filter(s => {
      const t = (s.trackingAddedAt || s.createdAt) ? new Date(s.trackingAddedAt || s.createdAt).getTime() : 0;
      return t > lastSeen;
    }).length;
    const notifyHtml = unseen > 0
      ? `<div class="notify-banner">🎁 你有 <b>${unseen}</b> 件新礼品动态！福利派送官已为你寄出，下拉查看物流动态～</div>`
      : '';
    const ships = SHIPS.length ? SHIPS.map(s => {
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
    }).join('') : '<div style="text-align:center;color:#9AA0AD;font-size:13px;padding:14px">还没有收到礼品发货～</div>';

    // ---- 我的返款进度（按专属页编号自动关联） ----
    const noRebate = !MODEL_REBATES || !MODEL_REBATES.length;
    const rebateItems = noRebate ? '' : MODEL_REBATES.map(r => {
      const st = r.status || '待返';
      const stColor = REBATE_COLOR[st] || '#9AA0AD';
      const voucher = (st === '已返' && r.voucher_url)
        ? `<div class="rebate-voucher"><div class="qv-label">返款凭证</div><img src="${esc(r.voucher_url)}" alt="返款凭证" onclick="openVoucher('${esc(r.voucher_url)}')"></div>`
        : '';
      return `<div class="rebate-item">
        <div class="rebate-top">
          <span class="rebate-name">${esc(r.item || '任务返款')}</span>
          <span class="rebate-status" style="background:${stColor}">${esc(st)}</span>
        </div>
        <div class="rebate-amount">${money(r.amount)}</div>
        <div class="rebate-date">返款日期：${esc(r.rebate_date || '—')}</div>
        <div class="rebate-expected">预计返款：${esc(r.expected_rebate_date || '待定')}</div>
        ${voucher}
      </div>`;
    }).join('');
    const rebateHtml = `
      <div class="me-card rebate-card">
        <div class="block-title">💰 我的返款进度 <span style="font-size:12px;color:var(--gray);font-weight:normal;margin-left:6px">共 ${MODEL_REBATES.length} 笔</span></div>
        ${noRebate ? '<div class="rebate-empty">还没有返款记录～完成返款任务后，这里会显示你的返款进度与凭证 💸</div>' : rebateItems}
      </div>`;

    const feedHtml = WALL_FEED.length ? WALL_FEED.map(f => {
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

    const wallHtml = `
      <div class="me-card wall">
        <div class="block-title">🎉 福利社群动态</div>
        <div class="wall-stats">
          <div class="ws"><div class="n">${WALL_STATS.total_sent}</div><div class="l">已送出礼品</div></div>
          <div class="ws"><div class="n">${WALL_STATS.total_receivers}</div><div class="l">位伙伴已收到</div></div>
          <div class="ws"><div class="n" style="color:#2BB673">${WALL_STATS.total_signed}</div><div class="l">已签收</div></div>
        </div>
        <div class="wall-feed">${feedHtml}</div>
        <div class="wall-tip">每一份小礼物，都是我们想离你更近一点 ❤️</div>
      </div>`;

    // ---- 专属福利概览 ----
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    const monthSigned = SHIPS.filter(s => s.status === 'signed' && (() => { const d = new Date(s.createdAt); return d.getFullYear() === y && d.getMonth() === m; })()).length;
    const pendingCount = SHIPS.filter(s => s.status !== 'signed').length;
    const totalValue = SHIPS.filter(s => s.status === 'signed').reduce((a, s) => a + (Number(s.value) || 0), 0);
    const overviewHtml = `
      <div class="me-card overview-card">
        <div class="block-title">📊 我的福利概览</div>
        <div class="ov-grid">
          <div class="ov"><div class="n">${monthSigned}</div><div class="l">本月已收</div></div>
          <div class="ov"><div class="n">${pendingCount}</div><div class="l">待收货</div></div>
          <div class="ov"><div class="n" style="color:#FF6B5C">¥${totalValue}</div><div class="l">累计福利价值</div></div>
        </div>
      </div>`;

    // ---- 每日签到 + 积分商城 ----
    const checkinHtml = `
      <div class="me-card checkin-card">
        <div class="block-title">🪙 每日签到 · 积分兑好礼</div>
        <div class="ck-row">
          <div class="ck-info">
            <div class="ck-points">${PARTNER.points} <span>积分</span></div>
            <div class="ck-streak">🔥 连续签到 ${PARTNER.checkinStreak} 天</div>
          </div>
          ${PARTNER.checkedToday
            ? '<div class="ck-done">✓ 今日已签</div>'
            : '<button class="btn-checkin" id="btn-checkin">签到领积分</button>'}
        </div>
        <div class="redeem-title">积分好礼</div>
        <div class="redeem-list">
          <div class="rd" data-cost="100" data-item="定制礼盒">🎁 定制礼盒<span class="rc">100积分</span></div>
          <div class="rd" data-cost="200" data-item="暖心保温杯">🥤 暖心保温杯<span class="rc">200积分</span></div>
          <div class="rd" data-cost="300" data-item="蓝牙音箱">🔊 蓝牙音箱<span class="rc">300积分</span></div>
        </div>
        <div class="ck-tip">每天签到得 5 积分，连续签到额外 +2/天（上限+10）；积分可兑换好礼，福利官亲自寄出～</div>
      </div>`;

    // ---- 转介绍邀请码 ----
    const inviteHtml = `
      <div class="me-card invite-card">
        <div class="block-title">🤝 邀请模特好友</div>
        <p class="invite-desc">分享你的专属邀请码给想做网拍模特的朋友，TA 成功入驻后，你们各得 <b>10 积分</b>！</p>
        <div class="invite-code-box">
          <span class="ic-code">${esc(PARTNER.inviteCode || '—')}</span>
          <button class="btn-copy" id="btn-copy-invite">复制邀请链接</button>
        </div>
        <div class="invite-stat">已成功邀请 <b>${INVITE_STATS.invited_count || 0}</b> 位好友 · 你共有 <b>${PARTNER.points}</b> 积分</div>
      </div>`;

    document.getElementById('app').innerHTML = `
      ${notifyHtml}
      <div class="me-card">
        <div class="hero">
          <div class="hero-icon">🎁</div>
          <div class="hero-body">
            <h1>${esc(p.name)} 的模特专属福利页</h1>
            <div class="lead">这是你的私人福利空间 —— 填好收件地址，就能第一时间收到福利派送官亲自寄出的小礼物，并实时查看物流动态～</div>
            <div class="hero-meta"><span class="pulse"></span>福利派送官亲自寄出 · 智能物流同步</div>
          </div>
        </div>
      </div>
      ${overviewHtml}
      <div class="me-card">
        <div class="addr-head">
          <div class="addr-title">收件地址</div>
          ${addr
            ? '<span class="addr-badge set">✓ 已设置</span>'
            : '<span class="addr-badge unset">待完善</span>'}
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
      </div>
      <div class="me-card">
        <div class="ship-head-row" id="ship-head-row">
          <div class="block-title">🚚 我的礼品与物流 <span style="font-size:12px;color:var(--gray);font-weight:normal;margin-left:6px">共 ${SHIPS.length} 件</span></div>
          <span class="ship-fold-btn" id="ship-fold-btn">收起</span>
        </div>
        <div class="ship-list" id="ship-list">${ships}</div>
      </div>
      ${rebateHtml}
      ${wallHtml}
      ${checkinHtml}
      ${inviteHtml}
      <div class="me-card guide-entry">
        <div class="block-title">📖 网拍模特平台图鉴</div>
        <p class="guide-desc">8个主流平台一次看懂</p>
        <a class="btn-guide" href="guide/?t=${TOKEN ? encodeURIComponent(TOKEN) : ''}">查看平台图鉴 →</a>
      </div>
      <div class="note">本页仅你本人可通过专属链接访问 · 信息仅用于福利发放</div>`;

    document.getElementById('edit-addr').addEventListener('click', () => {
      document.getElementById('addr-form').style.display = 'block';
      document.getElementById('edit-addr').style.display = 'none';
    });
    document.getElementById('save-addr').addEventListener('click', saveAddr);
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
    // 整个礼品物流卡片一键折叠/展开
    const shipHeadRow = document.getElementById('ship-head-row');
    const shipList = document.getElementById('ship-list');
    const shipFoldBtn = document.getElementById('ship-fold-btn');
    if (shipHeadRow && shipList && shipFoldBtn) {
      shipHeadRow.addEventListener('click', () => {
        shipList.classList.toggle('collapsed');
        shipHeadRow.classList.toggle('collapsed');
        shipFoldBtn.textContent = shipList.classList.contains('collapsed') ? '展开' : '收起';
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
    // 每日签到
    const btnCheckin = document.getElementById('btn-checkin');
    if (btnCheckin) {
      btnCheckin.addEventListener('click', async () => {
        btnCheckin.disabled = true; btnCheckin.textContent = '签到中…';
        try {
          const { data, error } = await sb.rpc('checkin', { p_token: TOKEN });
          if (error) throw new Error(error.message);
          if (data && data.checked) { alert('签到成功，获得 ' + data.gained + ' 积分！🔥'); load(); }
          else if (data && data.already) { load(); }
          else alert('签到失败，请重试');
        } catch (e) { alert(e.message || '网络异常'); btnCheckin.disabled = false; btnCheckin.textContent = '签到领积分'; }
      });
    }
    // 复制邀请链接
    const btnCopyInvite = document.getElementById('btn-copy-invite');
    if (btnCopyInvite) {
      btnCopyInvite.addEventListener('click', () => {
        const link = location.origin + '/join.html?ref=' + encodeURIComponent(PARTNER.inviteCode || '');
        const flash = () => { btnCopyInvite.textContent = '已复制 ✓'; setTimeout(() => btnCopyInvite.textContent = '复制邀请链接', 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(flash).catch(() => prompt('复制此邀请链接：', link));
        else prompt('复制此邀请链接：', link);
      });
    }
    // 积分兑换好礼
    document.querySelectorAll('.rd').forEach(rd => {
      rd.addEventListener('click', async () => {
        const cost = Number(rd.dataset.cost), item = rd.dataset.item;
        if (!confirm('确认用 ' + cost + ' 积分兑换「' + item + '」？\n（兑换后福利官会为你寄出）')) return;
        rd.style.opacity = '.5';
        try {
          const { data, error } = await sb.rpc('redeem_points', { p_token: TOKEN, p_cost: cost, p_item: item });
          if (error) throw new Error(error.message);
          if (data && data.ok) { alert('兑换成功 🎁 福利官将为你寄出「' + item + '」'); load(); }
          else alert((data && data.error) || '兑换失败');
        } catch (e) { alert(e.message || '网络异常'); rd.style.opacity = '1'; }
      });
    });
    // 标记已读（站内通知）：本次渲染已展示未读横幅，随后更新 last_seen_at，下次访问即不再提示
    Api.touchSeen(TOKEN);
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
      const { data, error } = await sb.rpc('update_my_partner_addr', { p_token: TOKEN, p_address: address });
      if (error) throw new Error(error.message);
      if (data && data.ok) { alert('地址已保存 ✅'); load(); }
      else alert('保存失败，请重试');
    } catch (e) { alert(e.message || '网络异常，请稍后重试'); }
  }

  // 返款凭证放大查看
  window.openVoucher = function (url) {
    const box = document.createElement('div');
    box.className = 'voucher-lightbox';
    box.innerHTML = '<img src="' + esc(url) + '" alt="返款凭证">';
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  };

  load();
})();
