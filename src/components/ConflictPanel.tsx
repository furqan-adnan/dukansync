import { useState } from 'react';
import type { Product, Sale } from '../db/db';
import { acknowledgeConflict, getConflictDetails } from '../db/conflictService';

interface ConflictPanelProps {
  conflicts: Sale[];
  products: Product[];
  onResolved: () => void;
}

export function ConflictPanel({ conflicts, products, onResolved }: ConflictPanelProps) {
  const [resolving, setResolving] = useState<string | null>(null);

  if (conflicts.length === 0) {
    return (
      <section className="history-panel" aria-labelledby="conflicts-heading">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Sync review</p>
            <h2 id="conflicts-heading">Conflicted Sales</h2>
          </div>
        </div>
        <div className="empty-state" style={{ margin: '14px' }}>
          <strong>No conflicts</strong>
          <span>All sales synced without inventory conflicts.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="history-panel" aria-labelledby="conflicts-heading">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Sync review</p>
          <h2 id="conflicts-heading">Conflicted Sales ({conflicts.length})</h2>
        </div>
      </div>

      <div className="conflict-list">
        {conflicts.map((sale) => {
          const details = getConflictDetails(sale, products);
          const isResolving = resolving === sale.id;

          return (
            <article className="conflict-card" key={sale.id}>
              <div className="conflict-card-header">
                <div>
                  <strong>Invoice #{sale.id.slice(0, 8).toUpperCase()}</strong>
                  <span>{new Date(sale.updated_at).toLocaleString('en-PK')}</span>
                </div>
                <span className="record-status status-conflict">conflict</span>
              </div>

              <p className="conflict-explanation">
                This sale was rejected during sync because stock was insufficient on the server.
                Stock was not decremented — review and acknowledge once handled.
              </p>

              <ul className="conflict-items">
                {details.map((item, i) => (
                  <li key={i}>
                    <span>{item.productName} × {item.quantity}</span>
                    <span>
                      {item.priceAtSale.toLocaleString('en-PK')} PKR · stock now: {item.currentStock}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="conflict-card-footer">
                <strong>{sale.total.toLocaleString('en-PK')} PKR</strong>
                <button
                  className="secondary-action"
                  disabled={isResolving}
                  onClick={async () => {
                    setResolving(sale.id);
                    try {
                      await acknowledgeConflict(sale.id);
                      onResolved();
                    } finally {
                      setResolving(null);
                    }
                  }}
                  type="button"
                >
                  {isResolving ? 'Saving...' : 'Acknowledge'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
