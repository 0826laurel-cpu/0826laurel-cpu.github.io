// api.js — 数据层（直连 Supabase，替代原 Node 后端 /api）
// 依赖：vendor/supabase.js（全局 supabase）、js/sb.js（全局 sb）、config.js

// v41 友好错误：把 TypeError/NetworkError/timeout 等技术错误转成中文+可行动引导
// 任何 catch 块统一用 friendlyError(e, ctx) 替代 '失败：' + e.message，避免给用户看原始堆栈
function friendlyError(e, ctx) {
  const msg = String((e && e.message) || e || '');
  if (/Failed to fetch|fetch failed|NetworkError|TypeError.*fetch/i.test(msg)) {
    return '网络连接失败，请检查网络后重试';
  }
  if (/timeout|AbortError|ETIMEDOUT|ENETUNREACH/i.test(msg)) {
    return '请求超时，请稍后重试';
  }
  if (/AllFailed|\[.via=AllFailed\]/i.test(msg)) {
    return '服务器连接不稳定，请稍后重试';
  }
  if (/401|403|JWT|invalid.*key|apikey/i.test(msg)) {
    return '认证失败，请重新登录';
  }
  if (/duplicate|unique|already exists|23505/i.test(msg)) {
    return '记录已存在，无需重复添加';
  }
  if (/not found|404/i.test(msg) && !/partners|shipments|gifts|interactions|deals/i.test(msg)) {
    return '未找到对应数据';
  }
  // 默认：业务前缀 + 通用引导（不再裸露 TypeError/NetworkError 等英文技术名词）
  return (ctx ? ctx + '：' : '操作失败，') + '请稍后重试';
}
window.friendlyError = friendlyError;

function toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function normPartner(r) {
  return {
    id: r.id,
    name: r.name,
    wechat: r.wechat || '',
    phone: r.phone || '',
    tier: r.tier || 'new',
    status: r.status || 'new',
    note: r.note || '',
    tags: Array.isArray(r.tags) ? r.tags : [],
    source: r.source || 'manual',
    token: r.token,
    address: (r.address && typeof r.address === 'object') ? r.address : {},
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
    // 模特平台 / ID（入驻时填写，name = platform·modelId）
    platform: r.platform || '',
    modelId: r.model_id || '',
    // 收款码（支付宝）base64 dataURL，后台「我的伙伴」卡片缩略图用
    payout_qr_url: r.payout_qr_url || null,
    // 运营数据字段（福利概览/签到/邀请）
    inviteCode: r.invite_code || '',
    invitedBy: r.invited_by || '',
    points: Number(r.points) || 0,
    lastCheckin: r.last_checkin || '',
    checkinStreak: Number(r.checkin_streak) || 0,
    lastSeenAt: toMs(r.last_seen_at),
    interactions: []
  };
}
function normShipment(r) {
  return {
    id: r.id,
    partnerId: r.partner_id,
    partnerName: r.partner_name || '',
    giftName: r.gift_name,
    carrier: r.carrier || '',
    trackingNo: r.tracking_no || '',
    phone: r.phone || '',
    status: r.status || 'pending',
    logs: Array.isArray(r.logs) ? r.logs : [],
    trackingAddedAt: r.tracking_added_at || null,
    productLink: r.product_link || '',
    productTitle: r.product_title || '',
    value: Number(r.value) || 0,
    createdAt: toMs(r.created_at)
  };
}
function normGift(r) {
  return {
    id: r.id,
    partnerId: r.partner_id,
    giftName: r.gift_name,
    price: Number(r.price) || 0,
    note: r.note || '',
    at: Number(r.at) || toMs(r.created_at)
  };
}
function normInteraction(r) {
  return {
    id: r.id,
    partnerId: r.partner_id,
    type: r.type || 'note',
    text: r.text || '',
    status: r.status || '',
    at: Number(r.at) || toMs(r.created_at)
  };
}
function normDeal(r) {
  return {
    id: r.id,
    title: r.title || '',
    platform: r.platform || '',
    origPrice: Number(r.orig_price) || 0,
    dealPrice: Number(r.deal_price) || 0,
    coupon: r.coupon || '',
    commissionRate: Number(r.commission_rate) || 0,
    promoUrl: r.promo_url || '',
    imageUrl: r.imageUrl || '',
    remark: r.remark || '',
    scene: r.scene || '',
    distValue: r.dist_value || '',
    status: r.status || 'draft',
    publishedAt: toMs(r.published_at),
    sortOrder: Number(r.sort_order) || 0,
    createdAt: toMs(r.created_at)
  };
}

