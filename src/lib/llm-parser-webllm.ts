import type { ParsedReceipt, ParsedLineItem } from './parser';

// ── Types ────────────────────────────────────────────────────────

export type LLMBackend = 'webllm' | 'wllama';

export interface WebLLMProgress {
  status: 'downloading' | 'loading' | 'ready' | 'processing' | 'error';
  progress: number; // 0-1
  text: string;
}

// ── Model catalog ────────────────────────────────────────────────

export interface WebLLMModelEntry {
  id: string;
  mlcId: string;           // MLC model ID for @mlc-ai/web-llm
  name: string;
  architecture: string;
  sizeMB: number;
  description: string;
}

export const WEBLLM_MODEL_CATALOG: WebLLMModelEntry[] = [
  {
    id: 'smollm2-360m-webllm',
    mlcId: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 360M',
    architecture: 'SmolLM',
    sizeMB: 376,
    description: 'Fastest GPU option. Smallest download, fits any phone.',
  },
  {
    id: 'qwen2.5-0.5b-webllm',
    mlcId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 0.5B',
    architecture: 'Qwen',
    sizeMB: 945,
    description: 'Best quality for receipts. Larger download, needs >2GB free RAM.',
  },
  {
    id: 'tinyllama-1.1b-webllm',
    mlcId: 'TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC',
    name: 'TinyLlama 1.1B',
    architecture: 'Llama',
    sizeMB: 697,
    description: 'Middle ground. Good general understanding.',
  },
];

const DEFAULT_WEBLLM_MODEL = 'smollm2-360m-webllm';

export function getWebLLMModelEntry(id: string): WebLLMModelEntry {
  return WEBLLM_MODEL_CATALOG.find(m => m.id === id) || WEBLLM_MODEL_CATALOG[0];
}

// ── Prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = 'OCR receipt. Format: yN xN text | xN text. Left x<120=item, right x>120=price. Same y=related. JSON: {merchant,date,total,tax,line_items:[{description,amount,quantity}]}';

// With GPU, we can afford more context
function buildUserPrompt(rawText: string): string {
  // GPU is fast — allow up to 4000 chars (still generous headroom)
  if (rawText.length <= 4000) return rawText;
  return rawText.slice(0, 3999) + '…';
}

// ── WebLLM singleton ─────────────────────────────────────────────

let engine: Awaited<ReturnType<typeof createWebLLMEngine>> | null = null;
let initPromise: Promise<boolean> | null = null;
let initError: string | null = null;
let currentModelId: string | null = null;

async function createWebLLMEngine(modelId: string, onProgress?: (p: WebLLMProgress) => void) {
  const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
  const entry = getWebLLMModelEntry(modelId);

  const eng = await CreateMLCEngine(entry.mlcId, {
    initProgressCallback: (report) => {
      const pct = report.progress ?? 0;
      if (pct < 0.95) {
        onProgress?.({
          status: 'downloading',
          progress: pct,
          text: `Loading ${entry.name}: ${Math.round(pct * 100)}%`,
        });
      } else {
        onProgress?.({
          status: 'loading',
          progress: pct,
          text: `Loading ${entry.name} into GPU memory…`,
        });
      }
    },
  });

  return eng;
}

// ── Init ─────────────────────────────────────────────────────────

export async function initWebLLMParser(
  modelId: string = DEFAULT_WEBLLM_MODEL,
  onProgress?: (p: WebLLMProgress) => void,
): Promise<boolean> {
  if (engine && currentModelId === modelId) {
    return true;
  }

  if (engine && currentModelId !== modelId) {
    await disposeWebLLMParser();
  }

  if (initError) {
    onProgress?.({ status: 'error', progress: 0, text: initError });
    return false;
  }

  if (initPromise) {
    return initPromise;
  }

  const entry = getWebLLMModelEntry(modelId);

  initPromise = (async (): Promise<boolean> => {
    try {
      engine = await createWebLLMEngine(modelId, onProgress);
      currentModelId = modelId;
      onProgress?.({ status: 'ready', progress: 1, text: `${entry.name} ready (WebGPU)` });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('WebGPU') || msg.includes('GPU') || msg.includes('gpu')) {
        initError = 'WebGPU not available. Switch to wllama (CPU) backend or use heuristic mode.';
      } else {
        initError = `Failed to load ${entry.name}: ${msg}`;
      }
      engine = null;
      currentModelId = null;
      onProgress?.({ status: 'error', progress: 0, text: initError });
      return false;
    }
  })();

  try {
    const ok = await initPromise;
    initPromise = null;
    return ok;
  } catch {
    initPromise = null;
    return false;
  }
}

// ── Parse ────────────────────────────────────────────────────────

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) return match[0];
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) return arrMatch[0];
  return text;
}

function parseJSON(jsonStr: string, rawText: string): ParsedReceipt {
  try {
    const data = JSON.parse(jsonStr);
    const lineItems: ParsedLineItem[] = (data.line_items || []).map(
      (li: Record<string, unknown>) => ({
        description: String(li.description || ''),
        amount: typeof li.amount === 'number' ? li.amount : null,
        quantity: typeof li.quantity === 'number' ? li.quantity : null,
        confidence: 0.95,
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
    return {
      merchant: null, date: null, total: null, tax: null,
      lineItems: [], confidence: 0, rawText,
    };
  }
}

const INFERENCE_TIMEOUT_MS = 60_000; // 1 minute on GPU (should be <10s normally)

export async function parseReceiptWithWebLLM(
  rawText: string,
  onProgress?: (p: WebLLMProgress) => void,
): Promise<ParsedReceipt> {
  if (!engine) {
    throw new Error('WebLLM not initialized. Call initWebLLMParser() first.');
  }

  const inputText = buildUserPrompt(rawText);
  const estTokens = Math.round(inputText.length / 3.0);
  onProgress?.({
    status: 'processing',
    progress: 0,
    text: `Processing ${inputText.length} chars (~${estTokens} tokens) on GPU…`,
  });

  let fullContent = '';
  let lastReportTime = Date.now();
  let firstToken = true;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('GPU inference timed out — may have run out of memory.')), INFERENCE_TIMEOUT_MS),
  );

  try {
    const streamPromise = (async () => {
      const chunks = await engine!.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: inputText },
        ],
        temperature: 0.1,
        max_tokens: 150,
        stream: true,
      });

      for await (const chunk of chunks) {
        const token = chunk.choices?.[0]?.delta?.content || '';
        fullContent += token;

        if (firstToken && token) {
          firstToken = false;
        }

        const now = Date.now();
        if (now - lastReportTime > 150) {
          lastReportTime = now;
          onProgress?.({
            status: 'loading',
            progress: Math.min(fullContent.length / 200, 0.95),
            text: firstToken
              ? 'Processing prompt…'
              : `Generating… ${fullContent.length} chars`,
          });
        }
      }
    })();

    await Promise.race([streamPromise, timeoutPromise]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`GPU inference failed: ${msg}`);
  }

  const json = extractJson(fullContent);
  return parseJSON(json, rawText);
}

// ── Dispose ──────────────────────────────────────────────────────

export async function disposeWebLLMParser(): Promise<void> {
  if (engine) {
    try {
      await engine.unload();
    } catch {
      // ignore
    }
    engine = null;
  }
  currentModelId = null;
  initPromise = null;
  initError = null;
}

// ── Status ───────────────────────────────────────────────────────

export function isWebLLMReady(): boolean {
  return engine !== null;
}

export function getWebLLMError(): string | null {
  return initError;
}

// ── Feature detection ────────────────────────────────────────────

export function hasWebGPU(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  } catch {
    return false;
  }
}
