import type { OcrResult } from '@paddleocr/paddleocr-js';

export interface ParsedLineItem {
  description: string;
  amount: number | null;
  quantity: number | null;
  confidence: number;
}

export interface ParsedReceipt {
  merchant: string | null;
  date: string | null;
  total: number | null;
  tax: number | null;
  lineItems: ParsedLineItem[];
  confidence: number;
  rawText: string;
}

interface OcrItem {
  text: string;
  score: number;
  y: number;
}

// ── Currency patterns ───────────────────────────────────────────

const CURRENCY_SYMBOLS = '[£$€¥₹]';
const AMOUNT_RE = new RegExp(`${CURRENCY_SYMBOLS}?\\s*\\d{1,3}(?:[.,]\\d{2,3})*`);
const AMOUNT_ONLY_RE = /^\s*\d{1,3}(?:[.,]\d{2,3})*\s*$/;

// ── Date patterns ───────────────────────────────────────────────

const DATE_PATTERNS = [
  /\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}/,       // 14/06/2026, 14-06-26
  /\d{4}[/\-\.]\d{1,2}[/\-\.]\d{1,2}/,           // 2026-06-14
  /\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}/i,  // 14 Jun 2026
  /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}/i,  // Jun 14, 2026
];

// ── Total indicators ────────────────────────────────────────────

const TOTAL_INDICATORS = /\b(total|subtotal|amount\s*due|balance\s*due|grand\s*total|to\s*pay|sum)\b/i;

// ── Tax indicators ──────────────────────────────────────────────

const TAX_INDICATORS = /\b(tax|vat|gst|hst)\b/i;

// ── Same-Y merging ─────────────────────────────────────────

/** Merge OCR items that share the same Y line.
 *  Receipt descriptions and prices often appear as separate OCR
 *  results at the same vertical position. This joins them. */
function mergeSameY(rawItems: OcrItem[], yThreshold = 10): OcrItem[] {
  const merged: OcrItem[] = [];
  let i = 0;

  while (i < rawItems.length) {
    const current = rawItems[i];
    // Find all items within yThreshold of this one
    const group: OcrItem[] = [current];
    let j = i + 1;
    while (j < rawItems.length && Math.abs(rawItems[j].y - current.y) < yThreshold) {
      group.push(rawItems[j]);
      j++;
    }

    if (group.length === 1) {
      merged.push(current);
    } else {
      // Put description FIRST (no currency symbol), price SECOND (has symbol)
      group.sort((a, b) => {
        const aHasSymbol = new RegExp(`[${CURRENCY_SYMBOLS.slice(1, -1)}]`).test(a.text) ? 1 : 0;
        const bHasSymbol = new RegExp(`[${CURRENCY_SYMBOLS.slice(1, -1)}]`).test(b.text) ? 1 : 0;
        return aHasSymbol - bHasSymbol;
      });
      const combinedText = group.map(g => g.text).join(' ');
      const avgScore = group.reduce((s, g) => s + g.score, 0) / group.length;
      merged.push({ text: combinedText, score: avgScore, y: current.y });
    }

    i = j;
  }

  return merged;
}

// ── Main parser ─────────────────────────────────────────────────

export function parseReceipt(result: OcrResult): ParsedReceipt {
  // Sort items top-to-bottom by Y
  const rawItems: OcrItem[] = result.items
    .map(item => {
      const avgY = item.poly.reduce((sum, p) => sum + p[1], 0) / item.poly.length;
      return { text: item.text.trim(), score: item.score, y: avgY };
    })
    .filter(item => item.text.length > 0)
    .sort((a, b) => a.y - b.y);

  // Merge items on the same Y line — descriptions and prices often
  // appear as separate OCR results at the same vertical position.
  const items = mergeSameY(rawItems);
  const rawText = items.map(i => i.text).join('\n');

  // Average confidence
  const confidence = items.length > 0
    ? items.reduce((sum, i) => sum + i.score, 0) / items.length
    : 0;

  // ── Extract merchant ──────────────────────────────────────
  // First 1-3 lines that don't look like dates/amounts/line items
  let merchant: string | null = null;
  const merchantLines: string[] = [];
  for (let i = 0; i < Math.min(items.length, 4); i++) {
    const t = items[i].text;
    if (DATE_PATTERNS.some(p => p.test(t))) continue;
    if (TOTAL_INDICATORS.test(t)) continue;
    if (TAX_INDICATORS.test(t)) continue;
    if (AMOUNT_RE.test(t)) continue;
    merchantLines.push(t);
  }
  if (merchantLines.length > 0) {
    merchant = merchantLines[0];
  }

  // ── Extract date ──────────────────────────────────────────
  let date: string | null = null;
  for (const item of items) {
    for (const pattern of DATE_PATTERNS) {
      const match = item.text.match(pattern);
      if (match) {
        date = normalizeDate(match[0]);
        break;
      }
    }
    if (date) break;
  }

  // ── Extract total ─────────────────────────────────────────
  let total: number | null = null;
  // Scan from bottom up — total is usually near the end
  for (let i = items.length - 1; i >= 0; i--) {
    const t = items[i].text;
    if (TOTAL_INDICATORS.test(t)) {
      const amt = extractAmount(t);
      if (amt !== null) {
        total = amt;
        break;
      }
    }
  }
  // Fallback: last line with a standalone amount
  if (total === null) {
    for (let i = items.length - 1; i >= 0; i--) {
      const t = items[i].text;
      if (AMOUNT_ONLY_RE.test(t)) {
        const amt = parseFloat(t.replace(',', ''));
        if (!isNaN(amt) && amt > 0) {
          total = amt;
          break;
        }
      }
    }
  }

  // ── Extract tax ───────────────────────────────────────────
  let tax: number | null = null;
  for (const item of items) {
    if (TAX_INDICATORS.test(item.text)) {
      const amt = extractAmount(item.text);
      if (amt !== null) {
        tax = amt;
        break;
      }
    }
  }

  // ── Extract line items ────────────────────────────────────
  const lineItems: ParsedLineItem[] = [];
  const merchantThreshold = merchant ? merchantLines.length : 3;

  for (let i = merchantThreshold; i < items.length; i++) {
    const t = items[i].text;

    // Skip total/tax/date lines
    if (TOTAL_INDICATORS.test(t)) continue;
    if (TAX_INDICATORS.test(t)) continue;
    if (DATE_PATTERNS.some(p => p.test(t))) continue;

    const amount = extractAmount(t);
    if (amount === null) continue;

    // Skip amounts that don't look like prices: large integers (>100)
    // without decimals or currency symbols are likely quantities/addresses
    if (amount > 100 && amount === Math.floor(amount) &&
        !new RegExp(`[${CURRENCY_SYMBOLS.slice(1, -1)}]`).test(t)) {
      const hasDecimal = t.match(/\d+\.\d{2}/);
      if (!hasDecimal) continue;
    }

    // Remove amount from description
    let desc = t
      .replace(new RegExp(`${CURRENCY_SYMBOLS}?\\s*\\d{1,3}(?:[.,]\\d{2,3})*\\s*`), '')
      .trim()
      .replace(/^[-–—•*]\s*/, '')  // strip bullet points
      .replace(/\s+/g, ' ');

    // Skip if desc is empty after stripping
    if (!desc) continue;

    // Quantity detection (e.g., "2 x", "2x", "2 @")
    // Must run BEFORE we strip numbers — check the ORIGINAL text
    let quantity: number | null = null;
    const qtyMatch = t.match(/^(\d+)\s*[xX@]/);
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10);
      // Strip "3x" or "3 x" prefix from description
      desc = desc.replace(/^\d+\s*[xX@]\s*/, '').trim();
    }

    lineItems.push({
      description: desc,
      amount,
      quantity,
      confidence: items[i].score,
    });
  }

  return { merchant, date, total, tax, lineItems, confidence, rawText };
}

