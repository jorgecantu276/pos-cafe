import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { SavedOrder } from './checkout';
import { saleDocuments, type ReceiptOptions, type PrintAudience, type SalePrintDocument, type SalePrintJob, type PrintState } from './sale-printing';

// Node 24 LTS is the print dispatch runtime. Keep the journal outside release folders.
interface Row { order_id: string; owner: string; ticket: string; audience: PrintAudience; queue: string; document: string; state: PrintState; message: string; attempts: number; claim: string | null; lease: number; updated: string }
export interface PreparedPrint { submit(): Promise<void>; dispose(): void }
export interface PrintAdapter { prepare(job: SalePrintJob, document: SalePrintDocument): Promise<PreparedPrint> }
const audiences: PrintAudience[] = ['customer', 'barista'];
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export class PrintJournal {
  private db: DatabaseSync;
  constructor(filename: string, private adapter: PrintAdapter, private clock = Date.now) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sale_sources (order_id TEXT PRIMARY KEY, owner TEXT NOT NULL, source_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (
        order_id TEXT NOT NULL, owner TEXT NOT NULL, ticket TEXT NOT NULL, audience TEXT NOT NULL,
        queue TEXT NOT NULL, document TEXT NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, claim TEXT, lease INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL,
        PRIMARY KEY(order_id,audience));`);
  }
  close() { this.db.close(); }
  private now() { return new Date(this.clock()).toISOString(); }
  private view(row: Row): SalePrintJob {
    return { orderId: row.order_id, ticket: row.ticket, audience: row.audience, queue: row.queue,
      state: row.state === 'submitting' && row.lease < this.clock() ? 'uncertain' : row.state,
      message: row.state === 'submitting' && row.lease < this.clock() ? 'Resultado incierto. Revisa la cola de Windows y el papel; no se reenviará automáticamente.' : row.message,
      attempts: row.attempts, updatedAt: row.updated };
  }
  list(owner: string): SalePrintJob[] {
    // Pending jobs are never hidden by a page of newer successful sales.
    const rows = this.db.prepare(`SELECT * FROM jobs WHERE owner=? AND state<>'submitted'
      UNION ALL SELECT * FROM (SELECT * FROM jobs WHERE owner=? AND state='submitted' ORDER BY updated DESC LIMIT 20)
      ORDER BY updated DESC`).all(owner, owner) as Row[];
    return rows.map(row => this.view(row));
  }
  get(owner: string, orderId: string): SalePrintJob[] {
    return (this.db.prepare('SELECT * FROM jobs WHERE owner=? AND order_id=? ORDER BY audience').all(owner, orderId) as Row[]).map(row => this.view(row));
  }
  cancel(owner: string, orderId: string) {
    this.db.prepare(`UPDATE jobs SET state='cancelled',message='Venta cancelada. No enviar a preparación.',updated=?
      WHERE owner=? AND order_id=? AND state IN ('queued','blocked','preparing')`).run(this.now(), owner, orderId);
  }
  ensure(owner: string, order: SavedOrder, queues: Record<PrintAudience, string>, options: ReceiptOptions = {}) {
    const documents = saleDocuments(order, options);
    const sourceHash = createHash('sha256').update(JSON.stringify(canonical(order))).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const source = this.db.prepare('SELECT * FROM sale_sources WHERE order_id=?').get(order.id) as { owner: string; source_hash: string } | undefined;
      if (source && (source.owner !== owner || source.source_hash !== sourceHash)) throw new Error('La identidad de impresión ya pertenece a otro comprobante.');
      if (!source) this.db.prepare('INSERT INTO sale_sources VALUES(?,?,?)').run(order.id, owner, sourceHash);
      for (const audience of audiences) {
        const old = this.db.prepare('SELECT * FROM jobs WHERE order_id=? AND audience=?').get(order.id, audience) as Row | undefined;
        if (old) {
          if (old.owner !== owner) throw new Error('La identidad de impresión ya pertenece a otro comprobante.');
          // A later template/locale update must not replace the saved document
          // or prevent retrying the original unsubmitted barista copy.
          // Existing jobs keep the original queue even when configuration changes.
          if (audience === 'customer' && documents.customer.issuerComplete === true
            && JSON.parse(old.document).issuerComplete !== true && !JSON.parse(old.document).testOnly) {
            // Complete a withheld draft only before any possible Windows handoff.
            this.db.prepare(`UPDATE jobs SET document=? WHERE order_id=? AND audience='customer' AND state IN ('queued','blocked')`)
              .run(JSON.stringify(documents.customer), order.id);
          }
          continue;
        }
        this.db.prepare(`INSERT INTO jobs(order_id,owner,ticket,audience,queue,document,state,message,updated)
          VALUES(?,?,?,?,?,?,'queued','Pendiente de envío',?)`).run(order.id, owner, String(order.ticket_number), audience, queues[audience], JSON.stringify(documents[audience]), this.now());
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async dispatch(owner: string, orderId: string, only?: PrintAudience) {
    await Promise.all((only ? [only] : audiences).map(audience => this.send(owner, orderId, audience)));
    return this.get(owner, orderId);
  }
  private async send(owner: string, orderId: string, audience: PrintAudience) {
    const claim = randomUUID();
    // Expired preparation is safe to reclaim: the old worker must win the CAS below
    // before it can touch the spooler. A submitting/uncertain job is NEVER reclaimed.
    const claimed = this.db.prepare(`UPDATE jobs SET state='preparing',claim=?,lease=?,updated=?,message='Comprobando impresora',attempts=attempts+1
      WHERE owner=? AND order_id=? AND audience=? AND (state IN ('queued','blocked') OR (state='preparing' AND lease<?))`)
      .run(claim, this.clock() + 60_000, this.now(), owner, orderId, audience, this.clock());
    if (!claimed.changes) return;
    const row = this.db.prepare('SELECT * FROM jobs WHERE order_id=? AND audience=?').get(orderId, audience) as Row;
    let prepared: PreparedPrint | undefined;
    let submitting = false;
    try {
      prepared = await this.adapter.prepare(this.view(row), JSON.parse(row.document));
      const changed = this.db.prepare(`UPDATE jobs SET state='submitting',lease=?,updated=?,message='Entregando a Windows'
        WHERE order_id=? AND audience=? AND claim=? AND state='preparing'`).run(this.clock() + 120_000, this.now(), orderId, audience, claim);
      if (!changed.changes) return;
      submitting = true; // Durable commit BEFORE the first potentially printing call.
      await prepared.submit();
      this.db.prepare(`UPDATE jobs SET state='submitted',message='Enviado a Windows. Si falta papel o Bluetooth, revisa esa cola; no vuelvas a cobrar.',updated=?
        WHERE order_id=? AND audience=? AND claim=?`).run(this.now(), orderId, audience, claim);
    } catch (error) {
      const message = submitting ? 'Resultado incierto. Revisa la cola de Windows y el papel; no se reenviará automáticamente.'
        : (error instanceof Error ? error.message : 'No se pudo preparar la impresora.');
      this.db.prepare(`UPDATE jobs SET state=?,message=?,updated=? WHERE order_id=? AND audience=? AND claim=?`)
        .run(submitting ? 'uncertain' : 'blocked', message, this.now(), orderId, audience, claim);
    } finally { prepared?.dispose(); }
  }
}
