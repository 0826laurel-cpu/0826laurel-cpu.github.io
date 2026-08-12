// join.js — 统一入口：登录 / 注册（同一条链接，所有人都能回到自己的福利页）
// 行为：
//   1) URL 带 ?t=<token> → 已登录用户，直接跳转 me.html 自助页
//   2) 本机 localStorage 已有 token → 自动登录，跳转 me.html
//   3) 否则渲染登录/注册切换页：
//      - 注册：平台 + 模特ID + 微信号 + 收件地址 + 登录密码 → 建号并进入福利页
//      - 登录：平台 + 模特ID + 密码 → 进入福利页
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LS_KEY = 'p_token';
  const REF = new URLSearchParams(location.search).get('ref') || '';
  const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

  function showToast(msg) {
    const el = document.getElementById('toast-mini');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove('show'), 1600);
  }

  // ========== 一键粘贴识别 ==========
  function parseAddr(text) {
    text = (text || '').replace(/\r/g, '').trim();
    const r = { name: '', phone: '', province: '', city: '', district: '', detail: '' };
    if (!text) return r;

    const phM = text.match(/(?<!\d)1[3-9]\d{9}(?!\d)/);
    if (phM) r.phone = phM[0];

    if (r.phone) {
      const before = text.slice(0, text.indexOf(r.phone));
      const cands = before.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
      for (let i = cands.length - 1; i >= 0; i--) {
        if (!/(省|市|区|县|路|街|道|号|室|栋|楼|村|镇|乡|巷|弄)/.test(cands[i])) {
          r.name = cands[i]; break;
        }
      }
    }
    if (!r.name) {
      const m = text.match(/^([\u4e00-\u9fa5]{2,4})/);
      if (m && !/(省|市|区|县)/.test(m[1])) r.name = m[1];
    }

    const DIRECT = ['北京', '上海', '天津', '重庆'];
    let consumed = text;
    const provM = consumed.match(/([\u4e00-\u9fa5]{2,8}?)(省|自治区|特别行政区|维吾尔自治区|壮族自治区|回族自治区|蒙古自治区|藏族自治州)/);
    if (provM) {
      r.province = provM[1];
      consumed = consumed.replace(provM[0], ' ');
    } else {
      for (const d of DIRECT) {
        const re = new RegExp(`(${d})市?`);
        const m = consumed.match(re);
        if (m) { r.province = d; consumed = consumed.replace(m[0], ' '); break; }
      }
    }

    const cityM = consumed.match(/([\u4e00-\u9fa5]{2,10}?)(市|地区|盟|自治州|州)(?!路)/);
    if (cityM) { r.city = cityM[1]; consumed = consumed.replace(cityM[0], ' '); }

    const distM = consumed.match(/([\u4e00-\u9fa5]{2,10}?)(区|县|旗|市辖区)(?!路|号)/);
    if (distM) { r.district = distM[0]; consumed = consumed.replace(distM[0], ' '); }

    let detail = consumed
      .replace(r.name, ' ')
      .replace(r.phone, ' ')
      .replace(/[，。、;；:,.\t\n\r]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    r.detail = detail;

    return r;
  }

  function setupPasteUI() {
    const modal = document.getElementById('paste-modal');
    const area = document.getElementById('paste-area');
    const openBtn = document.getElementById('open-paste');
    const closeBtn = document.getElementById('close-paste');
    const doBtn = document.getElementById('do-paste');
    if (!modal || !openBtn) return;

    const open = () => { modal.classList.add('show'); setTimeout(() => area && area.focus(), 50); };
    const close = () => { modal.classList.remove('show'); if (area) area.value = ''; };

    openBtn.addEventListener('click', open);
    closeBtn && closeBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    doBtn && doBtn.addEventListener('click', () => {
      const text = (area && area.value || '').trim();
      if (!text) { showToast('请先粘贴收件信息'); return; }
      const r = parseAddr(text);
      const filled = [];
      const set = (id, v) => {
        const el = document.getElementById(id);
        if (!el || !v) return false;
        el.value = v;
        return true;
      };
      if (set('a-name', r.name)) filled.push('姓名');
      if (set('a-phone', r.phone)) filled.push('手机号');
      if (set('a-prov', r.province)) filled.push('省');
      if (set('a-city', r.city)) filled.push('市');
      if (set('a-dist', r.district)) filled.push('区/县');
      if (set('a-detail', r.detail)) filled.push('详细地址');
      if (!filled.length) { showToast('未能识别，请检查格式'); return; }
      close();
      showToast(`✨ 已识别填入 ${filled.length} 个字段`);
    });

    if (navigator.clipboard && navigator.clipboard.readText) {
      openBtn.addEventListener('click', async () => {
        try {
          const t = await navigator.clipboard.readText();
          if (t && area && !area.value) area.value = t;
        } catch (e) { /* 用户拒绝/无权限，忽略 */ }
      }, true);
    }
  }

  // ---------- 入口 ----------
  function init() {
    const urlToken = new URLSearchParams(location.search).get('t');
    if (urlToken) {
      location.replace(location.origin + '/me.html?t=' + encodeURIComponent(urlToken));
      return;
    }
    const sess = localStorage.getItem(LS_KEY);
    if (sess && UUID_RE.test(sess)) {
      location.replace(location.origin + '/me.html?t=' + encodeURIComponent(sess));
      return;
    }
    renderAuth();
  }

  function renderAuth() {
    document.getElementById('app').innerHTML = `
      <div class="hero">
        <div class="hero-icon">🎁</div>
        <h1>模特专属福利圈</h1>
        <p class="lead">用「平台 + 模特ID + 密码」登录，<br>随时回到属于你的福利页</p>
        <div class="hero-tags">
          <span class="hero-tag"><span class="pulse"></span>福利派送官亲自寄出</span>
          <span class="hero-tag">🎀 智能物流同步</span>
        </div>
      </div>
      ${REF ? `<div class="ref-banner">🎁 由邀请码 <b>${esc(REF)}</b> 的模特邀请你加入福利圈</div>` : ''}

      <div class="auth-tabs">
        <button class="auth-tab active" id="tab-register" type="button">新用户注册</button>
        <button class="auth-tab" id="tab-login" type="button">老用户登录</button>
      </div>
      <div id="auth-body"></div>
      <div class="toast-mini" id="toast-mini"></div>`;

    document.getElementById('tab-register').addEventListener('click', () => setMode('register'));
    document.getElementById('tab-login').addEventListener('click', () => setMode('login'));
    setMode('register');
  }

  function setMode(mode) {
    const tr = document.getElementById('tab-register'), tl = document.getElementById('tab-login');
    if (!tr || !tl) return;
    tr.classList.toggle('active', mode === 'register');
    tl.classList.toggle('active', mode === 'login');
    if (mode === 'register') renderRegister(); else renderLogin();
  }

  function pasteModalHtml() {
    return `
      <div class="paste-modal" id="paste-modal" role="dialog" aria-modal="true">
        <div class="paste-card-modal">
          <div class="paste-modal-head">
            <h3><span class="em">📋</span>粘贴收件信息</h3>
            <button class="paste-modal-close" id="close-paste" type="button">×</button>
          </div>
          <div class="paste-modal-desc">
            支持 <b>淘宝 / 京东 / 拼多多 / 微信 / 短信</b> 复制的地址格式，自动识别姓名 / 手机号 / 省 / 市 / 区 / 详细地址。
          </div>
          <textarea class="paste-area" id="paste-area" placeholder="例：张三 13800138000
浙江省杭州市西湖区文一路 100 号

或复制淘宝/京东收货地址直接粘贴"></textarea>
          <div class="paste-modal-foot">
            <button class="btn-paste-go" id="do-paste" type="button">✨ 一键识别填入</button>
          </div>
        </div>
      </div>`;
  }

  function renderRegister() {
    document.getElementById('auth-body').innerHTML = `
      <div class="card">
        <div class="group">
          <div class="group-head"><span class="g-ico model">👤</span><h3>模特信息</h3><span class="opt">任填一平台即可</span></div>
          <div class="field"><label>模特平台<span class="req">*</span></label><div class="field-input"><span class="ico">🌐</span><input id="j-platform" placeholder="如：集美、多彩、猫当 等"></div></div>
          <div class="field"><label>模特ID<span class="req">*</span></label><div class="field-input"><span class="ico">🆔</span><input id="j-id" placeholder="📌 在模特平台查看后填写"></div></div>
          <div class="field"><label>微信号<span class="req">*</span></label><div class="field-input"><span class="ico">💬</span><input id="j-wechat" placeholder="方便必要时联系（订单沟通，打款等）"></div></div>
          <div class="field"><label>想对我们的话（选填）</label><div class="field-input"><span class="ico">✨</span><textarea id="j-note" placeholder="你的偏好、生日、想要的…"></textarea></div></div>
        </div>
      </div>

      <div class="card">
        <div class="sec-hint">领福利时直接寄出，不用再填第二次</div>
        <div class="group">
          <div class="group-head"><span class="g-ico addr">📦</span><h3>收件信息</h3><span class="opt">用于发货物流同步</span></div>
          <button class="btn-paste" id="open-paste" type="button"><span class="ico">📋</span><span>一键粘贴收件信息，自动识别填入</span><span class="badge-new">NEW</span></button>
          <div class="field"><label>收货人<span class="req">*</span></label><div class="field-input"><span class="ico">🧑</span><input id="a-name" placeholder="你的姓名"></div></div>
          <div class="field"><label>收货手机号<span class="req">*</span></label><div class="field-input"><span class="ico">📱</span><input id="a-phone" placeholder="11 位手机号"></div></div>
          <div class="row3">
            <div class="field"><label>省</label><div class="field-input"><span class="ico">🏙️</span><input id="a-prov" placeholder="浙江"></div></div>
            <div class="field"><label>市</label><div class="field-input"><span class="ico">🏙️</span><input id="a-city" placeholder="杭州"></div></div>
            <div class="field"><label>区 / 县</label><div class="field-input"><span class="ico">🏘️</span><input id="a-dist" placeholder="西湖区"></div></div>
          </div>
          <div class="addr-detail">
            <div class="field" style="margin-bottom:0"><label style="color:#D9483A">📍 详细地址<span class="req">*</span></label><div class="field-input"><span class="ico">🏠</span><input id="a-detail" placeholder="街道 / 小区 / 楼号 / 门牌"></div></div>
          </div>
        </div>

        <div class="card-sub">设置登录密码（之后用「平台 + 模特ID + 密码」登录）</div>
        <div class="field"><label>登录密码<span class="req">*</span></label><div class="field-input"><span class="ico">🔑</span><input id="j-pwd" type="password" placeholder="6 位以上，建议字母+数字"></div></div>
        <div class="field"><label>确认密码<span class="req">*</span></label><div class="field-input"><span class="ico">🔒</span><input id="j-pwd2" type="password" placeholder="再输入一次"></div></div>

        <button class="btn" id="j-submit">注册并领取福利 🎁</button>
        <div class="note">注册后自动进入你的专属福利页；下次打开本链接，用「平台 + 模特ID + 密码」即可登录。</div>
      </div>
      ${pasteModalHtml()}`;

    document.getElementById('j-submit').addEventListener('click', doRegister);
    setupPasteUI();
  }

  function renderLogin() {
    document.getElementById('auth-body').innerHTML = `
      <div class="card">
        <div class="group">
          <div class="group-head"><span class="g-ico model">👤</span><h3>登录</h3><span class="opt">平台 + 模特ID + 密码</span></div>
          <div class="field"><label>模特平台<span class="req">*</span></label><div class="field-input"><span class="ico">🌐</span><input id="l-platform" placeholder="如：集美、多彩、猫当 等"></div></div>
          <div class="field"><label>模特ID<span class="req">*</span></label><div class="field-input"><span class="ico">🆔</span><input id="l-id" placeholder="你注册时填的模特ID"></div></div>
          <div class="field"><label>登录密码<span class="req">*</span></label><div class="field-input"><span class="ico">🔑</span><input id="l-pwd" type="password" placeholder="注册时设置的密码"></div></div>
        </div>
        <button class="btn" id="l-submit">登录 🎁</button>
        <div class="note">还没有账号？点上方「新用户注册」先入驻。</div>
      </div>`;
    document.getElementById('l-submit').addEventListener('click', doLogin);
  }

  async function doRegister() {
    const platform = document.getElementById('j-platform').value.trim();
    const modelId = document.getElementById('j-id').value.trim();
    const wechat = document.getElementById('j-wechat').value.trim();
    const aName = document.getElementById('a-name').value.trim();
    const aPhone = document.getElementById('a-phone').value.trim();
    const pwd = document.getElementById('j-pwd').value;
    const pwd2 = document.getElementById('j-pwd2').value;
    if (!platform || !modelId) { showToast('请填写模特平台和模特ID'); return; }
    if (!wechat) { showToast('请填写微信号'); return; }
    if (!aName || !aPhone) { showToast('请填写收货人和手机号'); return; }
    if (pwd.length < 6) { showToast('密码至少 6 位'); return; }
    if (pwd !== pwd2) { showToast('两次密码不一致'); return; }

    const btn = document.getElementById('j-submit');
    btn.disabled = true; btn.textContent = '注册中…';
    const address = {
      name: aName, phone: aPhone,
      province: document.getElementById('a-prov').value.trim(),
      city: document.getElementById('a-city').value.trim(),
      district: document.getElementById('a-dist').value.trim(),
      detail: document.getElementById('a-detail').value.trim()
    };
    try {
      const { data, error } = await sb.rpc('register_member', {
        p_platform: platform,
        p_model_id: modelId,
        p_password: pwd,
        p_wechat: wechat,
        p_note: document.getElementById('j-note').value.trim(),
        p_address: address,
        p_invited_by: REF
      });
      if (error) throw new Error(error.message);
      if (!data || !data.ok) {
        if (data && data.error === 'EXISTS') {
          showToast('该模特ID已注册，已为你切到登录');
          setMode('login');
          return;
        }
        throw new Error('注册失败，请稍后重试');
      }
      localStorage.setItem(LS_KEY, data.token);
      window.location.replace(location.origin + '/me.html?t=' + data.token);
    } catch (e) {
      showToast(e.message || '网络异常，请稍后重试');
      btn.disabled = false; btn.textContent = '注册并领取福利 🎁';
    }
  }

  async function doLogin() {
    const platform = document.getElementById('l-platform').value.trim();
    const modelId = document.getElementById('l-id').value.trim();
    const pwd = document.getElementById('l-pwd').value;
    if (!platform || !modelId) { showToast('请填写模特平台和模特ID'); return; }
    if (!pwd) { showToast('请填写登录密码'); return; }

    const btn = document.getElementById('l-submit');
    btn.disabled = true; btn.textContent = '登录中…';
    try {
      const { data, error } = await sb.rpc('login_member', {
        p_platform: platform,
        p_model_id: modelId,
        p_password: pwd
      });
      if (error) throw new Error(error.message);
      if (!data || !data.ok) {
        if (data && data.error === 'NO_MATCH') { showToast('平台 / 模特ID 或密码不正确'); btn.disabled = false; btn.textContent = '登录 🎁'; return; }
        throw new Error('登录失败，请稍后重试');
      }
      localStorage.setItem(LS_KEY, data.token);
      window.location.replace(location.origin + '/me.html?t=' + data.token);
    } catch (e) {
      showToast(e.message || '网络异常，请稍后重试');
      btn.disabled = false; btn.textContent = '登录 🎁';
    }
  }

  init();
})();
