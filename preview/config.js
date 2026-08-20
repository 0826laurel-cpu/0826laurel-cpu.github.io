// config.js — 公有配置（publishable key 可安全暴露在前端，非私密）
// 默认首选 = Cloudflare Worker 代理（supabase-proxy.wgbproxy.workers.dev）：
//   实测在国内手机蜂窝网（模特页 me.html v32–v35 期间）Worker 比直连更稳——
//   Worker 在全球边缘节点 + 30s GET 缓存能吸收跨境抖动；直连 supabase.co（新加坡）
//   在用户手机网络偶发 18s+ 不通。把 Worker 当首选可避免 SDK 直连失败抛 TypeError。
// 直连 SB_DIRECT 仅作兜底（Worker 失败/被微信 X5 拦截时切回）。
window.SB_PROXY_URL = 'https://supabase-proxy.wgbproxy.workers.dev';
window.SB_DIRECT = 'https://ecvsamlwjbxovqaziyww.supabase.co';
window.SB_URL = window.SB_PROXY_URL || window.SB_DIRECT; // 首选：Worker（v37 还原 v32–v35 链路）
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
