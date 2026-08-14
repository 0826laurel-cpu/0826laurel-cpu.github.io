// ============ 后台录入逻辑 ============
let sb = null;
try { sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY); } catch(e){}

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

// 密码只保存在本次会话内存，不写前端常量、不落本地存储
let adminPw = '';

function val(id){ return document.getElementById(id).value.trim(); }
function setVal(id, v){ document.getElementById(id).value = v || ''; }

// ============ 模特编号智能识别：支持粘贴专属链接（me.html?t=xxx）============
// 录入人员手头通常只有模特的专属链接，而不是手填的「模特编号」。
// 这里把链接里的 token 解析出来，调 get_my_partner 反查真实模特编号，
// 避免把整条 URL 当编号存进去、导致模特端查不到返款进度。
let lastResolvedModel = null;  // 最近一次成功反查结果，供提交时校验

function extractToken(raw){
  if (!raw) return null;
  let m = raw.match(/me\.html\?t=([0-9a-fA-F-]{8,})/);
  if (m) return m[1];
  m = raw.match(/[?&]t=([0-9a-fA-F-]{8,})/);
  if (m) return m[1];
  // 纯 UUID（兼容直接粘 token）
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(raw.trim())) return raw.trim();
  return null;
}

// 实时把识别结果写到字段显示（用户看清楚）
function paintResolvedHint(modelId){
  const hint = document.getElementById('f-model-id-hint');
  if (!hint) return;
  if (modelId){
    hint.textContent = `✅ 识别为模特编号：${modelId}`;
    hint.style.color = 'var(--brand)';
  } else {
    hint.textContent = '';
    hint.style.color = 'var(--sub)';
  }
}
async function resolveModelId(raw){
  const token = extractToken(raw);
  if (!token) return { modelId: raw, ok: false }; // 不是链接/UUID，原样返回（兼容手填编号）
  try {
    const { data, error } = await sb.rpc('get_my_partner', { p_token: token });
    if (error) return { modelId: raw, ok: false, warn: '查询模特失败：' + error.message };
    const p = (data && data.partner) ? data.partner : (Array.isArray(data) ? data[0] : null);
    if (!p || !p.model_id) return { modelId: raw, ok: false, warn: '该专属链接未找到对应模特编号，请确认链接正确' };
    return { modelId: p.model_id, name: p.name || '', ok: true };
  } catch(e){
    return { modelId: raw, ok: false, warn: '识别失败：' + (e && e.message || e) };
  }
}

function enterPanel(){
  document.getElementById('gate').style.display = 'none';
  document.getElementById('panel').style.display = 'block';
  setVal('f-date', new Date().toISOString().slice(0,10));
  loadPending();
  loadPaid();
}

document.getElementById('pw-btn').addEventListener('click', async ()=>{
  const pw = document.getElementById('pw').value.trim();
  if (!pw){ toast('请输入密码'); return; }
  if (!sb){ toast('未连接数据库'); return; }

  const btn = document.getElementById('pw-btn');
  const oldText = btn.textContent;
  btn.textContent = '验证中…'; btn.disabled = true;

  const { data, error } = await sb.rpc('admin_check_pw', { p_admin_pw: pw });
  btn.textContent = oldText; btn.disabled = false;

  if (error || data !== true){
    toast('密码错误');
    return;
  }
  adminPw = pw;
  enterPanel();
});

document.getElementById('logout').addEventListener('click', ()=>{
  adminPw = '';
  document.getElementById('panel').style.display = 'none';
  document.getElementById('gate').style.display = 'block';
  setVal('pw', '');
});

// 凭证图片选择 + 预览
const voucherInput = document.getElementById('f-voucher');
const voucherName  = document.getElementById('voucher-name');
const voucherPreview = document.getElementById('voucher-preview');
  voucherInput.addEventListener('change', ()=>{
  const file = voucherInput.files[0];
  if (!file){ voucherName.textContent = '未选择文件'; voucherPreview.style.display='none'; voucherPreview.src=''; return; }
  voucherName.textContent = file.name;
  const reader = new FileReader();
  reader.onload = e => { voucherPreview.src = e.target.result; voucherPreview.style.display='block'; };
  reader.readAsDataURL(file);
});

