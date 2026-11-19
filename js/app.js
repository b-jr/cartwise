import * as C from './core.js';
const { money, r1, fmtSize, fmtUnit, unitLabel, packPrice, fmtDays, todayISO } = C;

const VERSION = '3.1.0';
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const KEY = 'grocery-scanner-v2', OLDKEY = 'grocery-scanner-v1';

// ================= state =================
let S = C.emptyState();
let IDX = null;                                   // price index, rebuilt lazily after every save
const ix = () => IDX || (IDX = C.buildIndex(S));
const stats = code => C.stats(ix(), code);
const entryUnit = e => C.entryUnit(S, e);
const today = () => todayISO();

function load() {
  try {
    const r = localStorage.getItem(KEY) || localStorage.getItem(OLDKEY);
    if (r) S = C.migrate(JSON.parse(r));
  } catch (e) { console.warn('load failed', e); }
}
function save() {
  IDX = null;
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Storage is full or blocked. Back up your data.'); }
  refreshBadges();
}

// ================= utils =================
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2200); }
const view = () => document.querySelector('nav button.on')?.dataset.v;
const fmtDate = iso => new Date(iso + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const img = (p, cls = '') => { const u = C.safeImageUrl(p.img); return u ? `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="${cls}">` : ''; };
function storeOptions(selected, withNew = false) {
  return S.stores.map(s => `<option ${s === selected ? 'selected' : ''}>${esc(s)}</option>`).join('') + (withNew ? '<option value="__new">＋ New store…</option>' : '');
}
const defaultStore = () => (S.trip.active && S.trip.store) || S.settings.lastStore || S.stores[0];

// ================= nav & badges =================
document.querySelectorAll('nav button').forEach(b => b.onclick = () => show(b.dataset.v));
function show(v) {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  for (const x of ['scan', 'list', 'pantry', 'deals', 'more']) $('#v-' + x).classList.toggle('hide', x !== v);
  if (v !== 'scan') stopCam();
  ({ scan: renderTripBar, list: renderList, pantry: renderPantry, deals: renderDeals, more: renderMore })[v]();
  window.scrollTo(0, 0);
}
function dealAlerts() {
  const out = [];
  for (const p of Object.values(S.products)) {
    const st = stats(p.code); if (!st) continue;
    const b = packPrice(st.best), v = C.verdict(st), recent = C.daysBetween(st.best.date, today()) <= 14;
    let why = null, cls = 'good';
    if (p.target && b <= p.target) why = `🔥 At or below your stock-up price (${money(p.target)})`;
    else if (recent && v && v.cls === 'good') why = v.t;
    else if (recent && st.best.sale) { why = 'On sale'; cls = 'mid'; }
    else { const sc = C.saleCycle(ix(), p.code); if (sc && sc.next && Math.abs(C.daysBetween(today(), sc.next)) <= 7) { why = `🏷️ Sale likely around ${fmtDate(sc.next)}`; cls = 'mid'; } }
    if (why) out.push({ p, st, why, cls, b });
  }
  return out;
}
function refreshBadges() {
  const open = S.list.filter(i => !i.done).length;
  $('#hdrCount').textContent = S.trip.active ? `🛒 ${S.trip.store}` : open ? `${open} on list` : '';
  const set = (id, n) => { const el = $(id); el.textContent = n; el.classList.toggle('hide', !n); };
  set('#dotList', open);
  const pa = C.pantryAlerts(S, today());
  set('#dotPantry', pa.low.length + pa.expiring.length);
  set('#dotDeals', dealAlerts().length);
}

// ================= offline =================
function setOnline() { $('#offline').classList.toggle('hide', navigator.onLine); if (navigator.onLine) processPending(); }
window.addEventListener('online', setOnline);
window.addEventListener('offline', setOnline);

// ================= camera =================
let scanner = null, scanning = false, paused = false, lastCode = '', lastTime = 0;
$('#btnCam').onclick = () => scanning ? stopCam() : startCam();
async function startCam() {
  if (!window.Html5Qrcode) { toast('Scanner is still loading. Try again in a moment.'); return; }
  if (scanning) return resumeCam();
  const F = Html5QrcodeSupportedFormats;
  scanner = scanner || new Html5Qrcode('reader', {
    formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF],
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }, verbose: false,
  });
  try {
    await scanner.start({ facingMode: 'environment' },
      { fps: 12, qrbox: (w, h) => ({ width: Math.min(w * 0.85, 340), height: Math.min(h * 0.45, 160) }) }, onScan, () => {});
    scanning = true; paused = false; $('#btnCam').textContent = 'Stop camera';
  } catch (e) { toast('Camera unavailable: ' + (e.message || e)); }
}
async function stopCam() {
  if (scanner && scanning) { try { await scanner.stop(); } catch (e) {} }
  scanning = false; paused = false; $('#btnCam').textContent = '📷 Start camera';
}
function pauseCam() { if (!scanning) return; try { scanner.pause(true); paused = true; } catch (e) { stopCam(); } }
function resumeCam() {
  if (scanning && paused) { try { scanner.resume(); paused = false; return; } catch (e) { stopCam(); } }
  if (!scanning) startCam();
}
function onScan(raw) {
  const code = String(raw).trim();
  const now = Date.now(); if (code === lastCode && now - lastTime < 3000) return;
  if (!C.isProductBarcode(code)) { lastCode = code; lastTime = now; toast("That isn't a product barcode"); return; }
  lastCode = code; lastTime = now;
  if (navigator.vibrate) navigator.vibrate(60);
  if (S.trip.active) { pauseCam(); lookup(code, { quick: true }); }
  else { stopCam(); lookup(code); }
}
$('#manual').onsubmit = e => {
  e.preventDefault(); const c = $('#manualCode').value.replace(/\D/g, '');
  if (!C.isProductBarcode(c)) return toast('Enter the numbers printed under the barcode');
  { $('#manualCode').value = ''; $('#manualCode').blur(); lookup(c, { quick: S.trip.active }); }
};

