import { useEffect, useState } from 'react';
import { db, type Product, type Sale } from './db/db';
import { createLocalProduct, getAllLocalProducts } from './db/productsService';
import { checkoutLocalSale, getAllLocalSales } from './db/salesService';
import { processSyncQueue } from './db/syncEngine';

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [queueCount, setQueueCount] = useState<number>(0);
  const [cart, setCart] = useState<{ [key: string]: number }>({});

  // Refresh component state from our local IndexedDB storage
  async function refreshData() {
    const localProds = await getAllLocalProducts();
    const localSales = await getAllLocalSales();
    const queue = await db.syncQueue.toArray();
    
    setProducts(localProds);
    setSales(localSales);
    setQueueCount(queue.length);
  }

  useEffect(() => {
    refreshData();
  }, []);

  // --- ADDED FOR PHASE 2: Cloud Sync Trigger Handler ---
  async function handleSyncTrigger() {
    try {
      const res = await processSyncQueue();
      await refreshData(); // Force layout metrics and counters to recalculate
      alert(`Sync Complete! Successfully uploaded ${res.processedCount} operational intents to Supabase.`);
    } catch (err: any) {
      alert(`Sync Interrupted: ${err.message}`);
    }
  }

  // Handler to quickly generate an item without reloading the page
  async function handleAddProduct() {
    const names = ['Lays Masala', 'Pepsi 500ml', 'Sufi Cooking Oil 1L', 'Tapal Danedar 250g'];
    const randomName = names[Math.floor(Math.random() * names.length)];
    const randomPrice = Math.floor(Math.random() * 5) * 50 + 50; // 50 to 250 PKR
    
    await createLocalProduct(`${randomName}`, null, randomPrice, 50);
    refreshData();
  }

  function addToCart(productId: string) {
    setCart(prev => ({ ...prev, [productId]: (prev[productId] || 0) + 1 }));
  }

  async function handleCheckout() {
    const cartItems = Object.entries(cart)
      .filter(([_, qty]) => qty > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));

    if (cartItems.length === 0) return alert("Your cart is empty!");

    try {
      await checkoutLocalSale(cartItems);
      setCart({}); // Clear component cart state
      await refreshData(); // Rerender matching state from storage disk
      alert("Checkout Successful! Stock reduced and logged offline.");
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', backgroundColor: '#121212', color: '#fff', minHeight: '100vh' }}>
      <h1 style={{ color: '#646cff', margin: 0 }}>DukanSync Sandbox Console</h1>
      <p style={{ color: '#aaa' }}>Phase 1 Core Loop & Phase 2 Sync Engine Active Sandbox.</p>

      {/* Control Dashboard Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', margin: '2rem 0' }}>
        <div style={{ background: '#1e1e1e', padding: '1rem', borderRadius: '8px', border: '1px solid #333' }}>
          <h3>Operations</h3>
          <button onClick={handleAddProduct} style={{ padding: '8px 16px', background: '#646cff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
            ➕ Create Random Product
          </button>
        </div>

        {/* UPDATED FOR PHASE 2: Appended the Cloud Sync Command Button */}
        <div style={{ background: '#1e1e1e', padding: '1rem', borderRadius: '8px', border: '1px solid #333', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: '0 0 5px 0' }}>Sync Queue Logs</h3>
            <p style={{ fontSize: '1.5rem', margin: '5px 0', fontWeight: 'bold', color: '#ffd700' }}>🔄 {queueCount} Operations</p>
          </div>
          <button 
            onClick={handleSyncTrigger} 
            style={{ 
              padding: '8px 16px', 
              background: '#ffd700', 
              color: '#000', 
              border: 'none', 
              borderRadius: '4px', 
              cursor: 'pointer', 
              fontWeight: 'bold',
              marginTop: '10px'
            }}
          >
            🚀 Force Sync to Cloud
          </button>
        </div>

        <div style={{ background: '#1e1e1e', padding: '1rem', borderRadius: '8px', border: '1px solid #333' }}>
          <h3>Current Cart Total</h3>
          <button onClick={handleCheckout} style={{ padding: '8px 16px', background: '#4caf50', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', width: '100%' }}>
            🛒 Checkout Out Items
          </button>
        </div>
      </div>

      {/* Core Inventory Catalog Deck */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        <div>
          <h2>Available Catalog Inventory</h2>
          {products.length === 0 && <p style={{ color: '#555' }}>No items found. Click 'Create Random Product' above.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {products.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#1a1a1a', borderRadius: '6px', alignItems: 'center' }}>
                <div>
                  <strong>{p.name}</strong> <br/>
                  <small style={{ color: '#888' }}>Price: {p.price} PKR | Stock: <span style={{ color: p.stock < 10 ? '#ff6b6b' : '#4caf50' }}>{p.stock} units</span></small>
                </div>
                <button onClick={() => addToCart(p.id)} style={{ padding: '4px 8px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer' }}>
                  Add to Invoice ({cart[p.id] || 0})
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Sales Log History Deck */}
        <div>
          <h2>Local Sales Invoices Generated</h2>
          {sales.length === 0 && <p style={{ color: '#555' }}>No sales processed yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {sales.map((s, index) => (
              <div key={s.id} style={{ padding: '10px', background: '#1a1a1a', borderRadius: '6px', borderLeft: '4px solid #4caf50' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>Invoice #{index + 1}</strong>
                  <span style={{ color: '#ffd700' }}>{s.total} PKR</span>
                </div>
                <small style={{ color: '#666', display: 'block', fontSize: '0.75rem' }}>
                  UUID: {s.id}
                </small>
                <div style={{ marginTop: '5px', fontSize: '0.85rem', color: '#aaa' }}>
                  Items sold: {s.items.reduce((acc, item) => acc + item.quantity, 0)} units
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;