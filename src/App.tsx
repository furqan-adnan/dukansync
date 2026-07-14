import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { db, type Product, type Sale } from './db/db';
import { createLocalProduct, getAllLocalProducts } from './db/productsService';
import { checkoutLocalSale, getAllLocalSales } from './db/salesService';
import { processSyncQueue } from './db/syncEngine';

type CartState = Record<string, number>;
type SyncState = 'idle' | 'syncing' | 'success' | 'error';

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [queueCount, setQueueCount] = useState<number>(0);
  const [cart, setCart] = useState<CartState>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [statusMessage, setStatusMessage] = useState('Local register ready.');

  async function refreshData() {
    const localProds = await getAllLocalProducts();
    const localSales = await getAllLocalSales();
    const queue = await db.syncQueue.toArray();

    setProducts(localProds);
    setSales(localSales);
    setQueueCount(queue.length);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      const localProds = await getAllLocalProducts();
      const localSales = await getAllLocalSales();
      const queue = await db.syncQueue.toArray();

      if (!cancelled) {
        setProducts(localProds);
        setSales(localSales);
        setQueueCount(queue.length);
      }
    }

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  const cartLines = useMemo(() => {
    return Object.entries(cart)
      .map(([productId, quantity]) => {
        const product = products.find((item) => item.id === productId);
        if (!product || quantity <= 0) return null;

        return {
          product,
          quantity,
          lineTotal: product.price * quantity,
        };
      })
      .filter((line): line is { product: Product; quantity: number; lineTotal: number } => line !== null);
  }, [cart, products]);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return products;

    return products.filter((product) => {
      return (
        product.name.toLowerCase().includes(normalizedSearch) ||
        product.barcode?.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [products, searchTerm]);

  const totalInventoryValue = useMemo(() => {
    return products.reduce((total, product) => total + product.price * product.stock, 0);
  }, [products]);

  const cartTotal = cartLines.reduce((total, line) => total + line.lineTotal, 0);
  const cartItemCount = cartLines.reduce((total, line) => total + line.quantity, 0);
  const lowStockCount = products.filter((product) => product.stock < 10).length;
  const conflictCount = sales.filter((sale) => sale.sync_status === 'conflict').length;
  const todaySalesTotal = sales.reduce((total, sale) => total + sale.total, 0);
  const latestSales = [...sales].reverse().slice(0, 6);

  async function handleSyncTrigger() {
    setSyncState('syncing');
    setStatusMessage('Uploading queued operations to Supabase...');

    try {
      const res = await processSyncQueue();
      await refreshData();

      if (!res.success) {
        setSyncState('error');
        setStatusMessage(`Sync stopped after ${res.processedCount} upload(s): ${res.error}`);
        return;
      }

      setSyncState('success');
      setStatusMessage(`Cloud sync complete. Uploaded ${res.processedCount} operation(s).`);
    } catch (err: unknown) {
      setSyncState('error');
      setStatusMessage(`Sync interrupted: ${getErrorMessage(err)}`);
    }
  }

  async function handleAddProduct() {
    const names = ['Lays Masala', 'Pepsi 500ml', 'Sufi Cooking Oil 1L', 'Tapal Danedar 250g'];
    const randomName = names[Math.floor(Math.random() * names.length)];
    const randomPrice = Math.floor(Math.random() * 5) * 50 + 50;

    await createLocalProduct(randomName, null, randomPrice, 50);
    await refreshData();
    setStatusMessage(`${randomName} added to local inventory.`);
  }

  function addToCart(productId: string) {
    const product = products.find((item) => item.id === productId);
    const currentQuantity = cart[productId] || 0;

    if (product && currentQuantity >= product.stock) {
      setStatusMessage(`Only ${product.stock} unit(s) available for ${product.name}.`);
      return;
    }

    setCart((prev) => ({ ...prev, [productId]: currentQuantity + 1 }));
  }

  function removeFromCart(productId: string) {
    setCart((prev) => {
      const nextQuantity = (prev[productId] || 0) - 1;
      const nextCart = { ...prev };

      if (nextQuantity > 0) {
        nextCart[productId] = nextQuantity;
      } else {
        delete nextCart[productId];
      }

      return nextCart;
    });
  }

  async function handleCheckout() {
    const cartItems = cartLines.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
    }));

    if (cartItems.length === 0) {
      setStatusMessage('Add at least one item before checkout.');
      return;
    }

    try {
      await checkoutLocalSale(cartItems);
      setCart({});
      await refreshData();
      setStatusMessage(`Invoice saved offline for ${formatCurrency(cartTotal)}.`);
    } catch (err: unknown) {
      setStatusMessage(getErrorMessage(err));
    }
  }

  return (
    <main className="pos-shell">
      <header className="pos-header">
        <div>
          <p className="eyebrow">Lahore Store Register</p>
          <h1>DukanSync POS</h1>
        </div>
        <div className="header-actions">
          <span className={`sync-pill sync-pill-${syncState}`}>
            {queueCount === 0 ? 'Cloud current' : `${queueCount} pending`}
          </span>
          <button className="secondary-action" type="button" onClick={handleAddProduct}>
            New product
          </button>
          <button
            className="primary-action"
            type="button"
            onClick={handleSyncTrigger}
            disabled={syncState === 'syncing' || queueCount === 0}
          >
            {syncState === 'syncing' ? 'Syncing...' : 'Sync now'}
          </button>
        </div>
      </header>

      <section className="metric-row" aria-label="Store summary">
        <article className="metric-card">
          <span>Inventory</span>
          <strong>{products.length}</strong>
          <small>{formatCurrency(totalInventoryValue)} in stock</small>
        </article>
        <article className="metric-card">
          <span>Conflicts</span>
          <strong>{conflictCount}</strong>
          <small className={conflictCount > 0 ? 'danger-text' : ''}>Requires review</small>
        </article>
        <article className="metric-card">
          <span>Local sales</span>
          <strong>{sales.length}</strong>
          <small>{formatCurrency(todaySalesTotal)} captured</small>
        </article>
        <article className="metric-card">
          <span>Low stock</span>
          <strong>{lowStockCount}</strong>
          <small>Below 10 units</small>
        </article>
      </section>

      <p className={`status-line status-${syncState}`}>{statusMessage}</p>

      <section className="workspace-grid">
        <section className="inventory-panel" aria-labelledby="inventory-heading">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Catalog</p>
              <h2 id="inventory-heading">Sell Items</h2>
            </div>
            <input
              aria-label="Search products"
              className="search-input"
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search product or barcode"
              type="search"
              value={searchTerm}
            />
          </div>

          <div className="product-list">
            {filteredProducts.length === 0 && (
              <div className="empty-state">
                <strong>No products found</strong>
                <span>Create a product or clear the search.</span>
              </div>
            )}

            {filteredProducts.map((product) => {
              const selectedQuantity = cart[product.id] || 0;
              const isLowStock = product.stock < 10;

              return (
                <article className="product-row" key={product.id}>
                  <div className="product-main">
                    <strong>{product.name}</strong>
                    <span>
                      {formatCurrency(product.price)} · Stock{' '}
                      <b className={isLowStock ? 'danger-text' : 'success-text'}>{product.stock}</b>
                    </span>
                  </div>
                  <div className="quantity-control">
                    <button
                      aria-label={`Remove ${product.name}`}
                      className="icon-button"
                      disabled={selectedQuantity === 0}
                      onClick={() => removeFromCart(product.id)}
                      type="button"
                    >
                      -
                    </button>
                    <span>{selectedQuantity}</span>
                    <button
                      aria-label={`Add ${product.name}`}
                      className="icon-button"
                      disabled={selectedQuantity >= product.stock}
                      onClick={() => addToCart(product.id)}
                      type="button"
                    >
                      +
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="checkout-panel" aria-labelledby="cart-heading">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Checkout</p>
              <h2 id="cart-heading">Current Invoice</h2>
            </div>
          </div>

          <div className="cart-lines">
            {cartLines.length === 0 && (
              <div className="empty-state">
                <strong>Cart is empty</strong>
                <span>Add products from the catalog.</span>
              </div>
            )}

            {cartLines.map((line) => (
              <div className="cart-line" key={line.product.id}>
                <div>
                  <strong>{line.product.name}</strong>
                  <span>
                    {line.quantity} x {formatCurrency(line.product.price)}
                  </span>
                </div>
                <b>{formatCurrency(line.lineTotal)}</b>
              </div>
            ))}
          </div>

          <div className="checkout-total">
            <span>Total</span>
            <strong>{formatCurrency(cartTotal)}</strong>
          </div>

          <button className="checkout-button" type="button" onClick={handleCheckout}>
            Save invoice offline
          </button>
        </aside>
      </section>

      <section className="history-panel" aria-labelledby="history-heading">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Register history</p>
            <h2 id="history-heading">Recent Local Invoices</h2>
          </div>
        </div>

        <div className="invoice-list">
          {latestSales.length === 0 && (
            <div className="empty-state">
              <strong>No invoices yet</strong>
              <span>Completed sales will appear here.</span>
            </div>
          )}

          {latestSales.map((sale, index) => (
            <article className="invoice-row" key={sale.id}>
              <div>
                <strong>Invoice #{sales.length - index}</strong>
                <span>{sale.items.reduce((total, item) => total + item.quantity, 0)} item(s)</span>
              </div>
              <div className="invoice-meta">
                <b>{formatCurrency(sale.total)}</b>
                <small className={`record-status status-${sale.sync_status}`}>{sale.sync_status}</small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function formatCurrency(amount: number): string {
  return `${amount.toLocaleString('en-PK')} PKR`;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Something went wrong.';
}

export default App;
