// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/core.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

function fixture() {
  const S = C.emptyState();
  S.products = {
    big:   { code: 'big',   name: 'Yogurt 48oz', size: { amt: 48 * 28.3495, unit: 'g' }, group: 'Yogurt', ns: 'a', nova: 1, n100: { protein: 10, kcal: 59, sugar: 3.6, fat: 0.4, sat: 0.1, sodium: 0.036 }, servQty: 170 },
    cup:   { code: 'cup',   name: 'Yogurt cup',  size: { amt: 5.3 * 28.3495, unit: 'g' }, group: 'Yogurt', ns: 'c', nova: 4 },
    soda:  { code: 'soda',  name: 'Soda',        size: { amt: 355, unit: 'ml' }, n100: { sugar: 10.6, fat: 0, sat: 0, sodium: 0.01 } },
    eggs:  { code: 'eggs',  name: 'Eggs',        size: { amt: 24, unit: 'ct' }, use: 4, shelf: 35 },
  };
  S.prices = [
    { id: '1', code: 'big', store: 'Costco',  price: 8.49, packs: 1, date: '2026-10-01' },
    { id: '2', code: 'big', store: 'Costco',  price: 6.49, packs: 1, date: '2026-11-10', sale: true },
    { id: '3', code: 'big', store: 'Walmart', price: 7.99, packs: 1, date: '2026-11-11' },
    { id: '4', code: 'cup', store: 'Walmart', price: 5.00, packs: 4, date: '2026-11-11' },
  ];
  return S;
}

test('parseSize handles common US and metric labels', () => {
  near(C.parseSize('16 oz').amt, 453.592);
  assert.equal(C.parseSize('64 fl oz (1.89 L)').unit, 'ml');
  near(C.parseSize('64 fl oz (1.89 L)').amt, 64 * 29.5735);
  near(C.parseSize('12 x 355 ml').amt, 4260);
  near(C.parseSize('2 lbs').amt, 907.184);
  assert.deepEqual(C.parseSize('18 ct'), { amt: 18, unit: 'ct' });
  near(C.parseSize('1,5 l').amt, 1500);
  assert.equal(C.parseSize('nothing here'), null);
  assert.equal(C.parseSize(''), null);
});

test('fmtUnit shows cents under a dollar', () => {
  assert.equal(C.fmtUnit(0.01 / 28.3495 * 13.5, 'g'), '13.5¢/oz');
  assert.equal(C.fmtUnit(0.25, 'ct'), '25.0¢/item');
  assert.equal(C.fmtUnit(1.5, 'ct'), '$1.50/item');
});

test('stats picks latest price per store and the cheapest of those', () => {
  const S = fixture(); const idx = C.buildIndex(S);
  const st = C.stats(idx, 'big');
  assert.equal(st.es.length, 3);
  assert.equal(st.best.store, 'Costco');
  assert.equal(st.best.price, 6.49);
  assert.equal(st.latest.length, 2);
  near(st.avg, (8.49 + 6.49 + 7.99) / 3);
  assert.equal(C.verdict(st).t, "Lowest you've logged");
});

test('multi-buy prices are per pack', () => {
  const S = fixture(); const idx = C.buildIndex(S);
  assert.equal(C.packPrice(C.stats(idx, 'cup').best), 1.25);
});

test('groupOptions ranks by unit price; cheaperAlt finds the bulk deal', () => {
  const S = fixture(); const idx = C.buildIndex(S);
  const opts = C.groupOptions(S, idx, 'Yogurt', 'g');
  assert.equal(opts[0].p.code, 'big');
  assert.equal(opts[opts.length - 1].p.code, 'cup');
  const alt = C.cheaperAlt(S, idx, S.products.cup);
  assert.equal(alt.alt.p.code, 'big');
  assert.equal(C.cheaperAlt(S, idx, S.products.big), null);
});

test('healthierSwap suggests the healthier item when it is not pricier', () => {
  const S = fixture(); const idx = C.buildIndex(S);
  const sw = C.healthierSwap(S, idx, S.products.cup);
  assert.equal(sw.opt.p.code, 'big');
  assert.equal(C.healthierSwap(S, idx, S.products.big), null);
});

test('healthFlags uses drink thresholds for liquids', () => {
  const f = Object.fromEntries(C.healthFlags(fixture().products.soda).map(x => [x.key, x.level]));
  assert.equal(f.sugar, 'med');         // 10.6 g/100ml is under the 11.25 drink "high" line
  assert.equal(f.salt, 'low');
  const yog = Object.fromEntries(C.healthFlags(fixture().products.big).map(x => [x.key, x.level]));
  assert.equal(yog.sugar, 'low');
});

test('bulkCheck flags waste and computes savings vs the small pack', () => {
  const S = fixture(); const idx = C.buildIndex(S);
  Object.assign(S.products.big, { use: 3, shelf: 21, buy: 3 });
  const b = C.bulkCheck(S, idx, S.products.big);
  near(b.lastsDays, 30.4);
  assert.ok(b.wastePct > 0.3 && b.wastePct < 0.32);
  assert.equal(b.maxSafe, 2);
  assert.ok(b.savesVsWorst.amt > 0);
  assert.equal(b.savesVsWorst.opt.p.code, 'cup');
  near(b.upfront, 6.49 * 3);
  assert.equal(C.bulkCheck(S, idx, S.products.cup), null); // no usage set
});

