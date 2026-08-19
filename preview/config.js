// config.js — 公有配置（publishable key 可安全暴露在前端，非私密）
// Cloudflare Worker 代理（国内加速 Supabase）：留空=直连新加坡节点；
// 部署 Worker 后把地址填到 SB_PROXY_URL，所有读/写路径自动切到边缘节点（详见 tools/supabase-proxy/README.md）
window.SB_PROXY_URL = '';
window.SB_URL = window.SB_PROXY_URL || 'https://ecvsamlwjbxovqaziyww.supabase.co';
window.SB_ANON = 'sb_publishable_zc1yT6MeRA19HRL4_lruXw_-PnAVmzu';
// 系统权威前端域名（私域/福利站统一入口）。
// 所有“拼接专属链接 / 跳转 / 分享链接”都引用这个常量，而不是 location.origin。
// 原因：location.origin 取的是“当前页面所在域名”，后台开在 CloudStudio 预览域就会把
// 所有人专属链接显示成预览域，造成与公众号正式入口（github.io）不一致。
// 统一用这里，后台无论开在哪都显示稳定的正式入口；将来迁移自有域名只改这一行。
window.APP_ORIGIN = 'https://0826laurel-cpu.github.io';
// 快递100 实时查询：已启用（由 Supabase RPC kd100_track 驱动，无需 Edge Function）
// 该值仅作为“是否已启用”的开关，非真实地址
window.KD100_FN = 'rpc:kd100_track';
