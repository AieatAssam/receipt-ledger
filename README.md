# Receipt Ledger

A privacy-first expense tracker that lives entirely in your browser. Photograph a receipt, instantly extract merchant, date, line items, and total via on-device OCR, and get real financial analytics — spending by category, merchant rankings, recurring expense detection. Zero accounts, zero cloud, zero data leaving your device.

**Live:** https://aieatassam.github.io/receipt-ledger/

---

## Features

| # | Feature | Description |
|---|---------|-------------|
| 📸 | **Camera & File Capture** | Take a photo via rear camera or upload from device |
| 🔍 | **On-Device OCR** | Baidu PP-OCRv6 runs entirely in-browser via ONNX Runtime Web |
| 📋 | **Structured Extraction** | OCR → merchant, date, total, tax, line items with quantities |
| ✏️ | **Editable Review** | Review and correct extracted data before saving |
| 💾 | **Persistent Storage** | Full Postgres database in your browser (PGlite + IndexedDB) |
| 📊 | **Spending Analytics** | Category breakdowns, monthly trends, top merchants |
| 🔎 | **Full-Text Search** | Search across merchants, line items, and raw OCR text |
| 📤 | **CSV Export** | Download all receipts + line items as CSV |
| 🌙 | **Dark Mode** | System preference detection |
| 📱 | **Mobile-First** | 44px touch targets, safe area padding, bottom tab bar |

---

## Technical Implementation

### Architecture

```
Camera/File Input
       ↓
PaddleOCR.js (Web Worker)    ← Baidu PP-OCRv6 ONNX models
       ↓
Text Parser                  ← Heuristic structured extraction
       ↓
React 19 UI (editable form)  ← Review & edit before save
       ↓
PGlite (WASM Postgres)       ← Persistent SQL in IndexedDB
       ↓
Analytics / CSV Export        ← SQL queries via GROUP BY, window functions
```

### OCR Pipeline

Receipt OCR is a two-stage pipeline running entirely in a Web Worker:

1. **PaddleOCR.js** (`src/lib/ocr.ts`) wraps the Baidu PP-OCRv6 model via ONNX Runtime Web. The model runs in Worker mode to keep the UI responsive during processing. Two model sizes are available:
   - **PP-OCRv6_small** (default) — better accuracy, larger download
   - **PP-OCRv6_tiny** — faster inference, smaller download

2. **Text Parser** (`src/lib/parser.ts`) converts flat OCR text regions into structured data through heuristic extraction:
   - **Same-Y merging:** OCR often produces separate text regions for descriptions and prices on the same receipt line. The parser merges items within 10px vertical proximity.
   - **Merchant detection:** First 1–3 lines without amounts, dates, or total/tax indicators.
   - **Date parsing:** 5 format variants (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, named months, 2-digit years). Auto-detects US vs UK date formats when month > 12.
   - **Total extraction:** Scans bottom-up for lines matching total/subtotal/balance indicators, with fallback to last standalone amount.
   - **Tax extraction:** Matches lines containing tax/vat/gst keywords.
   - **Line item extraction:** Each line with a currency amount becomes a line item. Quantity prefixes (`3x`, `2 @`) are detected. Large integers without currency symbols or decimals are filtered as non-prices.
   - **Comma decimal handling:** European format amounts (€3,99) are normalized to standard decimals.

   The parser achieves **38/39 correct extractions** on test receipts covering UK grocery, US restaurant, and various date/currency formats.

### Database Layer

**PGlite** (`src/lib/db.ts`) provides a full PostgreSQL 15 instance compiled to WebAssembly (3.7MB gzipped). It persists to IndexedDB via `idb://receipt-ledger`.

#### Schema (3 tables, normalized)

```sql
merchants (id, name, normalized_name UNIQUE, category)
receipts (id, merchant_id FK, receipt_date, total, tax, currency, image_data_url, raw_ocr_text, ocr_confidence)
line_items (id, receipt_id FK CASCADE, description, quantity, unit_price, amount, category, position_index)
```

#### Key queries

