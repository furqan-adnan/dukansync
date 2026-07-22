import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import { type Product, type Sale } from './db/db';
import { createLocalProduct } from './db/productsService';
import { getSaleById, checkoutLocalSale } from './db/salesService';
import { processSyncQueue, getPendingQueueCount } from './db/syncEngine';
import {
  getOfflineSession,
  getCachedProfile,
  fetchAndCacheProfile,
  type UserProfile,
  logout,
  login,
} from './db/authService';
import { logAuditAction } from './db/auditService';
import { getConflictedSales } from './db/conflictService';
import { getAnalyticsDashboard, getTodaySalesTotal, type AnalyticsSummary } from './db/reportsService';
import {
  fetchTenantStores,
  getActiveStoreId,
  getStoreProducts,
  getStoreSales,
  setActiveStoreId,
  createStore,
  type Store,
} from './db/storesService';
import { useOnlineSync } from './hooks/useOnlineSync';
import { ConflictPanel } from './components/ConflictPanel';
import { ReportsPanel } from './components/ReportsPanel';
import { StockAdjustModal } from './components/StockAdjustModal';
import { ReceiptPrint } from './components/ReceiptPrint';
import { printReceipt } from './utils/printReceipt';
import { DeadLetterPanel } from './components/DeadLetterPanel';
import { getDeadLetterStats } from './db/deadLetterService';
import { SyncStatusBadge } from './components/SyncStatusBadge';
import { SyncDashboard } from './components/SyncDashboard';
import { AlertBanner } from './components/AlertBanner';
import { SyncLogs } from './components/SyncLogs';
import { startNetworkQualityMonitoring } from './db/networkQualityService';

