import { useState, useEffect, useRef, useCallback } from 'react';
import { Scan, Trash2 } from 'lucide-react';
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
        setProgress('Loading AI model...');
        const llmOk = await initLLMParser((p: LLMProgress) => {
          if (p.status === 'downloading') {
            setProgress(`Downloading AI model: ${Math.round(p.progress * 100)}%`);
          } else if (p.status === 'loading') {
            setProgress(`Loading AI model: ${Math.round(p.progress * 100)}%`);
          } else if (p.status === 'error') {
            setProgress(`AI model error: ${p.text}. Falling back to heuristic...`);
          }
        });

        if (llmOk) {
          setProgress('Analyzing receipt with AI...');
          const rawText = ocrResultToText(ocrResult);
          parsed = await parseReceiptWithLLM(rawText);
        } else {
          // Fall back to heuristic
          setProgress('Parsing text...');
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
