import { useState, useCallback, useEffect } from 'react';
import {
  Camera, ReceiptText, ChartPie, Settings,
  Search, ArrowLeft, Trash2, X
} from 'lucide-react';
import { cn } from './lib/utils';
import CaptureButton from './components/CaptureButton';
import ImagePreview from './components/ImagePreview';
import ReceiptForm from './components/ReceiptForm';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import SettingsPanel from './components/SettingsPanel';
import { db } from './lib/db';
import type { ParsedReceipt } from './lib/parser';
import type { ReceiptWithItems } from './lib/db';

type Tab = 'history' | 'capture' | 'analytics' | 'settings';
type CaptureStep = 'capture' | 'preview' | 'form';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('history');
  const [captureStep, setCaptureStep] = useState<CaptureStep>('capture');
  const [capturedImage, setCapturedImage] = useState<ImageBitmap | null>(null);
  const [parsedReceipt, setParsedReceipt] = useState<ParsedReceipt | null>(null);
  const [receipts, setReceipts] = useState<ReceiptWithItems[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptWithItems | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [dbReady, setDbReady] = useState(false);

  // Init DB — sets dbReady flag once PGlite is up
  useEffect(() => {
    db.init().then(() => setDbReady(true));
  }, []);

  const loadReceipts = useCallback(async () => {
    const list = searchQuery
      ? await db.searchReceipts(searchQuery)
      : await db.getReceipts(50);
    setReceipts(list);
  }, [searchQuery]);

  // Load receipts whenever searchQuery changes (and only after DB is ready)
  useEffect(() => {
    if (dbReady) loadReceipts();
  }, [dbReady, loadReceipts]);

  const handleCapture = useCallback((image: ImageBitmap) => {
    setCapturedImage(image);
    setCaptureStep('preview');
  }, []);

  const handleOcrResult = useCallback((parsed: ParsedReceipt) => {
    setParsedReceipt(parsed);
    setCaptureStep('form');
  }, []);

  const handleSaveReceipt = useCallback(async (data: {
    merchant: string;
    date: string;
    total: number;
    tax: number | null;
    lineItems: { description: string; amount: number; quantity: number | null }[];
  }) => {
    let imageDataUrl: string | undefined;
    if (capturedImage) {
      const canvas = document.createElement('canvas');
      canvas.width = capturedImage.width;
      canvas.height = capturedImage.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(capturedImage, 0, 0);
        imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      }
    }

    await db.insertReceipt({
      merchant_name: data.merchant,
      receipt_date: data.date,
      total: data.total,
      tax: data.tax ?? undefined,
      image_data_url: imageDataUrl,
      raw_ocr_text: parsedReceipt?.rawText,
      ocr_confidence: parsedReceipt?.confidence,
      line_items: data.lineItems.map(li => ({
        description: li.description,
        quantity: li.quantity ?? undefined,
        amount: li.amount,
      })),
    });

    if (capturedImage) capturedImage.close();
    setCapturedImage(null);
    setParsedReceipt(null);
    setCaptureStep('capture');
    await loadReceipts();
    setActiveTab('history');
  }, [capturedImage, parsedReceipt, loadReceipts]);

  const handleCancelCapture = useCallback(() => {
    if (capturedImage) capturedImage.close();
    setCapturedImage(null);
    setParsedReceipt(null);
    setCaptureStep('capture');
  }, [capturedImage]);

  const handleDeleteReceipt = useCallback(async () => {
    if (!selectedReceipt) return;
    await db.deleteReceipt(selectedReceipt.id);
    setSelectedReceipt(null);
    setShowDeleteConfirm(false);
    await loadReceipts();
  }, [selectedReceipt, loadReceipts]);

  const formatDate = (d: string | null) => {
    if (!d) return 'No date';
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  };

  return (
    <div className="flex flex-col h-dvh bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pt-safe">
        {selectedReceipt ? (
          <div className="flex items-center gap-3 h-14 px-4">
            <button
              onClick={() => setSelectedReceipt(null)}
              className="flex items-center justify-center h-11 w-11 rounded-lg hover:bg-muted min-h-[44px] min-w-[44px]"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-semibold tracking-tight truncate">
              {selectedReceipt.merchant_name || 'Receipt'}
            </h1>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center justify-center h-11 w-11 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive ml-auto min-h-[44px] min-w-[44px]"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 h-14 px-4">
            <h1 className="text-lg font-semibold tracking-tight">
              Receipt Ledger
            </h1>
            {activeTab === 'history' && (
              <div className="relative flex-1 max-w-xs ml-auto">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="w-full h-9 pl-9 pr-8 rounded-lg bg-input border border-border text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[44px]"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-20">
        {activeTab === 'history' && (
          <div className="p-4">
            {selectedReceipt ? (
              /* Detail view */
              <div className="flex flex-col gap-4">
                {/* Receipt image */}
                {selectedReceipt.image_data_url && (
                  <div className="rounded-xl overflow-hidden border border-border bg-black/50">
                    <img
                      src={selectedReceipt.image_data_url}
                      alt="Receipt"
                      className="w-full h-auto max-h-[40vh] object-contain"
                    />
                  </div>
                )}

                {/* Summary */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-card border border-border">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Date</p>
                    <p className="text-sm font-medium mt-0.5">{formatDate(selectedReceipt.receipt_date)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-card border border-border">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Total</p>
                    <p className="text-sm font-semibold mt-0.5 tabular-nums">
                      £{selectedReceipt.total?.toFixed(2) ?? '0.00'}
                    </p>
                  </div>
                  {selectedReceipt.tax !== null && selectedReceipt.tax !== undefined && (
                    <div className="p-3 rounded-lg bg-card border border-border">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Tax</p>
                      <p className="text-sm font-medium mt-0.5 tabular-nums">
                        £{Number(selectedReceipt.tax).toFixed(2)}
                      </p>
                    </div>
                  )}
                  {selectedReceipt.ocr_confidence !== null && selectedReceipt.ocr_confidence !== undefined && (
                    <div className="p-3 rounded-lg bg-card border border-border">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">OCR Confidence</p>
                      <p className="text-sm font-medium mt-0.5">
                        {Math.round(selectedReceipt.ocr_confidence * 100)}%
                      </p>
                    </div>
                  )}
                </div>

                {/* Line items */}
                {selectedReceipt.items.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Line Items</h3>
                    <div className="rounded-lg border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">Item</th>
                            <th className="text-right px-3 py-2 text-xs text-muted-foreground font-medium w-20">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedReceipt.items.map((item, i) => (
                            <tr key={i} className="border-t border-border">
                              <td className="px-3 py-2">
                                <span>{item.description}</span>
                                {item.quantity && item.quantity > 1 && (
                                  <span className="text-xs text-muted-foreground ml-1">×{item.quantity}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                £{item.amount !== null ? Number(item.amount).toFixed(2) : '0.00'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Delete confirmation */}
                {showDeleteConfirm && (
                  <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                    <p className="text-sm mb-3">Delete this receipt? This cannot be undone.</p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="flex-1 h-11 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium min-h-[44px]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDeleteReceipt}
                        className="flex-1 h-11 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium min-h-[44px]"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : receipts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <ReceiptText className="w-12 h-12 mb-4 opacity-30" />
                <p className="text-sm">
                  {searchQuery ? 'No matching receipts' : 'No receipts yet'}
                </p>
                <p className="text-xs mt-1 opacity-60">
                  {searchQuery ? 'Try a different search' : 'Tap the camera to scan your first receipt'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {receipts.map(receipt => (
                  <button
                    key={receipt.id}
                    onClick={() => setSelectedReceipt(receipt)}
                    className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border text-left hover:bg-accent transition-colors w-full"
                  >
                    {receipt.image_data_url ? (
                      <img
                        src={receipt.image_data_url}
                        alt="Receipt"
                        className="w-12 h-12 rounded-lg object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <ReceiptText className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {receipt.merchant_name || 'Unknown'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(receipt.receipt_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        £{receipt.total?.toFixed(2) ?? '0.00'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {receipt.items.length} item{receipt.items.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'capture' && (
          <div className="p-4">
            {captureStep === 'capture' && (
              <CaptureButton onCapture={handleCapture} />
            )}
            {captureStep === 'preview' && capturedImage && (
              <ImagePreview
                image={capturedImage}
                onResult={handleOcrResult}
                onCancel={handleCancelCapture}
              />
            )}
            {captureStep === 'form' && parsedReceipt && (
              <ReceiptForm
                parsed={parsedReceipt}
                onSave={handleSaveReceipt}
                onCancel={handleCancelCapture}
              />
            )}
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="p-4">
            <AnalyticsDashboard dbReady={dbReady} />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="p-4">
            <SettingsPanel />
          </div>
        )}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 border-t border-border bg-background pb-safe">
        <div className="flex items-center justify-around h-16">
          {([
            { id: 'history', icon: ReceiptText, label: 'Receipts' },
            { id: 'capture', icon: Camera, label: 'Scan' },
            { id: 'analytics', icon: ChartPie, label: 'Stats' },
            { id: 'settings', icon: Settings, label: 'Settings' },
          ] as const).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => {
                setSelectedReceipt(null);
                setActiveTab(id as Tab);
              }}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 min-h-[44px] min-w-[44px] px-3',
                'transition-colors duration-150',
                activeTab === id
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] leading-none">{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