// 内部：单链路 fetch，带 AbortController 超时（浏览器原生 fetch 无超时，挂起会卡死整页）
async function directFetchAt(baseUrl, path, init, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => { try { ac.abort(); } catch (_) {} }, timeoutMs || 10000);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...(init || {}),
      signal: ac.signal,
      headers: {
        'apikey': window.SB_ANON,
        'Authorization': `Bearer ${window.SB_ANON}`,
        ...((init && init.headers) || {})
      }
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200) || res.statusText}`);
    }
    // v45-fix：Supabase 对 return=minimal / 204·205 返回空 body，直接 res.json() 会抛
    // SyntaxError，被上层当成 AllFailed 假阴性（且会触发串行兜底双写）。统一处理：空 body
    // 直接返回 null；非空再按 content-type 决定 json 解析（解析失败兜底返回原文）。
    const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    if (res.status === 204 || res.status === 205 || !/json/i.test(ct)) {
      const txt = await res.text().catch(() => '');
      if (!txt) return null;
      try { return JSON.parse(txt); } catch (_) { return txt; }
    }
    return await res.json().catch(() => null);
  } finally {
    clearTimeout(t);
  }
}
// 链路顺序：Worker 优先（国内手机/电脑最稳，v32–v35 实证），直连兜底；成功过的链路会被「钉住」
const PATH_PIN_KEY = 'admin_path_pin';
function orderedPaths() {
  const direct = window.SB_DIRECT || 'https://ecvsamlwjbxovqaziyww.supabase.co';
  const worker = window.SB_PROXY_URL;
  let pinned = null;
  try { pinned = localStorage.getItem(PATH_PIN_KEY); } catch (_) {}
  const arr = [];
  if (pinned === 'direct') {
    arr.push({ url: direct, label: 'Direct' });
    if (worker) arr.push({ url: worker, label: 'Worker' });
  } else {
    // 默认 + pinned='worker'：Worker 优先，Direct 兜底（v32–v35 实证稳定）
    if (worker) arr.push({ url: worker, label: 'Worker' });
    arr.push({ url: direct, label: 'Direct' });
  }
  return arr;
}
function pinPath(label) {
  try { localStorage.setItem(PATH_PIN_KEY, label === 'Worker' ? 'worker' : 'direct'); } catch (_) {}
}
// 公开：并行竞速双链路 —— Worker 与直连同时发起，谁先成功用谁；每条带 10s AbortController 超时。
// 解决「串行先等 Worker 卡 45s 才回退直连、再卡 45s」导致的整页几分钟转圈（手机蜂窝网挂起型失败）。
// 成功链路 pinPath 钉住；异常信息带 [.via=AllFailed] 便于错误横幅诊断。
async function directFetch(path, init, attemptTag) {
  attemptTag = attemptTag || '?';
  const paths = orderedPaths();
  return new Promise((resolve, reject) => {
    let settled = 0;
    const errs = [];
    const ctrls = [];
    paths.forEach((it, idx) => {
      const ac = new AbortController(); ctrls.push(ac);
      const timer = setTimeout(() => { try { ac.abort(); } catch (_) {} }, 10000);
      directFetchAt(it.url, path, init, 10000)
        .then(v => {
          clearTimeout(timer);
          ctrls.forEach(c => { try { c.abort(); } catch (_) {} }); // 取消其余链路，释放连接
          pinPath(it.label);
          if (attemptTag === 'login' && idx > 0) console.info('[fetch]', path, '走回退链路', it.label);
          resolve(v);
        })
        .catch(e => {
          clearTimeout(timer);
          const m = String(e && e.message || e);
          if (!/AbortError|aborted/i.test(m)) errs.push(it.label + ': ' + m.slice(0, 100));
          settled++;
          if (settled >= paths.length) {
            reject(new Error((errs.length ? errs.join(' | ') : 'all-fail') + ' [.via=AllFailed]'));
          }
        });
    });
  });
}

// 写路径串行兜底：Worker → Direct，每条 10s AbortController 超时。
// v45：写路径与读路径 (directFetch 并行竞速) 互补——写不能 race，否则双链路可能双写。
// 触发原因：sb.from(...).insert/update/delete 与 sb.rpc(...) 在用户手机偶发
//   "TypeError: Failed to fetch"（Worker 域名偶尔不可达、SDK 无超时兜底）。
// 串行兜底先用 Worker（国内手机最稳），失败/超时再走直连；最坏 20s 兜底不挂死整页。
async function directFetchWrite(path, init) {
  const paths = orderedPaths();
  const errs = [];
  for (const it of paths) {
    try {
      const r = await directFetchAt(it.url, path, init, 10000);
      pinPath(it.label);
      return r;
    } catch (e) {
      const m = String(e && e.message || e);
      if (!/AbortError|aborted/i.test(m)) errs.push(it.label + ': ' + m.slice(0, 100));
    }
  }
  throw new Error((errs.length ? errs.join(' | ') : 'all-fail') + ' [.via=AllFailed]');
}

// 登录 RPC 并行竞速：Worker/Direct 同时打，谁先回谁赢；15s 超时兜底
async function loginRace(pwd) {
  const paths = orderedPaths();
  return new Promise((resolve, reject) => {
    let settled = 0;
    const errs = [];
    const ctrls = [];
    paths.forEach((it, idx) => {
      const ac = new AbortController(); ctrls.push(ac);
      const timer = setTimeout(() => { try { ac.abort(); } catch (_) {} }, 15000);
      fetch(`${it.url}/rest/v1/rpc/admin_login`, {
        method: 'POST',
        signal: ac.signal,
        headers: {
          'apikey': window.SB_ANON,
          'Authorization': `Bearer ${window.SB_ANON}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p_pwd: pwd })
      })
        .then(async res => {
          clearTimeout(timer);
          if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200) || res.statusText}`); }
          const r = await res.json();
          if (!r || !r.ok) throw new Error((r && r.error) || '密码错误');
          ctrls.forEach(c => { try { c.abort(); } catch (_) {} });
          resolve({ ok: true, label: it.label, idx });
        })
        .catch(e => {
          clearTimeout(timer);
          const m = String(e && e.message || e);
          if (!/AbortError|aborted/i.test(m)) errs.push(it.label + ': ' + m.slice(0, 100));
          settled++;
          if (settled >= paths.length) reject(new Error(errs.length ? errs.join(' | ') : '登录失败'));
        });
    });
  });
}

async function sbSelect(table, transform) {
  const data = await directFetch(`/rest/v1/${table}?select=*&order=created_at.desc`);
  return (data || []).map(transform);
}

const Api = {
  // ---- 认证（密码 RPC 校验 + 前端 localStorage 闸门；RLS 已放行 anon，anon key 直连读写）----
  async login(pwd) {
    // 默认走 config.js 配置的链路（通常是 Worker 代理）
    return await this.loginAt(window.SB_URL, pwd);
  },
  // 支持双链路兜底：Worker → 直连。baseUrl 任意指定，便于 doLogin 在 Worker 卡顿时无缝回退到直连 supabase
  async loginAt(baseUrl, pwd) {
    const res = await fetch(`${baseUrl}/rest/v1/rpc/admin_login`, {
      method: 'POST',
      headers: {
        'apikey': window.SB_ANON,
        'Authorization': `Bearer ${window.SB_ANON}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_pwd: pwd })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 200) || res.statusText}`);
    }
    const r = await res.json();
    if (!r || !r.ok) throw new Error((r && r.error) || '密码错误');
    localStorage.setItem('p_admin', '1');
    return { ok: true };
  },
  async logout() { localStorage.removeItem('p_admin'); },
  async getSession() { return localStorage.getItem('p_admin') ? { user: { is_admin: true } } : null; },

  // ---- 伙伴 ----
  async listPartners() {
    // 仅查伙伴；互动数据由 loadData 统一并行拉取（去掉重复查询，省一次跨境 REST 请求）
    return await sbSelect('partners', normPartner);
  },
  async createPartner(b) {
    const { error } = await sb.from('partners').insert({
      name: b.name, wechat: b.wechat || '', phone: b.phone || '',
      tier: b.tier || 'normal', status: b.status || 'contacted',
      note: b.note || '', tags: b.tags || [], source: 'manual'
    });
    if (error) throw new Error(error.message);
  },
  async updatePartner(id, b) {
    const { error } = await sb.from('partners').update({
      name: b.name, wechat: b.wechat || '', phone: b.phone || '',
      tier: b.tier || 'normal', status: b.status || 'contacted',
      tags: b.tags || [], note: b.note || ''
    }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async deletePartner(id) {
    const { error } = await sb.from('partners').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // ---- 礼品 ----
  async listGifts() { return sbSelect('gifts', normGift); },
  async createGift(b) {
    const { error } = await sb.from('gifts').insert({
      partner_id: b.partnerId, gift_name: b.giftName, price: b.price || 0, note: b.note || '', at: Date.now()
    });
    if (error) throw new Error(error.message);
  },

  // ---- 发货 / 物流 ----
  async listShipments() { return sbSelect('shipments', normShipment); },
  async createShipment(b) {
    // v45：改走 directFetchWrite（Worker → Direct 串行兜底），避免 sb.from(...).insert()
    //   在用户手机偶发 "TypeError: Failed to fetch"（SDK 无超时，Worker 域名抖动整页卡死）。
    // 兜底：填了快递单号就一定是"已揽收"状态（承运商已分配运单），不能继续显示"待发货"
    let status = b.status || 'pending';
    if (b.trackingNo && (status === 'pending' || !status)) status = 'collected';
    const logs = b.note ? [{ status, desc: b.note, time: Date.now() }] : [];
    await directFetchWrite('/rest/v1/shipments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        partner_id: b.partnerId, gift_name: b.giftName, carrier: b.carrier || '',
        tracking_no: b.trackingNo || '', phone: b.phone || '', status, logs,
        product_link: b.productLink || '', product_title: b.productTitle || '',
        value: Number(b.value) || 0
      })
    });
  },
  async addShipLog(id, b) {
    // v45：改走 directFetchWrite（同 createShipment 原因，避免 SDK 写路径 Failed to fetch）
    const curRows = await directFetchWrite('/rest/v1/shipments?select=logs,tracking_no&id=eq.' + encodeURIComponent(id));
    const row = Array.isArray(curRows) ? curRows[0] : null;
    if (!row) throw new Error('发货记录不存在');
    const logs = Array.isArray(row.logs) ? row.logs : [];
    logs.unshift({ status: b.status, desc: b.desc || '', time: Date.now() });
    const upd = { status: b.status, logs };
    if (b.trackingNo) upd.tracking_no = b.trackingNo;
    else if (b.status !== 'pending' && row.tracking_no) upd.tracking_no = row.tracking_no;
    if (typeof b.value === 'number' && b.value > 0) upd.value = b.value;
    const updRows = await directFetchWrite('/rest/v1/shipments?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(upd)
    });
    const data = Array.isArray(updRows) ? updRows[0] : updRows;
    return normShipment(data);
  },
  async deleteShipment(id) {
    // v45：改走 directFetchWrite（同上）
    await directFetchWrite('/rest/v1/shipments?id=eq.' + encodeURIComponent(id), {
      method: 'DELETE'
    });
  },

  // ---- 送礼墙 / 站内通知（anon 可调用 SECURITY DEFINER RPC）----
  async shipFeed(limit) {
    // v41：换 Api.rpcRace 双链路 fallback（避免浏览器内 sb.rpc 在 Worker 域偶发 Failed to fetch）
    const r = await this.rpcRace('ship_feed', { p_limit: limit || 20 });
    return (r && r.feed) || [];
  },
  async shipStats() {
    // v41：换 Api.rpcRace 双链路 fallback
    const r = await this.rpcRace('ship_stats');
    return (r && r.stats) || { total_sent: 0, total_receivers: 0, total_signed: 0 };
  },
  async touchSeen(token) {
    // v41：换 Api.rpcRace 双链路 fallback，失败仍静默（不影响主流程）
    try { await this.rpcRace('touch_partner_seen', { p_token: token }); } catch (_) { /* 静默 */ }
  },

  // ---- 互动 ----
  async listInteractions() { return sbSelect('interactions', normInteraction); },
  async createInteraction(b) {
    const { error } = await sb.from('interactions').insert({
      partner_id: b.partnerId, type: b.type || 'note', text: b.text, status: b.status || '', at: Date.now()
    });
    if (error) throw new Error(error.message);
    if (b.status) {
      await sb.from('partners').update({ status: b.status }).eq('id', b.partnerId);
    }
  },

  // ---- 快递100 实时查询（Postgres RPC: kd100_track；否则抛 NO_KD100）----
  async trackShipment(shipment, phone) {
    if (!window.KD100_FN) throw new Error('NO_KD100');
    // v41：换 Api.rpcRace 双链路 fallback
    return await this.rpcRace('kd100_track', {
      p_tracking: shipment.trackingNo,
      p_carrier: shipment.carrier,
      p_phone: phone || shipment.phone || ''
    }); // {ok:true, shipment:{...}} | {ok:false, message}
  },
  async saveShipLogs(id, logs) {
    const status = (Array.isArray(logs) && logs.some(l => l.desc && /签收/.test(l.desc))) ? 'signed' : 'transit';
    const { error } = await sb.from('shipments').update({ logs, status }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  // ---- 羊毛情报 / 补贴好物 ----
  async listDeals() {
    const data = await directFetch('/rest/v1/deals?select=*&order=sort_order.asc&order=created_at.desc');
    return (data || []).map(normDeal);
  },
  async listPublishedDeals() {
    const data = await directFetch('/rest/v1/deals?select=*&status=eq.published&order=sort_order.asc&order=created_at.desc');
    return (data || []).map(normDeal);
  },
  async createDeal(b) {
    const { error } = await sb.from('deals').insert(dealRow(b));
    if (error) throw new Error(error.message);
  },
  async updateDeal(id, b) {
    const { error } = await sb.from('deals').update(dealRow(b)).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async deleteDeal(id) {
    const { error } = await sb.from('deals').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
  async publishDeal(id, published) {
    const { error } = await sb.from('deals').update({ status: published ? 'published' : 'draft', published_at: published ? new Date().toISOString() : null }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  // 调用 Supabase Edge Function（签名代理）拉取/转链多多进宝商品
  async fetchPdd(payload) {
    const { data, error } = await sb.functions.invoke('fetch-pdd', { body: payload });
    if (error) throw new Error(error.message || '函数调用失败');
    return data;
  },

  // ---- 返款管理（rebate）----
  async checkRebateAdmin(pw) {
    // v41：换 Api.rpcRace 双链路 fallback（修电脑浏览器 sb.rpc 走 Worker 域 CORS Failed to fetch → 显示「验证失败：TypeError」）
    return await this.rpcRace('admin_check_pw', { p_admin_pw: pw });
  },
  async listRebatesPending(pw) {
    // v41：换 Api.rpcRace 双链路 fallback
    const r = await this.rpcRace('admin_pending_list', { p_admin_pw: pw });
    return r || [];
  },
  async listRebatesPaid(pw) {
    // v41：换 Api.rpcRace 双链路 fallback
    const r = await this.rpcRace('admin_paid_list', { p_admin_pw: pw });
    return r || [];
  },
  async addRebate(pw, b) {
    // 写 RPC：保留 sb.rpc（v27 决策：写路径 SDK 错误处理更友好，避免双链路 retry 重复添加）
    const { data, error } = await sb.rpc('admin_add_rebate', {
      p_admin_pw: pw,
      p_model_code: b.modelCode || '',
      p_model_mask: b.modelMask || '',
      p_model_id: b.modelId || '',
      p_order_no: b.orderNo || '',
      p_item: b.item || '',
      p_amount: Number(b.amount) || 0,
      p_rebate_date: b.rebateDate || null,
      p_expected_rebate_date: b.expectedDate || null,
      p_status: b.status || '已返',
      p_voucher_url: b.voucherUrl || null
    });
    if (error) throw new Error(friendlyError(error, '添加返款失败'));
    return data;
  },
  async getRebatesByCode(code) {
    // v39：换 Api.rpcRace 双链路 fallback（之前 sb.rpc 走 Worker 域 CORS 失败，try/catch 被吞导致前端返款为空）
    return (await this.rpcRace('get_my_rebates', { p_code: code })) || [];
  },
  // 模特专属页首页「返款进度」：按 model_id 拉取该模特全部返款记录
  async getRebatesByModel(modelId) {
    // v39：换 Api.rpcRace 双链路 fallback（之前 sb.rpc 走 Worker 域 CORS 失败，try/catch 被吞导致「暂无返款任务」假空）
    return (await this.rpcRace('get_my_rebates_by_model', { p_model_id: modelId })) || [];
  },
  async uploadRebateVoucher(file) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `voucher/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { data: upData, error: upError } = await sb.storage.from('rebate-vouchers').upload(path, file, {
      contentType: file.type,
      upsert: true
    });
    if (upError) throw new Error(upError.message);
    const { data: urlData } = sb.storage.from('rebate-vouchers').getPublicUrl(path);
    return urlData.publicUrl;
  },
  // 返款公示页数据
  async rebatePublicStats() {
    // v41：换 Api.rpcRace 双链路 fallback
    return await this.rpcRace('public_stats');
  },
  async rebatePublicFeed(limit) {
    // v41：换 Api.rpcRace 双链路 fallback
    const r = await this.rpcRace('public_feed', { p_limit: limit || 30 });
    return r || [];
  },
  async rebatePublicLeaderboard(limit) {
    // v41：换 Api.rpcRace 双链路 fallback
    const r = await this.rpcRace('public_leaderboard', { p_limit: limit || 10 });
    return r || [];
  },

  // 通用 RPC 双链路 fallback（v38）：替换 sb.rpc(...) 用于模特端 me.html
  // 解决 Supabase JS SDK 在浏览器里对 Worker 域名的 CORS preflight 兼容问题
  // （电脑端 sb.rpc → 'TypeError: Failed to fetch'，但裸 fetch 经 Worker + 直连双链路都能通）
  async rpcRace(fnName, params) {
    const r = await directFetch('/rest/v1/rpc/' + fnName, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {})
    }, 'rpc-' + fnName);
    // 兼容两种返回：{ ok:true, partner } / { ok:false, error } / 直接数组
    if (r && typeof r === 'object' && 'ok' in r) {
      if (r.ok) return r; // 成功：返回完整对象（含 partner/shipments/payout_qr_url 等）
      throw new Error(r.error || ('RPC ' + fnName + ' failed'));
    }
    return r; // 直接返回（如数组）
  }
};

function dealRow(b) {
  return {
    title: b.title || '', platform: b.platform || '', orig_price: Number(b.origPrice) || 0,
    deal_price: Number(b.dealPrice) || 0, coupon: b.coupon || '', commission_rate: Number(b.commissionRate) || 0,
    promo_url: b.promoUrl || '', image_url: b.imageUrl || '', remark: b.remark || '',
    scene: b.scene || '', dist_value: b.distValue || '',
    status: b.status || 'draft', sort_order: Number(b.sortOrder) || 0
  };
}

window.Api = Api;
