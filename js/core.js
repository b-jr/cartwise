// Pure logic for CartWise. No DOM access here, so all of it is unit-testable in Node.

// ---------- formatting ----------
export const money = n => '$' + (Number(n) || 0).toFixed(2);
export const r1 = x => Math.round(x * 10) / 10;
export const r2 = x => Math.round(x * 100) / 100;
export const uid = () => Math.random().toString(36).slice(2, 10);
export const todayISO = (d = new Date()) => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
export const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
export const fmtDays = d => d < 14 ? `${Math.max(0, Math.round(d))} day${Math.round(d) === 1 ? '' : 's'}` : d < 60 ? `${r1(d / 7)} weeks` : `${r1(d / 30.4)} months`;

// ---------- input safety ----------
// Product barcodes (EAN-8/13, UPC-A/E, GTIN-14) are digits only. Anything else (QR codes,
// CODE-128 with letters or slashes) is rejected before it reaches a URL.
export const isProductBarcode = s => typeof s === 'string' && /^\d{6,14}$/.test(s);
// Only show product photos served over HTTPS from Open Food Facts. This also covers data from a restored backup.
const IMG_HOSTS = /^(images|static|world)\.openfoodfacts\.(org|net)$/;
export function safeImageUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && IMG_HOSTS.test(x.hostname) ? x.href : ''; }
  catch { return ''; }
}

