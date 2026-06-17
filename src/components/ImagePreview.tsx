import { useState, useEffect, useRef, useCallback } from 'react';
import { Scan, Trash2, AlertTriangle } from 'lucide-react';
import { initOCR, ocrImage } from '../lib/ocr';
import { parseReceipt, type ParsedReceipt } from '../lib/parser';
import { initLLMParser, parseReceiptWithLLM, ocrResultToText, type LLMProgress } from '../lib/llm-parser';
import { loadSettings } from '../lib/settings';

interface ImagePreviewProps {
  image: ImageBitmap;
  onResult: (parsed: ParsedReceipt) => void;
  onCancel: () => void;
}

export default function ImagePreview({ image, onResult, onCancel }: ImagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [llmFailed, setLlmFailed] = useState(false);

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
    setLlmFailed(false);

    const settings = loadSettings();
    const useLLM = settings.parserMode === 'ai';

    try {
      // Step 1: OCR
      setProgress('Initializing OCR engine...');
      await initOCR();

      setProgress('Processing image...');
      const ocrResult = await ocrImage(image);

      // Step 2: Parse
      let parsed: ParsedReceipt;

      if (useLLM) {
        // LLM path
        let llmOk = false;
        let llmErrorText: string | null = null;

        await initLLMParser((p: LLMProgress) => {
          if (p.status === 'downloading') {
            setProgress(`Downloading AI model: ${Math.round(p.progress * 100)}%`);
          } else if (p.status === 'loading') {
            setProgress(`Loading AI model: ${Math.round(p.progress * 100)}%`);
          } else if (p.status === 'error') {
            llmErrorText = p.text;
            setProgress('');
          } else if (p.status === 'ready') {
            llmOk = true;
          }
        });

        if (llmOk) {
          setProgress('Analyzing receipt with AI...');
          const rawText = ocrResultToText(ocrResult);
          parsed = await parseReceiptWithLLM(rawText);
        } else {
          // Show the error and fall back to heuristic
          setLlmFailed(true);
          if (llmErrorText) {
            setError(llmErrorText);
          }
          setProgress('Falling back to heuristic parser...');
          parsed = parseReceipt(ocrResult);
        }
      } else {
        // Heuristic path
        setProgress('Parsing text...');
        parsed = parseReceipt(ocrResult);
      }

      onResult(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OCR failed');
    } finally {
      setLoading(false);
      setProgress('');
    }
  }, [image, onResult]);

  return (
    <div className="flex flex-col gap-4">
      {/* Image display */}
      <div className="relative rounded-xl overflow-hidden bg-black/50 border border-border">
        <canvas
          ref={canvasRef}
          className="w-full h-auto max-h-[50vh] object-contain"
          style={{ imageRendering: 'auto' }}
        />
      </div>

      {/* LLM fallback notice */}
      {llmFailed && !loading && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">AI parser unavailable — used heuristic instead</p>
              {error && <p className="mt-1 text-xs opacity-80">{error}</p>}
              <p className="mt-1 text-xs opacity-60">
                Switch to Heuristic parser in Settings to skip this warning next time.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && !llmFailed && (
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
