import type { ParserMode } from './llm-parser';
import type { LLMBackend } from './llm-parser-webllm';
import { hasWebGPU } from './llm-parser-webllm';

const SETTINGS_KEY = 'receipt-ledger-settings';

export type OcrModelSize = 'PP-OCRv6_small' | 'PP-OCRv6_tiny';

export interface AppSettings {
  ocrModelSize: OcrModelSize;
  parserMode: ParserMode;
  llmBackend: LLMBackend;
  aiModel: string;        // model ID for the selected backend
  webllmModel: string;    // WebLLM model ID
  wllamaModel: string;    // wllama model ID
}

const DEFAULTS: AppSettings = {
  ocrModelSize: 'PP-OCRv6_small',
  parserMode: 'ai',
  llmBackend: hasWebGPU() ? 'webllm' : 'wllama',
  aiModel: 'qwen2.5-0.5b',     // legacy — kept for compat
  webllmModel: 'smollm2-360m-webllm',
  wllamaModel: 'qwen2.5-0.5b',
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate old settings without backend fields
      if (!parsed.llmBackend) {
        parsed.llmBackend = hasWebGPU() ? 'webllm' : 'wllama';
      }
      if (!parsed.webllmModel) parsed.webllmModel = DEFAULTS.webllmModel;
      if (!parsed.wllamaModel) parsed.wllamaModel = parsed.aiModel || DEFAULTS.wllamaModel;
      return { ...DEFAULTS, ...parsed };
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULTS };
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
