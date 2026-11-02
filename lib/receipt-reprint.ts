import { escapeHtml, writePrintDocument } from './printing';
import type { SalePrintDocument } from './sale-printing';

export function renderReceiptReprint(document: SalePrintDocument, status: string, source: 'stored' | 'snapshot' | 'legacy'): string {
  const branded = document.receiptBranding?.version === 1;
  const qrRows = document.receiptBranding?.qrRows ?? [];
  const qr = qrRows.length >= 21 && qrRows.length <= 177 && qrRows.every(row=>row.length===qrRows.length&&/^[01]+$/.test(row))
    ? `<svg role="img" aria-label="QR de Instagram" viewBox="0 0 ${qrRows.length} ${qrRows.length}" style="display:block;width:24mm;height:24mm;margin:1mm auto;shape-rendering:crispEdges"><rect width="100%" height="100%" fill="white"/>${qrRows.flatMap((row,y)=>Array.from(row,(bit,x)=>bit==='1'?`<rect x="${x}" y="${y}" width="1" height="1"/>`:'')).join('')}</svg>` : '';
  const lines = document.sections.flatMap((section,s)=>section.map((line,i)=>{
    const style=document.styles?.[s]?.[i];
    if(!branded)return `<div style="white-space:pre-wrap;font-family:monospace">${escapeHtml(line)}</div>`;
    if(style==='logo')return '<svg role="img" aria-label="Cariñito Mío Taller Repostero" viewBox="185 280 820 640" style="display:block;width:43mm;height:33.5mm;margin:auto"><image href="/receipt-branding/carinito-logo-v1.jpg" width="1200" height="1200"/></svg>';
    if(style==='qr')return qr;
    if(style==='separator')return '<hr style="border:0;border-top:1px solid black;margin:2mm 0"/>';
    const cells=line.trim().split(/\s{2,}/);
    if(style==='mono'&&cells.length===3&&((cells[0]==='CANT.'&&cells[1]==='P.UNITARIO'&&cells[2]==='IMPORTE')
      ||(/^\d+$/.test(cells[0])&&cells.slice(1).every(value=>/^\$-?\d+\.\d{2}$/.test(value))))) {
      return `<div style="display:grid;grid-template-columns:25% 38% 37%;font-size:8.5pt;font-weight:bold">${cells.map((value,i)=>`<span style="text-align:${i===0?'left':i===1?'center':'right'}">${escapeHtml(value)}</span>`).join('')}</div>`;
    }
    const centered=['receipt-heading','receipt-total','phone','issuer','meta','quote','social'].includes(style??'');
    const size=style==='receipt-heading'?14:style==='receipt-total'?15:style==='social'?11:style==='quote'?10:8.5;
    return `<div style="white-space:pre-wrap;font-weight:bold;font-size:${size}pt;text-align:${centered?'center':'left'};${style==='quote'?'font-family:Georgia,serif;font-style:italic;':''}">${escapeHtml(line)}</div>`;
  }));
  return `<main style="padding:3mm;font-family:Arial,sans-serif;font-size:11px;line-height:1.4;overflow-wrap:anywhere">
    <h2 style="text-align:center">REIMPRESIÓN</h2>
    ${['cancelled', 'canceled'].includes(status) ? '<h2>VENTA CANCELADA</h2>' : ''}
    ${source !== 'stored' ? '<p>Generado del registro guardado con los datos actuales del emisor.</p>' : ''}
    ${source === 'legacy' ? '<p>COMPROBANTE HISTÓRICO: algunos datos de la venta original no fueron registrados.</p>' : ''}
    ${lines.join('')}
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
