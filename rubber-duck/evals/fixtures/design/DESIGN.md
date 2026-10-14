# Design: cache invalidation for the price service
1. `PriceCache.set(sku, price)` stores with a 60s TTL.
2. When `PriceService.update(sku, price)` runs, it writes the DB then calls `PriceCache.delete(sku)`.
3. Readers call `PriceService.get(sku)`: cache first, then DB, then `PriceCache.set`.
4. Bulk import (`importPrices(rows)`) writes the DB in a transaction; invalidation of changed SKUs "is handled by the TTL".
5. We claim readers never see a price older than 60s.
