# Receipt Ledger — Implementation Plan

> **Goal:** Build a browser-native receipt auditor — photograph → OCR → structured data → analytics.
> **Architecture:** React 19 SPA → PaddleOCR.js Worker (OCR) → Text Parser → PGlite/IndexedDB (storage) → React UI (history, analytics, export).

---

## Phase 0: Scaffold

```bash
cd /home/hermes/receipt-ledger
npm create vite@latest . -- --template react-ts
npm install react@19.2.7 react-dom@19.2.7
npm install -D vite@8.0.16 typescript@6.0.3 @types/react @types/react-dom
npm install -D tailwindcss@4.3.1 @tailwindcss/vite@4.3.1
npx shadcn@4.11.0 init -d
```

**Files:** `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`

**shadcn components needed:** `button`, `card`, `input`, `label`, `dialog`, `tabs`, `select`, `textarea`, `badge`, `separator`, `skeleton`, `toast` (sonner)

---

## Phase 1: Database Layer (`src/lib/db.ts`)

**Objective:** PGlite singleton with schema migration, typed query helpers.

```typescript
// src/lib/db.ts
import { PGlite } from '@electric-sql/pglite';

export interface Merchant { ... }
export interface Receipt { ... }
export interface LineItem { ... }

class Database {
  private db: PGlite;
  
  async init(): Promise<void>;
  private async migrate(): Promise<void>;      // CREATE TABLE IF NOT EXISTS
  async insertReceipt(r: NewReceipt): Promise<Receipt>;
  async getReceipts(limit?: number, offset?: number): Promise<Receipt[]>;
  async getReceiptById(id: number): Promise<ReceiptWithItems>;
  async updateReceipt(id: number, data: Partial<Receipt>): Promise<void>;
  async deleteReceipt(id: number): Promise<void>;
  async getAnalytics(): Promise<Analytics>;
  async searchReceipts(query: string): Promise<Receipt[]>;
  async exportCsv(): Promise<string>;
  async dispose(): Promise<void>;
}

export const db = new Database();
```

**Persistence:** `new PGlite('idb://receipt-ledger')`

---

## Phase 2: OCR Engine (`src/lib/ocr.ts`)

**Objective:** Load PaddleOCR.js in Worker mode, expose `ocrImage(image)`.

```typescript
// src/lib/ocr.ts
import { PaddleOCR, OcrResult } from '@paddleocr/paddleocr-js';

let ocrInstance: PaddleOCR | null = null;

export async function initOCR(): Promise<void> {
  ocrInstance = await PaddleOCR.create({
    lang: 'en',
    ocrVersion: 'PP-OCRv6',
    worker: true,
    ortOptions: {
      backend: 'wasm',
      wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.1/dist/',
    },
  });
}

export async function ocrImage(
  image: ImageBitmap | HTMLImageElement | Blob
): Promise<OcrResult> {
  if (!ocrInstance) throw new Error('OCR not initialized');
  const [result] = await ocrInstance.predict(image);
  return result;
}

export function disposeOCR(): void {
  ocrInstance?.dispose();
  ocrInstance = null;
}
```

**Key decisions:**
- PP-OCRv6 (not v5) — better accuracy, supports English
- Worker mode — keeps UI responsive during OCR
- ONNX WASM paths pinned to CDN — required for Worker mode with GitHub Pages COOP/COEP

---

## Phase 3: Text Parser (`src/lib/parser.ts`)

**Objective:** Convert flat OCR text regions into structured receipt data.

```typescript
// src/lib/parser.ts
import { OcrResult } from '@paddleocr/paddleocr-js';

export interface ParsedReceipt {
  merchant: string | null;
  date: string | null;       // ISO date string
  total: number | null;
  tax: number | null;
  lineItems: ParsedLineItem[];
  confidence: number;        // average confidence across all items
  rawText: string;           // full concatenated OCR output
}

export interface ParsedLineItem {
  description: string;
  amount: number | null;
  quantity: number | null;
  confidence: number;
}

export function parseReceipt(result: OcrResult): ParsedReceipt;
```

**Heuristics:**
1. Concatenate all `result.items[].text` sorted by Y position (top-down)
2. **Merchant:** First line(s) with no currency symbols
3. **Date:** Regex patterns: `\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4}`, month names
4. **Total:** Lines with "TOTAL", "AMOUNT DUE", "BALANCE" preceding a number
5. **Line items:** Lines containing `£`/`$`/`€` followed by a number, excluding "TOTAL"/"TAX" lines
6. **Tax:** Lines containing "TAX", "VAT", "GST"

Each extracted piece carries a confidence score from OCR.

---

## Phase 4: UI — Capture Flow

**Components:** `src/components/CaptureButton.tsx`, `src/components/ImagePreview.tsx`, `src/components/ReceiptForm.tsx`

### CaptureButton
- Two modes: Camera (getUserMedia) and File Upload (input[type=file])
- Camera uses a full-screen dialog with `<video>` preview
- File upload accepts images from device
- Both produce an `ImageBitmap` passed up via callback

