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

async function sbSelect(table, transform) {
  const { data, error } = await sb.from(table).select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(transform);
}

const Api = {
  // ---- 认证（密码 RPC 校验 + 前端 localStorage 闸门；RLS 已放行 anon，anon key 直连读写）----
  async login(pwd) {
    const { data: r, error: re } = await sb.rpc('admin_login', { p_pwd: pwd });
    if (re) throw new Error(re.message || '登录失败');
    if (!r || !r.ok) throw new Error((r && r.error) || '密码错误');
    localStorage.setItem('p_admin', '1');
    return { ok: true };
  },
  async logout() { localStorage.removeItem('p_admin'); },
  async getSession() { return localStorage.getItem('p_admin') ? { user: { is_admin: true } } : null; },

  // ---- 伙伴 ----
  async listPartners() {
    const partners = await sbSelect('partners', normPartner);
    const interactions = await sbSelect('interactions', normInteraction);
    partners.forEach(p => { p.interactions = interactions.filter(i => i.partnerId == p.id); });
    return partners;
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
      product_link: b.productLink || '', product_title: b.productTitle || ''
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
    const status = (Array.isArray(logs) && logs.some(l => l.desc && /签收/.test(l.desc))) ? 'delivered' : 'transit';
    const { error } = await sb.from('shipments').update({ logs, status }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  // ---- 羊毛情报 / 补贴好物 ----
  async listDeals() {
    const { data, error } = await sb.from('deals').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(normDeal);
  },
  async listPublishedDeals() {
    const { data, error } = await sb.from('deals').select('*').eq('status', 'published').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
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