// ================= lookup (Open Food Facts) =================
const FIELDS = 'code,product_name,brands,quantity,product_quantity,image_front_small_url,image_front_url,nutriscore_grade,nova_group,nutriments,ingredients_text,allergens_tags,serving_size,serving_quantity,categories';
const variants = code => [...new Set([code, ...(code.length === 12 ? ['0' + code] : []), ...(code.length === 13 && code[0] === '0' ? [code.slice(1)] : [])])];
async function fetchOFF(code) {
  let netErr = false;
  for (const c of variants(code)) {
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(c)}.json?fields=${FIELDS}`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!r.ok && r.status !== 404) { netErr = true; continue; }
      const j = await r.json();
      if (j.status === 1 && j.product) return { product: j.product };
    } catch (e) { netErr = true; }
  }
  return netErr ? { netErr: true } : { notFound: true };
}
function applyOFF(code, p) {
  const n = p.nutriments || {};
  const pick = suf => ({ kcal: n['energy-kcal' + suf], fat: n['fat' + suf], sat: n['saturated-fat' + suf], carb: n['carbohydrates' + suf],
    sugar: n['sugars' + suf], fiber: n['fiber' + suf], protein: n['proteins' + suf], sodium: n['sodium' + suf] });
  const has = o => Object.values(o).some(v => v != null && v !== '');
  const n100 = pick('_100g'), nServ = pick('_serving');
  const old = S.products[code] || {};
  const cats = (p.categories || '').split(',').map(s => s.trim()).filter(Boolean);
  const P = S.products[code] = Object.assign(old, {
    code, name: (old.custom || (old.name && !old.pending && old.renamed)) ? old.name : (p.product_name || old.name || 'Unnamed product'),
    brand: p.brands || '', qtyText: p.quantity || '',
    img: C.safeImageUrl(p.image_front_small_url) || C.safeImageUrl(p.image_front_url), ns: (p.nutriscore_grade || '').toLowerCase(), nova: p.nova_group || '',
    n100: has(n100) ? n100 : null, nServ: has(nServ) ? nServ : null, serving: p.serving_size || '', servQty: parseFloat(p.serving_quantity) || null,
    ingr: p.ingredients_text || '', allergens: (p.allergens_tags || []).map(a => a.replace(/^\w\w:/, '')).join(', '),
    pending: false, notFound: false,
  });
  if (!P.size) P.size = C.parseSize(p.quantity) || (parseFloat(p.product_quantity) ? { amt: parseFloat(p.product_quantity), unit: 'g' } : null);
  if (!P.group && cats.length) P.group = cats[cats.length - 1].replace(/^\w\w:/, '');
  return P;
}
let curCode = null, curQuick = false;
async function lookup(code, { quick = false } = {}) {
  if (!C.isProductBarcode(code)) return;
  curCode = code; curQuick = quick;
  const rerender = () => { if (curCode === code) (curQuick ? renderQuick : renderProduct)(code); };
  const known = S.products[code];
  if (known && !known.pending) rerender(); else $('#result').innerHTML = `<div class="card mute">Looking up ${esc(code)}…</div>`;
  // Skip the network if we already have good data from the last 30 days.
  if (known && !known.pending && known.fetched && C.daysBetween(known.fetched, today()) < 30) return;
  const res = await fetchOFF(code);
  if (res.product) { applyOFF(code, res.product).fetched = today(); save(); return rerender(); }
  if (res.netErr && !(known && !known.pending)) {
    S.products[code] = Object.assign(known || {}, { code, name: known?.name || `Barcode ${code}`, pending: true });
    if (!S.pending.includes(code)) S.pending.push(code);
    save(); toast('Offline: saved it, and it will be looked up later'); return rerender();
  }
  if (res.notFound && !known) { if (curCode === code) renderUnknown(code); return; }
  rerender();
}
let processing = false;
async function processPending() {
  if (processing || !S.pending.length || !navigator.onLine) return;
  processing = true; let n = 0;
  for (const code of [...S.pending]) {
    const res = await fetchOFF(code);
    if (res.netErr) break;
    S.pending = S.pending.filter(c => c !== code);
    if (res.product) { applyOFF(code, res.product).fetched = today(); n++; }
    else if (S.products[code]) { S.products[code].pending = false; S.products[code].notFound = true; }
  }
  processing = false; save();
  if (n) { toast(`Looked up ${n} saved scan${n > 1 ? 's' : ''}`); if (curCode && view() === 'scan') (curQuick ? renderQuick : renderProduct)(curCode); }
}

// ================= shared renderers =================
function healthChips(p, compact = false) {
  const out = [];
  if (p.ns && 'abcde'.includes(p.ns)) out.push(`<span class="chip ns-${p.ns}">Nutri-Score ${p.ns.toUpperCase()}</span>`);
  if (p.nova) {
    const L = { 1: ['good', 'Unprocessed'], 2: ['good', 'Ingredient'], 3: ['mid', 'Processed'], 4: ['bad', 'Ultra-processed'] }[p.nova];
    if (L) out.push(`<span class="chip ${L[0]}">NOVA ${p.nova} · ${L[1]}</span>`);
  }
  for (const f of C.healthFlags(p)) {
    if (compact && f.level !== 'high') continue;
    out.push(`<span class="chip ${{ low: 'good', med: 'mid', high: 'bad' }[f.level]}">${f.label} ${f.level}</span>`);
  }
  return out.join('');
}
function valueLine(p, price) {
  const v = C.valueMetrics(p, price), parts = [];
  if (v.proteinPerDollar) parts.push(`<b>${r1(v.proteinPerDollar)} g</b> protein`);
  if (v.kcalPerDollar) parts.push(`<b>${Math.round(v.kcalPerDollar)}</b> kcal`);
  let s = parts.length ? 'Per $1: ' + parts.join(' · ') : '';
  if (v.perServing) s += (s ? '<br>' : '') + `<b>${money(v.perServing)}</b> per serving · ~${Math.round(v.servings)} servings`;
  return s;
}
function bulkHTML(p) {
  const b = C.bulkCheck(S, ix(), p);
  if (!b) return `<div class="mute">Enter how many packs you use per month to check whether buying in bulk makes sense and to track your pantry.</div>`;
  const L = [`<div>${b.qty} pack${b.qty > 1 ? 's' : ''} will last about <b>${fmtDays(b.lastsDays)}</b> at ${p.use}/month.</div>`];
  if (b.shelf) L.push(b.wastePct
    ? `<div class="warn">⚠️ Shelf life is ${b.shelf} days, so you'd likely waste about ${Math.round(b.wastePct * 100)}%. Buy ${b.maxSafe} or fewer, or freeze or split it.</div>`
    : `<div class="ok">✅ You'll use it up before it expires (${b.shelf}-day shelf life).</div>`);
  if (b.upfront != null) L.push(`<div>Upfront cost <b>${money(b.upfront)}</b> · about <b>${money(b.monthly)}</b>/month</div>`);
  const u = p.size && p.size.unit;
  if (b.savesVsWorst) { const o = b.savesVsWorst.opt; L.push(`<div class="ok">💰 Saves about <b>${money(b.savesVsWorst.amt)}/month</b> (${money(b.savesVsWorst.amt * 12)}/year) compared with ${esc(o.p.name)} ${esc(fmtSize(o.p.size))} at ${esc(o.e.store)}.</div>`); }
  if (b.cheaperOpt) { const o = b.cheaperOpt.opt; L.push(`<div class="warn">💡 ${esc(o.p.name)} ${esc(fmtSize(o.p.size))} at ${esc(o.e.store)} is cheaper per ${unitLabel(u)} and would save about ${money(b.cheaperOpt.amt)}/month.</div>`); }
  if (b.upfront != null && p.group && b.hasOpts === false) L.push(`<div class="mute">Scan other sizes into the "${esc(p.group)}" group to see your bulk savings.</div>`);
  if (b.wasteFactor > 1 && b.effUnit) L.push(`<div class="mute">The real price after waste is ${fmtUnit(b.effUnit, u)}.</div>`);
  return `<div class="lines">${L.join('')}</div>`;
}
function nutrTable(p) {
  const a = p.n100, b = p.nServ; if (!a && !b) return '<div class="mute">No nutrition data.</div>';
  const per = p.size && p.size.unit === 'ml' ? '100 ml' : '100 g';
  const rows = [['Calories', 'kcal', ' kcal', 1], ['Protein', 'protein', ' g', 1], ['Carbs', 'carb', ' g', 1], ['Sugars', 'sugar', ' g', 1],
    ['Fiber', 'fiber', ' g', 1], ['Fat', 'fat', ' g', 1], ['Sat. fat', 'sat', ' g', 1], ['Sodium', 'sodium', ' mg', 1000]];
  const f = (o, k, u, m) => o && o[k] != null && o[k] !== '' ? (m === 1 ? r1(o[k]) : Math.round(o[k] * m)) + u : '–';
  return `<table><tr><th></th><th class="r">Per ${per}</th>${b ? `<th class="r">Per serving${p.serving ? ` (${esc(p.serving)})` : ''}</th>` : ''}</tr>
    ${rows.map(([l, k, u, m]) => `<tr><td>${l}</td><td class="r">${f(a, k, u, m)}</td>${b ? `<td class="r">${f(b, k, u, m)}</td>` : ''}</tr>`).join('')}</table>`;
}
function pantryLine(p) {
  const now = C.pantryNow(p, S.pantry[p.code], today());
  return `<div class="row" style="margin-top:10px"><div class="mute">🏠 In pantry: <b>${r1(now.onHand)}</b> pack${r1(now.onHand) === 1 ? '' : 's'}${now.daysLeft != null && now.onHand > 0 ? ` · about ${fmtDays(now.daysLeft)} left` : ''}</div>
    <div class="qty"><button class="ghost sm" data-act="pAdj" data-code="${esc(p.code)}" data-d="-1">−</button><button class="ghost sm" data-act="pAdj" data-code="${esc(p.code)}" data-d="1">+</button></div></div>`;
}

