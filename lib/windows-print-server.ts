import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import machine from '../config/cafe-printers.json';
import type { PrintAdapter, PreparedPrint } from './print-journal-server';
import type { PrintAudience, SalePrintDocument, SalePrintJob } from './sale-printing';

export interface PrintConfig {
  mode: 'mock' | 'windows'; directory: string;
  queues: Record<PrintAudience, string>;
  baristaStock: { widthMm: number; heightMm: number } | null;
  mockFaults?: string;
}
export function printConfig(env: Record<string, string | undefined> = process.env): PrintConfig {
  if (!['mock', 'windows'].includes(env.POS_PRINT_MODE ?? '')) throw new Error('Falta activar y configurar la impresión local. La venta ya está guardada; no vuelvas a cobrar.');
  if (!env.POS_PRINT_DATA_DIR || !path.isAbsolute(env.POS_PRINT_DATA_DIR)) throw new Error('Configura una carpeta absoluta y permanente para el registro de impresión.');
  if (/^(?:\\\\|\/\/)/.test(env.POS_PRINT_DATA_DIR)) throw new Error('El registro de impresión requiere un disco local; no uses una carpeta de red.');
  const queues = { customer: env.POS_PRINT_CUSTOMER_QUEUE || machine.customer.queue, barista: env.POS_PRINT_BARISTA_QUEUE || machine.barista.queue };
  if (queues.customer.toLowerCase() === queues.barista.toLowerCase()) throw new Error('Cliente y barra deben tener colas distintas.');
  const widthMm = Number(env.POS_PRINT_BARISTA_WIDTH_MM || machine.barista.selectedWidthMm), heightMm = Number(env.POS_PRINT_BARISTA_HEIGHT_MM || machine.barista.selectedHeightMm);
  return { mode: env.POS_PRINT_MODE as PrintConfig['mode'], directory: env.POS_PRINT_DATA_DIR, queues,
    baristaStock: env.POS_PRINT_BARISTA_STOCK_CONFIRMED === '1' && widthMm >= 25 && widthMm <= 150 && heightMm >= 20 && heightMm <= 300 ? { widthMm, heightMm } : null,
    mockFaults: env.POS_PRINT_MOCK_FAULTS };
}

export function printerAdapter(config: PrintConfig): PrintAdapter {
  return { async prepare(job, document) {
    if (config.mode === 'mock') {
      let fault: string | undefined;
      if (config.mockFaults) {
        try { fault = JSON.parse(readFileSync(config.mockFaults, 'utf8'))[job.audience]; }
        catch { throw new Error('No se pudo leer la simulación de impresora.'); }
      }
      if (fault === 'offline') throw new Error('Simulación: impresora desconectada antes del envío.');
      return { async submit() {
        const filename = path.join(config.directory, 'mock-spool.jsonl');
        appendFileSync(filename, JSON.stringify({ orderId: job.orderId, audience: job.audience, queue: job.queue, document }) + '\n', 'utf8');
        const fd = openSync(filename, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
        if (fault === 'uncertain') throw new Error('Simulated lost spool acknowledgment');
      }, dispose() {} };
    }
    if (process.platform !== 'win32') throw new Error('La impresión física requiere Windows en la PC de caja.');
    if (job.audience === 'customer' && document.issuerComplete !== true && !document.testOnly) throw new Error('Configura los datos fiscales del emisor antes de imprimir tickets de venta. La prueba de hardware usa muestras identificadas como PRUEBA.');
    if (job.audience === 'barista' && !config.baristaStock) throw new Error('Confirma el tamaño de las etiquetas y la configuración del controlador Bluetooth antes de enviar a barra.');
    return windowsPrepare(job, document, config);
  } };
}

async function windowsPrepare(job: SalePrintJob, document: SalePrintDocument, config: PrintConfig): Promise<PreparedPrint> {
  // Separate desktop helper under the signed-in cashier's Windows account.
  // Shell interpolation and RAW/ESC-POS assumptions are deliberately absent.
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(process.cwd(), 'scripts/printing/windows-print.ps1')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  let doneResolve!: () => void, doneReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const done = new Promise<void>((resolve, reject) => { doneResolve = resolve; doneReject = reject; });
  void done.catch(() => {});
  let finished = false;
  const fail = () => { const error = new Error('El auxiliar de impresión no respondió. Revisa Windows y el controlador.'); readyReject(error); doneReject(error); };
  let timer = setTimeout(() => { fail(); child.kill(); }, 30_000);
  child.on('error', fail); child.stdin.on('error', fail);
  child.stderr.resume(); // Driver diagnostics may contain local paths; never return them to clients.
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const message = JSON.parse(line);
      if (message.state === 'ready') readyResolve();
      else if (message.state === 'submitted') { finished = true; doneResolve(); }
      else { readyReject(new Error('No se pudo preparar o enviar la impresora. Revisa su conexión y configuración.')); doneReject(new Error('Print helper failed')); }
    } catch { fail(); }
  });
  child.on('exit', () => { clearTimeout(timer); if (!finished) fail(); });
  child.stdin.write(JSON.stringify({ queue: job.queue, title: `${document.title} ${job.orderId} ${job.audience}`,
    sections: document.sections, styles: document.styles, receiptBranding: document.receiptBranding, verticalLabel: job.audience === 'barista', layoutTitle: document.title, fontPoints: job.audience === 'barista' ? 9 : 11,
    identity: { driver: machine[job.audience].driver, port: machine[job.audience].port },
    stock: job.audience === 'barista' ? config.baristaStock : { widthMm: machine.customer.paperWidthMm, heightMm: machine.customer.paperHeightMm } }) + '\n');
  try { await ready; }
  catch (error) { clearTimeout(timer); child.kill(); lines.close(); throw error; }
  return { async submit() {
    clearTimeout(timer); timer = setTimeout(() => { fail(); child.kill(); }, 30_000);
    child.stdin.end('PRINT\n');
    await done;
  }, dispose() { clearTimeout(timer); child.kill(); lines.close(); } };
}
