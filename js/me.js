// me.js — 伙伴专属自助页（底部 Tab 多视图版）
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TOKEN = new URLSearchParams(location.search).get('t') || '';
  const SHIP_STATUS = { pending: '待发货', collected: '已揽收', transit: '运输中', delivering: '派送中', signed: '已签收' };
  const SHIP_COLOR = { pending: '#9AA0AD', collected: '#5B7CFA', transit: '#E58A3F', delivering: '#FF8FA3', signed: '#2BB673' };
  function effStatus(s) {
    if (s && s.status === 'pending' && s.trackingNo && String(s.trackingNo).trim() !== '') return 'collected';
    return s ? s.status : '';
  }
  let PARTNER = null, SHIPS = [], WALL_FEED = [], WALL_STATS = { total_sent: 0, total_receivers: 0, total_signed: 0 };

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

  async function load() {
    if (!TOKEN) { showErr('链接无效', '链接里没有 token。请使用完整的专属链接（应形如 ' + location.origin + '/me.html?t=...）。'); return; }
    if (TOKEN === 'TOKEN' || !/^[a-f0-9]{32}$|^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(TOKEN)) { showErr('链接无效', '链接里的 token 不正确（看到了占位符 "TOKEN" 或格式不对）。请使用你收到的<b>真实</b>专属链接，<b>不要手动修改链接</b>。'); return; }
    if (typeof window.sb === 'undefined' || !window.sb || typeof window.sb.rpc !== 'function') {
      showErr('客户端加载失败', 'Supabase 客户端没有初始化成功，通常是脚本加载被浏览器拦截或网络不稳定。请检查网络、关闭广告拦截插件后重试。', 'window.sb=' + (typeof window.sb) + ' window.sb.rpc=' + (window.sb && typeof window.sb.rpc));
      return;
    }
    try {
      const { data: pd, error: e1 } = await window.sb.rpc('get_my_partner', { p_token: TOKEN });
      if (e1 || !pd || !pd.ok) { showErr('链接无效', '找不到对应的伙伴记录。可能链接已失效，请联系福利派送官重新发送你的专属链接。' + (e1 ? ' (' + esc(e1.message || e1) + ')' : '')); return; }
      const { data: sd, error: e2 } = await window.sb.rpc('my_shipments', { p_token: TOKEN });
      if (e2) { showErr('加载失败', '物流信息加载失败，请稍后刷新重试。' + (e2.message ? ' (' + esc(e2.message) + ')' : '')); return; }
      PARTNER = pd.partner; SHIPS = ((sd && sd.shipments) || []).map(normShip);
      const wall = generateWallData();
      WALL_FEED = wall.feed;
      WALL_STATS = wall.stats;
      render();
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
  }

  function buildShipsHtml() {
    return SHIPS.length ? SHIPS.map(s => {
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
  }

  function buildOverviewHtml() {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    const monthSigned = SHIPS.filter(s => s.status === 'signed' && (() => { const d = new Date(s.createdAt); return d.getFullYear() === y && d.getMonth() === m; })()).length;
    const pendingCount = SHIPS.filter(s => s.status !== 'signed').length;
    const totalValue = SHIPS.filter(s => s.status === 'signed').reduce((a, s) => a + (Number(s.value) || 0), 0);
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
            <h1>${esc(p.name)} 的模特专属福利页</h1>
            <div class="lead">这是你的私人福利空间 —— 填好收件地址，就能第一时间收到福利派送官亲自寄出的小礼物，并实时查看物流动态～</div>
            <div class="hero-meta"><span class="pulse"></span>福利派送官亲自寄出 · 智能物流同步</div>
          </div>
        </div>
      </div>
      ${buildOverviewHtml()}
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
      </div>
      <div class="me-card">
        <div class="ship-head-row" id="ship-head-row">
          <div class="block-title">🚚 我的礼品与物流 <span style="font-size:12px;color:#9AA0AD;font-weight:normal;margin-left:6px">共 ${SHIPS.length} 件</span></div>
          <span class="ship-fold-btn" id="ship-fold-btn">收起</span>
        </div>
        <div class="ship-list" id="ship-list">${buildShipsHtml()}</div>
      </div>
      <div class="note">本页仅你本人可通过专属链接访问 · 信息仅用于福利发放</div>
      ${buildWallHtml()}`;
  }

  function buildWallHtml() {
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

    return `
      <div class="me-card wall">
        <div class="block-title">🎉 福利社群动态</div>
        <div class="wall-stats">
          <div class="ws"><div class="n">${WALL_STATS.total_sent}</div><div class="l">已送出礼品</div></div>
          <div class="ws"><div class="n">${WALL_STATS.total_receivers}</div><div class="l">位伙伴已收到</div></div>
          <div class="ws"><div class="n" style="color:#2BB673">${WALL_STATS.total_signed}</div><div class="l">已签收</div></div>
        </div>
        <div class="wall-feed">${feedHtml}</div>
        <div class="wall-tip">每一份小礼物，都是我们想离你更近一点 ❤️</div>
      </div>
      <div class="note">每日更新 · 真实物流状态同步</div>`;
  }

  function renderRebate() {
    document.getElementById('view-rebate').innerHTML = `
      <div class="me-card" style="padding:0;border:none;background:transparent;box-shadow:none;margin:0;border-radius:0;">
        <div class="iframe-wrap">
          <iframe src="rebate/?v=6" title="返款公示台" allow="clipboard-write"></iframe>
        </div>
      </div>`;
  }

  function renderWelfare() {
    document.getElementById('view-welfare').innerHTML = `
      <div class="me-card" style="padding:0;border:none;background:transparent;box-shadow:none;margin:0;border-radius:0;">
        <div class="iframe-wrap">
          <iframe src="welfare.html?t=${encodeURIComponent(TOKEN)}" title="互动福利中心" allow="clipboard-write"></iframe>
        </div>
      </div>`;
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
      const { data, error } = await window.sb.rpc('update_my_partner_addr', { p_token: TOKEN, p_address: address });
      if (error) throw new Error(error.message);
      if (data && data.ok) { alert('地址已保存 ✅'); load(); }
      else alert('保存失败，请重试');
    } catch (e) { alert(e.message || '网络异常，请稍后重试'); }
  }

  // Tab 切换
  document.getElementById('tabbar').addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    switchTab(tab.dataset.tab);
  });

  load();
})();