// 模特编号字段：失焦时若粘贴的是专属链接，实时识别并带出昵称
document.getElementById('f-model-id').addEventListener('blur', async ()=>{
  const raw = val('f-model-id');
  if (!raw){ paintResolvedHint(null); lastResolvedModel = null; return; }
  const r = await resolveModelId(raw);
  if (r.ok){
    if (r.name && !val('f-mask')) setVal('f-mask', r.name);
    lastResolvedModel = r;
    paintResolvedHint(r.modelId);
    toast('✅ 已识别模特：' + (r.name || r.modelId));
  } else if (r.warn){
    toast(r.warn);
    paintResolvedHint(null);
    lastResolvedModel = null;
  } else {
    paintResolvedHint(null);
    lastResolvedModel = null;
  }
});
// 输入时清提示
document.getElementById('f-model-id').addEventListener('input', ()=>{
  paintResolvedHint(null);
  lastResolvedModel = null;
});

function resetForm(){
  ['f-code','f-mask','f-model-id','f-order','f-item','f-amount','f-expected'].forEach(id=>setVal(id,''));
  paintResolvedHint(null);
  lastResolvedModel = null;
  setVal('f-date', new Date().toISOString().slice(0,10));
  setVal('f-status', '已返');
  voucherInput.value = '';
  voucherName.textContent = '未选择文件';
  voucherPreview.style.display = 'none';
  voucherPreview.src = '';
}

// 把一条记录填充进表单
function fillForm(r, opts={}){
  setVal('f-code', r.model_code);
  setVal('f-mask', r.model_mask);
  setVal('f-model-id', r.model_id);
  setVal('f-order', r.order_no);
  setVal('f-item', r.item);
  setVal('f-amount', r.amount || '');
  setVal('f-expected', r.expected_rebate_date || '');
  setVal('f-status', opts.status || r.status || '已返');
  setVal('f-date', opts.setDateToday ? new Date().toISOString().slice(0,10) : (r.rebate_date || ''));
  voucherInput.value = '';
  voucherName.textContent = '未选择文件';
  voucherPreview.style.display = 'none';
  voucherPreview.src = '';
  // 滚动到表单顶部
  document.querySelector('.panel').scrollIntoView({ behavior: 'smooth' });
}

