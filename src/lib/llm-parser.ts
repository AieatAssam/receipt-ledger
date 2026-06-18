import type { OcrResult } from '@paddleocr/paddleocr-js';
import type { ParsedReceipt, ParsedLineItem } from './parser';

// ── Types ────────────────────────────────────────────────────────

export type ParserMode = 'heuristic' | 'ai';

// ── WebGPU detection ─────────────────────────────────────────────

function detectWebGPU(): { gpuLayers: number; gpuLabel: string } {
  try {
    const hasGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
    if (hasGPU) {
      return { gpuLayers: 99, gpuLabel: 'WebGPU' }; // 99 = all layers
    }
  } catch { /* navigator not available */ }
  return { gpuLayers: 0, gpuLabel: 'CPU (WASM SIMD)' };
}

export interface LLMProgress {
  status: 'downloading' | 'loading' | 'ready' | 'processing' | 'error';
  progress: number; // 0-1
  text: string;
}

// ── Model catalog ────────────────────────────────────────────────

export interface AICatalogEntry {
  id: string;
  name: string;
  architecture: string;
  hfRepo: string;
  hfFile: string;
  sizeMB: number;
  description: string;
}

export const AI_MODEL_CATALOG: AICatalogEntry[] = [
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen 2.5 0.5B',
    architecture: 'Qwen',
    hfRepo: 'bartowski/Qwen2.5-0.5B-Instruct-GGUF',
    hfFile: 'Qwen2.5-0.5B-Instruct-IQ4_XS.gguf',
    sizeMB: 333,
    description: 'Best balance of speed and accuracy. Great at structured extraction.',
  },
  {
    id: 'smollm2-360m',
    name: 'SmolLM2 360M',
    architecture: 'SmolLM',
    hfRepo: 'bartowski/SmolLM2-360M-Instruct-GGUF',
    hfFile: 'SmolLM2-360M-Instruct-IQ4_XS.gguf',
    sizeMB: 216,
    description: 'Tiniest option. Fast download, less capable on complex receipts.',
  },
  {
    id: 'llama3.2-1b',
    name: 'Llama 3.2 1B',
    architecture: 'Llama',
    hfRepo: 'bartowski/Llama-3.2-1B-Instruct-GGUF',
    hfFile: 'Llama-3.2-1B-Instruct-IQ4_XS.gguf',
    sizeMB: 709,
    description: 'Highest quality. Large download, may strain mobile memory.',
  },
];

const DEFAULT_MODEL_ID = 'qwen2.5-0.5b';

export function getModelEntry(id: string): AICatalogEntry {
  return AI_MODEL_CATALOG.find(m => m.id === id) || AI_MODEL_CATALOG[0];
}

// ── Prompt template (spatial + dynamic truncation) ───────────────

const SYSTEM_PROMPT = 'Extract receipt JSON from OCR with positions. Each line=[x:N] "text". Left items (x<120)=descriptions, right (x>120)=amounts. Same-line items are related. Return JSON: {merchant, date, total, tax, line_items:[{description,amount,quantity}]}.';

const MAX_TOKENS = 256;       // max tokens for LLM response
const N_CTX = 2048;           // total context window
const SYS_TOK_ESTIMATE = 40;  // ~40 tokens for system prompt
const SAFETY_MARGIN = 24;     // chat template overhead + breathing room
const AVAILABLE_TOKS = N_CTX - MAX_TOKENS - SYS_TOK_ESTIMATE - SAFETY_MARGIN;
// Conservative: ~1.5 chars per token for spatial annotations (lots of [y:N x:N])
const MAX_PROMPT_CHARS = Math.floor(AVAILABLE_TOKS * 1.5);

function buildUserPrompt(rawText: string): string {
  if (rawText.length <= MAX_PROMPT_CHARS) return rawText;
  // Truncate gracefully — keep most text, just trim from the end
  return rawText.slice(0, MAX_PROMPT_CHARS - 1) + '…';
}

// ── Wllama singleton ─────────────────────────────────────────────

let wllamaInstance: Awaited<ReturnType<typeof createWllamaInstance>> | null = null;
let initPromise: Promise<boolean> | null = null;
let initError: string | null = null;
let currentModelId: string | null = null;

async function createWllamaInstance() {
  const { Wllama, LoggerWithoutDebug } = await import('@wllama/wllama');

  const wllama = new Wllama(
    {
      default: `${import.meta.env.BASE_URL}wllama/wllama.wasm`,
    },
    {
      logger: LoggerWithoutDebug,
      parallelDownloads: 5,
    },
  );

  return { Wllama, wllama };
}

// ── Init ─────────────────────────────────────────────────────────

