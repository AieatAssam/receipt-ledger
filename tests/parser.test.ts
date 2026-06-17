/**
 * Parser test — simulates PaddleOCR output from real receipt layouts.
 * Run with: npx tsx tests/parser.test.ts
 */

// ── Copy of parser.ts logic for testability ──────────────────────

const CURRENCY_SYMBOLS = '[£$€¥₹]';
const AMOUNT_RE = new RegExp(`${CURRENCY_SYMBOLS}?\\s*\\d{1,3}(?:[.,]\\d{2,3})*`);
const AMOUNT_ONLY_RE = /^\s*\d{1,3}(?:[.,]\d{2,3})*\s*$/;

const DATE_PATTERNS = [
  /\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}/,
  /\d{4}[/\-\.]\d{1,2}[/\-\.]\d{1,2}/,
  /\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}/i,
  /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}/i,
];

const TOTAL_INDICATORS = /\b(total|subtotal|amount\s*due|balance\s*due|grand\s*total|to\s*pay|sum)\b/i;
const TAX_INDICATORS = /\b(tax|vat|gst|hst)\b/i;

// ── Helpers ─────────────────────────────────────────────────────

function extractAmount(text: string): number | null {
  const allMatches = [...text.matchAll(new RegExp(`(${CURRENCY_SYMBOLS}?)\\s*(\\d{1,3}(?:[.,]\\d{2,3})*)`, 'g'))];
  if (allMatches.length === 0) return null;
  const m = allMatches[allMatches.length - 1];
  const hasSymbol = m[1].length > 0;
  let numStr = m[2];
  if (!hasSymbol && allMatches.length > 1) {
    for (let i = allMatches.length - 1; i >= 0; i--) {
      if (allMatches[i][1].length > 0) {
        numStr = allMatches[i][2];
        break;
      }
    }
  }
  if (numStr.includes(',')) {
    const withoutCommas = numStr.replace(/,/g, '');
    if (!numStr.includes('.') && withoutCommas.length <= 4) {
      numStr = numStr.replace(/,/, '.');
    } else {
      numStr = withoutCommas;
    }
  }
  const dots = (numStr.match(/\./g) || []).length;
  if (dots > 1) {
    const lastDot = numStr.lastIndexOf('.');
    numStr = numStr.slice(0, lastDot).replace(/\./g, '') + '.' + numStr.slice(lastDot + 1);
  }
  const val = parseFloat(numStr);
  return isNaN(val) ? null : val;
}

function normalizeDate(raw: string): string {
  const clean = raw.replace(/[,]/g, '').trim();
  const slashMatch = clean.match(/^(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{2,4})$/);
  if (slashMatch) {
    let [, d, m, y] = slashMatch;
    if (parseInt(m) > 12) {
      [d, m] = [m, d];
    }
    if (y.length === 2) y = '20' + y;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const isoMatch = clean.match(/^(\d{4})[/\-\.](\d{1,2})[/\-\.](\d{1,2})$/);
  if (isoMatch) {
    let [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
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

// ── Main parser ─────────────────────────────────────────────────

interface OcrItem {
  text: string;
  score: number;
  y: number;
}

interface ParsedLineItem {
  description: string;
  amount: number | null;
  quantity: number | null;
  confidence: number;
}

interface ParsedReceipt {
  merchant: string | null;
  date: string | null;
  total: number | null;
  tax: number | null;
  lineItems: ParsedLineItem[];
  confidence: number;
  rawText: string;
}

/** Merge OCR items that share the same Y line. */
function mergeSameY(rawItems: OcrItem[], yThreshold = 10): OcrItem[] {
  const merged: OcrItem[] = [];
  let i = 0;
  while (i < rawItems.length) {
    const current = rawItems[i];
    const group: OcrItem[] = [current];
    let j = i + 1;
    while (j < rawItems.length && Math.abs(rawItems[j].y - current.y) < yThreshold) {
      group.push(rawItems[j]);
      j++;
    }
    if (group.length === 1) {
      merged.push(current);
    } else {
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

function parseReceipt(items: OcrItem[]): ParsedReceipt {
  const rawItems = items.filter(i => i.text.length > 0).sort((a, b) => a.y - b.y);
  const sorted = mergeSameY(rawItems);
  const rawText = sorted.map(i => i.text).join('\n');
  const confidence = sorted.length > 0
    ? sorted.reduce((sum, i) => sum + i.score, 0) / sorted.length : 0;

  // Merchant
  let merchant: string | null = null;
  const merchantLines: string[] = [];
  for (let i = 0; i < Math.min(sorted.length, 4); i++) {
    const t = sorted[i].text;
    if (DATE_PATTERNS.some(p => p.test(t))) continue;
    if (TOTAL_INDICATORS.test(t)) continue;
    if (TAX_INDICATORS.test(t)) continue;
    if (AMOUNT_RE.test(t)) continue;
    merchantLines.push(t);
  }
  if (merchantLines.length > 0) merchant = merchantLines[0];

  // Date
  let date: string | null = null;
  for (const item of sorted) {
    for (const pattern of DATE_PATTERNS) {
      const match = item.text.match(pattern);
      if (match) { date = normalizeDate(match[0]); break; }
    }
    if (date) break;
  }

  // Total
  let total: number | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const t = sorted[i].text;
    if (TOTAL_INDICATORS.test(t)) {
      const amt = extractAmount(t);
      if (amt !== null) { total = amt; break; }
    }
  }
  if (total === null) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      const t = sorted[i].text;
      if (AMOUNT_ONLY_RE.test(t)) {
        const amt = parseFloat(t.replace(',', ''));
        if (!isNaN(amt) && amt > 0) { total = amt; break; }
      }
    }
  }

  // Tax
  let tax: number | null = null;
  for (const item of sorted) {
    if (TAX_INDICATORS.test(item.text)) {
      const amt = extractAmount(item.text);
      if (amt !== null) { tax = amt; break; }
    }
  }

  // Line items
  const lineItems: ParsedLineItem[] = [];
  const merchantThreshold = merchant ? merchantLines.length : 3;
  for (let i = merchantThreshold; i < sorted.length; i++) {
    const t = sorted[i].text;
    if (TOTAL_INDICATORS.test(t)) continue;
    if (TAX_INDICATORS.test(t)) continue;
    if (DATE_PATTERNS.some(p => p.test(t))) continue;

    const amount = extractAmount(t);
    if (amount === null) continue;

    if (amount > 100 && amount === Math.floor(amount) &&
        !new RegExp(`[${CURRENCY_SYMBOLS.slice(1, -1)}]`).test(t)) {
      const hasDecimal = t.match(/\d+\.\d{2}/);
      if (!hasDecimal) continue;
    }

    let desc = t
      .replace(new RegExp(`${CURRENCY_SYMBOLS}?\\s*\\d{1,3}(?:[.,]\\d{2,3})*\\s*`), '')
      .trim()
      .replace(/^[-–—•*]\s*/, '')
      .replace(/\s+/g, ' ');

    if (!desc) continue;

    // Quantity detection — check ORIGINAL merged text
    let quantity: number | null = null;
    const qtyMatch = t.match(/^(\d+)\s*[xX@]/);
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10);
      desc = desc.replace(/^\d+\s*[xX@]\s*/, '').trim();
    }

    lineItems.push({ description: desc, amount, quantity, confidence: sorted[i].score });
  }

  return { merchant, date, total, tax, lineItems, confidence, rawText };
}

// ── TESTS ───────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, actual?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${actual ? ` (got: ${actual})` : ''}`);
    failed++;
  }
}

