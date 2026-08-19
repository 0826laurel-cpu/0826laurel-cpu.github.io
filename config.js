// config.js — 公有配置（publishable key 可安全暴露在前端，非私密）
// 主链路 = 直连 Supabase 新加坡：国内手机/电脑都稳（模特页 me.html 已验证手机可通）。
// Cloudflare Worker 代理（supabase-proxy.wgbproxy.workers.dev）仅作「备用兜底」——
// 实测 *.workers.dev 在国内手机蜂窝网路由极差、常被卡死，若把它当首选会让手机端登录/数据全程卡住。
// 故默认直连，Worker 仅在直连失败时才回退（见 js/api.js / app.js 的 orderedPaths()）。
window.SB_PROXY_URL = 'https://supabase-proxy.wgbproxy.workers.dev';
window.SB_DIRECT = 'https://ecvsamlwjbxovqaziyww.supabase.co';
window.SB_URL = window.SB_DIRECT; // 首选：直连（v36 起，还原 v32 之前手机可用的链路）
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
