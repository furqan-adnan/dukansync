import { useState } from 'react';
import type { Product } from '../db/db';
import { adjustStock } from '../db/stockService';

interface StockAdjustModalProps {
  product: Product | null;
  onClose: () => void;
  onAdjusted: () => void;
}

export function StockAdjustModal({ product, onClose, onAdjusted }: StockAdjustModalProps) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('restock');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!product) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;

    const parsed = parseInt(delta, 10);
    if (isNaN(parsed) || parsed === 0) {
      setError('Enter a non-zero quantity (+ to add, - to remove).');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await adjustStock(product.id, parsed, reason);
      onAdjusted();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Adjustment failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <form
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        aria-labelledby="stock-adjust-title"
      >
        <h3 id="stock-adjust-title">Adjust stock — {product.name}</h3>
        <p className="modal-subtitle">Current stock: <strong>{product.stock}</strong></p>

        <label className="modal-field">
          Quantity change
          <input
            placeholder="e.g. +50 or -10"
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            required
          />
        </label>

        <label className="modal-field">
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="restock">Restock / delivery</option>
            <option value="damage">Damaged goods</option>
            <option value="correction">Inventory correction</option>
            <option value="return">Customer return</option>
          </select>
        </label>

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button className="secondary-action" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-action" disabled={saving} type="submit">
            {saving ? 'Saving...' : 'Save adjustment'}
          </button>
        </div>
      </form>
    </div>
  );
}
