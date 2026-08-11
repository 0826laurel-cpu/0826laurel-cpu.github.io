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

document.getElementById('pw-btn').addEventListener('click', ()=>{
  const pw = document.getElementById('pw').value.trim();
  if (!pw){ toast('请输入密码'); return; }
  adminPw = pw;
  document.getElementById('gate').style.display = 'none';
  document.getElementById('panel').style.display = 'block';
  document.getElementById('f-date').value = new Date().toISOString().slice(0,10);
});

document.getElementById('logout').addEventListener('click', ()=>{
  adminPw = '';
  document.getElementById('panel').style.display = 'none';
  document.getElementById('gate').style.display = 'block';
  document.getElementById('pw').value = '';
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
    p_model_code: document.getElementById('f-code').value.trim(),
    p_model_mask: document.getElementById('f-mask').value.trim(),
    p_order_no:   document.getElementById('f-order').value.trim(),
    p_item:       document.getElementById('f-item').value.trim(),
    p_amount:     parseFloat(document.getElementById('f-amount').value||'0'),
    p_rebate_date: document.getElementById('f-date').value,
    p_expected_rebate_date: document.getElementById('f-expected').value || null,
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
  ['f-code','f-mask','f-order','f-item','f-amount'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('f-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('f-expected').value = '';
  voucherInput.value = '';
  voucherName.textContent = '未选择文件';
  voucherPreview.style.display = 'none';
  voucherPreview.src = '';
});
