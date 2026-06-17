import type { MLCEngine } from '@mlc-ai/web-llm';
import type { OcrResult } from '@paddleocr/paddleocr-js';
import type { ParsedReceipt, ParsedLineItem } from './parser';

// ── Types ────────────────────────────────────────────────────────

export type ParserMode = 'heuristic' | 'ai';

export interface LLMProgress {
  status: 'downloading' | 'loading' | 'ready' | 'error';
  progress: number; // 0-1
  text: string;
}

export interface LLMStatus {
  supported: boolean;
  reason?: string; // why it's not supported, if applicable
}

// ── Model config ─────────────────────────────────────────────────

// Smallest viable model for receipt parsing (~400MB)
const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

// ── Engine singleton ─────────────────────────────────────────────

let engine: MLCEngine | null = null;
let initPromise: Promise<MLCEngine> | null = null;
let initError: string | null = null;

// ── WebGPU detection ─────────────────────────────────────────────

export async function checkLLMSupport(): Promise<LLMStatus> {
  // Check WebGPU API existence
  if (!('gpu' in navigator)) {
    return {
      supported: false,
      reason:
        'WebGPU is not available in this browser. ' +
        'AI parser requires Chrome 113+, Edge 113+, or Firefox 130+.',
    };
  }

  // Check if we can get a GPU adapter
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return {
        supported: false,
        reason:
          'No GPU adapter found. Your device may not support WebGPU, ' +
          'or GPU acceleration may be disabled.',
      };
    }
  } catch (err) {
    return {
      supported: false,
      reason:
        'WebGPU access denied: ' +
        (err instanceof Error ? err.message : 'Unknown error'),
    };
  }

  return { supported: true };
}

// ── Prompt template ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a receipt parser. Your job is to extract structured data from OCR'd receipt text.

Given the raw text from a store receipt, identify:
- merchant: The store/business name (usually at the top)
- date: The transaction date in YYYY-MM-DD format
- total: The final total amount (just the number, no currency symbol)
- tax: Any tax/VAT amount listed (just the number, or null if not present)
- line_items: Array of {description, amount, quantity} for each purchased item

Rules:
- Extract EXACTLY what's on the receipt. Do not invent data.
- If a field is not found, use null.
- For line items, amount should be the total for that item (unit price × quantity if shown).
- quantity is the count/weight, or null if not specified.
- Ignore boilerplate text (store addresses, phone numbers, thank-you messages, payment instructions).
- Return ONLY valid JSON, no other text.`;

function buildUserPrompt(rawText: string): string {
  return `Parse this receipt text into JSON:

${rawText}

