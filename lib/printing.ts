import { posProfile } from './pos-profile';
export type PrintFormat = 'receipt' | 'sticker';

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

// These are layout dimensions, not a claim about the loaded sticker stock.
export function printStyles(format: PrintFormat): string {
  return `
    @page { margin: 0; size: ${format === 'receipt' ? 'auto' : '50mm 30mm'}; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; color: #000; background: #fff; }
    img { max-width: 100%; }
    ${format === 'receipt' ? 'body { width: 72mm; } body > div { max-width: 72mm; }' : `
      .sticker { width: 50mm; height: 30mm; padding: 2mm; overflow: hidden; break-after: page; }
      .sticker:last-child { break-after: auto; }
    `}
  `;
}

export function openPrintWindow(): Window | null {
  const target = window.open('', '_blank');
  if (!target) window.alert('Permite las ventanas emergentes para abrir el diálogo de impresión.');
  return target;
}

export function writePrintDocument(target: Window, content: string, format: PrintFormat = 'receipt', title: string = posProfile.shortName): void {
  target.document.open();
  target.document.write(`<!doctype html><html lang="es-MX"><head><meta charset="utf-8">
    <title>${escapeHtml(title)}</title><style>${printStyles(format)}</style></head><body>${content}
    <script>
      let requested = false;
      const requestPrint = () => {
        if (requested) return;
        requested = true;
        window.focus(); window.print();
      };
      window.addEventListener('afterprint', () => window.close(), { once: true });
      window.addEventListener('load', requestPrint, { once: true });
      setTimeout(requestPrint, 5000);
    </script></body></html>`);
  target.document.close();
}

export function renderStickers(items: ReadonlyArray<{
  quantity: number;
  product: { name: string; displayExtras?: ReadonlyArray<{ name: string }>; note?: string };
}>, customer: string, time: string): string {
  return items.flatMap(item => Array.from({ length: Math.max(0, Math.floor(item.quantity)) }, () => `
    <div class="sticker" style="font-family: Arial, sans-serif;">
      <div style="font-weight: bold; font-size: 12px; text-transform: uppercase;">${escapeHtml(item.product.name)}</div>
      <div style="font-size: 10px;">${item.product.displayExtras?.map(extra => escapeHtml(extra.name)).join(' · ') || 'Personalización Normal'}</div>
      ${item.product.note ? `<div style="font-size: 10px;">${escapeHtml(item.product.note)}</div>` : ''}
      <div style="font-size: 9px; margin-top: 1mm;">Cliente: ${escapeHtml(customer)}</div>
      <div style="font-size: 8px;">${escapeHtml(time)}</div>
    </div>`)).join('');
}
