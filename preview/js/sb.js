// sb.js — 初始化 Supabase 客户端（使用 publishable/anon key，可安全暴露）
window.sb = supabase.createClient(window.SB_URL, window.SB_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