function fmtDateTime(t){
  const d = new Date(t);
  return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// 加载待返款列表
async function loadPending(){
  const box = document.getElementById('pendingList');
  if (!sb){ box.innerHTML = '<div class="pending-empty">未连接数据库</div>'; return; }
  const { data, error } = await sb.rpc('admin_pending_list', { p_admin_pw: adminPw });
  if (error){ box.innerHTML = '<div class="pending-empty">加载失败：' + error.message + '</div>'; return; }
  document.getElementById('pending-count').textContent = (data || []).length;
  if (!data || data.length === 0){
    box.innerHTML = '<div class="pending-empty">暂无待返款订单 🎉</div>';
    return;
  }
  box.innerHTML = data.map(r => {
    const exp = r.expected_rebate_date ? r.expected_rebate_date : '未设置';
    const model = r.model_code ? `（${r.model_code}）` : '';
    return `<div class="pending-item" data-id="${r.id}">
      <div class="pending-top">
        <div class="pending-order">${r.order_no || '-'}</div>
        <div class="pending-amount">¥${Number(r.amount||0).toFixed(2)}</div>
      </div>
      <div class="pending-meta">
        <span>👤 ${r.model_mask || '匿名'}${model}</span>
        <span>📦 ${r.item || '-'}</span>
      </div>
      <div class="pending-meta">
        <span>预计返款：${exp}</span>
        <span>录入：${fmtDateTime(r.created_at)}</span>
      </div>
      <div class="pending-actions">
        <button class="btn-done" data-action="pay" data-order="${r.order_no}">上传返款截图</button>
        <button class="btn-edit" data-action="edit" data-order="${r.order_no}">编辑</button>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('[data-action="pay"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const order = btn.getAttribute('data-order');
      const { data } = await sb.rpc('get_my_rebates', { p_code: order });
      const r = (data||[]).find(x=>x.order_no===order);
      if (!r){ toast('未找到该订单'); return; }
      fillForm(r, { status: '已返', setDateToday: true });
    });
  });
  box.querySelectorAll('[data-action="edit"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const order = btn.getAttribute('data-order');
      const { data } = await sb.rpc('get_my_rebates', { p_code: order });
      const r = (data||[]).find(x=>x.order_no===order);
      if (!r){ toast('未找到该订单'); return; }
      fillForm(r, { status: r.status });
    });
  });
}

// 加载已返款列表
async function loadPaid(){
  const box = document.getElementById('paidList');
  if (!sb){ box.innerHTML = '<div class="pending-empty">未连接数据库</div>'; return; }
  const { data, error } = await sb.rpc('admin_paid_list', { p_admin_pw: adminPw });
  if (error){ box.innerHTML = '<div class="pending-empty">加载失败：' + error.message + '</div>'; return; }
  if (!data || data.length === 0){
    box.innerHTML = '<div class="pending-empty">暂无已返款订单</div>';
    return;
  }
  box.innerHTML = data.map(r => {
    const model = r.model_code ? `（${r.model_code}）` : '';
    const thumb = r.voucher_url
      ? `<img src="${r.voucher_url}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line);margin-top:6px;cursor:pointer;" onclick="openVoucher('${r.voucher_url}')">`
      : '<span style="font-size:12px;color:var(--sub)">无凭证</span>';
    return `<div class="pending-item" data-id="${r.id}">
      <div class="pending-top">
        <div class="pending-order">${r.order_no || '-'}</div>
        <div class="pending-amount">¥${Number(r.amount||0).toFixed(2)}</div>
      </div>
      <div class="pending-meta">
        <span>👤 ${r.model_mask || '匿名'}${model}</span>
        <span>📦 ${r.item || '-'}</span>
      </div>
      <div class="pending-meta">
        <span>返款日期：${r.rebate_date || '-'}</span>
        <span>录入：${fmtDateTime(r.created_at)}</span>
      </div>
      <div>${thumb}</div>
    </div>`;
  }).join('');
}

// 凭证放大查看
window.openVoucher = function(url){
  const box = document.createElement('div');
  box.className = 'voucher-lightbox';
  box.innerHTML = `<img src="${url}" alt="返款凭证">`;
  box.onclick = () => box.remove();
  document.body.appendChild(box);
};

document.getElementById('submit-btn').addEventListener('click', async ()=>{
  const file = voucherInput.files[0];
  const status = document.getElementById('f-status').value;
  let voucherUrl = '';

  // 解析「模特编号」：支持粘贴专属链接，自动识别为对应模特编号（提交时统一解析，字段保留原文便于核对）
  let modelIdVal = val('f-model-id');
  const resolved = await resolveModelId(modelIdVal);
  if (resolved.warn) toast(resolved.warn);
  modelIdVal = resolved.modelId;
  if (resolved.name && !val('f-mask')) setVal('f-mask', resolved.name);
  // 兜底：字段是 URL/UUID 形式但还没成功反查出来，强制再反查一次，避免整条 URL 被原样写入 DB
  if (modelIdVal && (modelIdVal.startsWith('http') || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(modelIdVal)) && resolved.modelId === modelIdVal){
    // resolveModelId 已 ok=false 直接原样返回 → 这里再调一次保险 + 提示用户
    const re = await resolveModelId(modelIdVal);
    if (re && re.ok){
      modelIdVal = re.modelId;
      if (re.name && !val('f-mask')) setVal('f-mask', re.name);
      toast('⚠️ 已自动反查为模特编号：' + re.modelId + '（' + re.name + '）');
    } else {
      toast('该字段含 URL/UUID 但未匹配到模特编号，请确认链接正确后将不再提交');
    }
  }

  // 如果选了凭证图，先上传到 Supabase Storage
  if (file){
    if (!sb){ toast('未连接数据库，无法上传图片'); return; }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `voucher/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    toast('正在上传凭证…');
    const { data: upData, error: upError } = await sb.storage.from('rebate-vouchers').upload(path, file, {
      contentType: file.type,
      upsert: true
    });
    if (upError){ toast('凭证上传失败：' + upError.message); return; }
    const { data: urlData } = sb.storage.from('rebate-vouchers').getPublicUrl(path);
    voucherUrl = urlData.publicUrl;
  }

  const payload = {
    p_admin_pw:   adminPw,
    p_model_code: val('f-code'),
    p_model_mask: val('f-mask'),
    p_model_id:   modelIdVal,
    p_order_no:   val('f-order'),
    p_item:       val('f-item'),
    p_amount:     parseFloat(val('f-amount')||'0'),
    p_rebate_date: val('f-date') || null,
    p_expected_rebate_date: val('f-expected') || null,
    p_status:     status,
    p_voucher_url: voucherUrl || null
  };
  if (!payload.p_model_mask || !payload.p_order_no || !payload.p_item || !payload.p_amount){
    toast('请填全：昵称 / 订单号 / 事项 / 金额'); return;
  }
  if (!sb){ toast('未连接数据库（演示环境无法写入）'); return; }
  const {data,error} = await sb.rpc('admin_add_rebate', payload);
  if (error){ toast('提交失败：' + error.message); return; }
  if (data && data.ok === false){ toast(data.error || '提交失败'); return; }
  toast('✅ 返款记录已提交');
  resetForm();
  loadPending();
  loadPaid();
});