Return ONLY the JSON object with this exact structure:
{
  "merchant": "Store Name or null",
  "date": "YYYY-MM-DD or null",
  "total": 12.34,
  "tax": 1.23,
  "line_items": [
    {"description": "Item name", "amount": 5.99, "quantity": 2}
  ]
}`;
}

// ── Init ─────────────────────────────────────────────────────────

export async function initLLMParser(
  onProgress?: (p: LLMProgress) => void,
): Promise<boolean> {
  // Already initialized
  if (engine) return true;

  // Already failed — report the error again
  if (initError) {
    onProgress?.({ status: 'error', progress: 0, text: initError });
    return false;
  }

  // Already initializing
  if (initPromise) {
    try {
      await initPromise;
      return true;
    } catch {
      return false;
    }
  }

  // Check WebGPU support first
  const gpuStatus = await checkLLMSupport();
  if (!gpuStatus.supported) {
    initError = gpuStatus.reason || 'WebGPU not available';
    onProgress?.({ status: 'error', progress: 0, text: initError });
    return false;
  }

  onProgress?.({ status: 'downloading', progress: 0, text: 'Loading AI model...' });

  initPromise = (async () => {
    // Dynamic import so Vite can code-split the ~6MB WebLLM JS bundle
    const { CreateMLCEngine } = await import('@mlc-ai/web-llm');

    engine = await CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (p: { progress: number; text: string }) => {
        const status: LLMProgress['status'] =
          p.progress === 1 ? 'ready' : p.progress > 0 ? 'loading' : 'downloading';
        onProgress?.({
          status,
          progress: p.progress,
          text: p.text || 'Loading...',
        });
      },
    });

    return engine;
  })();

  try {
    await initPromise;
    onProgress?.({ status: 'ready', progress: 1, text: 'AI model ready' });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    // Make error user-friendly
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      initError =
        'Failed to download AI model. Check your internet connection. ' +
        'The model is ~400MB and needs to be downloaded once.';
    } else if (msg.includes('WebGPU')) {
      initError = 'WebGPU not available. AI parser requires a GPU-accelerated browser.';
    } else {
      initError = `AI model failed to load: ${msg}`;
    }
    engine = null;
    initPromise = null;
    onProgress?.({ status: 'error', progress: 0, text: initError });
    return false;
  }
}

// ── Parse ────────────────────────────────────────────────────────

function extractJson(text: string): string {
  // Try to find JSON between braces
  const match = text.match(/\{[\s\S]*\}/);
  if (match) return match[0];

  // Try to find JSON array
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) return arrMatch[0];

  return text;
}

function parseLLMJson(jsonStr: string, rawText: string): ParsedReceipt {
  try {
    const data = JSON.parse(jsonStr);

    const lineItems: ParsedLineItem[] = (data.line_items || []).map(
      (li: Record<string, unknown>) => ({
        description: String(li.description || ''),
        amount: typeof li.amount === 'number' ? li.amount : null,
        quantity: typeof li.quantity === 'number' ? li.quantity : null,
        confidence: 0.95, // LLM confidence
      }),
    );

    return {
      merchant: data.merchant || null,
      date: data.date || null,
      total: typeof data.total === 'number' ? data.total : null,
      tax: typeof data.tax === 'number' ? data.tax : null,
      lineItems,
      confidence: lineItems.length > 0 ? 0.85 : 0.3,
      rawText,
    };
  } catch {
    // If JSON parsing fails, return empty result
    return {
      merchant: null,
      date: null,
      total: null,
      tax: null,
      lineItems: [],
      confidence: 0,
      rawText,
    };
  }
}

export async function parseReceiptWithLLM(rawText: string): Promise<ParsedReceipt> {
  if (!engine) {
    throw new Error('LLM parser not initialized. Call initLLMParser() first.');
  }

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserPrompt(rawText) },
  ];

  const reply = await engine.chat.completions.create({
    messages,
    temperature: 0,
    max_tokens: 1000,
  });

  const content = reply.choices[0]?.message?.content || '';
  const json = extractJson(content);
  return parseLLMJson(json, rawText);
}

// ── Text extraction from OCR results ─────────────────────────────

export function ocrResultToText(result: OcrResult): string {
  if (!result.items?.length) return '';

  // Sort by Y coordinate (top to bottom), then X (left to right)
  const sorted = [...result.items].sort((a, b) => {
    const aY = Math.min(...a.poly.map(p => p[1]));
    const bY = Math.min(...b.poly.map(p => p[1]));
    if (Math.abs(aY - bY) < 10) {
      const aX = Math.min(...a.poly.map(p => p[0]));
      const bX = Math.min(...b.poly.map(p => p[0]));
      return aX - bX;
    }
    return aY - bY;
  });

  return sorted.map(item => item.text).join('\n');
}

// ── Dispose ──────────────────────────────────────────────────────

export function disposeLLMParser(): void {
  if (engine) {
    engine = null;
  }
  initPromise = null;
  initError = null;
}

// ── Status ───────────────────────────────────────────────────────

export function isLLMReady(): boolean {
  return engine !== null;
}

export function getLLMError(): string | null {
  return initError;
}
