# RLS Security Testing Checklist

This document is the official QA protocol for verifying DukanSync's Row-Level Security (RLS) policies on your live Supabase instance. Because RLS policies execute on the database server, we must verify them via manual live testing or dedicated Supabase Edge testing.

## Prerequisites
1. Ensure the `04_reports_and_security.sql` migration has been executed in the Supabase SQL editor.
2. Ensure you have two distinct User Accounts created in your system:
   - **User A:** Owner of Tenant X (Store 1)
   - **User B:** Cashier of Tenant Y (Store 2)

## Test 1: Tenant Data Isolation (The "No Peeking" Rule)
**Objective:** Prove that database operations strictly query only data matching the user's `tenant_id` and `store_id`.

### Execution Steps
1. Log in to the application as **User A**.
2. Create a new product named "Tenant X Exclusive Product" and process a sale for it.
3. Wait for the `Sync Queue` to report "Cloud current" (verifying the data is in Supabase).
4. Log out, and log in as **User B**.
5. Navigate to the **Catalog** and **Reports** tabs.

### Success Criteria ✅
- **User B** MUST NOT see "Tenant X Exclusive Product" in their catalog.
- **User B** MUST NOT see the sales data or revenue from User A in their Reports Dashboard.
- Attempting to bypass the UI and directly call `supabase.from('sales').select('*')` in the browser console while logged in as User B must return an empty array `[]` (or only User B's sales).

## Test 2: Cashier Role Restrictions
**Objective:** Prove that Cashiers cannot view, edit, or delete transactions belonging to other stores within the same tenant, or perform owner-level actions.

### Execution Steps
1. As the **Owner**, create two stores: `Lahore Branch` and `Karachi Branch`.
2. Assign **User B (Cashier)** to `Lahore Branch`.
3. Process sales at the `Karachi Branch` as the Owner.
4. Log in as **User B (Cashier)**.

### Success Criteria ✅
- The Cashier's dropdown for Store Selection should be locked or only show `Lahore Branch`.
- The Cashier's `ReportsPanel` and local Dexie database should only synchronize invoices where `store_id` matches the `Lahore Branch`.
- Any attempt by the Cashier to call `supabase.from('sales').delete().eq('id', '<karachi_sale_id>')` must be rejected by Supabase with a `401 Unauthorized` or silently return `0 rows affected`.

## Test 3: Audit Log Immutability
**Objective:** Prove that `audit_logs` are insert-only.

### Execution Steps
1. Open the browser console while logged into any account.
2. Execute: `await supabase.from('audit_logs').delete().neq('id', '0')`

### Success Criteria ✅
- Supabase MUST block this query. RLS policies for `audit_logs` should restrict `DELETE` and `UPDATE` operations entirely, ensuring regulatory compliance for retail systems.
