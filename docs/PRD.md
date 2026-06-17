# Receipt Ledger — Product Requirements Document

> **Project:** `receipt-ledger`
> **Concept:** Browser-Native Receipt Auditor
> **Stack:** React 19 + Vite 8 + TypeScript 6 + Tailwind 4 + shadcn/ui + PaddleOCR.js + PGlite + pgvector

---

## Vision

A privacy-first expense tracker that lives entirely in your browser. Photograph a receipt, instantly extract merchant/date/line-items/total via on-device OCR, and get real financial analytics — spending by category, merchant rankings, recurring expense detection. Zero accounts, zero cloud, zero data leaving your device. The tool every freelancer wishes existed but can't trust a SaaS with.

---

## Core Principles

1. **100% Client-Side** — No server, no API keys, no accounts. All processing in-browser.
2. **Instant → Structured** — Photo to normalized data in seconds. No manual entry.
3. **SQL-Powered Analytics** — Real queries, not just a list. Budgets, trends, categories.
4. **Mobile-First** — Primary use case is photographing receipts on phone. Touch targets ≥44px.
5. **Exportable** — CSV + JSON export. Your data is yours.
6. **Minimal, Modern UI** — shadcn/ui components, clean typography, dark mode, no clutter.

---

## Feature Requirements

### Phase 1 — MVP (Weekend)

| # | Feature | Description |
|---|---------|-------------|
| F1 | **Camera Capture** | Take photo of receipt via `getUserMedia()` or upload from file picker |
| F2 | **OCR Pipeline** | `@paddleocr/paddleocr-js` v0.4.2 in Worker mode. Extract text regions with bounding boxes |
| F3 | **Structured Extraction** | Parse OCR output into merchant, date, line items, total. Confidence scores displayed |
| F4 | **Review & Edit** | Show extracted data in editable form before saving. Tap-to-correct |
| F5 | **Receipt History** | Chronological list of all receipts with thumbnails, merchant, amount, date |
| F6 | **Receipt Detail** | Full view: original image with OCR overlay, all line items, edit capability |
| F7 | **Basic Analytics** | Total spend, spend by category, spend by merchant (bar chart or simple table) |
| F8 | **CSV Export** | Export all receipts + line items as CSV |
| F9 | **Persistent Storage** | PGlite persisted to IndexedDB (`idb://receipt-ledger`). Survives tab close |

### Phase 2 — Enhancements (Week)

| # | Feature | Description |
|---|---------|-------------|
| F10 | **Auto-Categorization** | pgvector similarity: classify merchants into categories (groceries, transport, dining, etc.) based on name + line item text |
| F11 | **Recurring Expense Detection** | pgvector similarity of line items across receipts to flag subscriptions/recurring payments |
| F12 | **Category Budgets** | Set monthly budgets per category. Visual gauge + over-budget warnings |
| F13 | **Full-Text Search** | PostgreSQL tsvector FTS across merchants, line items, OCR text |
| F14 | **Date Range Filters** | Filter history/analytics by date range with quick presets (this month, last 3 months, YTD) |
| F15 | **Receipt Image Search** | pgvector similarity: "find receipts like this one" |

---

## Database Schema

### PGlite Tables

```sql
CREATE TABLE merchants (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,  -- lowercase, stripped
    category TEXT,                          -- groceries, dining, transport, etc.
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE receipts (
    id SERIAL PRIMARY KEY,
    merchant_id INTEGER REFERENCES merchants(id),
    receipt_date DATE,
    total NUMERIC(10,2),
    tax NUMERIC(10,2),
    currency TEXT DEFAULT 'GBP',
    image_data_url TEXT,                   -- base64 data URL or IndexedDB blob ref
    raw_ocr_text TEXT,
    ocr_confidence REAL,                   -- average confidence across all text regions
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE line_items (
    id SERIAL PRIMARY KEY,
    receipt_id INTEGER REFERENCES receipts(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price NUMERIC(10,2),
    amount NUMERIC(10,2),
    category TEXT,
    position_index INTEGER,                 -- order on receipt
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### pgvector Setup (Phase 2)

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE merchants ADD COLUMN embedding vector(384);
ALTER TABLE line_items ADD COLUMN embedding vector(384);
```