// ── Helpers ───────────────────────────────────────────────────

function extractAmount(text: string): number | null {
  // Match ALL currency amounts in the text, prefer ones with currency symbols
  const allMatches = [...text.matchAll(new RegExp(`(${CURRENCY_SYMBOLS}?)\\s*(\\d{1,3}(?:[.,]\\d{2,3})*)`, 'g'))];
  if (allMatches.length === 0) return null;

  // Prefer the LAST match (typically the actual price, not a quantity)
  const m = allMatches[allMatches.length - 1];
  const hasSymbol = m[1].length > 0;
  let numStr = m[2];

  // If the amount has a currency symbol, trust it. If not and it looks like
  // a small integer (1-2 digits), it might be a quantity — but if there's
  // no better candidate, use it.
  if (!hasSymbol && allMatches.length > 1) {
    // Try to find a match with a currency symbol
    for (let i = allMatches.length - 1; i >= 0; i--) {
      if (allMatches[i][1].length > 0) {
        numStr = allMatches[i][2];
        break;
      }
    }
  }

  // Handle comma as decimal BEFORE stripping commas
  // e.g., "€3,99" → numStr="3,99" → check if comma is decimal
  if (numStr.includes(',')) {
    const withoutCommas = numStr.replace(/,/g, '');
    // If the string without commas is short (≤4 digits), comma is decimal
    // Also check: if it has a dot AND commas, commas are thousands
    if (!numStr.includes('.') && withoutCommas.length <= 4) {
      numStr = numStr.replace(/,/, '.');
    } else {
      // Otherwise commas are thousand separators — remove them
      numStr = withoutCommas;
    }
  }

  // Handle dots as thousand separators (e.g., "1.234.56")
  const dots = (numStr.match(/\./g) || []).length;
  if (dots > 1) {
    const lastDot = numStr.lastIndexOf('.');
    numStr = numStr.slice(0, lastDot).replace(/\./g, '') + '.' + numStr.slice(lastDot + 1);
  }

  const val = parseFloat(numStr);
  return isNaN(val) ? null : val;
}

function normalizeDate(raw: string): string {
  // Parse common formats into YYYY-MM-DD
  const clean = raw.replace(/[,]/g, '').trim();

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const slashMatch = clean.match(/^(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{2,4})$/);
  if (slashMatch) {
    let [, d, m, y] = slashMatch;
    // If "month" > 12, this is actually MM/DD/YYYY (US format)
    if (parseInt(m) > 12) {
      [d, m] = [m, d];
    }
    if (y.length === 2) y = '20' + y;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // YYYY-MM-DD
  const isoMatch = clean.match(/^(\d{4})[/\-\.](\d{1,2})[/\-\.](\d{1,2})$/);
  if (isoMatch) {
    let [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // "14 Jun 2026" or "Jun 14 2026"
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const namedMatch = clean.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})/i)
    || clean.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\s+(\d{2,4})/i);
  if (namedMatch) {
    let d: string, m: string, y: string;
    if (/^\d/.test(namedMatch[1])) {
      [, d, m, y] = namedMatch;
    } else {
      [, m, d, y] = namedMatch;
    }
    if (y.length === 2) y = '20' + y;
    m = months[m.toLowerCase().slice(0, 3)];
    return `${y}-${m}-${d.padStart(2, '0')}`;
  }

  return clean;
}