export async function initLLMParser(
  modelId: string = DEFAULT_MODEL_ID,
  onProgress?: (p: LLMProgress) => void,
): Promise<boolean> {
  if (wllamaInstance && currentModelId === modelId) {
    return true;
  }

  if (wllamaInstance && currentModelId !== modelId) {
    await disposeLLMParser();
  }

  if (initError) {
    onProgress?.({ status: 'error', progress: 0, text: initError });
    return false;
  }

  if (initPromise) {
    return initPromise;
  }

  const model = getModelEntry(modelId);

  initPromise = (async (): Promise<boolean> => {
    try {
      onProgress?.({
        status: 'downloading',
        progress: 0,
        text: `Loading ${model.name} (${model.sizeMB} MB)...`,
      });

      const { wllama } = await createWllamaInstance();
      wllamaInstance = { Wllama: (await import('@wllama/wllama')).Wllama, wllama };

      const { gpuLayers, gpuLabel } = detectWebGPU();

      // n_ctx=512 keeps memory low; GPU offload if WebGPU available
      await wllama.loadModelFromHF(
        {
          repo: model.hfRepo,
          file: model.hfFile,
        },
        {
          n_threads: 4, // 4 threads — if browser supports SAB, uses real threads
          n_ctx: N_CTX,
          n_batch: 512,
          n_gpu_layers: gpuLayers,
          flash_attn: true,
          cache_type_k: 'q4_0',  // quantized KV cache saves memory
          cache_type_v: 'q4_0',
          progressCallback: ({ loaded, total }: { loaded: number; total: number }) => {
            const pct = total > 0 ? loaded / total : 0;
            if (pct < 0.99) {
              onProgress?.({
                status: 'downloading',
                progress: pct,
                text: `Downloading ${model.name}: ${Math.round(pct * 100)}%`,
              });
            } else {
              onProgress?.({
                status: 'loading',
                progress: pct,
                text: `Loading ${model.name} into memory...`,
              });
            }
          },
        },
      );

      currentModelId = modelId;
      onProgress?.({ status: 'ready', progress: 1, text: `${model.name} ready (${gpuLabel})` });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        initError = `Failed to download ${model.name}. Check your internet connection.`;
      } else {
        initError = `Failed to load ${model.name}: ${msg}`;
      }
      wllamaInstance = null;
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

function parseLLMJson(jsonStr: string, rawText: string): ParsedReceipt {
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

const INFERENCE_TIMEOUT_MS = 180_000; // 3 minutes for WASM on mobile

export async function parseReceiptWithLLM(
  rawText: string,
  onProgress?: (p: LLMProgress) => void,
): Promise<ParsedReceipt> {
  if (!wllamaInstance) {
    throw new Error('LLM parser not initialized. Call initLLMParser() first.');
  }

  const { wllama } = wllamaInstance;

  const inputText = buildUserPrompt(rawText);
  const estTokens = Math.round(inputText.length / 1.5);
  onProgress?.({
    status: 'processing',
    progress: 0,
    text: `Processing ${inputText.length} chars (~${estTokens} tokens of ${AVAILABLE_TOKS} available)…`,
  });

  let fullContent = '';
  let lastReportTime = Date.now();
  let firstToken = true;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Inference timed out after 3 minutes. Try a smaller model or shorter receipt.`)), INFERENCE_TIMEOUT_MS)
  );

  try {
    const inferencePromise = wllama.createChatCompletion(
      {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: inputText },
        ],
        temperature: 0.1,
        max_tokens: MAX_TOKENS,
        stream: true,
        onData: (chunk) => {
          const token = chunk.choices?.[0]?.delta?.content || '';
          fullContent += token;

          if (firstToken && token) {
            firstToken = false;
          }

          const now = Date.now();
          if (now - lastReportTime > 200) {
            lastReportTime = now;
            onProgress?.({
              status: 'loading',
              progress: Math.min(fullContent.length / 300, 0.95),
              text: firstToken
                ? `Processing prompt…`
                : `Generating… ${fullContent.length} chars`,
            });
          }
        },
      },
    );

    await Promise.race([inferencePromise, timeoutPromise]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`AI inference failed: ${msg}`);
  }

  const json = extractJson(fullContent);
  return parseLLMJson(json, rawText);
}

// ── Text extraction from OCR results (with spatial positions) ────

export function ocrResultToText(result: OcrResult): string {
  if (!result.items?.length) return '';

  // Extract bounding box data
  interface BoxItem {
    text: string;
    x: number;
    y: number;
    w: number;
  }
  const items: BoxItem[] = result.items.map(item => {
    const xs = item.poly.map(p => p[0]);
    const ys = item.poly.map(p => p[1]);
    return {
      text: item.text,
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
    };
  });

  // Group into visual lines (Y tolerance: 8px)
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const lines: BoxItem[][] = [];
  let currentLine: BoxItem[] = [];
  let currentY = sorted[0]?.y ?? 0;

  for (const item of sorted) {
    if (Math.abs(item.y - currentY) > 8) {
      if (currentLine.length) lines.push(currentLine);
      currentLine = [item];
      currentY = item.y;
    } else {
      currentLine.push(item);
    }
  }
  if (currentLine.length) lines.push(currentLine);

  // Format: one line per visual row, sort by X within each row
  let output = '';
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    // Include Y position on first item of each line for spatial reference
    const parts = line.map((item, i) => {
      const prefix = i === 0 ? `[y:${Math.round(item.y)} x:${Math.round(item.x)}]` : `[x:${Math.round(item.x)}]`;
      return `${prefix} "${item.text}"`;
    });
    output += parts.join('  ') + '\n';
  }

  return output.trim();
}

// ── Dispose ──────────────────────────────────────────────────────

export async function disposeLLMParser(): Promise<void> {
  if (wllamaInstance) {
    try {
      await wllamaInstance.wllama.exit();
    } catch {
      // ignore dispose errors
    }
    wllamaInstance = null;
  }
  currentModelId = null;
  initPromise = null;
  initError = null;
}

// ── Status ───────────────────────────────────────────────────────

export function isLLMReady(): boolean {
  return wllamaInstance !== null;
}

export function getLLMError(): string | null {
  return initError;
}
