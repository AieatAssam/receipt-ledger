# Receipt Ledger — Agent Instructions

## Project Identity

**Receipt Ledger** is a browser-native receipt auditor. Photograph a receipt → on-device OCR extracts merchant, date, line items, and total → structured data stored in a local Postgres database → analytics and CSV export. Zero backend, zero accounts, zero data leaving the device.

---

## Core Directives

### 1. 100% Client-Side
- No server, no API keys, no accounts. Everything runs in the browser.
- All data stored in IndexedDB via PGlite.
- Never add network-dependent features.

### 2. Mobile-First
- All touch targets ≥ 44×44px.
- Viewport-fit cover + safe area padding for notched phones.
- Bottom tab bar for thumb reach.
- Camera uses `facingMode: 'environment'` (rear camera).

### 3. Privacy-First
- Data never leaves the device.
- No analytics, no telemetry, no cookies.
- Export via CSV download only.

### 4. Code Quality
- TypeScript everywhere. No `any` types.
- Components are React 19 function components with hooks.
- One PGlite instance per app (singleton via `db` module).
- One PaddleOCR instance (lazy-init, disposed on model change).

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React | 19.2.7 |
| Build | Vite | 8.0.16 |
| Language | TypeScript | 6.0.3 |
| Styling | Tailwind CSS | 4.3.1 |
| UI | Custom (shadcn-style) | — |
| Icons | Lucide React | 1.20.0 |
| OCR | PaddleOCR.js (Baidu PP-OCRv6) | 0.4.2 |
| LLM Parser | WebLLM (Llama 3.2 1B Instruct) | 0.2.84 |
| Database | PGlite (WASM Postgres) | 0.5.3 |
| Hosting | GitHub Pages (static) | — |

---

## Project Structure

```
src/
├── main.tsx                    — Entry point
├── App.tsx                     — Router, tabs, state management
├── index.css                   — Tailwind v4 + CSS variables
├── lib/
│   ├── db.ts                   — PGlite singleton, schema, CRUD
│   ├── ocr.ts                  — PaddleOCR.js worker wrapper
│   ├── parser.ts               — Heuristic OCR → structured receipt
│   ├── llm-parser.ts           — WebLLM-powered AI receipt parser
│   ├── settings.ts             — localStorage-backed settings
│   └── utils.ts                — cn() helper
└── components/
    ├── CaptureButton.tsx        — Camera + file upload
    ├── ImagePreview.tsx         — Image display + extract trigger
    ├── ReceiptForm.tsx          — Editable form for parsed data
    ├── AnalyticsDashboard.tsx   — Summary cards + charts
    └── SettingsPanel.tsx        — Model size + export + about
```

---

## Database Schema

Three tables: `merchants`, `receipts`, `line_items`. See `src/lib/db.ts` for DDL. Migrations run on `db.init()` via `CREATE TABLE IF NOT EXISTS`.

---

## OCR Model Configuration

- **PP-OCRv6_small** (default): Better accuracy, larger model download
- **PP-OCRv6_tiny**: Faster, smaller download

Configurable in Settings tab. Stored in `localStorage`. Changing the model disposes the current OCR instance; next scan reinitializes with the new model.

---

## Parser Modes

Two modes available in Settings:

- **Heuristic** (default): Regex-based parser. Instant, zero download. Handles common receipt formats (USD, GBP, EUR). Limited accuracy on complex layouts.
- **AI (Llama 3.2 1B)**: In-browser LLM via WebLLM + WebGPU. ~400MB model download (cached in IndexedDB after first use). Much better at understanding diverse receipt layouts, handling OCR noise, and extracting structured data correctly. Falls back to heuristic if WebGPU unavailable or model download fails.

The AI parser model (`Llama-3.2-1B-Instruct-q4f16_1-MLC`) is loaded via dynamic `import()` to keep it out of the main bundle. First-time download shows progress percentage; subsequent uses load from cache (near-instant).

---

## Do Not

- Add any backend, API, or cloud dependency
- Use external OCR APIs
- Add user accounts or authentication
- Store data in `localStorage` beyond settings (use PGlite)
- Ignore mobile layout — always test at 375px viewport
- Create multiple PGlite or PaddleOCR instances
