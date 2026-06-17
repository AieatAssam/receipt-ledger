import { PGlite } from '@electric-sql/pglite';

// ── Types ──────────────────────────────────────────────────────────────

export interface Merchant {
  id: number;
  name: string;
  normalized_name: string;
  category: string | null;
  created_at: string;
}

export interface Receipt {
  id: number;
  merchant_id: number | null;
  receipt_date: string | null;
  total: number | null;
  tax: number | null;
  currency: string;
  image_data_url: string | null;
  raw_ocr_text: string | null;
  ocr_confidence: number | null;
  created_at: string;
}

export interface LineItem {
  id: number;
  receipt_id: number;
  description: string;
  quantity: number;
  unit_price: number | null;
  amount: number | null;
  category: string | null;
  position_index: number;
  created_at: string;
}

export interface ReceiptWithItems extends Receipt {
  merchant_name: string | null;
  items: LineItem[];
}

export interface NewReceipt {
  merchant_name?: string;
  receipt_date?: string;
  total?: number;
  tax?: number;
  currency?: string;
  image_data_url?: string;
  raw_ocr_text?: string;
  ocr_confidence?: number;
  line_items?: NewLineItem[];
}

export interface NewLineItem {
  description: string;
  quantity?: number;
  unit_price?: number;
  amount?: number;
}

export interface Analytics {
  total_spent: number;
  receipt_count: number;
  avg_receipt: number;
  top_merchant: string | null;
  top_merchant_total: number;
  by_category: { category: string; total: number; count: number }[];
  monthly_spend: { month: string; total: number; count: number }[];
}

