import { db, type Product, type Sale } from './db';
import { logAuditAction } from './auditService';

/**
 * Owner acknowledges a conflicted sale after manual review.
 * Marks it as synced locally (server already has it flagged as conflict).
 */
export async function acknowledgeConflict(saleId: string): Promise<void> {
  const sale = await db.sales.get(saleId);
  if (!sale || sale.sync_status !== 'conflict') {
    throw new Error('Sale is not in conflict state.');
  }

  await db.sales.update(saleId, { sync_status: 'synced' });
  await logAuditAction('conflict_acknowledged', { saleId, total: sale.total });
}

export async function getConflictedSales(): Promise<Sale[]> {
  return db.sales.filter((s) => s.sync_status === 'conflict').toArray();
}

export function getConflictDetails(sale: Sale, products: Product[]) {
  const productMap = new Map(products.map((p) => [p.id, p]));
  return sale.items.map((item) => ({
    productName: productMap.get(item.productId)?.name ?? 'Unknown',
    quantity: item.quantity,
    priceAtSale: item.priceAtSale,
    currentStock: productMap.get(item.productId)?.stock ?? 0,
  }));
}