test('pantry consumes oldest lots first and estimates days left', () => {
  const p = { use: 4, shelf: 35 };              // 4 packs / month
  let ent = C.pantryAdd(p, null, 2, '2026-11-01');
  ent = C.pantryAdd(p, ent, 2, '2026-11-01');
  let now = C.pantryNow(p, ent, '2026-11-01');
  assert.equal(now.onHand, 4);
  near(now.daysLeft, 30.4);
  now = C.pantryNow(p, ent, '2026-11-16');      // ~1.97 packs used
  near(now.onHand, 4 - 4 * 15 / 30.4);
  assert.equal(now.lots.length, 2);
  near(now.expiring[0].daysToExpiry, 20);
  ent = C.pantryAdjust(p, ent, -10, '2026-11-16');
  assert.equal(ent, null);                      // fully used up
  assert.deepEqual(C.pantryNow(p, null).lots, []);
});

test('pantryAlerts finds low stock and items about to expire', () => {
  const S = fixture();
  S.pantry.eggs = C.pantryAdd(S.products.eggs, null, 1, '2026-10-20');
  const a = C.pantryAlerts(S, '2026-11-17');
  assert.equal(a.low[0].now.onHand, 0);    // 1 pack at 4/month is used up by 11-17 → "out"
  assert.equal(a.onHand.length, 0);
  S.pantry.eggs = C.pantryAdd(S.products.eggs, null, 1, '2026-11-15');
  const b = C.pantryAlerts(S, '2026-11-17');
  assert.equal(b.low[0].p.code, 'eggs');
  assert.ok(b.low[0].now.onHand > 0);
  S.products.eggs.shelf = 3;
  assert.equal(C.pantryAlerts(S, '2026-11-17').expiring.length, 1);
});

test('purchases record savings vs typical price and roll up by month', () => {
  const S = fixture(); const idx = C.buildIndex(S);
  const x = C.makePurchase(idx, 'big', 2, 'Costco', '2026-11-17');
  assert.equal(x.packPrice, 6.49);
  near(x.saved, C.r2(((8.49 + 6.49 + 7.99) / 3 - 6.49) * 2));
  const y = C.makePurchase(idx, 'big', 1, 'Target', '2026-11-17'); // no price there → best known
  assert.equal(y.packPrice, 6.49);
  S.purchases.push(x, y, C.makePurchase(idx, 'eggs', 1, 'Aldi', '2026-11-17'));
  const m = C.monthSummary(S, '2026-11');
  near(m.spent, 6.49 * 3);
  assert.equal(m.unpriced, 1);
  assert.equal(C.monthSummary(S, '2026-10').count, 0);
});

test('saleCycle estimates the next sale', () => {
  const S = fixture();
  S.prices.push({ id: '5', code: 'big', store: 'Costco', price: 6.29, packs: 1, date: '2026-12-08', sale: true });
  const sc = C.saleCycle(C.buildIndex(S), 'big');
  near(sc.gap, 28);
  assert.equal(sc.next, '2027-01-05');
});

test('planList groups by cheapest store and compares one-stop totals', () => {
  const S = fixture(); const idx = C.buildIndex(S);
  S.list = [{ code: 'big', qty: 2, done: false }, { code: 'cup', qty: 1, done: false }, { code: 'eggs', qty: 1, done: false }];
  const plan = C.planList(S, idx);
  near(plan.total, 6.49 * 2 + 1.25);
  assert.equal(plan.unpriced, 1);
  assert.equal(plan.groups[plan.groups.length - 1].store, null);
  const wm = plan.oneStop.find(r => r.store === 'Walmart');
  near(wm.sum, 7.99 * 2 + 1.25);
});

test('migrate upgrades v1 data', () => {
  const v1 = { products: { a: { code: 'a', name: 'A', qty: '16 oz' } }, list: [], stores: ['Any store', 'Vons'], prices: { a: { Vons: { price: 3, date: '11/1/2026' } } } };
  const S = C.migrate(v1);
  assert.equal(S.v, 3);
  assert.equal(S.prices[0].store, 'Vons');
  assert.equal(S.prices[0].date, '2026-11-01');
  near(S.products.a.size.amt, 453.592);
  assert.ok(S.stores.includes('Vons') && !S.stores.includes('Any store'));
  const v2 = { v: 2, products: {}, prices: [], list: [], stores: ['X'], settings: {} };
  const S2 = C.migrate(v2);
  assert.deepEqual(S2.pantry, {}); assert.deepEqual(S2.purchases, []); assert.equal(S2.settings.lowDays, 7);
});

test('only real product barcodes are accepted', () => {
  for (const ok of ['096619756803', '0096619756803', '12345670', '10012345678902']) assert.ok(C.isProductBarcode(ok), ok);
  for (const bad of ['', '12345', '123456789012345', '../../user', '0966197568O3', 'https://evil.example', 42, null]) assert.ok(!C.isProductBarcode(bad), String(bad));
});

