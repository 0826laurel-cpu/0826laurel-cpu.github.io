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

function resetForm(){
  ['f-code','f-mask','f-model-id','f-order','f-item','f-amount','f-expected'].forEach(id=>setVal(id,''));
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
    p_model_id:   val('f-model-id'),
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
