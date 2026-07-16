import type { Product, Sale } from './db';
import { supabase } from './supabaseClient';

export interface DailySalesSummary {
  date: string;
  totalSales: number;
  invoiceCount: number;
  itemCount: number;
}

export interface BestSeller {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
}

const MS_PER_DAY = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Aggregates sales by day for the reports dashboard.
 */
export function getDailySalesSummaries(sales: Sale[], days = 7): DailySalesSummary[] {
  const todayStart = startOfDay(Date.now());
  const buckets = new Map<string, DailySalesSummary>();

  for (let i = 0; i < days; i++) {
    const dayStart = todayStart - i * MS_PER_DAY;
    const key = new Date(dayStart).toISOString().slice(0, 10);
    buckets.set(key, { date: key, totalSales: 0, invoiceCount: 0, itemCount: 0 });
  }

  for (const sale of sales) {
    if (sale.sync_status === 'conflict') continue;
    const key = new Date(sale.updated_at).toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;

    bucket.totalSales += sale.total;
    bucket.invoiceCount += 1;
    bucket.itemCount += sale.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  return [...buckets.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Returns top-selling products by quantity for the reports dashboard.
 */
export function getBestSellers(sales: Sale[], products: Product[], limit = 5): BestSeller[] {
  const counts = new Map<string, { qty: number; revenue: number }>();

  for (const sale of sales) {
    if (sale.sync_status === 'conflict') continue;
    for (const item of sale.items) {
      const existing = counts.get(item.productId) ?? { qty: 0, revenue: 0 };
      existing.qty += item.quantity;
      existing.revenue += item.quantity * item.priceAtSale;
      counts.set(item.productId, existing);
    }
  }

  const productMap = new Map(products.map((p) => [p.id, p.name]));

  return [...counts.entries()]
    .map(([productId, stats]) => ({
      productId,
      productName: productMap.get(productId) ?? 'Unknown product',
      quantitySold: stats.qty,
      revenue: stats.revenue,
    }))
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, limit);
}

/**
 * Today's sales total (fixes the mislabeled metric in the original dashboard).
 */
export function getTodaySalesTotal(sales: Sale[]): number {
  const todayStart = startOfDay(Date.now());
  return sales
    .filter((s) => s.sync_status !== 'conflict' && s.updated_at >= todayStart)
    .reduce((sum, s) => sum + s.total, 0);
}

export interface AnalyticsSummary {
  todayTotal: number;
  dailySummaries: DailySalesSummary[];
  bestSellers: BestSeller[];
}

/**
 * Attempts to fetch highly-optimized server-side analytics from the Supabase RPC.
 * If offline, or if it fails, falls back gracefully to calculating it locally.
 */
export async function getAnalyticsDashboard(
  tenantId: string,
  storeId: string | null,
  localSales: Sale[],
  localProducts: Product[]
): Promise<AnalyticsSummary> {
  // 1. Try Server-Side Aggregation
  if (navigator.onLine) {
    try {
      const { data, error } = await supabase.rpc('get_dashboard_analytics', {
        p_tenant_id: tenantId,
        p_store_id: storeId,
      });

      if (!error && data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload = data as any;
        
        return {
          todayTotal: Number(payload.todayTotal || payload.todaytotal || 0),
          dailySummaries: (payload.dailySummaries || payload.dailysummaries || []).map((d: any) => ({
            date: d.date,
            totalSales: Number(d.totalSales ?? d.totalsales ?? 0),
            invoiceCount: Number(d.invoiceCount ?? d.invoicecount ?? 0),
            itemCount: Number(d.itemCount ?? d.itemcount ?? 0),
          })),
          bestSellers: (payload.bestSellers || payload.bestsellers || []).map((b: any) => ({
            productId: b.productId || b.productid,
            productName: b.productName || b.productname || 'Unknown',
            quantitySold: Number(b.quantitySold ?? b.quantitysold ?? 0),
            revenue: Number(b.revenue ?? 0),
          })),
        };
      }
    } catch (error) {
      console.warn("Failed to fetch server analytics. Falling back to local calculation.", error);
    }
  }

  // 2. Fallback to Local Offline Calculation
  console.log("Using local analytics fallback.");
  return {
    todayTotal: getTodaySalesTotal(localSales),
    dailySummaries: getDailySalesSummaries(localSales, 7),
    bestSellers: getBestSellers(localSales, localProducts, 5),
  };
}
