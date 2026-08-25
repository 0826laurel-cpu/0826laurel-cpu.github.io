// welfare.js — 互动福利中心（签到 / 邀请 / 图鉴）
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TOKEN = new URLSearchParams(location.search).get('t') || '';
  let PARTNER = null;
  let INVITE_STATS = { invited_count: 0 };

  function showErr(title, hint) {
    const el = document.getElementById('err');
    el.style.display = 'block';
    el.innerHTML = '<div class="em">🔒</div><h1>' + esc(title || '链接无效') + '</h1><p class="lead">' + (hint || '请使用完整的专属链接访问本页') + '</p>';
  }

  async function load() {
    if (!TOKEN) { showErr('链接无效', '链接里没有 token。请使用完整的专属链接（应形如 ' + (window.APP_ORIGIN || location.origin) + '/welfare.html?t=...）。'); return; }
    if (TOKEN === 'TOKEN' || !/^[a-f0-9]{32}$|^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(TOKEN)) { showErr('链接无效', '链接里的 token 不正确。请使用你收到的<b>真实</b>专属链接，<b>不要手动修改链接</b>。'); return; }
    try {
      // v40：换 Api.rpcRace 双链路 fallback（Worker 链路 403 → 直连兜底）
      const pd = await Api.rpcRace('get_my_partner', { p_token: TOKEN });
      if (!pd || !pd.ok || !pd.partner) { showErr('链接无效', '找不到对应的伙伴记录。可能链接已失效，请联系福利派送官重新发送你的专属链接。'); return; }
      PARTNER = pd.partner;
      try {
        const isd = await Api.rpcRace('my_invite_stats', { p_token: TOKEN });
        if (isd && isd.ok) INVITE_STATS = isd;
      } catch (e2) { /* 不影响主流程 */ }
      render();
    } catch (e) { showErr('网络异常', '请检查网络后刷新重试。'); }
  }

  function render() {
    const p = PARTNER;
    const partnerName = p.name || '专属伙伴';

    // 顶部 Hero（与 me/rebate 同语言 —— 已在 welfare.html 文档注：v17 加）
    const heroHtml = `
      <div class="hero">
        <h1>${esc(partnerName)}的互动福利空间</h1>
        <p>每日签到领积分</p>
        <p>邀请好友拿福利</p>
        <p>还有 8 大网拍平台图鉴</p>
        <p>福利派送官陪你一起玩～</p>
        <span class="live"><span class="dot"></span>福利官在线 · 积分实时到账</span>
      </div>`;

    // 签到 + 积分商城
    const checkinHtml = `
      <div class="me-card checkin-card">
        <div class="block-title">🪙 每日签到 · 积分兑好礼</div>
        <div class="ck-row">
          <div class="ck-info">
            <div class="ck-points">${p.points} <span>积分</span></div>
            <div class="ck-streak">🔥 连续签到 ${p.checkinStreak} 天</div>
          </div>
          ${p.checkedToday
            ? '<div class="ck-done">✓ 今日已签</div>'
            : '<button class="btn-checkin" id="btn-checkin">签到领积分</button>'}
        </div>
        <div class="redeem-title">积分好礼</div>
        <div class="redeem-list">
          <div class="rd" data-cost="100" data-item="小号礼品盲盒">
            <img class="rd-img" src="img/box-small.jpg" alt="小号礼品盲盒" width="64" height="64" loading="lazy" decoding="async">
            <div class="rd-body">
              <div class="rd-name">小号礼品盲盒</div>
              <div class="rd-sub">随机惊喜小礼</div>
              <span class="rc">100积分</span>
            </div>
          </div>
          <div class="rd" data-cost="200" data-item="中号礼品盲盒">
            <img class="rd-img" src="img/box-medium.jpg" alt="中号礼品盲盒" width="64" height="64" loading="lazy" decoding="async">
            <div class="rd-body">
              <div class="rd-name">中号礼品盲盒</div>
              <div class="rd-sub">诚意满满好礼</div>
              <span class="rc">200积分</span>
            </div>
          </div>
          <div class="rd" data-cost="300" data-item="大号礼品盲盒">
            <img class="rd-img" src="img/box-large.jpg" alt="大号礼品盲盒" width="64" height="64" loading="lazy" decoding="async">
            <div class="rd-body">
              <div class="rd-name">大号礼品盲盒</div>
              <div class="rd-sub">超值惊喜大礼</div>
              <span class="rc">300积分</span>
            </div>
          </div>
        </div>
        <div class="ck-tip">每天签到得 5 积分，连续签到额外 +2/天（上限+10）；积分可兑换好礼，福利官亲自寄出～</div>
      </div>`;

    // 转介绍邀请码
    const inviteHtml = `
      <div class="me-card invite-card">
        <div class="block-title">🤝 邀请模特好友</div>
        <p class="invite-desc">分享你的专属邀请码给想做网拍模特的朋友，TA 成功入驻后，你们各得 <b style="color:#f5222d">10 积分</b>！</p>
        <div class="invite-code-box">
          <span class="ic-code">${esc(p.inviteCode || '—')}</span>
          <button class="btn-copy" id="btn-copy-invite">复制邀请链接</button>
        </div>
        <div class="invite-stat">已成功邀请 <b>${INVITE_STATS.invited_count || 0}</b> 位好友 · 你共有 <b>${p.points}</b> 积分</div>
      </div>`;

    // 平台图鉴
    const guideHtml = `
      <div class="me-card guide-entry">
        <div class="block-title">📖 网拍模特平台图鉴</div>
        <p class="guide-desc">8 个主流平台一次看懂</p>
        <a class="btn-guide" href="guide/index.html?t=${TOKEN ? encodeURIComponent(TOKEN) : ''}">查看平台图鉴 →</a>
      </div>`;

    document.getElementById('app').innerHTML = `
      ${heroHtml}
      ${checkinHtml}
      ${inviteHtml}
      ${guideHtml}
      <div class="note">本页仅你本人可通过专属链接访问 · 信息仅用于福利发放</div>`;

    // 每日签到
    const btnCheckin = document.getElementById('btn-checkin');
    if (btnCheckin) {
      btnCheckin.addEventListener('click', async () => {
        btnCheckin.disabled = true; btnCheckin.textContent = '签到中…';
        try {
          // v40：换 Api.rpcRace 双链路 fallback
          const data = await Api.rpcRace('checkin', { p_token: TOKEN });
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
        const link = (window.APP_ORIGIN || location.origin) + '/join.html?ref=' + encodeURIComponent(p.inviteCode || '');
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
          // v40：换 Api.rpcRace 双链路 fallback
          const data = await Api.rpcRace('redeem_points', { p_token: TOKEN, p_cost: cost, p_item: item });
          if (data && data.ok) { alert('兑换成功 🎁 福利官将为你寄出「' + item + '」'); load(); }
          else alert((data && data.error) || '兑换失败');
        } catch (e) { alert(e.message || '网络异常'); rd.style.opacity = '1'; }
      });
    });
  }

  load();
})();