function test(name: string, fn: () => void) {
  console.log(`\n${name}`);
  fn();
}

// ── Test 1: UK Grocery (Tesco) ──────────────────────────────────

test('UK Grocery Receipt (Tesco)', () => {
  const items: OcrItem[] = [
    { text: 'Tesco', score: 0.95, y: 20 },
    { text: 'Store 2345 High Street', score: 0.85, y: 40 },
    { text: '14/06/2026 14:32', score: 0.88, y: 60 },
    { text: 'Milk Semi-Skimmed 2L', score: 0.82, y: 100 },
    { text: '£1.45', score: 0.91, y: 100 },
    { text: 'Bread Wholemeal', score: 0.85, y: 120 },
    { text: '£1.20', score: 0.90, y: 120 },
    { text: 'Bananas x6', score: 0.88, y: 140 },
    { text: '£0.89', score: 0.92, y: 140 },
    { text: 'Chicken Breast 300g', score: 0.80, y: 160 },
    { text: '£3.50', score: 0.93, y: 160 },
    { text: 'Pasta Sauce', score: 0.87, y: 180 },
    { text: '£1.75', score: 0.91, y: 180 },
    { text: 'SUBTOTAL £8.79', score: 0.85, y: 220 },
    { text: 'VAT £0.35', score: 0.80, y: 240 },
    { text: 'TOTAL £8.79', score: 0.88, y: 260 },
    { text: 'Paid by Card', score: 0.75, y: 280 },
  ];

  const p = parseReceipt(items);

  assert('merchant = Tesco', p.merchant === 'Tesco', p.merchant ?? 'null');
  assert('date = 2026-06-14', p.date === '2026-06-14', p.date ?? 'null');
  assert('total = 8.79', p.total === 8.79, p.total?.toString() ?? 'null');
  assert('tax found', p.tax !== null, p.tax?.toString() ?? 'null');
  assert('5 line items', p.lineItems.length === 5, p.lineItems.length.toString());
  assert('Milk item', p.lineItems.some(li => li.description.includes('Milk')), 'not found');
  assert('Bread item', p.lineItems.some(li => li.description.includes('Bread')), 'not found');
  assert('Chicken item', p.lineItems.some(li => li.description.includes('Chicken')), 'not found');
  assert('confidence > 80%', p.confidence > 0.8, Math.round(p.confidence * 100) + '%');
});

// ── Test 2: US Restaurant Receipt ───────────────────────────────

