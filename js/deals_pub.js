// deals_pub.js — 公开「伙伴补给仓」：场景化货架 + 派发清单 + 一键复制全部购买链接
let allDeals = [];
let dealScene = '全部';
let dealPlatform = '全部';
let dealPrice = '全部';
const SCENES = ['新人见面礼', '复购激活', '转介绍答谢', '节日关怀', '日常补给'];
const CART_KEY = 'supply_cart';

const PRICE_BUCKETS = [
  { key: '全部', test: () => true, label: '全部' },
  { key: '≤5', test: p => p > 0 && p <= 5, label: '0-5元' },
  { key: '5-10', test: p => p > 5 && p <= 10, label: '5-10元' },
  { key: '10-20', test: p => p > 10 && p <= 20, label: '10-20元' },
  { key: '20+', test: p => p > 20, label: '20元以上' },
];

function fmtMoney(n) { n = Number(n) || 0; return (Math.round(n * 100) / 100).toString(); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function loadCart() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch (e) { return []; } }
function saveCart(arr) { localStorage.setItem(CART_KEY, JSON.stringify(arr)); }

function platformsIn(list) {
  const map = {};
  list.forEach(d => { const p = d.platform || '其他'; map[p] = (map[p] || 0) + 1; });
  const arr = Object.keys(map).sort((a, b) => map[b] - map[a]);
  return [{ p: '全部', n: list.length }].concat(arr.map(p => ({ p, n: map[p] })));
}

function renderSceneChips() {
  const present = SCENES.filter(s => allDeals.some(d => (d.scene || '') === s));
  const chips = [{ p: '全部', n: allDeals.length }].concat(present.map(s => ({ p: s, n: allDeals.filter(d => d.scene === s).length })));
  document.getElementById('scene-chips').innerHTML = chips.map(c =>
    `<button class="chip ${dealScene === c.p ? 'on' : ''}" data-s="${esc(c.p)}">${esc(c.p)}<i>${c.n}</i></button>`).join('');
}

function renderPlatformChips() {
  const chips = platformsIn(allDeals);
  document.getElementById('deals-chips').innerHTML = chips.map(c =>
    `<button class="chip ${dealPlatform === c.p ? 'on' : ''}" data-p="${esc(c.p)}">${esc(c.p)}<i>${c.n}</i></button>`).join('');
}

function renderPriceChips() {
  document.getElementById('price-chips').innerHTML = PRICE_BUCKETS.map(b =>
    `<button class="chip ${dealPrice === b.key ? 'on' : ''}" data-pr="${b.key}">${b.label}</button>`).join('');
}

function renderStats() {
  const count = allDeals.length;
  const saved = allDeals.reduce((s, d) => s + Math.max(0, (Number(d.origPrice) || 0) - (Number(d.dealPrice) || 0)), 0);
  const el = document.getElementById('supply-stats');
  if (!el) return;
  el.innerHTML = `
    <div class="ss"><div class="ss-n">${count}</div><div class="ss-l">在架好物</div></div>
    <div class="ss"><div class="ss-n">¥${fmtMoney(saved)}</div><div class="ss-l">累计补贴额</div></div>`;
}

async function loadDeals() {
  try {
    allDeals = await Api.listPublishedDeals() || [];
    renderSceneChips();
    renderStats();
    applyFilters();
  } catch (e) {
    document.getElementById('deals-list').innerHTML = '<div class="deals-foot">加载失败：' + esc(e.message) + '</div>';
  }
}

function applyFilters() {
  renderSceneChips();
  renderPlatformChips();
  renderPriceChips();
  let list = allDeals;
  if (dealScene !== '全部') list = list.filter(d => (d.scene || '') === dealScene);
  if (dealPlatform !== '全部') list = list.filter(d => (d.platform || '其他') === dealPlatform);
  const bucket = PRICE_BUCKETS.find(b => b.key === dealPrice);
  if (bucket && bucket.key !== '全部') list = list.filter(d => bucket.test(Number(d.dealPrice) || 0));
  renderDeals(list);
}

