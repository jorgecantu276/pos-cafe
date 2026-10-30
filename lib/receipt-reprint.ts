import { escapeHtml, writePrintDocument } from './printing';
import type { SalePrintDocument } from './sale-printing';

export function renderReceiptReprint(document: SalePrintDocument, status: string, source: 'stored' | 'snapshot' | 'legacy'): string {
  const lines = document.sections.flat();
  return `<main style="padding:3mm;font-family:Arial,sans-serif;font-size:11px;line-height:1.4;overflow-wrap:anywhere">
    <h2 style="text-align:center">REIMPRESIÓN</h2>
    ${['cancelled', 'canceled'].includes(status) ? '<h2>VENTA CANCELADA</h2>' : ''}
    ${source !== 'stored' ? '<p>Generado del registro guardado con los datos actuales del emisor.</p>' : ''}
    ${source === 'legacy' ? '<p>COMPROBANTE HISTÓRICO: algunos datos de la venta original no fueron registrados.</p>' : ''}
    ${lines.map(line => `<div style="white-space:pre-wrap;font-family:monospace">${escapeHtml(line)}</div>`).join('')}
  </main>`;
}

// The caller opens this window synchronously from the tap, before any I/O.
// This preserves the explicit Windows dialog and avoids popup blocking.
export async function printHistoricalReceipt(target: Window, selector: { orderId?: string; ticketNumber?: string } = {}) {
  try {
    target.document.body.textContent = 'Recuperando comprobante…';
    const response = await fetch(`/api/receipts?${new URLSearchParams(selector)}`, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo recuperar el comprobante.');
    if (!result.document?.issuerComplete || !Array.isArray(result.document.sections)) throw new Error('El comprobante está incompleto.');
    writePrintDocument(target, renderReceiptReprint(result.document, result.status, result.source), 'receipt', `Reimpresión - #${result.ticket}`);
  } catch (error) { target.close(); throw error; }
}