test('US Restaurant Receipt', () => {
  const items: OcrItem[] = [
    { text: 'JOE\'S DINER', score: 0.92, y: 20 },
    { text: '123 Main St, Portland', score: 0.80, y: 40 },
    { text: 'Jun 17, 2026  12:45 PM', score: 0.85, y: 60 },
    { text: 'Cheeseburger', score: 0.88, y: 100 },
    { text: '$12.50', score: 0.93, y: 100 },
    { text: 'French Fries', score: 0.87, y: 120 },
    { text: '$4.50', score: 0.92, y: 120 },
    { text: 'Coke', score: 0.90, y: 140 },
    { text: '$2.50', score: 0.94, y: 140 },
    { text: 'SUBTOTAL', score: 0.85, y: 180 },
    { text: '$19.50', score: 0.91, y: 180 },
    { text: 'TAX', score: 0.80, y: 200 },
    { text: '$1.56', score: 0.89, y: 200 },
    { text: 'TOTAL', score: 0.88, y: 220 },
    { text: '$21.06', score: 0.92, y: 220 },
  ];
  // After same-Y merging, description+price pairs are combined

  const p = parseReceipt(items);

  assert('merchant = JOE\'S DINER', p.merchant === 'JOE\'S DINER', p.merchant ?? 'null');
  assert('date = 2026-06-17', p.date === '2026-06-17', p.date ?? 'null');
  assert('total = 21.06', p.total === 21.06, p.total?.toString() ?? 'null');
  assert('tax = 1.56', p.tax === 1.56, p.tax?.toString() ?? 'null');
  assert('3 line items', p.lineItems.length === 3, p.lineItems.length.toString());
  assert('Cheeseburger item', p.lineItems.some(li => li.description.includes('Cheeseburger')), 'not found');
  assert('French Fries item', p.lineItems.some(li => li.description.includes('French Fries')), 'not found');
  assert('Coke item', p.lineItems.some(li => li.description.includes('Coke')), 'not found');
});

// ── Test 3: date formats ────────────────────────────────────────

test('Date format parsing', () => {
  assert('DD/MM/YYYY', normalizeDate('14/06/2026') === '2026-06-14', normalizeDate('14/06/2026'));
  assert('MM/DD/YYYY (US style)', normalizeDate('06/17/2026') === '2026-06-17', normalizeDate('06/17/2026'));
  assert('YYYY-MM-DD', normalizeDate('2026-06-14') === '2026-06-14', normalizeDate('2026-06-14'));
  assert('DD Mon YYYY', normalizeDate('14 Jun 2026') === '2026-06-14', normalizeDate('14 Jun 2026'));
  assert('Mon DD, YYYY', normalizeDate('Jun 14, 2026') === '2026-06-14', normalizeDate('Jun 14, 2026'));
  assert('2-digit year', normalizeDate('14/06/26') === '2026-06-14', normalizeDate('14/06/26'));
});

// ── Test 4: amount extraction ───────────────────────────────────

test('Amount extraction', () => {
  assert('£1.45 → 1.45', extractAmount('£1.45') === 1.45, extractAmount('£1.45')?.toString() ?? 'null');
  assert('$12.50 → 12.50', extractAmount('$12.50') === 12.50);
  assert('€3,99 → 3.99', extractAmount('€3,99') === 3.99);
  assert('1,234.56 → 1234.56', extractAmount('£1,234.56') === 1234.56);
  assert('no amount → null', extractAmount('No price here') === null);
  assert('TOTAL £8.79 → 8.79', extractAmount('TOTAL £8.79') === 8.79);
});

// ── Test 5: quantity extraction ─────────────────────────────────

test('Quantity extraction', () => {
  const items: OcrItem[] = [
    { text: 'MERCHANT', score: 0.9, y: 10 },
    { text: '15/06/2026', score: 0.9, y: 30 },
    { text: '3x Coffee', score: 0.85, y: 50 },
    { text: '£7.50', score: 0.9, y: 50 },
    { text: '2 @ Bagels', score: 0.82, y: 70 },
    { text: '£4.00', score: 0.9, y: 70 },
    { text: 'TOTAL £11.50', score: 0.88, y: 100 },
  ];
  // After same-Y merging: "3x Coffee £7.50", "2 @ Bagels £4.00"
  const p = parseReceipt(items);
  assert('Coffee quantity = 3', p.lineItems.some(li => li.quantity === 3), 'not found');
  assert('Bagels quantity = 2', p.lineItems.some(li => li.quantity === 2), 'not found');
  assert('Coffee desc contains Coffee', p.lineItems.some(li => li.description.includes('Coffee')), 'not found');
  assert('Coffee amount = 7.50', p.lineItems.some(li => li.amount === 7.50), 'not found');
  assert('TOTAL = 11.50', p.total === 11.50, p.total?.toString() ?? 'null');
});

// ── Test 6: empty receipt ───────────────────────────────────────

test('Empty receipt', () => {
  const p = parseReceipt([]);
  assert('no merchant', p.merchant === null);
  assert('no date', p.date === null);
  assert('no total', p.total === null);
  assert('no line items', p.lineItems.length === 0);
  assert('confidence = 0', p.confidence === 0);
});

// ── Summary ─────────────────────────────────────────────────────

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}`);

if (failed > 0) process.exit(1);