// ---------- sizes ----------
// Base units: g (weight), ml (volume), ct (count)
export const UNITS = [
  [/^(fl\.?\s?oz|fluid ounces?)$/, 'ml', 29.5735],
  [/^(oz|ounces?)$/, 'g', 28.3495],
  [/^(lbs?|pounds?)$/, 'g', 453.592],
  [/^(kg|kilos?|kilograms?)$/, 'g', 1000],
  [/^(g|gr|grams?)$/, 'g', 1],
  [/^(ml|millilit(?:er|re)s?)$/, 'ml', 1],
  [/^(cl)$/, 'ml', 10],
  [/^(l|lt|lit(?:er|re)s?)$/, 'ml', 1000],
  [/^(gal|gallons?)$/, 'ml', 3785.41],
  [/^(qt|quarts?)$/, 'ml', 946.353],
  [/^(pt|pints?)$/, 'ml', 473.176],
  [/^(ct|count|pcs?|pieces?|pk|pack|eggs?|each|ea|rolls?|bags?|cans?|bottles?|pods?|bars?)$/, 'ct', 1],
];
export function parseSize(txt) {
  if (!txt) return null;
  const t = String(txt).toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
  const re = /(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(fl\.?\s?oz|fluid ounces?|[a-z]+)/g;
  let m;
  while ((m = re.exec(t))) {
    for (const [rx, base, f] of UNITS) if (rx.test(m[3].trim()))
      return { amt: (m[1] ? +m[1] : 1) * parseFloat(m[2]) * f, unit: base };
  }
  return null;
}
export const EDIT_UNITS = { oz: ['g', 28.3495], lb: ['g', 453.592], g: ['g', 1], kg: ['g', 1000], 'fl oz': ['ml', 29.5735], ml: ['ml', 1], L: ['ml', 1000], gal: ['ml', 3785.41], ct: ['ct', 1] };
export function sizeEditDefault(s) {
  if (!s) return ['', 'oz'];
  if (s.unit === 'g') return [r2(s.amt / 28.3495), 'oz'];
  if (s.unit === 'ml') return [r2(s.amt / 29.5735), 'fl oz'];
  return [s.amt, 'ct'];
}
export function fmtSize(s) {
  if (!s) return '';
  if (s.unit === 'g') { const oz = s.amt / 28.3495; return oz >= 16 ? `${r1(oz / 16)} lb` : `${r1(oz)} oz`; }
  if (s.unit === 'ml') { const fl = s.amt / 29.5735; return fl >= 128 ? `${r1(fl / 128)} gal` : `${r1(fl)} fl oz`; }
  return `${Math.round(s.amt)} ct`;
}
export const unitLabel = u => u === 'g' ? 'oz' : u === 'ml' ? 'fl oz' : 'item';
export const perDisp = (perBase, u) => u === 'g' ? perBase * 28.3495 : u === 'ml' ? perBase * 29.5735 : perBase;
export function fmtUnit(perBase, u) {
  if (perBase == null || !isFinite(perBase)) return '';
  const v = perDisp(perBase, u);
  return (v < 1 ? (v * 100).toFixed(1) + '¢' : '$' + v.toFixed(2)) + '/' + unitLabel(u);
}

// ---------- state ----------
export function emptyState() {
  return {
    v: 3, products: {}, prices: [], list: [], purchases: [], pantry: {}, pending: [],
    stores: ['Costco', "Sam's Club", 'Smart & Final', 'Walmart', 'Aldi'],
    trip: { active: false, store: null },
    settings: { lowDays: 7 },
  };
}
// Accepts v1 or v2/v3 JSON and returns a v3 state.
export function migrate(raw, { today = todayISO() } = {}) {
  const S = emptyState();
  if (!raw || typeof raw !== 'object') return S;
  if (Array.isArray(raw.prices) || raw.v >= 2) {
    Object.assign(S, raw);
    S.settings = Object.assign({ lowDays: 7 }, raw.settings || {});
    S.trip = Object.assign({ active: false, store: null }, raw.trip || {});
    for (const k of ['purchases', 'pending', 'list', 'prices']) if (!Array.isArray(S[k])) S[k] = [];
    if (!S.pantry || typeof S.pantry !== 'object') S.pantry = {};
    S.v = 3;
    return S;
  }
  // v1: prices[code][store] = {price, date(locale string)}
  S.products = raw.products || {};
  S.list = raw.list || [];
  S.stores = [...new Set([...(raw.stores || []).filter(s => s !== 'Any store'), ...S.stores])];
  for (const [code, m] of Object.entries(raw.prices || {})) for (const [st, v] of Object.entries(m)) {
    const d = new Date(v.date); const iso = isNaN(d) ? today : d.toISOString().slice(0, 10);
    S.prices.push({ id: uid(), code, store: st === 'Any store' ? 'Unknown' : st, price: v.price, packs: 1, sale: false, date: iso });
  }
  for (const p of Object.values(S.products)) { p.qtyText = p.qtyText || p.qty; if (!p.size) p.size = parseSize(p.qtyText); delete p.nutr; delete p.qty; }
  return S;
}

// ---------- prices ----------
export const packPrice = e => e.price / (e.packs || 1);
export function entryUnit(S, e) { const p = S.products[e.code]; return p && p.size && p.size.amt ? packPrice(e) / p.size.amt : null; }
const byDate = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
export function buildIndex(S) {
  const m = new Map();
  for (const e of S.prices) { if (!m.has(e.code)) m.set(e.code, []); m.get(e.code).push(e); }
  for (const a of m.values()) a.sort(byDate);
  return m;
}
export function stats(idx, code) {
  const es = idx.get(code);
  if (!es || !es.length) return null;
  const pp = es.map(packPrice);
  const latestByStore = {}; for (const e of es) latestByStore[e.store] = e;
  const latest = Object.values(latestByStore).sort((a, b) => packPrice(a) - packPrice(b));
  return { es, min: Math.min(...pp), max: Math.max(...pp), avg: pp.reduce((a, b) => a + b, 0) / pp.length, best: latest[0], latest };
}
export function verdict(st) {
  if (!st || st.es.length < 2) return null;
  const b = packPrice(st.best);
  if (b <= st.min + 1e-9 && st.max > st.min + 1e-9) return { cls: 'good', t: "Lowest you've logged" };
  const pct = (st.avg - b) / st.avg;
  if (pct >= 0.08) return { cls: 'good', t: Math.round(pct * 100) + '% below your avg' };
  if (pct <= -0.08) return { cls: 'bad', t: Math.round(-pct * 100) + '% above your avg' };
  return { cls: 'mid', t: 'Typical price' };
}
// Does logging this price duplicate one already logged today at this store?
export function isDuplicate(S, e) {
  return S.prices.some(x => x.code === e.code && x.store === e.store && x.date === e.date && Math.abs(x.price - e.price) < 1e-9 && (x.packs || 1) === (e.packs || 1));
}
// Average days between sale sightings, and when the next one is likely.
export function saleCycle(idx, code) {
  const es = idx.get(code) || [];
  const dates = [...new Set(es.filter(e => e.sale).map(e => e.date))].sort();
  if (dates.length < 2) return dates.length ? { last: dates[0], gap: null, next: null } : null;
  const gaps = []; for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  const gap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const last = dates[dates.length - 1];
  return { last, gap, next: addDays(last, Math.round(gap)) };
}

// ---------- groups & comparisons ----------
export function groupOptions(S, idx, group, unit) {
  const out = [];
  if (!group) return out;
  for (const p of Object.values(S.products)) {
    if (p.group !== group || !p.size || p.size.unit !== unit) continue;
    const st = stats(idx, p.code); if (!st) continue;
    for (const e of st.latest) out.push({ p, e, u: entryUnit(S, e) });
  }
  return out.sort((a, b) => a.u - b.u);
}
export function cheaperAlt(S, idx, p) {
  if (!p.group || !p.size) return null;
  const st = stats(idx, p.code); const mine = st ? entryUnit(S, st.best) : Infinity;
  const alt = groupOptions(S, idx, p.group, p.size.unit).find(o => o.p.code !== p.code);
  return alt && alt.u < mine * 0.97 ? { alt, mine } : null;
}

// ---------- health ----------
const NS_RANK = { a: 1, b: 2, c: 3, d: 4, e: 5 };
// Lower is healthier. Unknown ratings rank in the middle.
export function healthScore(p) {
  const ns = NS_RANK[p.ns] || 3.5, nova = Number(p.nova) || 3;
  return ns * 10 + nova;
}
export function hasHealthData(p) { return !!(NS_RANK[p.ns] || p.nova); }
export function healthFlags(p) {
  const n = p.n100; if (!n) return [];
  const drink = p.size && p.size.unit === 'ml';
  const T = drink ? { fat: [1.5, 8.75], sat: [0.75, 2.5], sugar: [2.5, 11.25], salt: [0.3, 0.75] }
                  : { fat: [3, 17.5], sat: [1.5, 5], sugar: [5, 22.5], salt: [0.3, 1.5] };
  const V = { fat: n.fat, sat: n.sat, sugar: n.sugar, salt: n.sodium != null && n.sodium !== '' ? n.sodium * 2.5 : null };
  const N = { fat: 'Fat', sat: 'Sat fat', sugar: 'Sugar', salt: 'Salt' };
  const out = [];
  for (const k of ['sugar', 'salt', 'sat', 'fat']) {
    const v = V[k]; if (v == null || v === '') continue;
    const [lo, hi] = T[k];
    out.push({ key: k, label: N[k], level: v <= lo ? 'low' : v > hi ? 'high' : 'med' });
  }
  return out;
}
// A healthier option in the same group that costs no more than `tolerance` × this item per unit.
export function healthierSwap(S, idx, p, tolerance = 1.15) {
  if (!p.group || !p.size || !hasHealthData(p)) return null;
  const st = stats(idx, p.code); const mine = st ? entryUnit(S, st.best) : null;
  const myScore = healthScore(p);
  const cands = groupOptions(S, idx, p.group, p.size.unit)
    .filter(o => o.p.code !== p.code && hasHealthData(o.p) && healthScore(o.p) <= myScore - 5 && (mine == null || o.u <= mine * tolerance))
    .sort((a, b) => healthScore(a.p) - healthScore(b.p) || a.u - b.u);
  return cands[0] ? { opt: cands[0], mine } : null;
}
export function valueMetrics(p, price) {
  const out = {};
  if (!(price > 0)) return out;
  if (p.size && p.size.unit !== 'ct' && p.n100) {
    const amt = p.size.amt;
    if (p.n100.protein) out.proteinPerDollar = p.n100.protein * amt / 100 / price;
    if (p.n100.kcal) out.kcalPerDollar = p.n100.kcal * amt / 100 / price;
  }
  if (p.servQty && p.size && p.size.unit !== 'ct') {
    const sv = p.size.amt / p.servQty;
    if (sv >= 1) { out.servings = sv; out.perServing = price / sv; }
  }
  return out;
}

// ---------- bulk ----------
export function bulkCheck(S, idx, p) {
  if (!p.use) return null;
  const qty = p.buy || 1;
  const res = { qty, lastsDays: qty * 30.4 / p.use, wasteFactor: 1 };
  if (p.shelf) {
    res.shelf = p.shelf;
    if (res.lastsDays > p.shelf) {
      res.wasteFactor = res.lastsDays / p.shelf;
      res.wastePct = 1 - p.shelf / res.lastsDays;
      res.maxSafe = Math.max(1, Math.floor(p.shelf * p.use / 30.4));
    }
  }
  const st = stats(idx, p.code);
  if (st) {
    const price = packPrice(st.best);
    res.upfront = price * qty; res.monthly = price * p.use;
    if (p.size && p.group) {
      const mine = entryUnit(S, st.best) * res.wasteFactor, base = p.use * p.size.amt;
      res.effUnit = mine;
      const opts = groupOptions(S, idx, p.group, p.size.unit).filter(o => o.p.code !== p.code);
      res.hasOpts = opts.length > 0;
      if (opts.length) {
        const best = opts[0], worst = opts[opts.length - 1];
        if (worst.u > mine) res.savesVsWorst = { amt: (worst.u - mine) * base, opt: worst };
        if (best.u < mine) res.cheaperOpt = { amt: (mine - best.u) * base, opt: best };
      }
    }
  }
  return res;
}

// ---------- pantry ----------
// pantry[code] = { asOf: ISO date, lots: [{qty, date}] } (oldest lot first; quantities are as of `asOf`)
export function pantryNow(p, ent, today = todayISO()) {
  if (!ent || !ent.lots) return { lots: [], onHand: 0, daysLeft: null, expiring: [] };
  let lots = ent.lots.map(l => ({ ...l }));
  const use = (p && p.use) || 0;
  if (use > 0) {
    let consume = use * Math.max(0, daysBetween(ent.asOf, today)) / 30.4;
    for (const l of lots) { if (consume <= 0) break; const take = Math.min(l.qty, consume); l.qty -= take; consume -= take; }
    lots = lots.filter(l => l.qty > 1e-6);
  }
  const onHand = lots.reduce((s, l) => s + l.qty, 0);
  const daysLeft = use > 0 ? onHand / use * 30.4 : null;
  const expiring = p && p.shelf ? lots.map(l => { const expires = addDays(l.date, p.shelf); return { ...l, expires, daysToExpiry: daysBetween(today, expires) }; }) : [];
  return { lots, onHand, daysLeft, expiring };
}
function pantryWith(p, ent, today, fn) {
  const lots = fn(pantryNow(p, ent, today).lots).filter(l => l.qty > 1e-6);
  return lots.length ? { asOf: today, lots } : null;
}
export function pantryAdd(p, ent, qty, today = todayISO()) {
  return pantryWith(p, ent, today, lots => [...lots, { qty, date: today }]);
}
export function pantryAdjust(p, ent, delta, today = todayISO()) {
  if (delta > 0) return pantryAdd(p, ent, delta, today);
  return pantryWith(p, ent, today, lots => {
    let rm = -delta;
    for (const l of lots) { if (rm <= 0) break; const t = Math.min(l.qty, rm); l.qty -= t; rm -= t; }
    return lots;
  });
}
export function pantryAlerts(S, today = todayISO()) {
  const low = [], expiring = [], onHand = [];
  const lowDays = (S.settings && S.settings.lowDays) || 7;
  const tracked = new Set([...Object.keys(S.pantry)]);
  for (const code of tracked) {
    const p = S.products[code]; if (!p) continue;
    const now = pantryNow(p, S.pantry[code], today);
    if (now.onHand > 1e-6) onHand.push({ p, now });
    if (p.use && now.daysLeft != null && now.daysLeft <= lowDays) low.push({ p, now });
    for (const x of now.expiring) if (x.daysToExpiry <= 7) expiring.push({ p, lot: x });
  }
  low.sort((a, b) => a.now.daysLeft - b.now.daysLeft);
  expiring.sort((a, b) => a.lot.daysToExpiry - b.lot.daysToExpiry);
  onHand.sort((a, b) => (a.now.daysLeft ?? 1e9) - (b.now.daysLeft ?? 1e9) || a.p.name.localeCompare(b.p.name));
  return { low, expiring, onHand };
}

// ---------- trips, purchases, spending ----------
export function tripPrice(idx, code, store) {
  const st = stats(idx, code); if (!st) return null;
  const here = store && st.latest.find(x => x.store === store);
  const e = here || st.best;
  return { e, price: packPrice(e), here: !!here };
}
export function makePurchase(idx, code, qty, store, today = todayISO()) {
  const tp = tripPrice(idx, code, store);
  const st = stats(idx, code);
  const price = tp ? tp.price : null;
  const saved = price != null && st && st.es.length >= 2 ? r2((st.avg - price) * qty) : 0;
  return { id: uid(), code, qty, packPrice: price, store, date: today, saved };
}
export function monthSummary(S, ym) {
  const ps = S.purchases.filter(x => x.date.startsWith(ym));
  const byStore = {};
  let spent = 0, saved = 0, unpriced = 0;
  for (const x of ps) {
    if (x.packPrice == null) { unpriced++; continue; }
    const amt = x.packPrice * x.qty; spent += amt; saved += x.saved || 0;
    byStore[x.store] = (byStore[x.store] || 0) + amt;
  }
  return { ym, spent, saved, count: ps.length, unpriced, byStore };
}

// ---------- shopping plan ----------
export function planList(S, idx) {
  const open = S.list.filter(i => !i.done);
  const by = {}; let total = 0;
  for (const it of open) {
    const st = stats(idx, it.code); const k = st ? st.best.store : null;
    const key = k || '__none';
    (by[key] = by[key] || { store: k, items: [], sub: 0 }).items.push({ it, st });
    if (st) { by[key].sub += packPrice(st.best) * it.qty; total += packPrice(st.best) * it.qty; }
  }
  const groups = Object.values(by).sort((a, b) => (a.store === null) - (b.store === null) || b.items.length - a.items.length);
  const oneStop = [];
  for (const s of S.stores) {
    let sum = 0, miss = 0, any = 0;
    for (const it of open) { const st = stats(idx, it.code); const e = st && st.latest.find(x => x.store === s); if (e) { sum += packPrice(e) * it.qty; any++; } else miss++; }
    if (any) oneStop.push({ store: s, sum, miss });
  }
  oneStop.sort((a, b) => a.miss - b.miss || a.sum - b.sum);
  const unpriced = by.__none ? by.__none.items.length : 0;
  const storesUsed = groups.filter(g => g.store).length;
  const bestComplete = oneStop.find(r => !r.miss);
  const splitSaves = bestComplete && !unpriced && storesUsed > 1 ? { store: bestComplete.store, amt: bestComplete.sum - total } : null;
  return { groups, total, oneStop, unpriced, storesUsed, splitSaves };
}
