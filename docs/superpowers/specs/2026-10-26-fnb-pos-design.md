# FnB POS Android Design

## Intent
Build an Android-first FnB point-of-sale application for tablet and mobile. The first usable slice prioritizes fast cashier transactions while preserving the approved offline-first, inventory, forecasting, shift, and accounting direction.

## Users
- Owner: manages menu, recipes, ingredients, stock, purchasing, expenses, reports, accounting, and shift consolidation.
- Cashier: uses one shared cashier account, opens a shift with a default Rp350,000 float, records sales and cash movements, handles held orders and pre-orders, accepts cash/QRIS, and prints receipts.

## Approved transaction flow
Select items → choose order type (Takeaway default, Dine in, GoFood, GrabFood, ShopeeFood) → process → choose Cash or QRIS → print Bluetooth thermal receipt → finish.

Dine in has no table number. Cash in/out requires amount and free-form note, without category.

## Approved operational rules
- Held orders are unfinished and do not count as sales or reduce stock.
- Pre-orders support customer details, pickup schedule, items, order type, DP, payment method, and notes.
- Pre-order stock and sale recognition happen when status changes to “Mulai Diproses”.
- Cashier float defaults to Rp350,000.
- Expected cash = opening float + cash sales + cash in - cash out.
- QRIS is reported but excluded from physical cash.
- Offline data is stored locally and automatically synced when online; topbar exposes sync state.
- Transactions are never deleted; cancellation/refund/correction is used instead.
- Owner reporting includes operational PNL plus double-entry journal, ledger, trial balance, balance sheet, and cash flow.
- Google Sheets is a near-realtime reporting clone, never the operational source of truth.

## MVP scope for the first implementation slice
Implement the Android-first responsive POS UI with in-memory demo state: menu categories/items, cart, order type selection, held orders, pre-order creation, cash/QRIS checkout, shift summary, cash in/out, and offline/sync indicator. Use the existing React + Vite stack. Do not add native Capacitor or backend dependencies until the UI and domain contracts are validated.

## Later modules
Capacitor Android shell and native Bluetooth thermal printing; local SQLite and sync queue; backend/idempotent sync; Google Sheets export; inventory recipes and stock movements; purchasing; daily/weekly forecast; accounting chart of accounts and automatic journal posting; backup/restore and audit log.

## Non-goals for this slice
No payment gateway QRIS integration, automatic delivery-platform integrations, multi-branch support, tax accounting, or Bluetooth Classic/SPP native printer bridge. The web app does include Web Bluetooth BLE pairing and ESC/POS receipt delivery.
