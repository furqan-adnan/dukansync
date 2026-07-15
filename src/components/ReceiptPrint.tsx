import type { Sale, Product } from '../db/db';

interface ReceiptPrintProps {
  sale: Sale | null;
  products: Product[];
  storeName: string;
  width: '58mm' | '80mm';
}

export function ReceiptPrint({ sale, products, storeName, width }: ReceiptPrintProps) {
  if (!sale) return null;

  const productMap = new Map(products.map((p) => [p.id, p.name]));
  const date = new Date(sale.updated_at).toLocaleString('en-PK');

  return (
    <div className={`receipt-print receipt-${width}`} aria-hidden="true">
      <div className="receipt-header">
        <strong>DukanSync</strong>
        <div>{storeName}</div>
        <div>Invoice #{sale.id.slice(0, 8).toUpperCase()}</div>
        <div>{date}</div>
      </div>

      {sale.items.map((item, i) => (
        <div className="receipt-line" key={i}>
          <span>
            {productMap.get(item.productId) ?? 'Item'} x{item.quantity}
          </span>
          <span>{(item.quantity * item.priceAtSale).toLocaleString('en-PK')}</span>
        </div>
      ))}

      <div className="receipt-total receipt-line">
        <span>TOTAL</span>
        <span>{sale.total.toLocaleString('en-PK')} PKR</span>
      </div>

      <div className="receipt-footer">
        Shukriya — Thank you for shopping!
        <br />
        Powered by DukanSync
      </div>
    </div>
  );
}