test('product images must be HTTPS from Open Food Facts', () => {
  assert.equal(C.safeImageUrl('https://images.openfoodfacts.org/images/products/1.jpg'), 'https://images.openfoodfacts.org/images/products/1.jpg');
  assert.equal(C.safeImageUrl('http://images.openfoodfacts.org/x.jpg'), '');
  assert.equal(C.safeImageUrl('https://images.openfoodfacts.org.evil.com/x.jpg'), '');
  assert.equal(C.safeImageUrl('javascript:alert(1)'), '');
  assert.equal(C.safeImageUrl('" onerror="alert(1)'), '');
  assert.equal(C.safeImageUrl(undefined), '');
});

test('isDuplicate prevents double-logging the same price on the same day', () => {
  const S = fixture();
  assert.ok(C.isDuplicate(S, { code: 'big', store: 'Walmart', price: 7.99, packs: 1, date: '2026-11-11' }));
  assert.ok(!C.isDuplicate(S, { code: 'big', store: 'Walmart', price: 7.49, packs: 1, date: '2026-11-11' }));
});

// ---------- regression tests for issues #1-#8 ----------
test('#1 migrate coerces restored values so markup cannot reach the page', () => {
  const S = C.migrate({ v: 3, stores: ['X', 7], settings: { lowDays: '<b>' },
    products: { '123456': { name: 5, use: '<img>', shelf: '30', buy: 'x', size: { amt: '<i>', unit: 'g' } }, bad: 'nope' },
    prices: [{ id: '"><img src=x>', code: '123456', store: 'X', price: '2.5', packs: '<b>2</b>', date: '2026-11-01' }, { id: 'z', code: '1', price: 'free' }],
    list: [{ code: '123456', qty: '<i>x</i>', done: 1 }],
    purchases: [{ code: '123456', qty: '3', packPrice: '1.5', saved: 'lots', date: '2026-11-01' }],
    pantry: { '123456': { asOf: '2026-11-01', lots: [{ qty: '2', date: '2026-11-01' }, { qty: '<b>' }] }, junk: 5 } });
  const p = S.products['123456'];
  assert.equal(p.code, '123456'); assert.equal(p.name, '5'); assert.equal(p.use, null); assert.equal(p.shelf, 30); assert.equal(p.buy, 1); assert.equal(p.size, null);
  assert.ok(!S.products.bad);
  assert.equal(S.prices.length, 1);
  assert.equal(S.prices[0].price, 2.5); assert.equal(S.prices[0].packs, 1); assert.equal(typeof S.prices[0].id, 'string');
  assert.deepEqual(S.list[0], { code: '123456', qty: 1, done: true });
  assert.equal(S.purchases[0].qty, 3); assert.equal(S.purchases[0].packPrice, 1.5); assert.equal(S.purchases[0].saved, 0);
  assert.deepEqual(S.pantry, { '123456': { asOf: '2026-11-01', lots: [{ qty: 2, date: '2026-11-01' }] } });
  assert.deepEqual(S.stores, ['X', '7']); assert.equal(S.settings.lowDays, 7);
});

test('#1 migrate keeps valid data unchanged', () => {
  const S = fixture(); S.list = [{ code: 'big', qty: 2, done: false }];
  const R = C.migrate(JSON.parse(JSON.stringify(S)));
  assert.deepEqual(R.products, S.products); assert.deepEqual(R.list, S.list);
  assert.deepEqual(R.prices.map(e => [e.id, e.price, e.packs]), S.prices.map(e => [e.id, e.price, e.packs]));
});

test('#2 cheaperAlt gives no hint for an item without a price', () => {
  const S = fixture(); S.products.tub = { code: 'tub', name: 'Tub', size: { amt: 900, unit: 'g' }, group: 'Yogurt' };
  assert.equal(C.cheaperAlt(S, C.buildIndex(S), S.products.tub), null);
});

test('#3 parseSize reads thousands separators', () => {
  near(C.parseSize('1,000 g').amt, 1000);
  near(C.parseSize('2,000 ml').amt, 2000);
  near(C.parseSize('1,5 kg').amt, 1500);
  near(C.parseSize('0,75 l').amt, 750);
});

test('#8 planList does not claim $0.00 savings from splitting', () => {
  const S = C.emptyState(); S.stores = ['X', 'Y'];
  S.products = { a: { code: 'a', name: 'A' }, b: { code: 'b', name: 'B' } };
  S.prices = [
    { id: '1', code: 'a', store: 'X', price: 2, packs: 1, date: '2026-11-01' }, { id: '2', code: 'a', store: 'Y', price: 2, packs: 1, date: '2026-11-01' },
    { id: '3', code: 'b', store: 'Y', price: 1, packs: 1, date: '2026-11-01' }, { id: '4', code: 'b', store: 'X', price: 1, packs: 1, date: '2026-11-01' }];
  S.list = [{ code: 'a', qty: 1, done: false }, { code: 'b', qty: 1, done: false }];
  assert.equal(C.planList(S, C.buildIndex(S)).splitSaves, null);
});
