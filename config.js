// config.js — 公有配置（publishable key 可安全暴露在前端，非私密）
window.SB_URL = 'https://ecvsamlwjbxovqaziyww.supabase.co';
window.SB_ANON = 'sb_publishable_zc1yT6MeRA19HRL4_lruXw_-PnAVmzu';
// 快递100 实时查询：已启用（由 Supabase RPC kd100_track 驱动，无需 Edge Function）
// 该值仅作为“是否已启用”的开关，非真实地址
window.KD100_FN = 'rpc:kd100_track';