// ================= full product card =================
function renderProduct(code) {
  curCode = code; curQuick = false;
  const p = S.products[code]; if (!p) return;
  const openIds = [...document.querySelectorAll('#result details[open]')].map(d => d.id);
  const st = stats(code), v = C.verdict(st), inList = S.list.find(i => i.code === code);
  const u = p.size ? p.size.unit : null;
  const stock = st && p.target && packPrice(st.best) <= p.target;
  const alt = C.cheaperAlt(S, ix(), p), swap = C.healthierSwap(S, ix(), p), sc = C.saleCycle(ix(), code);
  const [sAmt, sUnit] = C.sizeEditDefault(p.size);
  const groups = [...new Set(Object.values(S.products).map(x => x.group).filter(Boolean))].sort();

  $('#result').innerHTML = `
  <div class="card">
    <div class="prod">${img(p)}
      <div class="grow">
        <h2>${esc(p.name)}</h2>
        <div class="mute">${esc([p.brand, p.size ? fmtSize(p.size) : p.qtyText].filter(Boolean).join(' · '))}</div>
        <div class="mute">${p.group ? `Group: ${esc(p.group)} · ` : ''}#${esc(code)}</div>
      </div>
    </div>
    <div class="chips">${p.pending ? '<span class="chip mid">⏳ Will look up when online</span>' : ''}${healthChips(p)}${inList ? `<span class="chip">On list ×${inList.qty}${inList.done ? ' · in cart' : ''}</span>` : ''}</div>
    ${p.allergens ? `<div class="mute" style="margin-top:6px"><b class="warn">Allergens:</b> ${esc(p.allergens)}</div>` : ''}

    <div class="deal">
      ${st ? `
        <div class="row" style="align-items:flex-end">
          <div><div class="mute">Best price you've logged</div><div class="big">${money(packPrice(st.best))}</div>
            <div class="mute">${esc(st.best.store)} · ${fmtDate(st.best.date)}${st.best.packs > 1 ? ` · ${st.best.packs} for ${money(st.best.price)}` : ''}</div></div>
          <div style="text-align:right">${u ? `<div class="unit">${fmtUnit(entryUnit(st.best), u)}</div>` : '<div class="mute">Set a size to see the unit price</div>'}</div>
        </div>
        <div class="chips">
          ${stock ? `<span class="chip good">🔥 STOCK UP: at or below ${money(p.target)}</span>` : ''}
          ${v ? `<span class="chip ${v.cls}">${v.t}</span>` : ''}
          ${st.best.sale ? '<span class="chip good">On sale</span>' : ''}
          ${st.es.length > 1 ? `<span class="chip">Range ${money(st.min)}–${money(st.max)} · ${st.es.length} logged</span>` : ''}
        </div>
        ${st.latest.length > 1 ? `<table>${st.latest.map((e, i) => `<tr><td>${i === 0 ? '🏆 ' : ''}${esc(e.store)}${e.sale ? ' 🏷️' : ''}</td><td class="r">${money(packPrice(e))}</td><td class="r">${u ? fmtUnit(entryUnit(e), u) : ''}</td></tr>`).join('')}</table>` : ''}
        ${sc ? `<div class="mute" style="margin-top:8px">🏷️ ${sc.gap ? `On sale about every ${fmtDays(sc.gap)}; next sale likely around <b>${fmtDate(sc.next)}</b>` : `Last seen on sale ${fmtDate(sc.last)}`}</div>` : ''}
        ${valueLine(p, packPrice(st.best)) ? `<div class="mute" style="margin-top:8px">${valueLine(p, packPrice(st.best))}</div>` : ''}
      ` : `<div class="mute">No prices yet. Log one below to start tracking deals.</div>`}
      ${alt ? `<div class="hint">💡 ${swap && swap.opt.p.code === alt.alt.p.code ? '🥗 Cheaper <b>and</b> healthier' : 'Cheaper'} in "${esc(p.group)}": ${esc(alt.alt.p.name)} ${esc(fmtSize(alt.alt.p.size))} at ${esc(alt.alt.e.store)} for ${fmtUnit(alt.alt.u, u)} (${Math.round((1 - alt.alt.u / alt.mine) * 100)}% less per ${unitLabel(u)})</div>` : ''}
      ${swap && !(alt && swap.opt.p.code === alt.alt.p.code) ? `<div class="hint">🥗 Healthier pick at about the same price: ${esc(swap.opt.p.name)}${swap.opt.p.ns ? ` (Nutri-Score ${swap.opt.p.ns.toUpperCase()})` : ''} at ${esc(swap.opt.e.store)}, ${fmtUnit(swap.opt.u, u)}</div>` : ''}
    </div>
    ${pantryLine(p)}

    <label>Log the price you see</label>
    <div class="row"><select id="pStore" data-chg="storeSel">${storeOptions(defaultStore(), true)}</select><input id="pPrice" type="number" step="0.01" inputmode="decimal" placeholder="Price $"></div>
    <input id="pNewStore" class="hide" placeholder="Store name" style="margin-top:8px">
    <div class="row" style="margin-top:8px">
      <div class="row" style="flex:1.3"><span class="mute none">for</span><input id="pPacks" type="number" min="1" value="1" inputmode="numeric" style="max-width:70px"><span class="mute">pack(s)</span></div>
      <label class="inline" style="flex:1"><input type="checkbox" id="pSale"> On sale</label>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="ghost" data-act="logPrice">Log price</button>
      <button data-act="add" data-code="${esc(code)}">${inList ? '＋ One more' : 'Add to list'}</button>
    </div>
    <button class="ghost wide" data-act="next" style="margin-top:8px">📷 Scan next</button>

    <details id="d-bulk" ${!p.size || !p.group ? 'open' : ''}>
      <summary>📦 Bulk check & stock-up settings</summary>
      <div class="grid2">
        <div><label>Package size</label><input data-chg="set" id="sAmt" type="number" step="any" inputmode="decimal" value="${esc(sAmt)}"></div>
        <div><label>Unit</label><select data-chg="set" id="sUnit">${Object.keys(C.EDIT_UNITS).map(k => `<option ${k === sUnit ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
      </div>
      <label>Compare group (same item, other sizes and brands)</label>
      <input data-chg="set" id="sGroup" list="grpList" value="${esc(p.group || '')}" placeholder="e.g. Eggs">
      <datalist id="grpList">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      <div class="grid2">
        <div><label>Stock-up price ($/pack)</label><input data-chg="set" id="sTarget" type="number" step="0.01" inputmode="decimal" value="${esc(p.target || '')}" placeholder="alert at/below"></div>
        <div><label>Packs I use per month</label><input data-chg="set" id="sUse" type="number" step="any" inputmode="decimal" value="${esc(p.use || '')}"></div>
        <div><label>Shelf life (days)</label><input data-chg="set" id="sShelf" type="number" inputmode="numeric" value="${esc(p.shelf || '')}" placeholder="optional"></div>
        <div><label>Packs I'm buying</label><input data-chg="set" id="sBuy" type="number" min="1" inputmode="numeric" value="${esc(p.buy || 1)}"></div>
      </div>
      <div class="deal">${bulkHTML(p)}</div>
    </details>

    <details id="d-nutr"><summary>🥗 Nutrition facts</summary>${nutrTable(p)}</details>
    ${p.ingr ? `<details id="d-ingr"><summary>Ingredients</summary><div class="mute">${esc(p.ingr)}</div></details>` : ''}
    ${st ? `<details id="d-hist"><summary>🧾 Price history (${st.es.length})</summary><table>
      ${st.es.slice().reverse().map(e => `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.store)}${e.sale ? ' 🏷️' : ''}</td><td class="r">${money(packPrice(e))}${e.packs > 1 ? `<div class="mute">${e.packs} for ${money(e.price)}</div>` : ''}</td><td class="r"><button class="x" data-act="delPrice" data-id="${e.id}" aria-label="Delete">✕</button></td></tr>`).join('')}
    </table></details>` : ''}
    <details id="d-edit"><summary>✏️ Edit name / remove</summary>
      <label>Name</label><input data-chg="set" id="sName" value="${esc(p.name)}">
      <button class="ghost sm" data-act="delProduct" data-code="${esc(code)}" style="margin-top:10px;color:var(--bad)">Delete this item and its prices</button>
    </details>
  </div>`;
  openIds.forEach(id => { const d = document.getElementById(id); if (d) d.open = true; });
}

// ================= in-store quick card =================
function renderQuick(code) {
  curCode = code; curQuick = true;
  const p = S.products[code]; if (!p) return;
  const store = S.trip.store, tp = C.tripPrice(ix(), code, store), st = stats(code), v = C.verdict(st);
  const it = S.list.find(i => i.code === code);
  const u = p.size && p.size.unit;
  const alt = C.cheaperAlt(S, ix(), p);
  const stock = st && p.target && packPrice(st.best) <= p.target;
  $('#result').innerHTML = `
  <div class="card">
    <div class="prod compact">${img(p)}
      <div class="grow"><h2>${esc(p.name)}</h2>
        <div class="mute">${esc([p.brand, p.size ? fmtSize(p.size) : p.qtyText].filter(Boolean).join(' · '))}</div>
        <div class="chips">${p.pending ? '<span class="chip mid">⏳ offline</span>' : ''}${healthChips(p, true)}</div>
      </div>
    </div>
    <div class="chips">
      ${it ? `<span class="chip good">✓ On your list ×${it.qty}</span>` : '<span class="chip">Not on your list</span>'}
      ${stock ? '<span class="chip good">🔥 Stock-up price</span>' : ''}
      ${v ? `<span class="chip ${v.cls}">${v.t}</span>` : ''}
      ${tp && !tp.here ? `<span class="chip">Best: ${money(packPrice(st.best))} at ${esc(st.best.store)}</span>` : ''}
    </div>
    ${alt ? `<div class="hint">💡 ${esc(alt.alt.p.name)} ${esc(fmtSize(alt.alt.p.size))} at ${esc(alt.alt.e.store)} is ${Math.round((1 - alt.alt.u / alt.mine) * 100)}% cheaper per ${unitLabel(u)}</div>` : ''}
    <label>Price here at ${esc(store)}${tp && tp.here ? ` (last ${money(tp.price)})` : ''}</label>
    <div class="row">
      <input id="qPrice" class="price-in" type="number" step="0.01" inputmode="decimal" placeholder="$0.00" value="${tp && tp.here ? tp.price.toFixed(2) : ''}">
      <div class="none" style="width:96px"><input id="qQty" type="number" min="1" inputmode="numeric" value="${it ? it.qty : 1}" aria-label="Quantity"><div class="mute" style="text-align:center;font-size:12px">qty</div></div>
    </div>
    <div class="row" style="margin-top:8px"><label class="inline"><input type="checkbox" id="qSale"> On sale</label><span class="mute" id="qUnit" style="text-align:right">${tp && tp.here && u ? fmtUnit(tp.price / p.size.amt, u) : ''}</span></div>
    <button class="wide" data-act="qCart" style="margin-top:10px">✓ Put in cart</button>
    <div class="row" style="margin-top:8px">
      <button class="ghost sm" data-act="qLog">Log only</button>
      <button class="ghost sm" data-act="qSkip">Skip</button>
      <button class="ghost sm" data-act="qMore">Details</button>
    </div>
  </div>`;
  const pi = $('#qPrice');
  pi.oninput = () => { const v = parseFloat(pi.value); $('#qUnit').textContent = v > 0 && u ? fmtUnit(v / p.size.amt, u) : ''; };
  if (!(tp && tp.here)) setTimeout(() => pi.focus(), 50);
}
function renderTripBar() {
  const el = $('#tripBar');
  if (S.trip.active) {
    const cart = S.list.filter(i => i.done);
    const sum = cart.reduce((s, i) => { const tp = C.tripPrice(ix(), i.code, S.trip.store); return s + (tp ? tp.price * i.qty : 0); }, 0);
    const left = S.list.filter(i => !i.done).length;
    el.innerHTML = `<div class="trip"><div class="grow">🛒 Shopping at <b>${esc(S.trip.store)}</b><br>${cart.length} in cart · ${money(sum)}${left ? ` · ${left} still to get` : ''}</div><button data-act="tripCheckout">Checkout</button></div>`;
  } else {
    el.innerHTML = `<div class="card"><div class="row"><div class="grow"><b>🛒 At the store?</b><div class="mute">In-store mode keeps the camera running. Each scan checks the item off your list and logs its price in a couple of taps.</div></div></div>
      <div class="row" style="margin-top:10px"><select id="tripStore">${storeOptions(defaultStore())}</select><button class="none" data-act="tripStart">Start</button></div></div>`;
  }
}
function renderUnknown(code) {
  $('#result').innerHTML = `
  <div class="card">
    <h3>Not in Open Food Facts</h3>
    <div class="mute">#${esc(code)}: name it once and the app will remember it.</div>
    <label>Product name</label><input id="uName" placeholder="e.g. Kirkland eggs 24ct">
    <div class="grid2">
      <div><label>Package size</label><input id="uAmt" type="number" step="any" inputmode="decimal"></div>
      <div><label>Unit</label><select id="uUnit">${Object.keys(C.EDIT_UNITS).map(k => `<option>${k}</option>`).join('')}</select></div>
    </div>
    <div class="row" style="margin-top:12px"><button data-act="saveUnknown" data-code="${esc(code)}">Save item</button><button class="ghost" data-act="next">${S.trip.active ? 'Skip' : 'Scan next'}</button></div>
    <div class="mute" style="margin-top:10px">You can also add it for everyone at <a href="https://world.openfoodfacts.org/cgi/product.pl?code=${esc(code)}" target="_blank" rel="noopener noreferrer">openfoodfacts.org</a>.</div>
  </div>`;
  setTimeout(() => $('#uName')?.focus(), 50);
}

// ================= list =================
function listRow(it, st) {
  const p = S.products[it.code] || { name: it.code }; const e = st && st.best;
  const alt = !it.done && C.cheaperAlt(S, ix(), p);
  return `<div class="item ${it.done ? 'done' : ''}">
    <input type="checkbox" class="chk" data-chg="toggle" data-code="${esc(it.code)}" ${it.done ? 'checked' : ''} aria-label="In cart">
    ${img(p)}
    <div class="grow" data-act="open" data-code="${esc(it.code)}">
      <div class="name">${esc(p.name)}</div>
      <div class="mute">${e ? `${money(packPrice(e))} ea${p.size ? ' · ' + fmtUnit(entryUnit(e), p.size.unit) : ''}${e.sale ? ' · 🏷️' : ''}` : 'no price yet'}${p.size ? ' · ' + esc(fmtSize(p.size)) : ''}</div>
      ${alt ? `<div class="hint">💡 ${esc(alt.alt.p.name)} at ${esc(alt.alt.e.store)} costs ${Math.round((1 - alt.alt.u / alt.mine) * 100)}% less per ${unitLabel(p.size.unit)}</div>` : ''}
    </div>
    <div class="qty"><button class="ghost sm" data-act="dec" data-code="${esc(it.code)}" aria-label="Less">−</button><span>${it.qty}</span><button class="ghost sm" data-act="inc" data-code="${esc(it.code)}" aria-label="More">+</button></div>
  </div>`;
}
function renderList() {
  const done = S.list.filter(i => i.done);
  if (!S.list.length) {
    $('#listItems').innerHTML = `<div class="mute" style="padding:14px 0">Your list is empty. Scan something, or add items that are running low from the Pantry tab.</div>`;
    $('#listTotal').textContent = '$0.00'; $('#oneStop').classList.add('hide'); $('#checkout').classList.add('hide'); return;
  }
  const plan = C.planList(S, ix());
  let html = '';
  for (const g of plan.groups) {
    html += `<div class="storehdr"><span>${g.store ? '📍 ' + esc(g.store) : '❔ No price yet'}</span><span>${g.store ? money(g.sub) : ''}</span></div>`;
    html += g.items.map(({ it, st }) => listRow(it, st)).join('');
  }
  if (done.length) html += `<div class="storehdr" style="border-color:var(--line)"><span>✅ In cart</span><span></span></div>` + done.map(it => listRow(it, stats(it.code))).join('');
  $('#listItems').innerHTML = html;
  $('#listTotal').textContent = money(plan.total);

  // checkout
  const co = $('#checkout');
  if (done.length) {
    const store = defaultStore();
    const sum = done.reduce((s, i) => { const tp = C.tripPrice(ix(), i.code, store); return s + (tp ? tp.price * i.qty : 0); }, 0);
    co.classList.remove('hide');
    co.innerHTML = `<h3>✅ Checkout</h3>
      <div class="mute">${done.length} item${done.length > 1 ? 's' : ''} in your cart, about ${money(sum)}. Finishing records what you spent, adds the items to your pantry and clears them from the list.</div>
      <div class="row" style="margin-top:10px"><select id="coStore">${storeOptions(store)}</select><button class="none" data-act="finishTrip">Finish trip</button></div>`;
  } else co.classList.add('hide');

  // one-stop vs split
  const os = $('#oneStop');
  if (!plan.oneStop.length || !S.list.some(i => !i.done)) { os.classList.add('hide'); return; }
  os.classList.remove('hide');
  os.innerHTML = `<h3>🧭 Split the trip or shop one store?</h3>
    <div class="mute">Shopping the plan above takes ${plan.storesUsed} store${plan.storesUsed === 1 ? '' : 's'} and costs <b>${money(plan.total)}</b>${plan.unpriced ? ` plus ${plan.unpriced} unpriced item${plan.unpriced > 1 ? 's' : ''}` : ''}.</div>
    ${plan.splitSaves ? `<div class="hint" style="font-size:14px">Splitting saves <b>${money(plan.splitSaves.amt)}</b> compared with doing everything at ${esc(plan.splitSaves.store)}.</div>` : ''}
    <table><tr><th>Everything at…</th><th class="r">Total</th></tr>
    ${plan.oneStop.map(r => `<tr><td>${esc(r.store)}${r.miss ? `<div class="mute">${r.miss} item${r.miss > 1 ? 's' : ''} without a price there</div>` : ''}</td><td class="r">${money(r.sum)}</td></tr>`).join('')}</table>`;
}

// ================= pantry =================
function renderPantry() {
  const a = C.pantryAlerts(S, today());
  const onList = code => S.list.some(i => i.code === code && !i.done);
  const addBtn = code => onList(code) ? '<span class="chip good">On list</span>' : `<button class="sm none" data-act="add" data-code="${esc(code)}">＋ List</button>`;
  let html = '';
  if (!Object.keys(S.pantry).length) {
    html = `<div class="card"><h3>🏠 Pantry</h3><div class="mute">Track your bulk stock here. Items are added when you <b>Finish trip</b> on the List tab, or with the + button on any item's page.<br><br>Set <b>packs I use per month</b> on an item and the app estimates how much is left, warns you before you run out, and tells you what to use first before it expires.</div></div>`;
  } else {
    if (a.low.length) html += `<div class="card"><div class="row"><h3 class="grow">⚠️ Running low</h3>${a.low.some(x => !onList(x.p.code)) ? '<button class="sm none" data-act="addLow">Add all to list</button>' : ''}</div>
      ${a.low.map(({ p, now }) => `<div class="item">${img(p)}<div class="grow" data-act="open" data-code="${esc(p.code)}"><div class="name">${esc(p.name)}</div>
        <div class="mute ${now.onHand <= 0 ? 'warn' : ''}">${now.onHand <= 0 ? 'Probably out' : `About ${fmtDays(now.daysLeft)} left (${r1(now.onHand)} pack${r1(now.onHand) === 1 ? '' : 's'})`}</div></div>${addBtn(p.code)}</div>`).join('')}</div>`;
    if (a.expiring.length) html += `<div class="card"><h3>⏰ Use soon</h3>
      ${a.expiring.map(({ p, lot }) => `<div class="item">${img(p)}<div class="grow" data-act="open" data-code="${esc(p.code)}"><div class="name">${esc(p.name)}</div>
        <div class="mute ${lot.daysToExpiry < 0 ? 'warn' : ''}">${r1(lot.qty)} pack${r1(lot.qty) === 1 ? '' : 's'} bought ${fmtDate(lot.date)} · ${lot.daysToExpiry < 0 ? `expired ${fmtDays(-lot.daysToExpiry)} ago` : lot.daysToExpiry < 1 ? 'expires today' : `expires in ${fmtDays(lot.daysToExpiry)}`}</div></div></div>`).join('')}</div>`;
    const lowDays = S.settings.lowDays || 7;
    html += `<div class="card"><h3>🏠 On hand</h3>${a.onHand.length ? a.onHand.map(({ p, now }) => {
      const pct = now.daysLeft != null ? Math.min(1, now.daysLeft / 45) : null;
      return `<div class="item">${img(p)}<div class="grow" data-act="open" data-code="${esc(p.code)}"><div class="name">${esc(p.name)}</div>
        <div class="mute">${r1(now.onHand)} pack${r1(now.onHand) === 1 ? '' : 's'}${now.daysLeft != null ? ` · ~${fmtDays(now.daysLeft)} left` : ' · set packs/month to track'}</div>
        ${pct != null ? `<div class="bar ${now.daysLeft <= lowDays ? 'low' : ''}"><i style="width:${Math.max(3, pct * 100)}%"></i></div>` : ''}</div>
        <div class="qty"><button class="ghost sm" data-act="pAdj" data-code="${esc(p.code)}" data-d="-1" aria-label="Used one">−</button><button class="ghost sm" data-act="pAdj" data-code="${esc(p.code)}" data-d="1" aria-label="Add one">+</button></div></div>`;
    }).join('') : '<div class="mute">Nothing on hand.</div>'}</div>`;
  }
  $('#pantryBody').innerHTML = html;
}