Embeddings via a lightweight in-browser embedding model (e.g., Transformers.js with a tiny model) — or defer to Phase 2.

---

## UX Flows

### Flow 1: Capture & Save
```
Camera/Upload → Image Preview → [OCR Button] → Processing spinner (Worker)
→ Extracted data in editable form → [Save] → Receipt History
```

### Flow 2: Review History
```
Receipt List (cards with thumbnails) → Tap receipt → Detail view
→ Edit button → Edit form → Save changes → Back to detail
```

### Flow 3: Analytics
```
Analytics tab → Summary cards (total spent, receipt count, top merchant)
→ Category breakdown (pie/bar) → Merchant ranking (sorted table)
```

### Flow 4: Export
```
Settings/Export → Select date range → CSV download
```

---

## Screen Layout (Mobile-First)

```
┌─────────────────────────┐
│  Receipt Ledger    ⚙️   │  ← Header (sticky)
├─────────────────────────┤
│                         │
│  [Camera] [Upload]      │  ← Primary actions
│                         │
│  ┌─────────────────────┐│
│  │ Tesco     £42.30   ││
│  │ 14 Jun 2026         ││  ← Receipt cards
│  └─────────────────────┘│
│  ┌─────────────────────┐│
│  │ Uber       £12.50   ││
│  │ 13 Jun 2026         ││
│  └─────────────────────┘│
│                         │
├─────────────────────────┤
│  📋 History  📊 Stats   │  ← Bottom tab bar
└─────────────────────────┘
```

---

## Technical Requirements

### Dependency Versions (latest as of June 2026)

| Package | Version | Purpose |
|---------|---------|---------|
| react | 19.2.7 | UI framework |
| vite | 8.0.16 | Build tool |
| typescript | 6.0.3 | Type system |
| tailwindcss | 4.3.1 | Utility CSS |
| @tailwindcss/vite | 4.3.1 | Tailwind Vite plugin |
| shadcn (CLI) | 4.11.0 | Component library |
| @paddleocr/paddleocr-js | 0.4.2 | Browser OCR engine |
| @electric-sql/pglite | 0.5.3 | WASM Postgres |
| @electric-sql/pglite-pgvector | 0.0.4 | pgvector for PGlite |
| lucide-react | 1.20.0 | Icon library |
| @radix-ui/react-dialog | 1.1.17 | Accessible dialog primitives |

### Architecture

```
Camera/File Input
       ↓
PaddleOCR.js (Worker)  ← OCR extraction
       ↓
Text Parser            ← Structured extraction (merchant, date, items, total)
       ↓
React UI (editable)    ← Review & edit before save
       ↓
PGlite (IndexedDB)     ← Persistent SQL storage
       ↓
Analytics / Export     ← SQL queries (GROUP BY, window functions)
```

### Performance Targets

- OCR processing: < 5s for typical receipt (PP-OCRv6_small)
- UI responsive during OCR (Worker mode)
- Receipt list: virtualized if >100 receipts
- Bundle size: < 8MB total (OCR models are the bulk, loaded on-demand)

### Browser Support

- Chrome 120+, Firefox 125+, Safari 18+, Edge 120+
- Web Worker support required (for PaddleOCR worker mode)
- IndexedDB required (for PGlite persistence)
- camera access via getUserMedia (https or localhost; GitHub Pages is https)

### Hosting

- GitHub Pages (static)
- COOP/COEP headers configured for threaded WASM (required by ONNX Runtime Web)

---

## Success Criteria

- [ ] Photograph receipt → structured data ready to save in < 10s
- [ ] All data survives browser restart (IndexedDB persistence)
- [ ] CSV export contains all receipts + line items
- [ ] Works on mobile (375px viewport)
- [ ] All touch targets ≥ 44×44px
- [ ] Zero network requests after initial load (fully offline-capable)

---

## Non-Goals (explicitly out of scope)

- ❌ Multi-device sync / cloud backup
- ❌ Receipt sharing / collaboration
- ❌ PDF invoice generation
- ❌ Currency conversion
- ❌ Bank statement reconciliation
- ❌ Barcode/QR scanning for product lookup
- ❌ Any backend or API
- ❌ Authentication / user accounts
