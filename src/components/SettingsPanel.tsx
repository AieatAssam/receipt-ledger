import { useState } from 'react';
import { Download, Cpu, Info, Brain, Layers } from 'lucide-react';
import { db } from '../lib/db';
import { loadSettings, saveSettings, type AppSettings, type OcrModelSize } from '../lib/settings';
import { disposeOCR } from '../lib/ocr';
import { type ParserMode, AI_MODEL_CATALOG, type AICatalogEntry } from '../lib/llm-parser';

export default function SettingsPanel() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [exporting, setExporting] = useState(false);

  const handleModelSizeChange = (size: OcrModelSize) => {
    const updated = { ...settings, ocrModelSize: size };
    setSettings(updated);
    saveSettings(updated);
    disposeOCR();
  };

  const handleParserModeChange = (mode: ParserMode) => {
    const updated = { ...settings, parserMode: mode };
    setSettings(updated);
    saveSettings(updated);
  };

  const handleAIModelChange = (modelId: string) => {
    const updated = { ...settings, aiModel: modelId };
    setSettings(updated);
    saveSettings(updated);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await db.exportCsv();
      if (!csv) return;

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* OCR Model Size */}
      <div className="rounded-xl bg-card border border-border p-4">
        <div className="flex items-start gap-3 mb-3">
          <Cpu className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold">OCR Model Size</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Baidu PP-OCRv6 model. Changes take effect on next scan.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {([
            { value: 'PP-OCRv6_small', label: 'Small', desc: 'Better accuracy, larger download' },
            { value: 'PP-OCRv6_tiny', label: 'Tiny', desc: 'Faster, smaller download' },
          ] as const).map(opt => (
            <button
              key={opt.value}
              onClick={() => handleModelSizeChange(opt.value)}
              className={`flex-1 p-3 rounded-lg border text-left transition-colors ${
                settings.ocrModelSize === opt.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-accent'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    settings.ocrModelSize === opt.value
                      ? 'border-primary'
                      : 'border-muted-foreground/30'
                  }`}
                >
                  {settings.ocrModelSize === opt.value && (
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  )}
                </div>
                <span className="text-sm font-medium">{opt.label}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 ml-6">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Parser Mode */}
      <div className="rounded-xl bg-card border border-border p-4">
        <div className="flex items-start gap-3 mb-3">
          <Brain className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold">Receipt Parser</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Heuristic is instant. AI uses an in-browser LLM via WebAssembly — works on any device, no GPU required.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {([
            { value: 'heuristic' as const, label: 'Heuristic', desc: 'Regex-based. Instant, no download.' },
            { value: 'ai' as const, label: 'AI (WASM)', desc: 'In-browser LLM. Works everywhere, no GPU needed.' },
          ]).map(opt => (
            <button
              key={opt.value}
              onClick={() => handleParserModeChange(opt.value)}
              className={`flex-1 p-3 rounded-lg border text-left transition-colors ${
                settings.parserMode === opt.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-accent'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    settings.parserMode === opt.value
                      ? 'border-primary'
                      : 'border-muted-foreground/30'
                  }`}
                >
                  {settings.parserMode === opt.value && (
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  )}
                </div>
                <span className="text-sm font-medium">{opt.label}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 ml-6">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* AI Model Selector — only shown when AI mode */}
      {settings.parserMode === 'ai' && (
        <div className="rounded-xl bg-card border border-primary/20 p-4">
          <div className="flex items-start gap-3 mb-3">
            <Layers className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold">AI Model</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Models download once (~{AI_MODEL_CATALOG.find(m => m.id === settings.aiModel)?.sizeMB || '—'} MB) and are cached for future use.
                All run in-browser via WebAssembly — no GPU, no server.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {AI_MODEL_CATALOG.map((model: AICatalogEntry) => (
              <button
                key={model.id}
                onClick={() => handleAIModelChange(model.id)}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  settings.aiModel === model.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-accent'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      settings.aiModel === model.id
                        ? 'border-primary'
                        : 'border-muted-foreground/30'
                    }`}
                  >
                    {settings.aiModel === model.id && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <span className="text-sm font-medium">{model.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground font-mono">
                    {model.architecture}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
                    {model.sizeMB} MB
                  </span>
                </div>
                <p className="text-xs text-muted-foreground ml-6">{model.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Export */}
      <div className="rounded-xl bg-card border border-border p-4">
        <div className="flex items-start gap-3 mb-3">
          <Download className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold">Export Data</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Download all receipts and line items as CSV.
            </p>
          </div>
        </div>

        <button
          onClick={handleExport}
          disabled={exporting}
          className="w-full h-11 flex items-center justify-center gap-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors min-h-[44px] disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          {exporting ? 'Exporting...' : 'Download CSV'}
        </button>
      </div>

      {/* About */}
      <div className="rounded-xl bg-card border border-border p-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold">About</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Receipt Ledger runs entirely in your browser. All data is stored locally
              using Postgres (WASM) in IndexedDB. No data ever leaves your device.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              OCR powered by{' '}
              <a
                href="https://github.com/PaddlePaddle/PaddleOCR"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Baidu PP-OCRv6
              </a>
              {' '}running in-browser via ONNX Runtime Web.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              AI parser powered by{' '}
              <a
                href="https://github.com/ngxson/wllama"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                wllama
              </a>
              {' '}— WebAssembly binding for llama.cpp. No GPU, no server.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Database powered by{' '}
              <a
                href="https://pglite.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                PGlite
              </a>
              {' '}— WASM Postgres with pgvector support.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