### ImagePreview
- Shows captured image with crop/rotate options (optional Phase 1)
- "Extract" button triggers OCR
- Loading skeleton while OCR runs

### ReceiptForm
- Editable form pre-filled with parsed data
- Fields: merchant, date, total, tax, line items (add/remove rows)
- "Save" button → writes to PGlite → navigates to receipt detail
- "Cancel" → discard

---

## Phase 5: UI — History & Detail

**Components:** `src/components/ReceiptList.tsx`, `src/components/ReceiptCard.tsx`, `src/components/ReceiptDetail.tsx`

### ReceiptList
- Flat list of `ReceiptCard` components
- Pull-to-refresh (optional, since data is local)
- Empty state: "No receipts yet. Tap the camera to add one."

### ReceiptCard
- Thumbnail (if available), merchant name, date, total
- Swipe to delete (or long-press)
- Tap → navigate to detail

### ReceiptDetail
- Full view: original image with OCR bounding box overlay (Canvas2D)
- Merchant, date, total, tax displayed
- Line items table
- "Edit" button → ReceiptForm in edit mode
- "Delete" button with confirmation

---

## Phase 6: UI — Analytics

**Components:** `src/components/AnalyticsDashboard.tsx`, `src/components/SpendByCategory.tsx`, `src/components/SpendOverTime.tsx`

### AnalyticsDashboard
- Summary cards: Total spent (this month), receipt count, top merchant, avg receipt value
- Two charts below: category breakdown + monthly trend
- All data from SQL GROUP BY queries

### SpendByCategory
- Horizontal bar chart (Canvas2D or simple CSS bars)
- Color-coded categories
- Legend

### SpendOverTime
- Simple bar chart: monthly spend for last 6-12 months
- X-axis: months, Y-axis: total

---

## Phase 7: Export

**Components:** `src/components/ExportButton.tsx`

- Button in header/settings
- Calls `db.exportCsv()` — builds CSV from SQL query joining receipts + line_items
- Triggers browser download via Blob URL
- Option to filter by date range before export

---

## Phase 8: Polish & Mobile

- **Dark mode:** Tailwind `dark:` classes, system preference detection
- **Touch targets:** All interactive elements ≥ 44×44px (shadcn/ui defaults handle most)
- **Viewport:** `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
- **Safe areas:** `env(safe-area-inset-*)` for notched phones
- **Bottom tab bar:** Fixed position with safe area padding
- **Loading states:** Skeleton components from shadcn/ui during OCR and data fetch
- **Error states:** Toast notifications for OCR failures, DB errors
- **Empty states:** Illustrated empty states for history and analytics
- **Service Worker:** COOP/COEP via `coi-serviceworker.js` for GitHub Pages (same pattern as video-p2p)

---

## File Checklist

```
receipt-ledger/
├── README.md
├── AGENTS.md
├── docs/
│   ├── PRD.md                          ← done
│   └── PLAN.md                         ← this file
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── coi-serviceworker.js                ← COOP/COEP for GitHub Pages
├── src/
│   ├── main.tsx
│   ├── App.tsx                         ← Router + tab bar
│   ├── index.css                       ← Tailwind + custom
│   ├── lib/
│   │   ├── db.ts                       ← PGlite singleton + schema
│   │   ├── ocr.ts                      ← PaddleOCR.js worker wrapper
│   │   └── parser.ts                   ← OCR → structured data
│   ├── hooks/
│   │   ├── useDatabase.ts              ← DB status + query hooks
│   │   ├── useOCR.ts                   ← OCR lifecycle hook
│   │   └── useReceipts.ts              ← Receipt CRUD hooks
│   ├── components/
│   │   ├── CaptureButton.tsx
│   │   ├── ImagePreview.tsx
│   │   ├── ReceiptForm.tsx
│   │   ├── ReceiptList.tsx
│   │   ├── ReceiptCard.tsx
│   │   ├── ReceiptDetail.tsx
│   │   ├── AnalyticsDashboard.tsx
│   │   ├── SpendByCategory.tsx
│   │   ├── SpendOverTime.tsx
│   │   └── ExportButton.tsx
│   └── components/ui/                  ← shadcn/ui components (generated)
│       ├── button.tsx
│       ├── card.tsx
│       ├── input.tsx
│       ├── label.tsx
│       ├── dialog.tsx
│       ├── tabs.tsx
│       ├── select.tsx
│       ├── textarea.tsx
│       ├── badge.tsx
│       ├── separator.tsx
│       ├── skeleton.tsx
│       └── sonner.tsx
└── public/
    └── (empty — no static assets needed)
```

---

## Estimated Phase Times

| Phase | Description | Est. Time |
|-------|-------------|-----------|
| 0 | Scaffold | 5 min |
| 1 | Database Layer | 15 min |
| 2 | OCR Engine | 10 min |
| 3 | Text Parser | 20 min |
| 4 | Capture Flow UI | 30 min |
| 5 | History & Detail UI | 25 min |
| 6 | Analytics UI | 15 min |
| 7 | Export | 10 min |
| 8 | Polish & Mobile | 15 min |
| **Total** | | **~2.5 hours** |
