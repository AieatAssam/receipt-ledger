import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, ReceiptText, Store, Receipt } from 'lucide-react';
import { db, type Analytics } from '../lib/db';

export default function AnalyticsDashboard() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.getAnalytics();
      setAnalytics(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex gap-1">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!analytics || analytics.receipt_count === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <TrendingUp className="w-12 h-12 mb-4 opacity-30" />
        <p className="text-sm">No data yet</p>
        <p className="text-xs mt-1 opacity-60">Scan receipts to see your spending</p>
      </div>
    );
  }

  const topCategories = analytics.by_category.slice(0, 5);
  const maxCategoryTotal = Math.max(...topCategories.map(c => c.total), 1);

  return (
    <div className="flex flex-col gap-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-xl bg-card border border-border">
          <div className="flex items-center gap-2 mb-1">
            <ReceiptText className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Spent</p>
          </div>
          <p className="text-xl font-bold tabular-nums">
            £{analytics.total_spent.toFixed(2)}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-card border border-border">
          <div className="flex items-center gap-2 mb-1">
            <Receipt className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Receipts</p>
          </div>
          <p className="text-xl font-bold tabular-nums">
            {analytics.receipt_count}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-card border border-border">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Avg Receipt</p>
          </div>
          <p className="text-xl font-bold tabular-nums">
            £{analytics.avg_receipt.toFixed(2)}
          </p>
        </div>
        {analytics.top_merchant && (
          <div className="p-4 rounded-xl bg-card border border-border">
            <div className="flex items-center gap-2 mb-1">
              <Store className="w-4 h-4 text-primary" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Top Merchant</p>
            </div>
            <p className="text-sm font-semibold truncate">{analytics.top_merchant}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              £{analytics.top_merchant_total.toFixed(2)}
            </p>
          </div>
        )}
      </div>

      {/* Category breakdown */}
      {topCategories.length > 0 && (
        <div className="rounded-xl bg-card border border-border p-4">
          <h3 className="text-sm font-semibold mb-3">By Category</h3>
          <div className="flex flex-col gap-2">
            {topCategories.map(cat => (
              <div key={cat.category} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{cat.category}</span>
                  <span className="font-medium tabular-nums">£{cat.total.toFixed(2)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${(cat.total / maxCategoryTotal) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly spend */}
      {analytics.monthly_spend.length > 0 && (
        <div className="rounded-xl bg-card border border-border p-4">
          <h3 className="text-sm font-semibold mb-3">Monthly Spend</h3>
          <div className="flex items-end gap-2 h-32">
            {analytics.monthly_spend.map(m => {
              const maxTotal = Math.max(...analytics.monthly_spend.map(x => x.total), 1);
              const height = (m.total / maxTotal) * 100;
              const monthLabel = m.month.slice(5); // "2026-06" → "06"
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    £{m.total.toFixed(0)}
                  </span>
                  <div
                    className="w-full rounded-t-sm bg-primary/60 transition-all min-h-[2px]"
                    style={{ height: `${Math.max(height, 2)}%` }}
                  />
                  <span className="text-[10px] text-muted-foreground">{monthLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