| Query | SQL technique |
|-------|--------------|
| Receipt history | `LEFT JOIN merchants ... ORDER BY created_at DESC LIMIT/OFFSET` |
| Category breakdown | `GROUP BY li.category ... ORDER BY total DESC` |
| Monthly spend | `TO_CHAR(receipt_date, 'YYYY-MM') ... GROUP BY month` |
| Full-text search | `WHERE m.name ILIKE $1 OR r.raw_ocr_text ILIKE $1 OR li.description ILIKE $1` |
| CSV export | Cross-join receipts + line_items with comma escaping |

`upsertMerchant` uses `INSERT ... ON CONFLICT (normalized_name) DO UPDATE` for idempotent merchant creation.

### Settings & Model Configuration

Settings persist in `localStorage` (`src/lib/settings.ts`). Changing the OCR model size in the Settings tab disposes the current PaddleOCR instance; the next scan reinitializes with the new model. This avoids loading both models simultaneously.

### Performance

- **OCR processing:** PP-OCRv6_small runs in 2–5s for a typical receipt in a Web Worker
- **UI:** Remains responsive during OCR (Worker mode)
- **Bundle:** ~4MB total (OCR models loaded on-demand from CDN)
- **Database:** Writes are synchronous in WASM; typical receipt insert < 50ms
- **Mobile:** Canvas2D image preview, virtualized receipt list for 100+ items

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React | 19.2.7 |
| Build | Vite | 8.0.16 |
| Language | TypeScript | 6.0.3 |
| Styling | Tailwind CSS | 4.3.1 |
| Icons | Lucide React | 1.20.0 |
| OCR | PaddleOCR.js (Baidu PP-OCRv6) | 0.4.2 |
| Database | PGlite (WASM Postgres) | 0.5.3 |
| Hosting | GitHub Pages (static) | — |

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm 9+

### Development

```bash
git clone https://github.com/AieatAssam/receipt-ledger.git
cd receipt-ledger
npm install
npm run dev          # http://localhost:5173
```

### Build

```bash
npm run build        # Output in dist/
npm run preview      # Preview production build
```

### Browser Support

| Browser | Minimum Version |
|---------|----------------|
| Chrome | 120+ |
| Firefox | 125+ |
| Safari | 18+ |
| Edge | 120+ |

Requires: Web Workers, IndexedDB, SharedArrayBuffer (via COOP/COEP headers on GitHub Pages).

---

## Project Structure

```
receipt-ledger/
├── README.md
├── LICENSE                          ← MIT
├── AGENTS.md                        ← AI assistant instructions
├── docs/
│   ├── PRD.md                       ← Product requirements
│   └── PLAN.md                      ← Implementation plan
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── public/
│   └── coi-serviceworker.js         ← COOP/COEP polyfill for GitHub Pages
├── tests/
│   └── parser.test.ts               ← 39 parser test cases
└── src/
    ├── main.tsx                      ← Entry point
    ├── App.tsx                       ← Router, 4-tab shell, state machine
    ├── index.css                     ← Tailwind v4 + CSS custom properties
    ├── lib/
    │   ├── db.ts                     ← PGlite singleton, schema, CRUD, analytics, CSV
    │   ├── ocr.ts                    ← PaddleOCR.js Worker wrapper
    │   ├── parser.ts                 ← OCR → structured receipt data
    │   ├── settings.ts               ← localStorage-backed settings
    │   └── utils.ts                  ← cn() class merger
    └── components/
        ├── CaptureButton.tsx         ← Camera + file upload
        ├── ImagePreview.tsx          ← Canvas2D preview + extract trigger
        ├── ReceiptForm.tsx           ← Editable form for extracted data
        ├── AnalyticsDashboard.tsx    ← Summary cards + charts
        └── SettingsPanel.tsx         ← Model size picker + export
```

---

## Privacy

Receipt Ledger runs 100% client-side. All data stays in your browser's IndexedDB. No analytics, no telemetry, no cookies, no accounts, no backend. The OCR model runs locally via ONNX Runtime Web — no image data is ever sent to a server.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Acknowledgements

- [Baidu PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) — PP-OCRv6 model and browser SDK
- [PGlite](https://pglite.dev) — WASM Postgres by [Electric SQL](https://electric-sql.com)
- [ONNX Runtime Web](https://onnxruntime.ai) — Browser-side ONNX inference
- [Lucide](https://lucide.dev) — Icons
