# Chaos Testing: Extreme Conditions Guide

Retail stores in Pakistan face aggressive power cuts, unstable ISPs, and failing hardware. DukanSync is built on an Offline-First, Local-First architecture to survive these exact scenarios.

This document outlines how to physically simulate disaster scenarios to guarantee our POS never loses a single transaction.

## Scenario 1: The Mid-Transaction Blackout (Internet Drop)

**The Threat:** The cashier hits "Save invoice offline", but the internet drops the exact millisecond the transaction starts processing.

### Execution:
1. Open the POS and add 5 items to the cart.
2. Open Chrome DevTools (F12) -> Network Tab.
3. Change throttling from "No throttling" to **"Offline"**.
4. Click **Save invoice offline**.

### Expected Behavior ✅:
- The UI must instantly report "Invoice saved offline".
- The `Sync Queue` badge must increment by 1 (e.g., "1 pending").
- Local stock must decrement immediately in the catalog.
- **Verification:** Refresh the page entirely. The sync queue must still show "1 pending" (data persists in IndexedDB).

## Scenario 2: The Reconnection Flood (Backlog Processing)

**The Threat:** The store was offline for 8 hours. The cashier processed 500 invoices. Suddenly, the internet connects, and the browser tries to dump 500 records to Supabase simultaneously, causing a rate limit or race condition.

### Execution:
1. Stay in "Offline" mode (DevTools).
2. Rapidly checkout 10-15 different invoices.
3. Observe the `Sync Queue` badge incrementing to 15.
4. Switch DevTools Network back to **"No throttling"**.
5. Wait for the `Auto-Sync` interval to trigger, OR manually click **Sync now**.

### Expected Behavior ✅:
- The `syncEngine.ts` must process the queue in exact chronological order (FIFO).
- The network tab should show distinct RPC/PostgREST calls.
- The UI status must update to "Uploading queued operations..." and eventually "Cloud sync complete."
- **Crucial check:** Verify on the Supabase dashboard that exactly 15 new sales appeared, with no duplicates.

## Scenario 3: The Fatal App Crash (Atomicity Test)

**The Threat:** The sync engine is actively uploading record #3 out of 10. The cashier accidentally closes the browser tab, or the laptop battery dies.

### Execution:
1. Go "Offline" and create 5 invoices.
2. Go "Online" and click **Sync now**.
3. *IMMEDIATELY* close the browser tab before the UI says "Sync complete".
4. Re-open the browser and launch DukanSync.

### Expected Behavior ✅:
- The sync engine uses strict IndexedDB transactional locks (`await db.transaction`).
- The `syncQueue` records are only deleted *after* a successful `200 OK` from Supabase.
- Upon reopening, the POS should show the remaining pending records (e.g., "2 pending" if 3 succeeded).
- **Failure state:** If the queue is 0 but Supabase only has 3 records, data loss occurred (The engine dropped the records prematurely). This must never happen.

## Scenario 4: The Double-Sell (Concurrency)

**The Threat:** Store A and Store B are offline. Both sell the exact same SKU (e.g., "Pepsi") down to 0 stock. They both come online at the same time.

### Execution:
1. Open two separate browsers (e.g., Chrome and Firefox) logged into the same tenant.
2. Put both browsers in "Offline" mode.
3. In Chrome, sell 3 Pepsis. 
4. In Firefox, sell 2 Pepsis.
5. Bring both browsers Online.
6. Click sync on both.

### Expected Behavior ✅:
- Because sales are immutable ledgers, both invoices will sync perfectly.
- Supabase RPC will evaluate the stock based on the timestamps.
- If the final cloud stock drops below 0, it should either allow it (negative inventory is common in retail until audits fix it) OR flag the transaction with `sync_status = 'conflict'`. DukanSync currently flags conflicting updates to the same product via the `ConflictPanel`.
