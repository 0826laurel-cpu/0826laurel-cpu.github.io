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
function setVal(id, v){ document.getElementById(id).value = v; }

function enterPanel(){
  document.getElementById('gate').style.display = 'none';
  document.getElementById('panel').style.display = 'block';
  setVal('f-date', new Date().toISOString().slice(0,10));
  loadPending();
}

document.getElementById('pw-btn').addEventListener('click', ()=>{
  const pw = document.getElementById('pw').value.trim();
  if (!pw){ toast('请输入密码'); return; }
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
  ['f-code','f-mask','f-order','f-item','f-amount','f-expected'].forEach(id=>setVal(id,''));
  setVal('f-date', new Date().toISOString().slice(0,10));
  setVal('f-status', '已返');
  voucherInput.value = '';
  voucherName.textContent = '未选择文件';
  voucherPreview.style.display = 'none';
  voucherPreview.src = '';
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
    return `<div class="pending-item">
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
        <span>录入：${new Date(r.created_at).toLocaleString('zh-CN')}</span>
      </div>
    </div>`;
  }).join('');
}

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
});
