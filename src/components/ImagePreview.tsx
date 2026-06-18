import { useState, useEffect, useRef, useCallback } from 'react';
import { Scan, Trash2 } from 'lucide-react';
import type { OcrResult } from '@paddleocr/paddleocr-js';
import { initOCR, ocrImage } from '../lib/ocr';
import { parseReceipt, type ParsedReceipt } from '../lib/parser';
import { initLLMParser, parseReceiptWithLLM, ocrResultToText, type LLMProgress } from '../lib/llm-parser';
import { loadSettings } from '../lib/settings';

interface ImagePreviewProps {
  image: ImageBitmap;
  onResult: (parsed: ParsedReceipt) => void;
  onCancel: () => void;
}

// ── Bounding box overlay ─────────────────────────────────────────

function drawBoundingBoxes(
  overlayCtx: CanvasRenderingContext2D,
  ocrResult: OcrResult,
) {
  const items = ocrResult.items || [];
  if (!items.length) return;

  // Build a color gradient from top (blue) to bottom (pink) based on Y position
  const allY = items.map(i => Math.min(...i.poly.map(p => p[1])));
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);

  for (const item of items) {
    const pts = item.poly;
    if (!pts || pts.length < 4) continue;

    // Calculate bounding rect
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x;
    const h = Math.max(...ys) - y;

    // Color gradient based on vertical position (top=blue, bottom=pink)
    const yNorm = maxY > minY ? (Math.min(...ys) - minY) / (maxY - minY) : 0.5;
    const hue = 240 - yNorm * 100; // blue(240) → pink(300) → warm
    const alpha = 0.25 + (1 - item.score) * 0.15; // less confident = more opaque

    // Semi-transparent fill
    overlayCtx.fillStyle = `hsla(${hue}, 80%, 60%, ${alpha})`;
    overlayCtx.fillRect(x, y, w, h);

    // Border
    overlayCtx.strokeStyle = `hsla(${hue}, 80%, 60%, 0.7)`;
    overlayCtx.lineWidth = 1.5;
    overlayCtx.strokeRect(x, y, w, h);

    // Confidence badge
    const pct = Math.round(item.score * 100);
    overlayCtx.fillStyle = 'rgba(0,0,0,0.7)';
    const badgeW = 28;
    const badgeH = 14;
    const badgeX = x + w - badgeW - 2;
    const badgeY = y + 2;
    overlayCtx.fillRect(badgeX, badgeY, badgeW, badgeH);
    overlayCtx.fillStyle = '#fff';
    overlayCtx.font = '9px monospace';
    overlayCtx.textAlign = 'center';
    overlayCtx.fillText(`${pct}%`, badgeX + badgeW / 2, badgeY + 11);
  }
}

// ── Component ────────────────────────────────────────────────────

export default function ImagePreview({ image, onResult, onCancel }: ImagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [progressDetail, setProgressDetail] = useState('');
  const [ocrStats, setOcrStats] = useState<{ textCount: number; boxCount: number } | null>(null);

  // Draw the image on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);
  }, [image]);

  const handleExtract = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOcrStats(null);

    const settings = loadSettings();
    const useLLM = settings.parserMode === 'ai';

    try {
      // Step 1: OCR
      setProgress('Initializing OCR engine…');
      setProgressDetail('');
      await initOCR();

      setProgress('Scanning receipt…');
      const ocrResult = await ocrImage(image);

      // Draw bounding boxes on overlay
      const overlay = overlayRef.current;
      if (overlay && ocrResult.items?.length) {
        overlay.width = image.width;
        overlay.height = image.height;
        const octx = overlay.getContext('2d');
        if (octx) {
          drawBoundingBoxes(octx, ocrResult);
        }
      }

      const rawText = ocrResultToText(ocrResult);
      setOcrStats({
        textCount: rawText.length,
        boxCount: ocrResult.items?.length || 0,
      });

      // Step 2: Parse
      let parsed: ParsedReceipt;

      if (useLLM) {
        let llmOk = false;
        let llmErrorText: string | null = null;

        await initLLMParser(settings.aiModel, (p: LLMProgress) => {
          if (p.status === 'downloading' || p.status === 'loading') {
            setProgress(p.text);
          } else if (p.status === 'error') {
            llmErrorText = p.text;
            setProgress('');
          } else if (p.status === 'ready') {
            llmOk = true;
          }
        });

        if (llmOk) {
          setProgress('AI analyzing…');
          setProgressDetail(`${rawText.length} chars of text from ${ocrResult.items?.length || 0} detected regions`);
          parsed = await parseReceiptWithLLM(rawText, (p: LLMProgress) => {
            if (p.status === 'processing') {
              setProgress(p.text);
              setProgressDetail(`${rawText.length} chars from ${ocrResult.items?.length || 0} regions`);
            } else if (p.status === 'loading') {
              setProgress(p.text);
              setProgressDetail('');
            }
          });
        } else {
          setProgress('Falling back to heuristic parser…');
          setProgressDetail('');
          parsed = parseReceipt(ocrResult);
          parsed = {
            ...parsed,
            warning: `AI parser unavailable — used heuristic instead. ${llmErrorText || ''}`.trim(),
          };
        }
      } else {
        setProgress('Parsing text…');
        setProgressDetail(`${rawText.length} chars · ${ocrResult.items?.length || 0} regions`);
        parsed = parseReceipt(ocrResult);
      }

      onResult(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OCR failed');
    } finally {
      setLoading(false);
      setProgress('');
      setProgressDetail('');
    }
  }, [image, onResult]);

  return (
    <div className="flex flex-col gap-4">
      {/* Image display with OCR overlay */}
      <div className="relative rounded-xl overflow-hidden bg-black/50 border border-border">
        <canvas
          ref={canvasRef}
          className="w-full h-auto max-h-[50vh] object-contain"
          style={{ imageRendering: 'auto' }}
        />
        <canvas
          ref={overlayRef}
          className="absolute inset-0 w-full h-full max-h-[50vh] object-contain pointer-events-none"
          style={{ imageRendering: 'auto' }}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="flex gap-1">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{progress}</p>
          {progressDetail && (
            <p className="text-xs text-muted-foreground/60 -mt-2">{progressDetail}</p>
          )}
          {ocrStats && (
            <div className="flex gap-3 mt-1">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {ocrStats.boxCount} regions
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                {ocrStats.textCount} chars
              </span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {!loading && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center justify-center gap-2 h-12 px-5 bg-secondary text-secondary-foreground rounded-xl font-medium min-h-[44px]"
          >
            <Trash2 className="w-4 h-4" />
            <span className="text-sm">Discard</span>
          </button>
          <button
            type="button"
            onClick={handleExtract}
            className="flex-1 flex items-center justify-center gap-2 h-12 bg-primary text-primary-foreground rounded-xl font-medium transition-opacity hover:opacity-90 min-h-[44px]"
          >
            <Scan className="w-4 h-4" />
            <span className="text-sm">Extract Text</span>
          </button>
        </div>
      )}
    </div>
  );
}