type CartState = Record<string, number>;
type SyncState = 'idle' | 'syncing' | 'success' | 'error';
type AppView = 'pos' | 'reports' | 'conflicts' | 'dlq' | 'dashboard' | 'logs';

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [conflicts, setConflicts] = useState<Sale[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [dlqCount, setDlqCount] = useState(0);
  const [cart, setCart] = useState<CartState>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [statusMessage, setStatusMessage] = useState('Local register ready.');
  const [activeView, setActiveView] = useState<AppView>('pos');
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStoreId, setActiveStoreIdState] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [receiptWidth, setReceiptWidth] = useState<'58mm' | '80mm'>('58mm');
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreAddress, setNewStoreAddress] = useState('');
  const [isCreatingStore, setIsCreatingStore] = useState(false);

  const [session, setSession] = useState<{ user: { id: string } } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(true);

  // Start network quality monitoring on mount
  useEffect(() => {
    startNetworkQualityMonitoring();
  }, []);

  const refreshData = useCallback(async () => {
    const [localProds, localSales, conflicted, queue, dlqStats] = await Promise.all([
      getStoreProducts(),
      getStoreSales(),
      getConflictedSales(),
      getPendingQueueCount(),
      getDeadLetterStats(),
    ]);

    setProducts(localProds);
    setSales(localSales);
    setConflicts(conflicted);
    setQueueCount(queue);
    setDlqCount(dlqStats.unresolved);

    // Fetch Analytics (Will try server RPC first, then fallback to localSales)
    const p = await getCachedProfile();
    const storeId = await getActiveStoreId();
    if (p) {
      const analyticsData = await getAnalyticsDashboard(p.tenant_id, storeId, localSales, localProds);
      setAnalytics(analyticsData);
    }
  }, []);

  const handleAutoSyncComplete = useCallback(
    (processed: number) => {
      if (processed > 0) {
        setSyncState('success');
        setStatusMessage(`Auto-sync complete. Uploaded ${processed} operation(s).`);
        void refreshData();
      }
    },
    [refreshData],
  );

  useOnlineSync(handleAutoSyncComplete);

  useEffect(() => {
    let cancelled = false;

    async function loadAuthAndData() {
      const activeSession = await getOfflineSession();
      if (!cancelled) {
        setSession(activeSession);
        if (activeSession) {
          const cachedProf = await getCachedProfile();
          setProfile(cachedProf);

          fetchAndCacheProfile(activeSession.user.id)
            .then((p) => {
              if (!cancelled && p) setProfile(p);
            })
            .catch(() => {});
        }
        setAuthLoading(false);
      }

      if (activeSession) {
        const storeId = await getActiveStoreId();
        if (!cancelled) setActiveStoreIdState(storeId);

        const tenantStores = await fetchTenantStores();
        if (!cancelled) setStores(tenantStores);

        await refreshData();
      }
    }

    void loadAuthAndData();

    return () => {
      cancelled = true;
    };
  }, [refreshData]);

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
  const lowStockCount = products.filter((product) => product.stock < 10).length;
  const conflictCount = conflicts.length;
  const todaySalesTotal = getTodaySalesTotal(sales);
  const latestSales = [...sales].reverse().slice(0, 6);
  const activeStoreName =
    stores.find((s) => s.id === activeStoreId)?.name ??
    (profile?.role === 'owner' ? 'All stores' : 'Store register');

  const isOwner = profile?.role === 'owner';

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

    try {
      await createLocalProduct(randomName, null, randomPrice, 50);
      await refreshData();
      setStatusMessage(`${randomName} added to local inventory.`);
    } catch (err: unknown) {
      setStatusMessage(getErrorMessage(err));
    }
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
        void logAuditAction('cart_item_removed', { productId });
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
      const saleId = await checkoutLocalSale(cartItems);
      const sale = await getSaleById(saleId);
      setCart({});
      await refreshData();
      if (sale) setLastSale(sale);
      setStatusMessage(`Invoice saved offline for ${formatCurrency(cartTotal)}.`);
    } catch (err: unknown) {
      setStatusMessage(getErrorMessage(err));
    }
  }

  function handlePrintLastReceipt() {
    if (!lastSale) return;
    printReceipt(receiptWidth);
  }

  async function handleStoreChange(storeId: string) {
    if (!storeId) return;
    setActiveStoreId(storeId);
    setActiveStoreIdState(storeId);
    setCart({});
    await refreshData();
    const store = stores.find((s) => s.id === storeId);
    setStatusMessage(`Switched to ${store?.name ?? 'store'}.`);
  }

  async function handleCreateStore(e: React.FormEvent) {
    e.preventDefault();
    if (!newStoreName.trim()) return;
    
    setIsCreatingStore(true);
    try {
      const store = await createStore(newStoreName, newStoreAddress || null);
      const tenantStores = await fetchTenantStores();
      setStores(tenantStores);
      await handleStoreChange(store.id);
      setShowStoreModal(false);
      setNewStoreName('');
      setNewStoreAddress('');
      setStatusMessage(`Store "${store.name}" created successfully.`);
    } catch (err: unknown) {
      setStatusMessage(getErrorMessage(err));
    } finally {
      setIsCreatingStore(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    
    try {
      const activeSession = await login(authEmail, authPassword);
      setSession(activeSession);
      
      if (activeSession) {
        const p = await fetchAndCacheProfile(activeSession.user.id);
        setProfile(p);
        const storeId = await getActiveStoreId();
        setActiveStoreIdState(storeId);
        const tenantStores = await fetchTenantStores();
        setStores(tenantStores);
        await refreshData();
      }
    } catch (error: unknown) {
      alert(getErrorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await logout();
    setSession(null);
    setProfile(null);
    setStores([]);
    setActiveStoreIdState(null);
  }

  if (authLoading) return <div className="loading-screen">Loading workspace...</div>;

  if (!session) {
    return (
      <main className="pos-shell login-shell">
        <form className="login-card" onSubmit={handleLogin}>
          <h2>DukanSync Login</h2>
          <p className="login-subtitle">Offline-first POS for Pakistani retail</p>
          <input
            type="email"
            placeholder="Email"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            required
          />
          <button className="primary-action" type="submit">
            Sign In
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="pos-shell">
      <header className="pos-header">
        <div>
          <p className="eyebrow">{isOwner ? 'Owner workspace' : 'Store register'}</p>
          <h1>DukanSync POS</h1>
          <small className="store-label">{activeStoreName}</small>
        </div>
        <div className="header-actions">
          {isOwner && (
            <>
              {stores.length > 0 && (
                <select
                  aria-label="Select store"
                  className="store-select"
                  value={activeStoreId ?? ''}
                  onChange={(e) => void handleStoreChange(e.target.value)}
                >
                  <option value="" disabled>Select a store</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              )}
              <button className="secondary-action" type="button" onClick={() => setShowStoreModal(true)}>
                New store
              </button>
            </>
          )}
          <button className="secondary-action" type="button" onClick={handleLogout}>
            Logout
          </button>
          <SyncStatusBadge onClick={() => setActiveView('dashboard')} />
          {isOwner && activeView === 'pos' && (
            <button className="secondary-action" type="button" onClick={handleAddProduct}>
              New product
            </button>
          )}
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

      <nav className="view-tabs" aria-label="Main navigation">
        <button
          className={activeView === 'pos' ? 'tab-active' : ''}
          onClick={() => setActiveView('pos')}
          type="button"
        >
          Register
        </button>
        <button
          className={activeView === 'reports' ? 'tab-active' : ''}
          onClick={() => setActiveView('reports')}
          type="button"
        >
          Reports
        </button>
        {isOwner && (
          <>
            <button
              className={`${activeView === 'conflicts' ? 'tab-active' : ''} ${conflictCount > 0 ? 'tab-alert' : ''}`}
              onClick={() => setActiveView('conflicts')}
              type="button"
            >
              Conflicts {conflictCount > 0 && `(${conflictCount})`}
            </button>
            <button
              className={`${activeView === 'dlq' ? 'tab-active' : ''} ${dlqCount > 0 ? 'tab-alert' : ''}`}
              onClick={() => setActiveView('dlq')}
              type="button"
            >
              Dead Letters {dlqCount > 0 && `(${dlqCount})`}
            </button>
            <button
              className={activeView === 'dashboard' ? 'tab-active' : ''}
              onClick={() => setActiveView('dashboard')}
              type="button"
            >
              Dashboard
            </button>
            <button
              className={activeView === 'logs' ? 'tab-active' : ''}
              onClick={() => setActiveView('logs')}
              type="button"
            >
              Sync Logs
            </button>
          </>
        )}
      </nav>

      <AlertBanner className="m-4" />

      {activeView === 'pos' && (
        <>
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
              <span>Today&apos;s sales</span>
              <strong>{formatCurrency(todaySalesTotal)}</strong>
              <small>{sales.length} total invoices</small>
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
                      <div className="product-actions">
                        {isOwner && (
                          <button
                            className="secondary-action stock-btn"
                            onClick={() => setAdjustProduct(product)}
                            type="button"
                          >
                            Stock
                          </button>
                        )}
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

              {lastSale && (
                <div className="receipt-actions">
                  <select
                    aria-label="Receipt width"
                    value={receiptWidth}
                    onChange={(e) => setReceiptWidth(e.target.value as '58mm' | '80mm')}
                  >
                    <option value="58mm">58mm thermal</option>
                    <option value="80mm">80mm thermal</option>
                  </select>
                  <button className="secondary-action" onClick={handlePrintLastReceipt} type="button">
                    Print receipt
                  </button>
                </div>
              )}
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
        </>
      )}

      {activeView === 'reports' && <ReportsPanel analytics={analytics} />}

      {activeView === 'conflicts' && isOwner && (
        <ConflictPanel conflicts={conflicts} products={products} onResolved={refreshData} />
      )}

      {activeView === 'dlq' && isOwner && (
        <div className="p-4">
          <DeadLetterPanel />
        </div>
      )}

      {activeView === 'dashboard' && isOwner && (
        <SyncDashboard />
      )}

      {activeView === 'logs' && isOwner && (
        <SyncLogs />
      )}

      <ReceiptPrint
        sale={lastSale}
        products={products}
        storeName={activeStoreName}
        width={receiptWidth}
      />

      <StockAdjustModal
        product={adjustProduct}
        onClose={() => setAdjustProduct(null)}
        onAdjusted={refreshData}
      />

      {showStoreModal && (
        <div className="modal-overlay" role="presentation" onClick={() => setShowStoreModal(false)}>
          <form
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateStore}
            aria-labelledby="store-modal-title"
          >
            <h3 id="store-modal-title">Create New Store</h3>
            <p className="modal-subtitle">Setup a new branch for your tenant</p>

            <label className="modal-field">
              Store Name
              <input
                type="text"
                required
                placeholder="e.g., Lahore Main Branch"
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
                disabled={isCreatingStore}
              />
            </label>

            <label className="modal-field">
              Address (Optional)
              <input
                type="text"
                placeholder="e.g., Gulberg III"
                value={newStoreAddress}
                onChange={(e) => setNewStoreAddress(e.target.value)}
                disabled={isCreatingStore}
              />
            </label>

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={() => setShowStoreModal(false)}
                disabled={isCreatingStore}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-action"
                disabled={isCreatingStore || !newStoreName.trim()}
              >
                {isCreatingStore ? 'Creating...' : 'Create Store'}
              </button>
            </div>
          </form>
        </div>
      )}
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