function updateBar() {
  const cart = loadCart();
  const bar = document.getElementById('supply-bar');
  document.getElementById('sb-count').textContent = cart.length;
  const total = cart.reduce((s, x) => s + (Number(x.dealPrice) || 0), 0);
  document.getElementById('sb-total').textContent = '¥' + fmtMoney(total);
  bar.style.display = cart.length ? 'flex' : 'none';
}

function renderDeals(list) {
  if (!list.length) {
    document.getElementById('deals-list').innerHTML = '<div class="deals-foot">没有符合条件的补贴品，换个筛选看看～</div>';
    return;
  }
  const cart = loadCart();
  const cartIds = new Set(cart.map(c => c.id));
  document.getElementById('deals-list').innerHTML = list.map(d => {
    const off = (d.origPrice > d.dealPrice && d.origPrice > 0) ? `<span class="orig">¥${fmtMoney(d.origPrice)}</span>` : '';
    const disc = (d.origPrice > d.dealPrice && d.origPrice > 0) ? Math.round((1 - d.dealPrice / d.origPrice) * 100) : 0;
    const discTag = disc > 0 ? `<span class="tag">省${disc}%</span>` : '';
    const commTag = d.commissionRate > 0 ? `<span class="tag">佣${d.commissionRate}%</span>` : '';
    const img = d.imageUrl ? `<img src="${esc(d.imageUrl)}" alt="" onerror="this.parentNode.textContent='🛍️'">` : '🛍️';
    const url = d.promoUrl || '#';
    const inCart = cartIds.has(d.id);
    return `<div class="deal-card" data-id="${d.id}">
      <div class="di">${img}</div>
      <div class="db">
        <div class="dt">${esc(d.title)}</div>
        <div class="dm"><span class="tag">${esc(d.platform || '其他')}</span>${discTag}${commTag}${d.coupon ? `<span class="tag">${esc(d.coupon)}</span>` : ''}</div>
        <div class="dist">派发价值：${esc(d.distValue || '1 次伙伴触达')}</div>
        <div class="dp">${off}<span class="now"><small>¥</small>${fmtMoney(d.dealPrice)}</span></div>
        <div class="dact">
          <a class="buy" href="${esc(url)}" target="_blank" rel="noopener">去拼多多购买</a>
          <button class="add ${inCart ? 'on' : ''}" data-id="${d.id}">${inCart ? '已加入' : '加入清单'}</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleCart(d) {
  const cart = loadCart();
  const idx = cart.findIndex(c => c.id === d.id);
  if (idx >= 0) cart.splice(idx, 1);
  else cart.push({ id: d.id, title: d.title, dealPrice: d.dealPrice, promoUrl: d.promoUrl });
  saveCart(cart);
  updateBar();
  const btn = document.querySelector('.add[data-id="' + d.id + '"]');
  if (btn) { const on = idx < 0; btn.classList.toggle('on', on); btn.textContent = on ? '已加入' : '加入清单'; }
}

document.addEventListener('click', e => {
  const schip = e.target.closest('#scene-chips .chip');
  if (schip) { dealScene = schip.dataset.s; applyFilters(); return; }
  const chip = e.target.closest('#deals-chips .chip');
  if (chip) { dealPlatform = chip.dataset.p; applyFilters(); return; }
  const pr = e.target.closest('#price-chips .chip');
  if (pr) { dealPrice = pr.dataset.pr; applyFilters(); return; }
  const add = e.target.closest('.add');
  if (add) {
    const d = allDeals.find(x => String(x.id) === String(add.dataset.id));
    if (d) toggleCart(d);
    return;
  }
  if (e.target.closest('#sb-copy')) {
    const cart = loadCart();
    if (!cart.length) return;
    const text = cart.map(c => (c.title ? c.title + '：' : '') + (c.promoUrl || '')).join('\n');
    const flash = () => { const b = document.getElementById('sb-copy'); const o = b.textContent; b.textContent = '已复制 ' + cart.length + ' 条链接 ✓'; setTimeout(() => b.textContent = o, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(flash).catch(() => prompt('复制全部购买链接：', text));
    else prompt('复制全部购买链接：', text);
  }
});

updateBar();
loadDeals();