// ================= deals =================
function renderDeals() {
  // spending
  const ym = today().slice(0, 7);
  const m = C.monthSummary(S, ym);
  const prev = [1, 2].map(k => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); return C.monthSummary(S, todayISO(d).slice(0, 7)); }).filter(x => x.count);
  const monthName = ym => new Date(ym + '-15T12:00').toLocaleDateString(undefined, { month: 'long' });
  $('#spendCard').innerHTML = `<h3>💵 ${monthName(ym)} spending</h3>${S.purchases.length ? `
    <div class="stats3"><div class="stat"><b>${money(m.spent)}</b><span>spent</span></div><div class="stat"><b class="${m.saved >= 0 ? 'ok' : 'warn'}">${money(Math.abs(m.saved))}</b><span>${m.saved >= 0 ? 'saved vs usual' : 'over usual'}</span></div><div class="stat"><b>${m.count}</b><span>items</span></div></div>
    ${Object.keys(m.byStore).length ? `<table>${Object.entries(m.byStore).sort((a, b) => b[1] - a[1]).map(([s, v]) => `<tr><td>${esc(s)}</td><td class="r">${money(v)}</td></tr>`).join('')}</table>` : ''}
    ${prev.map(x => `<div class="mute" style="margin-top:6px">${monthName(x.ym)}: ${money(x.spent)} spent · ${money(x.saved)} saved</div>`).join('')}
    ${m.unpriced ? `<div class="mute" style="margin-top:6px">${m.unpriced} item${m.unpriced > 1 ? 's' : ''} had no price logged.</div>` : ''}`
    : '<div class="mute">Finish a trip from the List tab to track what you spend and how much you save compared with your usual prices.</div>'}`;

  const al = dealAlerts();
  $('#alerts').innerHTML = al.length ? al.map(({ p, st, why, cls, b }) => `<div class="item">${img(p)}
      <div class="grow" data-act="open" data-code="${esc(p.code)}"><div class="name">${esc(p.name)}</div>
        <div class="mute">${money(b)} at ${esc(st.best.store)}${p.size ? ' · ' + fmtUnit(entryUnit(st.best), p.size.unit) : ''}</div>
        <div class="chips"><span class="chip ${cls}">${why}</span></div></div>
      ${S.list.some(i => i.code === p.code && !i.done) ? '<span class="chip good">On list</span>' : `<button class="sm none" data-act="add" data-code="${esc(p.code)}" aria-label="Add to list">＋</button>`}</div>`).join('')
    : `<div class="mute" style="padding:10px 0">No alerts yet. Set a stock-up price on the items you buy in bulk.</div>`;

  const groups = [...new Set(Object.values(S.products).map(x => x.group).filter(Boolean))].sort();
  const sel = $('#grpSel'), cur = sel.value || S.settings.lastGroup || groups[0] || '';
  sel.innerHTML = groups.length ? groups.map(g => `<option ${g === cur ? 'selected' : ''}>${esc(g)}</option>`).join('') : '<option value="">No groups yet</option>';
  renderGroup(sel.value);
  renderRecent();
}
function renderGroup(g) {
  if (!g) { $('#grpTable').innerHTML = ''; return; }
  let html = '';
  for (const u of ['g', 'ml', 'ct']) {
    const opts = C.groupOptions(S, ix(), g, u); if (!opts.length) continue;
    const min = opts[0].u;
    const rated = opts.filter(o => C.hasHealthData(o.p));
    const healthiest = rated.length > 1 ? Math.min(...rated.map(o => C.healthScore(o.p))) : null;
    html += `<table><tr><th>Item · store</th><th class="r">Pack</th><th class="r">Per ${unitLabel(u)}</th></tr>
      ${opts.map((o, i) => `<tr data-act="open" data-code="${esc(o.p.code)}">
        <td>${i === 0 ? '🏆 ' : ''}${healthiest != null && C.healthScore(o.p) === healthiest ? '🥗 ' : ''}<b>${esc(o.p.name)}</b> ${esc(fmtSize(o.p.size))}<div class="mute">${esc(o.e.store)} · ${fmtDate(o.e.date)}${o.e.sale ? ' · 🏷️' : ''}</div>
          <div class="chips">${o.p.ns && 'abcde'.includes(o.p.ns) ? `<span class="chip ns-${o.p.ns}">${o.p.ns.toUpperCase()}</span>` : ''}${o.p.nova == 4 ? '<span class="chip bad">Ultra-processed</span>' : ''}</div></td>
        <td class="r">${money(packPrice(o.e))}</td>
        <td class="r"><b>${fmtUnit(o.u, u)}</b>${i ? `<div class="mute">+${Math.round((o.u / min - 1) * 100)}%</div>` : ''}</td></tr>`).join('')}</table>`;
  }
  const unpriced = Object.values(S.products).filter(p => p.group === g && (!p.size || !stats(p.code)));
  if (unpriced.length) html += `<div class="mute" style="margin-top:8px">Missing a size or price: ${unpriced.map(p => esc(p.name)).join(', ')}</div>`;
  $('#grpTable').innerHTML = html || '<div class="mute">No priced items in this group yet.</div>';
}
$('#grpSel').onchange = e => { S.settings.lastGroup = e.target.value; save(); renderGroup(e.target.value); };
function renderRecent() {
  const q = ($('#logSearch').value || '').toLowerCase();
  const es = S.prices.slice().reverse().sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
    .filter(e => { const p = S.products[e.code] || {}; return !q || ((p.name || '') + ' ' + e.store).toLowerCase().includes(q); }).slice(0, 40);
  $('#recent').innerHTML = es.length ? `<table>${es.map(e => { const p = S.products[e.code] || { name: e.code };
    return `<tr><td data-act="open" data-code="${esc(e.code)}"><b>${esc(p.name)}</b><div class="mute">${esc(e.store)} · ${fmtDate(e.date)}${e.sale ? ' · 🏷️' : ''}</div></td>
      <td class="r">${money(packPrice(e))}${p.size ? `<div class="mute">${fmtUnit(entryUnit(e), p.size.unit)}</div>` : ''}</td>
      <td class="r"><button class="x" data-act="delPrice" data-id="${e.id}" aria-label="Delete">✕</button></td></tr>`; }).join('')}</table>`
    : '<div class="mute" style="padding:10px 0">No prices logged yet.</div>';
}
$('#logSearch').oninput = renderRecent;

