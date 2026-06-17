import { useState } from 'react';
import { Save, Plus, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ParsedReceipt } from '../lib/parser';

interface ReceiptFormProps {
  parsed: ParsedReceipt;
  onSave: (data: {
    merchant: string;
    date: string;
    total: number;
    tax: number | null;
    lineItems: { description: string; amount: number; quantity: number | null }[];
  }) => void;
  onCancel: () => void;
}

export default function ReceiptForm({ parsed, onSave, onCancel }: ReceiptFormProps) {
  const [merchant, setMerchant] = useState(parsed.merchant || '');
  const [date, setDate] = useState(parsed.date || new Date().toISOString().slice(0, 10));
  const [total, setTotal] = useState(parsed.total?.toString() || '');
  const [tax, setTax] = useState(parsed.tax?.toString() || '');
  const [lineItems, setLineItems] = useState(
    parsed.lineItems.length > 0
      ? parsed.lineItems.map(li => ({
          description: li.description,
          amount: li.amount?.toString() || '',
          quantity: li.quantity?.toString() || '',
        }))
      : [{ description: '', amount: '', quantity: '' }]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const totalNum = parseFloat(total);
    if (isNaN(totalNum) || totalNum <= 0) return;

    onSave({
      merchant: merchant.trim(),
      date,
      total: totalNum,
      tax: tax ? parseFloat(tax) : null,
      lineItems: lineItems
        .filter(li => li.description.trim())
        .map(li => ({
          description: li.description.trim(),
          amount: parseFloat(li.amount) || 0,
          quantity: li.quantity ? parseInt(li.quantity, 10) : null,
        })),
    });
  };

  const updateLineItem = (index: number, field: string, value: string) => {
    setLineItems(prev =>
      prev.map((li, i) => (i === index ? { ...li, [field]: value } : li))
    );
  };

  const removeLineItem = (index: number) => {
    setLineItems(prev => prev.filter((_, i) => i !== index));
  };

  const addLineItem = () => {
    setLineItems(prev => [...prev, { description: '', amount: '', quantity: '' }]);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Confidence badge */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'px-2 py-0.5 rounded-full text-xs font-medium',
            parsed.confidence > 0.8
              ? 'bg-emerald-500/10 text-emerald-400'
              : parsed.confidence > 0.5
                ? 'bg-amber-500/10 text-amber-400'
                : 'bg-red-500/10 text-red-400'
          )}
        >
          OCR: {Math.round(parsed.confidence * 100)}%
        </span>
      </div>

      {/* Merchant */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Merchant
        </label>
        <input
          type="text"
          value={merchant}
          onChange={e => setMerchant(e.target.value)}
          className="h-11 px-3 rounded-lg bg-input border border-border text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[44px]"
          placeholder="Merchant name"
          required
        />
      </div>

      {/* Date + Total row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="h-11 px-3 rounded-lg bg-input border border-border text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[44px]"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Total (£)
          </label>
          <input
            type="number"
            step="0.01"
            value={total}
            onChange={e => setTotal(e.target.value)}
            className="h-11 px-3 rounded-lg bg-input border border-border text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[44px]"
            placeholder="0.00"
            required
          />
        </div>
      </div>

      {/* Tax */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Tax (£) <span className="text-muted-foreground/50">(optional)</span>
        </label>
        <input
          type="number"
          step="0.01"
          value={tax}
          onChange={e => setTax(e.target.value)}
          className="h-11 px-3 rounded-lg bg-input border border-border text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[44px]"
          placeholder="0.00"
        />
      </div>

      {/* Line items */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Line Items
          </label>
          <button
            type="button"
            onClick={addLineItem}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 min-h-[44px] min-w-[44px] justify-center"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {lineItems.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={item.description}
                onChange={e => updateLineItem(i, 'description', e.target.value)}
                className="flex-1 h-11 px-3 rounded-lg bg-input border border-border text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[44px]"
                placeholder="Item description"
              />
              <input
                type="number"
                step="0.01"
                value={item.amount}
                onChange={e => updateLineItem(i, 'amount', e.target.value)}
                className="w-20 h-11 px-2 rounded-lg bg-input border border-border text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring min-h-[44px]"
                placeholder="0.00"
              />
              <button
                type="button"
                onClick={() => removeLineItem(i)}
                className="flex items-center justify-center h-11 w-11 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 min-h-[44px] min-w-[44px]"
                disabled={lineItems.length <= 1}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Raw OCR text (expandable) */}
      {parsed.rawText && (
        <details className="group">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors py-2 min-h-[44px] flex items-center">
            View raw OCR text
          </summary>
          <pre className="mt-2 p-3 rounded-lg bg-muted text-xs text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto">
            {parsed.rawText}
          </pre>
        </details>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 flex items-center justify-center h-12 rounded-xl bg-secondary text-secondary-foreground font-medium text-sm min-h-[44px]"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 flex items-center justify-center gap-2 h-12 rounded-xl bg-primary text-primary-foreground font-medium text-sm min-h-[44px]"
        >
          <Save className="w-4 h-4" />
          Save Receipt
        </button>
      </div>
    </form>
  );
}
