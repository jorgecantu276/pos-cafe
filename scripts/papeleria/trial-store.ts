import { closeSync, linkSync, openSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { CartItem } from '../../store/useCartStore';
import { checkoutPayload } from '../../lib/checkout';
import { customerSaleDocument, type SalePrintDocument } from '../../lib/sale-printing';

const papeleriaProfile = { id: 'papeleria', title: 'POS Papelería', ticketPrefix: 'Ticket' };

type ProductRow = { id: string; code: string; barcode: string; name: string; price_cents: number; stock: number | null };
type Payment = 'efectivo' | 'tarjeta';
type Sale = { folio: number; totalCents: number; changeCents: number; receipt: SalePrintDocument };
type SaleRow = { folio: number; total_cents: number; change_cents: number; receipt: string; void_reason: string | null };

function validCents(amount: number) {
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 99_999_999;
}

// Deliberately a separate schema for the local parity trial. This never opens a native POS database for writing.
export class PapeleriaTrialStore {
  private readonly db: DatabaseSync;

  constructor(file: string, writable: boolean) {
    this.db = new DatabaseSync(file, { readOnly: !writable });
    try {
      this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
      this.db.prepare('SELECT stock FROM trial_products LIMIT 0').get();
      if (writable) this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  static initialize(file: string) {
    closeSync(openSync(file, 'wx'));
    const db = new DatabaseSync(file);
    try {
      db.exec('BEGIN IMMEDIATE');
      db.exec(`
        CREATE TABLE trial_products (
          id TEXT PRIMARY KEY, code TEXT NOT NULL COLLATE NOCASE UNIQUE, barcode TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK (price_cents > 0),
          stock INTEGER CHECK (stock >= 0), opening_stock INTEGER CHECK (opening_stock >= 0)
        ) STRICT;
        CREATE TABLE trial_sales (
          folio INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, total_cents INTEGER NOT NULL,
          change_cents INTEGER NOT NULL, receipt TEXT NOT NULL, void_reason TEXT
        ) STRICT;
        CREATE TABLE trial_sale_lines (
          folio INTEGER NOT NULL REFERENCES trial_sales, product_id TEXT NOT NULL REFERENCES trial_products,
          quantity INTEGER NOT NULL CHECK (quantity > 0), PRIMARY KEY (folio, product_id)
        ) STRICT;
        INSERT INTO trial_products VALUES ('pen', 'BOL-AZUL', '0012345678905', 'Bolígrafo azul', 825, 4, 4),
          ('unknown', 'PENDIENTE', '0012345678912', 'Cuaderno sin conteo', 1500, NULL, NULL);
      `);
      db.exec('COMMIT');
    } finally {
      db.close();
    }
  }

  close() { this.db.close(); }

  scan(identifier: string): CartItem['product'] | null {
    const matches = this.db.prepare('SELECT * FROM trial_products WHERE barcode = ? OR code = ?')
      .all(identifier.trim(), identifier.trim()) as ProductRow[];
    if (matches.length > 1) throw Error('Código ambiguo.');
    const product = matches[0];
    if (!product) return null;
    return { id: product.id, name: product.name, price: product.price_cents / 100, category: 'Papelería',
      inventory: { mode: 'counted', quantity: product.stock, available: product.stock !== null && product.stock > 0 } };
  }

  readSale(folio: number): Sale | null {
    const row = this.db.prepare('SELECT * FROM trial_sales WHERE folio = ?').get(folio) as SaleRow | undefined;
    return row ? this.savedSale(row) : null;
  }

  private savedSale(row: SaleRow): Sale {
    return { folio: row.folio, totalCents: row.total_cents, changeCents: row.change_cents, receipt: JSON.parse(row.receipt) };
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  checkout(requestId: string, cart: readonly CartItem[], payment: Payment, tenderCents: number): Sale {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)) throw Error('Falta el identificador de venta.');
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM trial_sales WHERE request_id = ?').get(requestId) as SaleRow | undefined;
      if (previous) return this.savedSale(previous);
      if (!validCents(tenderCents) || !['efectivo', 'tarjeta'].includes(payment)) throw Error('Revisa el pago.');

      const payload = checkoutPayload(cart, {
        register_id: 'papeleria-trial', expected_total: 0, payment_method: payment, tender_mxn: tenderCents / 100,
        tender_usd: 0, customer_id: null, order_type: 'Venta de mostrador', order_note: '', pager_number: null,
      }, false);
      const products = new Set<string>();
      let totalCents = 0;
      const items = payload.items.map((line, index) => {
        if (line.quantity > 1000 || products.has(line.product_id) || line.extra_ids.length || line.note) {
          throw Error('Revisa los artículos de la venta.');
        }
        products.add(line.product_id);
        const product = this.db.prepare('SELECT * FROM trial_products WHERE id = ?').get(line.product_id) as ProductRow | undefined;
        if (!product || product.stock === null || product.stock < line.quantity) throw Error('Revisa el conteo y las existencias.');
        if (product.price_cents !== Math.round(cart[index].product.price * 100)) throw Error('El precio cambió. Revisa la venta.');
        totalCents += product.price_cents * line.quantity;
        return { id: product.id, quantity: line.quantity,
          product: { id: product.id, name: product.name, category: 'Papelería', price: product.price_cents / 100 } };
      });
      if (!validCents(totalCents) || tenderCents < totalCents || (payment === 'tarjeta' && tenderCents !== totalCents)) {
        throw Error('El pago no coincide con el total.');
      }

      const changeCents = tenderCents - totalCents;
      const result = this.db.prepare('INSERT INTO trial_sales (request_id, total_cents, change_cents, receipt) VALUES (?, ?, ?, ?) RETURNING folio')
        .get(requestId, totalCents, changeCents, '{}') as { folio: number };
      const { folio } = result;
      const receipt = customerSaleDocument({
        id: requestId, ticket_number: folio, status: 'completed', items, total: totalCents / 100,
        customer_name: '', order_type: payload.order_type, order_note: '', created_at: new Date().toISOString(),
        payment_method: payment, tender_mxn: tenderCents / 100, tender_usd: 0, exchange_rate: 1, change_mxn: changeCents / 100,
      }, { testOnly: true }, papeleriaProfile);
      this.db.prepare('UPDATE trial_sales SET receipt = ? WHERE folio = ?').run(JSON.stringify(receipt), folio);
      const add = this.db.prepare('INSERT INTO trial_sale_lines VALUES (?, ?, ?)');
      const deduct = this.db.prepare('UPDATE trial_products SET stock = stock - ? WHERE id = ?');
      for (const { id, quantity } of items) {
        add.run(folio, id, quantity);
        deduct.run(quantity, id);
      }
      return { folio, totalCents, changeCents, receipt };
    });
  }

  voidSale(folio: number, reason: string) {
    const note = reason.trim();
    if (!note) throw Error('Indica el motivo de la cancelación.');
    this.transaction(() => {
      const result = this.db.prepare('UPDATE trial_sales SET void_reason = ? WHERE folio = ? AND void_reason IS NULL').run(note, folio);
      if (!result.changes) throw Error('La venta no existe o ya está cancelada.');
      this.db.prepare(`UPDATE trial_products SET stock = stock + (
        SELECT quantity FROM trial_sale_lines WHERE folio = ? AND product_id = trial_products.id
      ) WHERE id IN (SELECT product_id FROM trial_sale_lines WHERE folio = ?)`).run(folio, folio);
    });
  }

  createBackup(destination: string) {
    const temporary = destination + '.' + randomUUID() + '.tmp';
    try {
      this.db.prepare('VACUUM INTO ?').run(temporary);
      const restored = new PapeleriaTrialStore(temporary, false);
      try {
        const result = restored.db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
        const imbalance = restored.db.prepare(`SELECT p.id FROM trial_products p WHERE p.stock IS NOT (
          p.opening_stock - COALESCE((SELECT SUM(l.quantity) FROM trial_sale_lines l JOIN trial_sales s USING (folio)
            WHERE l.product_id = p.id AND s.void_reason IS NULL), 0)) LIMIT 1`).get();
        if (result?.integrity_check !== 'ok' || restored.db.prepare('PRAGMA foreign_key_check').get() || imbalance) {
          throw Error('La copia no pasó la verificación.');
        }
      } finally { restored.close(); }
      linkSync(temporary, destination);
    } finally { rmSync(temporary, { force: true }); }
  }
}
