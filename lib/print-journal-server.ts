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
export type PrintRecoveryAction = 'retry' | 'confirm_printed' | 'replace_missing';
export interface PrintRecovery { requestId: string; actor: string; owner: string; orderId: string; audience: PrintAudience; action: PrintRecoveryAction; reason: string }
export interface PrintRecoveryAudit extends PrintRecovery { previousState: string; createdAt: string; ticket: string }
const audiences: PrintAudience[] = ['customer', 'barista'];
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export class PrintJournal {
  private db: DatabaseSync;
  constructor(filename: string, private adapter: PrintAdapter, private clock = Date.now) {
    const probe = new DatabaseSync(':memory:');
    try {
      const { version } = probe.prepare('SELECT sqlite_version() AS version').get() as { version: string };
      const [major, minor, patch] = version.split('.').map(Number);
      if (!(major > 3 || (major === 3 && (minor > 51 || (minor === 51 && patch >= 3)))))
        throw new Error('Actualiza el runtime de impresión: se requiere SQLite 3.51.3 o posterior. Conserva el registro existente.');
    } finally { probe.close(); }
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sale_sources (order_id TEXT PRIMARY KEY, owner TEXT NOT NULL, source_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (
        order_id TEXT NOT NULL, owner TEXT NOT NULL, ticket TEXT NOT NULL, audience TEXT NOT NULL,
        queue TEXT NOT NULL, document TEXT NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, claim TEXT, lease INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL,
        PRIMARY KEY(order_id,audience));
      CREATE TABLE IF NOT EXISTS recovery_audit (
        request_id TEXT PRIMARY KEY, actor TEXT NOT NULL, owner TEXT NOT NULL, order_id TEXT NOT NULL, audience TEXT NOT NULL,
        action TEXT NOT NULL, reason TEXT NOT NULL, previous_state TEXT NOT NULL, created_at TEXT NOT NULL);`);
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
  listAll(): (SalePrintJob & { cashierId: string; canRetry: boolean })[] {
    const rows = this.db.prepare(`SELECT * FROM jobs WHERE state NOT IN ('submitted','cancelled')
      UNION ALL SELECT * FROM (SELECT * FROM jobs WHERE state IN ('submitted','cancelled') ORDER BY updated DESC LIMIT 20)
      ORDER BY updated DESC`).all() as Row[];
    return rows.map(row => ({ ...this.view(row), cashierId: row.owner,
      canRetry:['queued','blocked'].includes(row.state)||(row.state==='preparing'&&row.lease<this.clock()) }));
  }
  recoveryHistory(): PrintRecoveryAudit[] {
    return (this.db.prepare(`SELECT a.*,j.ticket FROM recovery_audit a JOIN jobs j ON j.order_id=a.order_id AND j.audience=a.audience
      ORDER BY a.created_at DESC,a.request_id DESC LIMIT 50`).all() as Record<string,string>[])
      .map(row => ({ requestId: row.request_id, actor: row.actor, owner: row.owner, orderId: row.order_id,
        audience: row.audience as PrintAudience, action: row.action as PrintRecoveryAction, reason: row.reason,
        previousState: row.previous_state, createdAt: row.created_at,ticket:row.ticket }));
  }
  authorizeRecovery(input: PrintRecovery) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT * FROM recovery_audit WHERE request_id=?').get(input.requestId) as Record<string,string> | undefined;
      if (old) {
        if (old.actor !== input.actor || old.owner !== input.owner || old.order_id !== input.orderId || old.audience !== input.audience
          || old.action !== input.action || old.reason !== input.reason) throw new Error('La recuperación pendiente pertenece a otra revisión.');
        this.db.exec('COMMIT'); return;
      }
      const row = this.db.prepare('SELECT * FROM jobs WHERE owner=? AND order_id=? AND audience=?').get(input.owner,input.orderId,input.audience) as Row | undefined;
      if (!row) throw new Error('No existe esta copia en el registro local.');
      const uncertain = row.state === 'uncertain' || (row.state === 'submitting' && row.lease < this.clock());
      if (input.action === 'retry') {
        if (!['queued','blocked'].includes(row.state) && !(row.state === 'preparing' && row.lease < this.clock()))
          throw new Error('Esta copia no admite reintento seguro. Actualiza su estado.');
      } else {
        if (!uncertain && !(input.action === 'replace_missing' && row.state === 'submitted'))
          throw new Error('Espera a que termine el envío activo y actualiza antes de resolverlo.');
        this.db.prepare(`UPDATE jobs SET state=?,message=?,claim=NULL,lease=0,updated=? WHERE owner=? AND order_id=? AND audience=?`)
          .run(input.action === 'confirm_printed' ? 'submitted' : 'blocked', input.action === 'confirm_printed'
            ? 'El responsable confirmó la salida en papel. No se reenvió.' : 'El responsable autorizó una reposición tras revisar papel y cola de Windows.',
          this.now(),input.owner,input.orderId,input.audience);
      }
      this.db.prepare('INSERT INTO recovery_audit VALUES(?,?,?,?,?,?,?,?,?)')
        .run(input.requestId,input.actor,input.owner,input.orderId,input.audience,input.action,input.reason,row.state,this.now());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  cancel(owner: string, orderId: string) {
    this.db.prepare(`UPDATE jobs SET state='cancelled',message='Venta cancelada. No enviar a preparación.',updated=?
      WHERE owner=? AND order_id=? AND state IN ('queued','blocked','preparing')`).run(this.now(), owner, orderId);
  }
  ensure(owner: string, order: SavedOrder, queues: Record<PrintAudience, string>, options: ReceiptOptions = {}, only?: PrintAudience) {
    const documents = saleDocuments(order, options);
    const sourceHash = createHash('sha256').update(JSON.stringify(canonical(order))).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const source = this.db.prepare('SELECT * FROM sale_sources WHERE order_id=?').get(order.id) as { owner: string; source_hash: string } | undefined;
      if (source && (source.owner !== owner || source.source_hash !== sourceHash)) throw new Error('La identidad de impresión ya pertenece a otro comprobante.');
      if (!source) this.db.prepare('INSERT INTO sale_sources VALUES(?,?,?)').run(order.id, owner, sourceHash);
      // Normal sales still create both copies atomically. The standalone
      // receipt acceptance runner explicitly selects only the customer copy.
      for (const audience of only ? [only] : audiences) {
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
  async dispatch(owner: string, orderId: string, only?: PrintAudience, eligible?: () => Promise<boolean>) {
    await Promise.all((only ? [only] : audiences).map(audience => this.send(owner, orderId, audience, eligible)));
    return this.get(owner, orderId);
  }
  private async send(owner: string, orderId: string, audience: PrintAudience, eligible?: () => Promise<boolean>) {
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
      // Preparation can wait on Windows. Re-read authoritative eligibility only
      // after it completes, before the durable handoff fence. An already handed
      // off Windows job cannot be recalled by a later database cancellation.
      if (eligible && !await eligible()) { this.cancel(owner, orderId); return; }
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
      this.db.prepare(`UPDATE jobs SET state=?,message=?,updated=? WHERE order_id=? AND audience=? AND claim=? AND state IN ('preparing','submitting')`)
        .run(submitting ? 'uncertain' : 'blocked', message, this.now(), orderId, audience, claim);
    } finally { prepared?.dispose(); }
  }
}