// ================= more =================
function renderMore() {
  $('#storeList').innerHTML = S.stores.map((s, i) => `<span class="chip" style="display:inline-flex;align-items:center;margin:0 6px 6px 0;font-weight:600">${esc(s)}<button class="x" data-act="delStore" data-i="${i}" aria-label="Remove ${esc(s)}">✕</button></span>`).join('');
  const q = ($('#bookSearch').value || '').toLowerCase();
  const items = Object.values(S.products).filter(p => !q || (p.name + ' ' + (p.brand || '') + ' ' + (p.group || '')).toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  $('#bookItems').innerHTML = items.length ? items.map(p => { const st = stats(p.code);
    return `<div class="item" data-act="open" data-code="${esc(p.code)}">${img(p)}
      <div class="grow"><div class="name">${esc(p.name)}</div><div class="mute">${esc([p.group, p.size && fmtSize(p.size)].filter(Boolean).join(' · '))}${st ? ` · best ${money(packPrice(st.best))} @ ${esc(st.best.store)}` : ''}</div></div></div>`; }).join('')
    : '<div class="mute" style="padding:10px 0">Nothing scanned yet.</div>';
  $('#setLowDays').value = S.settings.lowDays || 7;
  $('#version').textContent = `Version ${VERSION} · ${Object.keys(S.products).length} items · ${S.prices.length} prices`;
}
$('#bookSearch').oninput = renderMore;
$('#setLowDays').onchange = e => { S.settings.lowDays = Math.max(1, parseInt(e.target.value) || 7); save(); };
$('#storeForm').onsubmit = e => { e.preventDefault(); const n = $('#storeName').value.trim(); if (n && !S.stores.includes(n)) { S.stores.push(n); save(); } $('#storeName').value = ''; renderMore(); };

// ================= actions =================
function addToList(code, qty = 1) {
  const it = S.list.find(i => i.code === code);
  if (it) { it.qty += qty; it.done = false; } else S.list.push({ code, qty, done: false });
  save(); toast('Added to list');
}
function logPrice(code, store, price, packs = 1, sale = false) {
  const e = { id: C.uid(), code, store, price, packs, sale, date: today() };
  if (C.isDuplicate(S, e)) return false;
  S.prices.push(e); S.settings.lastStore = store; save(); return true;
}
function afterQuick() { $('#result').innerHTML = ''; curCode = null; renderTripBar(); resumeCam(); }
function rerenderCurrent() {
  const v = view();
  if (v === 'scan') { renderTripBar(); if (curCode && S.products[curCode]) (curQuick ? renderQuick : renderProduct)(curCode); }
  else ({ list: renderList, pantry: renderPantry, deals: renderDeals, more: renderMore })[v]();
}
const ACT = {
  open: d => { show('scan'); renderProduct(d.code); },
  add: d => { addToList(d.code); rerenderCurrent(); },
  inc: d => { const it = S.list.find(i => i.code === d.code); it.qty++; save(); renderList(); },
  dec: d => { const i = S.list.findIndex(x => x.code === d.code); if (--S.list[i].qty <= 0) S.list.splice(i, 1); save(); renderList(); },
  next: () => { $('#result').innerHTML = ''; curCode = null; window.scrollTo(0, 0); resumeCam(); },
  clearList: (d, btn) => {
    if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Tap again to clear'; return; }
    S.list = []; save(); renderList();
  },
  copyList: async () => {
    const plan = C.planList(S, ix()); const lines = [];
    for (const g of plan.groups) { lines.push((g.store || 'Other').toUpperCase()); g.items.forEach(({ it }) => lines.push(`- ${it.qty}× ${(S.products[it.code] || {}).name || it.code}`)); lines.push(''); }
    try { await navigator.clipboard.writeText(lines.join('\n').trim()); toast('List copied'); } catch (e) { toast("Couldn't copy"); }
  },
  logPrice: () => {
    const code = curCode; if (!code) return;
    let store = $('#pStore').value;
    if (store === '__new') { store = $('#pNewStore').value.trim(); if (!store) return toast('Enter a store name'); if (!S.stores.includes(store)) S.stores.push(store); }
    const price = parseFloat($('#pPrice').value); if (!(price > 0)) return toast('Enter a price');
    const packs = Math.max(1, parseInt($('#pPacks').value) || 1);
    if (!logPrice(code, store, price, packs, $('#pSale').checked)) return toast('Already logged today');
    const v = C.verdict(stats(code));
    toast(`Logged ${money(price / packs)} at ${store}` + (v ? ` · ${v.t}` : ''));
    renderProduct(code);
  },
  qCart: () => {
    const code = curCode, qty = Math.max(1, parseInt($('#qQty').value) || 1), price = parseFloat($('#qPrice').value);
    if (price > 0) logPrice(code, S.trip.store, price, 1, $('#qSale').checked);
    const it = S.list.find(i => i.code === code);
    if (it) { it.qty = qty; it.done = true; } else S.list.push({ code, qty, done: true });
    save(); toast(`✓ ${S.products[code]?.name || 'Item'} in cart`); afterQuick();
  },
  qLog: () => {
    const price = parseFloat($('#qPrice').value); if (!(price > 0)) return toast('Enter a price');
    toast(logPrice(curCode, S.trip.store, price, 1, $('#qSale').checked) ? `Logged ${money(price)}` : 'Already logged today'); afterQuick();
  },
  qSkip: () => afterQuick(),
  qMore: () => renderProduct(curCode),
  tripStart: () => {
    S.trip = { active: true, store: $('#tripStore').value, started: today() }; S.settings.lastStore = S.trip.store;
    save(); renderTripBar(); $('#result').innerHTML = ''; startCam();
    toast(`In-store mode at ${S.trip.store}. Scan as you shop.`);
  },
  tripCheckout: () => show('list'),
  finishTrip: () => {
    const store = $('#coStore').value, done = S.list.filter(i => i.done);
    let saved = 0, spent = 0;
    for (const it of done) {
      const x = C.makePurchase(ix(), it.code, it.qty, store, today());
      S.purchases.push(x); saved += x.saved || 0; spent += (x.packPrice || 0) * it.qty;
      S.pantry[it.code] = C.pantryAdd(S.products[it.code], S.pantry[it.code], it.qty, today());
    }
    S.list = S.list.filter(i => !i.done);
    S.trip = { active: false, store: null }; S.settings.lastStore = store;
    save(); stopCam(); renderList();
    toast(`Recorded ${done.length} item${done.length > 1 ? 's' : ''} · ${money(spent)}${saved > 0.005 ? ` · saved ${money(saved)}` : ''}`);
  },
  pAdj: d => {
    const p = S.products[d.code]; const ent = C.pantryAdjust(p, S.pantry[d.code], +d.d, today());
    if (ent) S.pantry[d.code] = ent; else delete S.pantry[d.code];
    save(); rerenderCurrent();
  },
  addLow: () => {
    const a = C.pantryAlerts(S, today()); let n = 0;
    for (const { p } of a.low) if (!S.list.some(i => i.code === p.code && !i.done)) { S.list.push({ code: p.code, qty: Math.max(1, Math.ceil(p.buy || 1)), done: false }); n++; }
    save(); renderPantry(); toast(`Added ${n} item${n === 1 ? '' : 's'} to your list`);
  },
  delPrice: d => { S.prices = S.prices.filter(e => e.id !== d.id); save(); rerenderCurrent(); },
  delStore: d => { S.stores.splice(+d.i, 1); save(); renderMore(); },
  delProduct: (d, btn) => {
    if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Tap again to confirm'; return; }
    delete S.products[d.code]; delete S.pantry[d.code];
    S.prices = S.prices.filter(e => e.code !== d.code); S.list = S.list.filter(i => i.code !== d.code); S.pending = S.pending.filter(c => c !== d.code);
    save(); $('#result').innerHTML = ''; curCode = null; toast('Deleted');
  },
  saveUnknown: d => {
    const name = $('#uName').value.trim(); if (!name) return toast('Enter a name');
    const amt = parseFloat($('#uAmt').value), [unit, f] = C.EDIT_UNITS[$('#uUnit').value];
    S.products[d.code] = { code: d.code, name, custom: true, size: amt > 0 ? { amt: amt * f, unit } : null };
    save(); (S.trip.active ? renderQuick : renderProduct)(d.code);
  },
  csv: () => {
    const rows = [['Date', 'Store', 'Barcode', 'Item', 'Brand', 'Group', 'Size', 'Pack price', 'Packs', 'Total paid', 'On sale', 'Unit price', 'Per', 'Nutri-Score', 'NOVA', 'kcal/100', 'Protein/100']];
    for (const e of S.prices.slice().sort((a, b) => a.date < b.date ? -1 : 1)) {
      const p = S.products[e.code] || {}; const u = entryUnit(e);
      rows.push([e.date, e.store, e.code, p.name, p.brand, p.group, p.size ? fmtSize(p.size) : '', C.r2(packPrice(e)), e.packs, e.price, e.sale ? 'yes' : '',
        u != null ? C.perDisp(u, p.size.unit).toFixed(4) : '', p.size ? unitLabel(p.size.unit) : '', (p.ns || '').toUpperCase(), p.nova || '', p.n100?.kcal ?? '', p.n100?.protein ?? '']);
    }
    downloadCSV(`grocery-prices-${today()}.csv`, rows);
  },
  csvBuys: () => {
    const rows = [['Date', 'Store', 'Barcode', 'Item', 'Group', 'Qty', 'Pack price', 'Line total', 'Saved vs usual']];
    for (const x of S.purchases) { const p = S.products[x.code] || {}; rows.push([x.date, x.store, x.code, p.name, p.group, x.qty, x.packPrice ?? '', x.packPrice != null ? C.r2(x.packPrice * x.qty) : '', x.saved]); }
    downloadCSV(`grocery-purchases-${today()}.csv`, rows);
  },
  backup: () => download(`grocery-backup-${today()}.json`, JSON.stringify(S), 'application/json'),
  wipe: (d, btn) => {
    if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Tap again to erase everything'; return; }
    S = C.emptyState(); save(); renderMore(); toast('All data erased');
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const f = ACT[el.dataset.act]; if (f) { e.preventDefault(); f(el.dataset, el); }
});
document.addEventListener('change', e => {
  const el = e.target, k = el.dataset && el.dataset.chg; if (!k) return;
  if (k === 'toggle') { const it = S.list.find(i => i.code === el.dataset.code); it.done = el.checked; save(); renderList(); }
  if (k === 'storeSel') { $('#pNewStore').classList.toggle('hide', el.value !== '__new'); if (el.value === '__new') $('#pNewStore').focus(); }
  if (k === 'set') {
    const p = S.products[curCode]; if (!p) return;
    const num = id => { const v = parseFloat($(id).value); return v > 0 ? v : null; };
    const amt = num('#sAmt'), [unit, f] = C.EDIT_UNITS[$('#sUnit').value];
    // Changing usage rate must not rewrite how much was already consumed, so materialize the pantry first.
    if (S.pantry[curCode]) { const ent = C.pantryAdjust(p, S.pantry[curCode], 0, today()); if (ent) S.pantry[curCode] = ent; else delete S.pantry[curCode]; }
    p.size = amt ? { amt: amt * f, unit } : null;
    p.group = $('#sGroup').value.trim() || null;
    p.target = num('#sTarget'); p.use = num('#sUse'); p.shelf = num('#sShelf'); p.buy = Math.max(1, Math.round(num('#sBuy') || 1));
    const nm = $('#sName').value.trim(); if (nm && nm !== p.name) { p.name = nm; p.renamed = true; }
    save(); renderProduct(curCode);
  }
});
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const downloadCSV = (name, rows) => download(name, '\ufeff' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
$('#fileRestore').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  if (f.size > MAX_BACKUP_BYTES) { e.target.value = ''; return toast('That file is too large to be a backup'); }
  try { const o = JSON.parse(await f.text()); if (!o.products) throw 0; S = C.migrate(o); save(); renderMore(); toast('Restored'); }
  catch (err) { toast('Not a valid backup file'); }
  e.target.value = '';
};

// ================= boot =================
load();
renderTripBar();
refreshBadges();
setOnline();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
// Debug access from the console, only during local development.
if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__app = { get S() { return S; }, save, C };
