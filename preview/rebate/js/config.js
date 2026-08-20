// Supabase 连接配置（用你现有的项目，匿名 key 已就位）
window.SUPABASE_URL = 'https://ecvsamlwjbxovqaziyww.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_zc1yT6MeRA19HRL4_lruXw_-PnAVmzu';

// ---- 双链路 RPC 竞速（与主站 api.js 同策略：Worker 代理首选 + 直连兜底）----
// 返款系统此前只走直连 supabase.co（新加坡），国内手机蜂窝网直连易慢/失败，缺兜底。
// 用裸 fetch 做并行竞速 + AbortController 超时，绕开 supabase-js SDK 在浏览器内偶发的 CORS/TypeError。
window.SB_PROXY_URL = 'https://supabase-proxy.wgbproxy.workers.dev';
window.SB_DIRECT = 'https://ecvsamlwjbxovqaziyww.supabase.co';
window.SB_ANON = 'sb_publishable_zc1yT6MeRA19HRL4_lruXw_-PnAVmzu';

// 双链路竞速：Worker 代理 + 直连同时发，谁先成功用谁（AbortController 超时防挂起）；
// 全失败时抛 [rebateRpc.AllFailed]，由调用方显示中文错误，绝不静默回退假数据。
window.rebateRpc = async function (fn, params, timeoutMs = 12000) {
  const paths = [window.SB_PROXY_URL, window.SB_DIRECT];
  const headers = {
    'apikey': window.SB_ANON,
    'Authorization': 'Bearer ' + window.SB_ANON,
    'Content-Type': 'application/json'
  };
  async function attempt(base) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(base + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers,
        body: JSON.stringify(params || {}),
        signal: ctrl.signal
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + ': ' + t.slice(0, 200));
      }
      const j = await res.json();
      if (j && j.error) throw new Error((j.error.message) || 'RPC error');
      return j;
    } finally {
      clearTimeout(timer);
    }
  }
  const results = await Promise.allSettled(paths.map(p => attempt(p)));
  const ok = results.find(r => r.status === 'fulfilled');
  if (ok) return ok.value;
  const errs = results.map(r => (r.reason && r.reason.message) || '').filter(Boolean).join(' | ');
  throw new Error('[rebateRpc.AllFailed] ' + (errs || '网络异常，请检查网络后重试'));
};
