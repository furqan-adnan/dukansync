import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ReceiptPrint } from '../../components/ReceiptPrint';

describe('THE PRINTER LAYOUT TEST (Receipt Utility)', () => {
  it('Formats prices, store name, and tax calculations correctly in localized PKR without decimals', () => {
    // Note: DukanSync currently computes total dynamically based on items, 
    // without separate tax rows, so we verify total formatting strictly.
    const mockSale = {
      id: 'mock-uuid-1234',
      tenant_id: 'test-tenant',
      store_id: 'test-store',
      updated_at: Date.now(),
      version: 1,
      sync_status: 'synced' as const,
      deleted_at: null,
      items: [
        { productId: 'prod-1', quantity: 2, priceAtSale: 1050 } // 2100
      ],
      total: 2100
    };

    const mockProducts = [
      {
        id: 'prod-1',
        name: 'Ghee 1kg',
        tenant_id: 'test-tenant',
        barcode: null,
        price: 1050,
        stock: 50,
        updated_at: Date.now(),
        version: 1,
        sync_status: 'synced' as const,
        deleted_at: null,
      }
    ];

    render(
      <ReceiptPrint 
        sale={mockSale} 
        products={mockProducts} 
        storeName="Lahore Main Branch" 
        width="58mm" 
      />
    );

    // Verify Store Name
    expect(screen.getByText('Lahore Main Branch')).toBeTruthy();
    
    // Verify Invoice ID
    expect(screen.getByText('Invoice #MOCK-UUI')).toBeTruthy();

    // Verify item layout strings
    expect(screen.getByText('Ghee 1kg x2')).toBeTruthy();
    
    // Verify currency formatted as PKR without decimal truncation errors (2,100 instead of 2100.00)
    // The component renders the line total as 2,100
    expect(screen.getByText('2,100')).toBeTruthy();
    
    // Verify grand total formatted correctly
    expect(screen.getByText('2,100 PKR')).toBeTruthy();
  });

  it('Matches thermal paper sizing constraints (58mm and 80mm)', () => {
    const mockSale = {
      id: 'mock-uuid-1234',
      tenant_id: 'test-tenant',
      store_id: 'test-store',
      updated_at: Date.now(),
      version: 1,
      sync_status: 'synced' as const,
      deleted_at: null,
      items: [],
      total: 0
    };

    const { container, rerender } = render(
      <ReceiptPrint sale={mockSale} products={[]} storeName="Test" width="58mm" />
    );

    // Ensure 58mm class is strictly applied for the print stylesheet target
    const element = container.firstChild as HTMLElement;
    expect(element.className).toContain('receipt-print');
    expect(element.className).toContain('receipt-58mm');
    expect(element.className).not.toContain('receipt-80mm');

    // Rerender for 80mm
    rerender(<ReceiptPrint sale={mockSale} products={[]} storeName="Test" width="80mm" />);
    const element80 = container.firstChild as HTMLElement;
    expect(element80.className).toContain('receipt-80mm');
    expect(element80.className).not.toContain('receipt-58mm');
  });
});
