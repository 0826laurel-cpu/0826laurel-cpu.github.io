// join.js — 统一入口：公开入驻 + 伙伴自助（合并为一页）
// 行为：
//   1) URL 带 ?t=<token> 或 本机 localStorage 已有 token → 直接渲染「我的专属页」（可改地址 / 看物流）
//   2) 否则渲染合并表单：模特信息（平台/ID/微信/福利意向）+ 收货地址，一次提交
//   3) 提交后把 token 存进 localStorage，并直接渲染专属页；同时给出「个人专属链接」可收藏
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LS_KEY = 'p_token';
  const TOKEN = new URLSearchParams(location.search).get('t') || localStorage.getItem(LS_KEY) || '';
  const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

  const SHIP_STATUS = { pending: '待发货', collected: '已揽收', transit: '运输中', delivering: '派送中', signed: '已签收' };
  const SHIP_COLOR = { pending: '#9AA0AD', collected: '#5B7CFA', transit: '#E58A3F', delivering: '#FF8FA3', signed: '#2BB673' };
  // 兜底：填了快递单号就不应再显示"待发货"，升级为"已揽收"
  function effStatus(s) {
    if (s && s.status === 'pending' && s.trackingNo && String(s.trackingNo).trim() !== '') return 'collected';
    return s ? s.status : '';
  }
  let PARTNER = null, SHIPS = [];

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), n = new Date(), diff = (n - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + '天前';
    return d.toISOString().slice(0, 10);
  }
  // 统一把 RPC 返回的 snake_case 字段转成 camelCase（DB 列名 → 前端属性名）
  // 关键：my_shipments 返回 tracking_no / gift_name，但模板里用的是 trackingNo / giftName
  function normShip(s) {
    if (!s) return s;
    return {
      id: s.id, partnerId: s.partner_id,
      giftName: s.gift_name, carrier: s.carrier,
      trackingNo: s.tracking_no, phone: s.phone,
      status: s.status, logs: s.logs || [],
      trackingAddedAt: s.tracking_added_at,
      createdAt: s.created_at, updatedAt: s.updated_at
    };
  }
  // 把时间戳格式化成"2026-08-08 17:55"这样紧凑可读的形式
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
  function showErr(title, hint) {
    document.getElementById('app').innerHTML =
      '<div class="card err"><div class="em">🔒</div><h1>' + esc(title) + '</h1><p class="lead">' + esc(hint || '请使用完整的专属链接访问本页') + '</p></div>';
  }

  // ---------- 视图 1：合并入驻表单 ----------
  function renderForm() {
    const giftOpts = ['', '定制礼盒', '精美小样礼', '电子贺卡', '鲜花礼遇'];
    document.getElementById('app').innerHTML = `
      <div class="card">
        <div class="badge">🎁</div>
        <h1>加入合作模特的专属福利圈</h1>
        <p class="lead">留下联系方式 + 收货地址，即可进入私域伙伴名单，不定期领取定制小礼品、新品体验与专属优惠～</p>

        <div class="block-title">👤 模特信息</div>
        <div class="field"><label>模特平台 *</label>
          <input id="j-platform" placeholder="如：集美、多彩、猫当 等">
        </div>
        <div class="field"><label>模特ID *</label><input id="j-id" placeholder="如：beauty_001"></div>
        <div class="field"><label>微信号 *</label><input id="j-wechat" placeholder="方便我们加你微信"></div>
        <div class="field"><label>最想收到的福利</label>
          <select id="j-gift">${giftOpts.map(o => '<option value="' + o + '">' + (o || '都可以～') + '</option>').join('')}</select>
        </div>
        <div class="field"><label>想对我们说的话（选填）</label><textarea id="j-note" placeholder="你的偏好、生日、想要的…"></textarea></div>

        <div class="sec-hint">📦 收货信息（领福利时直接寄出，不用再填第二次）</div>
        <div class="field"><label>收货人 *</label><input id="a-name" placeholder="你的姓名"></div>
        <div class="field"><label>收货手机号 *</label><input id="a-phone" placeholder="11 位手机号"></div>
        <div class="row2">
          <div class="field"><label>省</label><input id="a-prov" placeholder="如：浙江"></div>
          <div class="field"><label>市</label><input id="a-city" placeholder="如：杭州"></div>
        </div>
        <div class="field"><label>区 / 县</label><input id="a-dist" placeholder="如：西湖区"></div>
        <div class="field"><label>详细地址</label><input id="a-detail" placeholder="街道 / 小区 / 门牌"></div>

        <button class="btn" id="j-submit">提交并领取福利</button>
        <div class="note">提交即表示同意我们保存以上信息用于福利发放与贴心服务</div>
      </div>`;

    document.getElementById('j-submit').addEventListener('click', submit);
  }

  async function submit() {
    const platform = document.getElementById('j-platform').value;
    const modelId = document.getElementById('j-id').value.trim();
    const wechat = document.getElementById('j-wechat').value.trim();
    const aName = document.getElementById('a-name').value.trim();
    const aPhone = document.getElementById('a-phone').value.trim();
    if (!platform || !modelId) { alert('请填写模特平台和模特ID'); return; }
    if (!wechat) { alert('请填写微信号'); return; }
    if (!aName || !aPhone) { alert('请填写收货人和收货手机号，方便我们给你寄礼品'); return; }
    const btn = document.getElementById('j-submit');
    btn.disabled = true; btn.textContent = '提交中…';
    const name = platform + '·' + modelId;
    const address = {
      name: aName, phone: aPhone,
      province: document.getElementById('a-prov').value.trim(),
      city: document.getElementById('a-city').value.trim(),
      district: document.getElementById('a-dist').value.trim(),
      detail: document.getElementById('a-detail').value.trim()
    };
    try {
      const { data, error } = await sb.rpc('submit_partner', {
        p_name: name,
        p_wechat: wechat,
        p_phone: aPhone,
        p_gift: document.getElementById('j-gift').value,
        p_note: document.getElementById('j-note').value.trim(),
        p_address: address,
        p_platform: platform,
        p_model_id: modelId
      });
      if (error) throw new Error(error.message);
      if (!data || !data.ok) throw new Error('提交失败，请稍后重试');
      localStorage.setItem(LS_KEY, data.token);
      renderDashboard({ id: data.id, name, wechat, platform, model_id: modelId, address }, [], true);
    } catch (e) {
      alert(e.message || '网络异常，请稍后重试');
      btn.disabled = false; btn.textContent = '提交并领取福利';
    }
  }

  // ---------- 视图 2：我的专属页（仪表盘）----------
  async function load() {
    if (!TOKEN) { renderForm(); return; }
    if (TOKEN === 'TOKEN' || !UUID_RE.test(TOKEN)) { showErr('链接无效', '链接里的 token 不正确（看到了占位符 "TOKEN" 或格式不对）。请使用你收到的真实专属链接，不要手动修改。'); return; }
    try {
      const { data: pd, error: e1 } = await sb.rpc('get_my_partner', { p_token: TOKEN });
      if (e1 || !pd || !pd.ok) { showErr('链接无效', '找不到对应的伙伴记录，可能链接已失效。若你是在本机首次填写过，请直接重新打开本页即可。'); localStorage.removeItem(LS_KEY); return; }
      const { data: sd, error: e2 } = await sb.rpc('my_shipments', { p_token: TOKEN });
      if (e2) { showErr('加载失败', '物流信息加载失败，请稍后刷新重试。'); return; }
      PARTNER = pd.partner; SHIPS = ((sd && sd.shipments) || []).map(normShip);
      renderDashboard(PARTNER, SHIPS, false);
    } catch (e) {
      showErr('网络异常', '请检查网络后刷新重试。');
    }
  }

  function renderDashboard(p, ships, justJoined) {
    const a = p.address || {}, addr = addrText(a);
    const titleName = (p.platform && p.model_id) ? (p.platform + ' · ' + p.model_id) : (p.name || '模特');
    const shipsHtml = ships.length ? ships.map(s => {
      const logs = (s.logs || []).map(l => `<div class="it"><div class="dot" style="background:${SHIP_COLOR[l.status] || '#FF6B5C'}"></div>
        <div><div class="tt">${esc(l.desc)}</div><div class="ta">${SHIP_STATUS[l.status] || ''} · ${fmtTime(l.time)}</div></div></div>`).join('') || '<div style="color:#9AA0AD;font-size:13px">暂无轨迹</div>';
      const trackNo = s.trackingNo || '';
      // 单号与轨迹解耦：tracking_no 有值时一律显示（不管 logs 是否有），给"还在路上"的伙伴也保留可查的入口
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
      // 默认折叠规则：运输中/派送中 → 展开（实时进度优先）；已揽收/已签收/待发货 → 折叠（历史归档）
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
        <div class="tl${collapseCls}">${logs}</div>
      </div>`;
    }).join('') : '<div style="text-align:center;color:#9AA0AD;font-size:13px;padding:14px">还没有收到礼品发货～</div>';

    const personalLink = location.origin + '/me.html?t=' + TOKEN;

    document.getElementById('app').innerHTML = `
      <div class="card">
        <div class="badge">🎁</div>
        <h1>${esc(titleName)} 的合作模特专属页</h1>
        <div class="lead">这里是你的私属空间：填好收件地址，就能第一时间收到福利派送官寄出的小礼品，并实时查看物流～</div>
        ${justJoined ? '<div class="tag">🌟 已成功加入合作模特福利圈</div>' : ''}
      </div>
      <div class="card">
        <div class="block-title">📦 收件地址</div>
        ${addr ? `<div class="addr-text">${esc(addr).replace(/\n/g, '<br>')}</div>
          <button class="btn-line" id="edit-addr">修改收件地址</button>`
          : `<div class="addr-empty">还没填写收件地址，赶紧填上，方便我们给你寄礼物 🎀</div>
          <button class="btn" id="edit-addr">填写收件地址</button>`}
        <div id="addr-form" style="display:none;margin-top:12px">
          <div class="field"><label>收货人 *</label><input id="a-name" value="${esc(a.name || '')}" placeholder="你的姓名"></div>
          <div class="field"><label>收货手机号 *</label><input id="a-phone" value="${esc(a.phone || '')}" placeholder="11 位手机号"></div>
          <div class="row2">
            <div class="field"><label>省</label><input id="a-prov" value="${esc(a.province || '')}" placeholder="如：浙江"></div>
            <div class="field"><label>市</label><input id="a-city" value="${esc(a.city || '')}" placeholder="如：杭州"></div>
          </div>
          <div class="field"><label>区 / 县</label><input id="a-dist" value="${esc(a.district || '')}" placeholder="如：西湖区"></div>
          <div class="field"><label>详细地址</label><input id="a-detail" value="${esc(a.detail || '')}" placeholder="街道 / 小区 / 门牌"></div>
          <button class="btn" id="save-addr">保存地址</button>
        </div>
      </div>
      <div class="card">
        <div class="block-title">🚚 我的礼品与物流 <span style="font-size:12px;color:var(--gray);font-weight:normal;margin-left:6px">共 ${ships.length} 件</span></div>
        ${shipsHtml}
        <button class="btn-ghost" id="refresh">🔄 刷新最新物流</button>
      </div>
      <div class="card">
        <div class="block-title">🔖 我的专属链接</div>
        <div class="addr-text" style="color:#FF6B5C">${esc(personalLink)}</div>
        <button class="btn-line" id="copy-link">复制链接收藏</button>
        <div class="note">收藏此链接，下次直接打开就能看物流；也可转发给福利派送官核对信息。</div>
      </div>
      <div class="note">本页仅你本人可通过专属链接访问 · 信息仅用于福利发放</div>`;

    document.getElementById('edit-addr').addEventListener('click', () => {
      document.getElementById('addr-form').style.display = 'block';
      document.getElementById('edit-addr').style.display = 'none';
    });
    document.getElementById('save-addr').addEventListener('click', () => saveAddr());
    document.getElementById('refresh').addEventListener('click', async () => {
      const btn = document.getElementById('refresh');
      if (btn.disabled) return;
      btn.disabled = true;
      const oldHtml = btn.innerHTML;
      btn.innerHTML = '⏳ 正在拉取最新物流…';
      try {
        // 主动触发 KD100 同步：对每条已有单号的发货调一次 RPC 拉新轨迹
        if (SHIPS && SHIPS.length) {
          for (const s of SHIPS) {
            if (s.trackingNo && s.carrier && s.phone) {
              try {
                await sb.rpc('kd100_track', { p_tracking: s.trackingNo, p_carrier: s.carrier, p_phone: s.phone });
              } catch (e) { /* 单条失败不影响其它 */ }
            }
          }
        }
        await load();
        btn.innerHTML = '✓ 已刷新';
        setTimeout(() => { btn.innerHTML = oldHtml; btn.disabled = false; }, 1500);
      } catch (e) {
        btn.innerHTML = '刷新失败，重试';
        setTimeout(() => { btn.innerHTML = oldHtml; btn.disabled = false; }, 1500);
      }
    });
    document.getElementById('copy-link').addEventListener('click', () => {
      navigator.clipboard.writeText(personalLink).then(() => alert('已复制，可收藏或发给福利派送官')).catch(() => prompt('复制此链接：', personalLink));
    });
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
    // 物流轨迹折叠/展开：点头部区域切换 .tl 的 collapsed 状态
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

  async function saveAddr() {
    const name = document.getElementById('a-name').value.trim();
    const phone = document.getElementById('a-phone').value.trim();
    if (!name || !phone) { alert('请填写收货人和手机号'); return; }
    const address = {
      name, phone,
      province: document.getElementById('a-prov').value.trim(),
      city: document.getElementById('a-city').value.trim(),
      district: document.getElementById('a-dist').value.trim(),
      detail: document.getElementById('a-detail').value.trim()
    };
    try {
      const { data, error } = await sb.rpc('update_my_partner_addr', { p_token: TOKEN, p_address: address });
      if (error) throw new Error(error.message);
      if (data && data.ok) { alert('地址已保存 ✅'); load(); }
      else alert('保存失败，请重试');
    } catch (e) { alert(e.message || '网络异常，请稍后重试'); }
  }

  load();
})();
