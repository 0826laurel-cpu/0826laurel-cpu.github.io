// api.js — 数据层（直连 Supabase，替代原 Node 后端 /api）
// 依赖：vendor/supabase.js（全局 supabase）、js/sb.js（全局 sb）、config.js

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

// 内部：单链路 fetch。baseUrl 任意指定，便于公开 directFetch 自动 fallback
async function directFetchAt(baseUrl, path, init) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...(init || {}),
    headers: {
      'apikey': window.SB_ANON,
      'Authorization': `Bearer ${window.SB_ANON}`,
      ...((init && init.headers) || {})
    }
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 200) || res.statusText}`);
  }
  return res.json();
}
// 公开：自动双链路 fallback —— 默认 window.SB_URL（=Worker 代理/Cloudflare 边缘），
// 失败/超时无缝切到直连 Supabase 新加坡（解决 Worker 在微信 X5 内核 / 4G 抖动下的偶发不通）
// 异常信息带 [.via=Worker/.via=Direct] 后缀，便于错误横幅区分走的是哪条链路
async function directFetch(path, init, attemptTag) {
  attemptTag = attemptTag || '?';
  const directUrl = 'https://ecvsamlwjbxovqaziyww.supabase.co';
  const tries = [];
  if (window.SB_URL && window.SB_URL !== directUrl) tries.push({ url: window.SB_URL, label: 'Worker' });
  tries.push({ url: directUrl, label: 'Direct' });
  let lastErr = null;
  for (let i = 0; i < tries.length; i++) {
    const it = tries[i];
    try {
      const v = await directFetchAt(it.url, path, init);
      if (attemptTag === 'login' && i > 0) console.info('[fetch]', path, '走回退链路', it.label);
      return v;
    } catch (e) {
      lastErr = e;
      const msg = String(e && e.message || e);
      console.warn('[fetch]', path, 'via', it.label, '失败：', msg.slice(0, 120));
      // 网络/超时类错误继续下一条链路；4xx 不重试（业务错重试无意义）
      const transient = /Failed to fetch|NetworkError|timeout|AbortError|TypeError.*fetch|503|502|504|ETIMEDOUT|ENETUNREACH|fetch failed/i.test(msg);
      if (!transient) throw e;
    }
  }
  throw new Error((lastErr && lastErr.message || 'all-fail') + ' [.via=AllFailed]');
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
    // 兜底：填了快递单号就一定是"已揽收"状态（承运商已分配运单），不能继续显示"待发货"
    let status = b.status || 'pending';
    if (b.trackingNo && (status === 'pending' || !status)) status = 'collected';
    const logs = b.note ? [{ status, desc: b.note, time: Date.now() }] : [];
    const { error } = await sb.from('shipments').insert({
      partner_id: b.partnerId, gift_name: b.giftName, carrier: b.carrier || '',
      tracking_no: b.trackingNo || '', phone: b.phone || '', status, logs,
      product_link: b.productLink || '', product_title: b.productTitle || '',
      value: Number(b.value) || 0
    });
    if (error) throw new Error(error.message);
  },
  async addShipLog(id, b) {
    const { data: cur, error: e1 } = await sb.from('shipments').select('logs').eq('id', id).single();
    if (e1) throw new Error(e1.message);
    const logs = Array.isArray(cur.logs) ? cur.logs : [];
    logs.unshift({ status: b.status, desc: b.desc || '', time: Date.now() });
    const upd = { status: b.status, logs };
    if (b.trackingNo) upd.tracking_no = b.trackingNo;
    else if (b.status !== 'pending') {
      // 兜底：从接口/补单切换状态时如果没带 trackingNo，沿用现单号（保持状态一致）
      const { data: cur2 } = await sb.from('shipments').select('tracking_no').eq('id', id).single();
      if (cur2 && cur2.tracking_no) upd.tracking_no = cur2.tracking_no;
    }
    if (typeof b.value === 'number' && b.value > 0) upd.value = b.value;
    const { data, error } = await sb.from('shipments').update(upd).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return normShipment(data);
  },
  async deleteShipment(id) {
    const { error } = await sb.from('shipments').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // ---- 送礼墙 / 站内通知（anon 可调用 SECURITY DEFINER RPC）----
  async shipFeed(limit) {
    const { data, error } = await sb.rpc('ship_feed', { p_limit: limit || 20 });
    if (error) throw new Error(error.message);
    return (data && data.feed) || [];
  },
  async shipStats() {
    const { data, error } = await sb.rpc('ship_stats');
    if (error) throw new Error(error.message);
    return (data && data.stats) || { total_sent: 0, total_receivers: 0, total_signed: 0 };
  },
  async touchSeen(token) {
    try { await sb.rpc('touch_partner_seen', { p_token: token }); } catch (e) { /* 失败不影响主流程 */ }
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
    const { data, error } = await sb.rpc('kd100_track', {
      p_tracking: shipment.trackingNo,
      p_carrier: shipment.carrier,
      p_phone: phone || shipment.phone || ''
    });
    if (error) throw new Error(error.message);
    return data; // {ok:true, shipment:{trackingNo, carrier, logs}} | {ok:false, message}
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
    const { data, error } = await sb.rpc('admin_check_pw', { p_admin_pw: pw });
    if (error) throw new Error(error.message);
    return data === true;
  },
  async listRebatesPending(pw) {
    const { data, error } = await sb.rpc('admin_pending_list', { p_admin_pw: pw });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async listRebatesPaid(pw) {
    const { data, error } = await sb.rpc('admin_paid_list', { p_admin_pw: pw });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async addRebate(pw, b) {
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
    if (error) throw new Error(error.message);
    return data;
  },
  async getRebatesByCode(code) {
    const { data, error } = await sb.rpc('get_my_rebates', { p_code: code });
    if (error) throw new Error(error.message);
    return data || [];
  },
  // 模特专属页首页「返款进度」：按 model_id 拉取该模特全部返款记录
  async getRebatesByModel(modelId) {
    const { data, error } = await sb.rpc('get_my_rebates_by_model', { p_model_id: modelId });
    if (error) throw new Error(error.message);
    return data || [];
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
    const { data, error } = await sb.rpc('public_stats');
    if (error) throw new Error(error.message);
    return data;
  },
  async rebatePublicFeed(limit) {
    const { data, error } = await sb.rpc('public_feed', { p_limit: limit || 30 });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async rebatePublicLeaderboard(limit) {
    const { data, error } = await sb.rpc('public_leaderboard', { p_limit: limit || 10 });
    if (error) throw new Error(error.message);
    return data || [];
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
