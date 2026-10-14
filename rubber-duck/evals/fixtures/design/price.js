const cache = new Map();
const PriceCache = {
  set(sku, price) { cache.set(sku, { price, at: Date.now() }); },           // no TTL enforced here
  get(sku) { return cache.get(sku)?.price; },
  delete(sku) { cache.delete(sku); },
};
const PriceService = {
  async get(sku, db) {
    const hit = PriceCache.get(sku);
    if (hit !== undefined) return hit;
    const price = await db.getPrice(sku);
    PriceCache.set(sku, price);
    return price;
  },
  async update(sku, price, db) { PriceCache.delete(sku); await db.setPrice(sku, price); },
};
async function importPrices(rows, db) { await db.transaction(tx => rows.forEach(r => tx.setPrice(r.sku, r.price))); }
module.exports = { PriceCache, PriceService, importPrices };