// ── Database Singleton ────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS merchants (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    category TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS receipts (
    id SERIAL PRIMARY KEY,
    merchant_id INTEGER REFERENCES merchants(id),
    receipt_date DATE,
    total NUMERIC(10,2),
    tax NUMERIC(10,2),
    currency TEXT DEFAULT 'GBP',
    image_data_url TEXT,
    raw_ocr_text TEXT,
    ocr_confidence REAL,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS line_items (
    id SERIAL PRIMARY KEY,
    receipt_id INTEGER REFERENCES receipts(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price NUMERIC(10,2),
    amount NUMERIC(10,2),
    category TEXT,
    position_index INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
  );
`;

class Database {
  private db: PGlite | null = null;
  private ready = false;

  async init(): Promise<void> {
    if (this.ready) return;

    this.db = new PGlite('idb://receipt-ledger');
    await this.db.waitReady;

    // Run schema migration
    await this.db.exec(SCHEMA);

    this.ready = true;
  }

  private ensureReady(): PGlite {
    if (!this.db || !this.ready) {
      throw new Error('Database not initialized. Call db.init() first.');
    }
    return this.db;
  }

  // ── Merchants ──────────────────────────────────────────────────

  private async upsertMerchant(name: string): Promise<number> {
    const db = this.ensureReady();
    const normalized = name.toLowerCase().trim().replace(/\s+/g, ' ');

    // Try insert first
    const result = await db.query<Merchant>(
      `INSERT INTO merchants (name, normalized_name)
       VALUES ($1, $2)
       ON CONFLICT (normalized_name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [name.trim(), normalized]
    );
    return result.rows[0].id;
  }

  // ── Receipts ───────────────────────────────────────────────────

  async insertReceipt(data: NewReceipt): Promise<ReceiptWithItems> {
    const db = this.ensureReady();

    // Upsert merchant if name provided
    let merchantId: number | null = null;
    if (data.merchant_name) {
      merchantId = await this.upsertMerchant(data.merchant_name);
    }

    // Insert receipt
    const receiptResult = await db.query<Receipt>(
      `INSERT INTO receipts (merchant_id, receipt_date, total, tax, currency, image_data_url, raw_ocr_text, ocr_confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        merchantId,
        data.receipt_date ?? null,
        data.total ?? null,
        data.tax ?? null,
        data.currency ?? 'GBP',
        data.image_data_url ?? null,
        data.raw_ocr_text ?? null,
        data.ocr_confidence ?? null,
      ]
    );
    const receipt = receiptResult.rows[0];

    // Insert line items
    const items: LineItem[] = [];
    if (data.line_items) {
      for (let i = 0; i < data.line_items.length; i++) {
        const item = data.line_items[i];
        const itemResult = await db.query<LineItem>(
          `INSERT INTO line_items (receipt_id, description, quantity, unit_price, amount, position_index)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            receipt.id,
            item.description,
            item.quantity ?? 1,
            item.unit_price ?? null,
            item.amount ?? null,
            i,
          ]
        );
        items.push(itemResult.rows[0]);
      }
    }

    // Fetch merchant name
    let merchantName: string | null = null;
    if (merchantId) {
      const mResult = await db.query<Merchant>(
        'SELECT name FROM merchants WHERE id = $1',
        [merchantId]
      );
      if (mResult.rows.length > 0) {
        merchantName = mResult.rows[0].name;
      }
    }

    return { ...receipt, merchant_name: merchantName, items };
  }

  async getReceipts(limit = 50, offset = 0): Promise<ReceiptWithItems[]> {
    const db = this.ensureReady();
    const result = await db.query<Receipt & { merchant_name: string | null }>(
      `SELECT r.*, m.name as merchant_name
       FROM receipts r
       LEFT JOIN merchants m ON r.merchant_id = m.id
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const receipts: ReceiptWithItems[] = [];
    for (const row of result.rows) {
      const { merchant_name, ...receipt } = row;
      const itemsResult = await db.query<LineItem>(
        'SELECT * FROM line_items WHERE receipt_id = $1 ORDER BY position_index',
        [receipt.id]
      );
      receipts.push({ ...receipt, merchant_name, items: itemsResult.rows });
    }

    return receipts;
  }

  async getReceiptById(id: number): Promise<ReceiptWithItems | null> {
    const db = this.ensureReady();
    const result = await db.query<Receipt & { merchant_name: string | null }>(
      `SELECT r.*, m.name as merchant_name
       FROM receipts r
       LEFT JOIN merchants m ON r.merchant_id = m.id
       WHERE r.id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;

    const { merchant_name, ...receipt } = result.rows[0];
    const itemsResult = await db.query<LineItem>(
      'SELECT * FROM line_items WHERE receipt_id = $1 ORDER BY position_index',
      [id]
    );

    return { ...receipt, merchant_name, items: itemsResult.rows };
  }

  async updateReceipt(id: number, data: Partial<NewReceipt>): Promise<void> {
    const db = this.ensureReady();

    let merchantId: number | null = undefined as never;
    if (data.merchant_name !== undefined) {
      merchantId = data.merchant_name
        ? await this.upsertMerchant(data.merchant_name)
        : null;
    }

    const sets: string[] = [];
    const vals: unknown[] = [];

    if (merchantId !== (undefined as never)) {
      sets.push(`merchant_id = $${sets.length + 1}`);
      vals.push(merchantId);
    }
    if (data.receipt_date !== undefined) {
      sets.push(`receipt_date = $${sets.length + 1}`);
      vals.push(data.receipt_date);
    }
    if (data.total !== undefined) {
      sets.push(`total = $${sets.length + 1}`);
      vals.push(data.total);
    }
    if (data.tax !== undefined) {
      sets.push(`tax = $${sets.length + 1}`);
      vals.push(data.tax);
    }
    if (data.currency !== undefined) {
      sets.push(`currency = $${sets.length + 1}`);
      vals.push(data.currency);
    }
    if (data.image_data_url !== undefined) {
      sets.push(`image_data_url = $${sets.length + 1}`);
      vals.push(data.image_data_url);
    }
    if (data.raw_ocr_text !== undefined) {
      sets.push(`raw_ocr_text = $${sets.length + 1}`);
      vals.push(data.raw_ocr_text);
    }
    if (data.ocr_confidence !== undefined) {
      sets.push(`ocr_confidence = $${sets.length + 1}`);
      vals.push(data.ocr_confidence);
    }

    if (sets.length === 0) return;

    vals.push(id);
    await db.query(
      `UPDATE receipts SET ${sets.join(', ')} WHERE id = $${vals.length}`,
      vals
    );

    // Replace line items if provided
    if (data.line_items) {
      await db.query('DELETE FROM line_items WHERE receipt_id = $1', [id]);
      for (let i = 0; i < data.line_items.length; i++) {
        const item = data.line_items[i];
        await db.query(
          `INSERT INTO line_items (receipt_id, description, quantity, unit_price, amount, position_index)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, item.description, item.quantity ?? 1, item.unit_price ?? null, item.amount ?? null, i]
        );
      }
    }
  }

  async deleteReceipt(id: number): Promise<void> {
    const db = this.ensureReady();
    await db.query('DELETE FROM receipts WHERE id = $1', [id]);
  }

  // ── Analytics ──────────────────────────────────────────────────

  async getAnalytics(): Promise<Analytics> {
    const db = this.ensureReady();

    const totals = await db.query<{ total: number; count: number }>(
      `SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count FROM receipts`
    );
    const totalSpent = Number(totals.rows[0].total);
    const receiptCount = Number(totals.rows[0].count);
    const avgReceipt = receiptCount > 0 ? totalSpent / receiptCount : 0;

    // Top merchant
    const topMerchant = await db.query<{ name: string; total: number }>(
      `SELECT m.name, COALESCE(SUM(r.total), 0) as total
       FROM receipts r
       JOIN merchants m ON r.merchant_id = m.id
       GROUP BY m.id, m.name
       ORDER BY total DESC
       LIMIT 1`
    );

    // By category (from line items)
    const byCategory = await db.query<{ category: string; total: number; count: number }>(
      `SELECT COALESCE(li.category, 'Uncategorized') as category,
              COALESCE(SUM(li.amount), 0) as total,
              COUNT(DISTINCT li.receipt_id) as count
       FROM line_items li
       GROUP BY li.category
       ORDER BY total DESC`
    );

    // Monthly spend
    const monthlySpend = await db.query<{ month: string; total: number; count: number }>(
      `SELECT TO_CHAR(receipt_date, 'YYYY-MM') as month,
              COALESCE(SUM(total), 0) as total,
              COUNT(*) as count
       FROM receipts
       WHERE receipt_date IS NOT NULL
       GROUP BY month
       ORDER BY month DESC
       LIMIT 12`
    );

    return {
      total_spent: totalSpent,
      receipt_count: receiptCount,
      avg_receipt: avgReceipt,
      top_merchant: topMerchant.rows[0]?.name ?? null,
      top_merchant_total: Number(topMerchant.rows[0]?.total ?? 0),
      by_category: byCategory.rows.map(r => ({ ...r, total: Number(r.total), count: Number(r.count) })),
      monthly_spend: monthlySpend.rows.reverse().map(r => ({ ...r, total: Number(r.total), count: Number(r.count) })),
    };
  }

  async searchReceipts(query: string): Promise<ReceiptWithItems[]> {
    const db = this.ensureReady();
    const pattern = `%${query}%`;

    const result = await db.query<Receipt & { merchant_name: string | null }>(
      `SELECT DISTINCT r.*, m.name as merchant_name
       FROM receipts r
       LEFT JOIN merchants m ON r.merchant_id = m.id
       LEFT JOIN line_items li ON li.receipt_id = r.id
       WHERE m.name ILIKE $1
          OR r.raw_ocr_text ILIKE $1
          OR li.description ILIKE $1
       ORDER BY r.created_at DESC
       LIMIT 50`,
      [pattern]
    );

    const receipts: ReceiptWithItems[] = [];
    for (const row of result.rows) {
      const { merchant_name, ...receipt } = row;
      const itemsResult = await db.query<LineItem>(
        'SELECT * FROM line_items WHERE receipt_id = $1 ORDER BY position_index',
        [receipt.id]
      );
      receipts.push({ ...receipt, merchant_name, items: itemsResult.rows });
    }

    return receipts;
  }

  async exportCsv(): Promise<string> {
    const db = this.ensureReady();
    const result = await db.query<Record<string, unknown>>(
      `SELECT
         r.id as receipt_id,
         m.name as merchant,
         r.receipt_date,
         r.total,
         r.tax,
         r.currency,
         li.description as item_description,
         li.quantity,
         li.unit_price,
         li.amount as item_amount,
         li.category as item_category
       FROM receipts r
       LEFT JOIN merchants m ON r.merchant_id = m.id
       LEFT JOIN line_items li ON li.receipt_id = r.id
       ORDER BY r.created_at DESC, li.position_index`
    );

    if (result.rows.length === 0) return '';

    const headers = Object.keys(result.rows[0]);
    const lines = [
      headers.join(','),
      ...result.rows.map(row =>
        headers.map(h => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          const str = String(val);
          // Escape commas and quotes
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        }).join(',')
      ),
    ];

    return lines.join('\n');
  }

  async dispose(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.ready = false;
    }
  }
}

export const db = new Database();
