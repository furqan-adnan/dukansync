import type { AnalyticsSummary } from '../db/reportsService';

interface ReportsPanelProps {
  analytics: AnalyticsSummary | null;
}

function formatCurrency(amount: number): string {
  return `${amount.toLocaleString('en-PK')} PKR`;
}

export function ReportsPanel({ analytics }: ReportsPanelProps) {
  if (!analytics) {
    return (
      <section className="reports-grid" aria-labelledby="reports-heading">
        <div className="panel-header" style={{ gridColumn: '1 / -1' }}>
          <div>
            <p className="eyebrow">Analytics</p>
            <h2 id="reports-heading">Sales Reports</h2>
          </div>
          <small className="reports-note">Loading analytics...</small>
        </div>
      </section>
    );
  }

  const { todayTotal, dailySummaries, bestSellers } = analytics;

  return (
    <section className="reports-grid" aria-labelledby="reports-heading">
      <div className="panel-header" style={{ gridColumn: '1 / -1' }}>
        <div>
          <p className="eyebrow">Analytics</p>
          <h2 id="reports-heading">Sales Reports</h2>
        </div>
        <small className="reports-note">Server-side aggregation when online · local data shown here</small>
      </div>

      <article className="metric-card">
        <span>Today&apos;s sales</span>
        <strong>{formatCurrency(todayTotal)}</strong>
        <small>Excludes conflicted invoices</small>
      </article>

      <article className="metric-card">
        <span>7-day invoices</span>
        <strong>{dailySummaries.reduce((sum, d) => sum + d.invoiceCount, 0)}</strong>
        <small>{dailySummaries.reduce((sum, d) => sum + d.itemCount, 0)} items sold</small>
      </article>

      <section className="history-panel reports-table-panel">
        <div className="panel-header compact">
          <h3>Daily breakdown</h3>
        </div>
        <div className="reports-table">
          {dailySummaries.map((day) => (
            <div className="reports-row" key={day.date}>
              <span>{day.date}</span>
              <span>{day.invoiceCount} invoices</span>
              <strong>{formatCurrency(day.totalSales)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="history-panel reports-table-panel">
        <div className="panel-header compact">
          <h3>Best sellers</h3>
        </div>
        <div className="reports-table">
          {bestSellers.length === 0 && (
            <div className="empty-state">
              <strong>No sales data yet</strong>
            </div>
          )}
          {bestSellers.map((item, i) => (
            <div className="reports-row" key={item.productId}>
              <span>#{i + 1} {item.productName}</span>
              <span>{item.quantitySold} sold</span>
              <strong>{formatCurrency(item.revenue)}</strong>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
