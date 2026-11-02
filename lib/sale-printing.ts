import type { SavedOrder } from './checkout';
import receiptBranding from '../config/receipt-branding.json';

export type PrintAudience = 'customer' | 'barista';
export type PrintState = 'queued' | 'preparing' | 'blocked' | 'submitting' | 'submitted' | 'uncertain' | 'cancelled';
export type PrintLineStyle = 'brand' | 'heading' | 'mono' | 'total' | 'meta' | 'name' | 'drink' | 'modifier' | 'note' | 'footer'
  | 'logo' | 'qr' | 'separator' | 'receipt-heading' | 'receipt-total' | 'phone' | 'quote' | 'social' | 'issuer';
export interface ReceiptIssuer {
  legalName: string; rfc: string; taxRegime: string; establishmentAddress: string; postalCode: string; city: string;
}
export interface ReceiptOptions { issuer?: ReceiptIssuer; testOnly?: boolean }
export function validReceiptIssuer(issuer: ReceiptIssuer | undefined): issuer is ReceiptIssuer {
  return Boolean(issuer && issuer.legalName.trim() && /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(issuer.rfc)
    && /^\d{3}\s*-\s*.+/.test(issuer.taxRegime) && /^\d{5}$/.test(issuer.postalCode) && issuer.establishmentAddress.trim() && issuer.city.trim());
}
export interface SalePrintDocument {
  title: string; sections: string[][]; styles?: PrintLineStyle[][];
  // Older local snapshots may contain this unused reference-design metadata.
  // Keep reading their text; never rewrite a saved document to remove it.
  cupLabels?: { folio: string; service: string; date: string; time: string }[];
  labelLayout?: 'reference-v2';
  referenceLabels?: { folio: string; cup: string; service: string; date: string; time: string }[];
  receiptBranding?: { version: number; qrUrl: string; qrRows: string[] };
  issuerComplete?: boolean; testOnly?: boolean;
}
export interface SalePrintJob {
  orderId: string; ticket: string; audience: PrintAudience; queue: string;
  state: PrintState; message: string; attempts: number; updatedAt: string;
}

// Both documents come from the immutable, server-confirmed sale. No catalog lookups.
const text = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const money = (value: number) => `$${value.toFixed(2)} MXN`;
export function saleDocuments(order: SavedOrder, options: ReceiptOptions = {}): Record<PrintAudience, SalePrintDocument> {
  if (order.status !== 'completed' || !order.id || !order.items?.length
    || !Number.isFinite(order.total) || order.total <= 0 || !Number.isFinite(Date.parse(order.created_at))
    || order.items.some(i => !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 1000
      || !i.product?.name || !Number.isFinite(i.product.price))) throw new Error('La venta no tiene un comprobante completo para imprimir.');
  const ticket = text(order.ticket_number).padStart(4, '0');
  const date = new Date(order.created_at).toLocaleString('es-MX', { timeZone: 'America/Matamoros', dateStyle: 'short', timeStyle: 'short' });
  const issuer = options.issuer;
  const issuerComplete = validReceiptIssuer(issuer);
  if (issuer && !issuerComplete) throw new Error('Revisa nombre fiscal, RFC, régimen y domicilio del emisor.');
  const receipt: string[] = [], receiptStyles: PrintLineStyle[] = [];
  const add = (line: string, style: PrintLineStyle = 'mono') => { receipt.push(line); receiptStyles.push(style); };
  add('CARIÑITO MÍO', 'logo');
  add('', 'separator');
  add('Teléfono: +52 868 305 4668', 'phone');
  add('', 'separator');
  add('TICKET DE VENTA', 'receipt-heading');
  if (options.testOnly || !issuerComplete) add('PRUEBA DE IMPRESIÓN · NO ES UNA VENTA', 'heading');
  add(`Folio: ${ticket} · ${date}`);
  add(`Cliente: ${text(order.customer_name) || 'Público en general'}`);
  if (order.pager_number != null) {
    if (!Number.isInteger(order.pager_number) || order.pager_number < 1 || order.pager_number > 30) throw new Error('Control de entrega inválido.');
    add(`CONTROL: ${order.pager_number}`, 'receipt-heading');
  }
  add(text(order.order_type)); add('', 'separator');
  add('CANT.      P.UNITARIO        IMPORTE');
  add('', 'separator');
  let grossCents = 0;
  for (const item of order.items) {
    const lineCents = Math.round(item.product.price * 100) * item.quantity; grossCents += lineCents;
    add(text(item.product.name));
    add(`${String(item.quantity).padEnd(5)}${('$' + item.product.price.toFixed(2)).padStart(13)}${('$' + (lineCents / 100).toFixed(2)).padStart(17)}`);
    for (const extra of item.product.displayExtras ?? []) add(`  + ${text(extra.name)} (incl.)`);
    if (item.product.note) add(`  ${text(item.product.note)}`);
  }
  if (order.order_note) add(`Nota: ${text(order.order_note)}`);
  add('', 'separator');
  const adjustment = grossCents - Math.round(order.total * 100);
  if (adjustment) { add(`Importe artículos: ${money(grossCents / 100)}`); add(`Ajuste de la venta: ${money(-adjustment / 100)}`); }
  add(`TOTAL: ${money(order.total)}`, 'receipt-total');
  add('', 'separator');
  const payment = ({ efectivo: 'EFECTIVO', tarjeta: 'TARJETA', mixto: 'MIXTO' } as Record<string, string>)[order.payment_method.toLowerCase()] || text(order.payment_method);
  add(`Pago: ${payment}`);
  if (['efectivo', 'mixto'].includes(order.payment_method.toLowerCase())) {
    add(`Recibido MXN: $${order.tender_mxn.toFixed(2)}`);
    if (order.tender_usd) add(`Recibido USD: $${order.tender_usd.toFixed(2)} · TC ${order.exchange_rate.toFixed(4)}`);
    add(`Cambio: $${order.change_mxn.toFixed(2)}`);
  }
  add('', 'separator');
  if (issuer) {
    add(`RFC: ${text(issuer.rfc)}`, 'issuer');
    add(`Régimen: ${text(issuer.taxRegime)}`, 'issuer'); add(text(issuer.establishmentAddress), 'issuer');
    add(`${text(issuer.city)} · C.P. ${text(issuer.postalCode)}`, 'issuer');
  } else {
    add('RFC: [RFC DEL EMISOR]', 'issuer');
    add('Régimen: [RÉGIMEN FISCAL]', 'issuer'); add('[DOMICILIO DEL ESTABLECIMIENTO]', 'issuer');
    add('[MUNICIPIO, ESTADO · C.P.]', 'issuer');
  }
  add(receiptBranding.qrUrl, 'qr'); add('MENÚ E INSTAGRAM', 'meta');
  add('', 'separator');
  add('Para el postre y una sonrisa,', 'quote'); add('siempre hay espacio.', 'quote');
  add('@_carinitomio', 'social');
  const units = order.items.reduce((sum, i) => sum + i.quantity, 0);
  if (units > 2000) throw new Error('La orden requiere revisión por su cantidad de etiquetas.');
  let unit = 0;
  const baristaStyles: PrintLineStyle[][] = [];
  const referenceLabels: NonNullable<SalePrintDocument['referenceLabels']> = [];
  const sections = order.items.flatMap(item => Array.from({ length: item.quantity }, () => {
    const lines = [text(order.customer_name) || 'Mostrador', text(item.product.name)];
    const styles: PrintLineStyle[] = ['name', 'drink'];
    for (const extra of item.product.displayExtras ?? []) { lines.push(text(extra.name)); styles.push('modifier'); }
    if (item.product.note) { lines.push(text(item.product.note)); styles.push('note'); }
    if (order.order_note) { lines.push(`ORDEN: ${text(order.order_note)}`); styles.push('modifier'); }
    const time = new Date(order.created_at).toLocaleTimeString('es-MX', { timeZone: 'America/Matamoros', hour: '2-digit', minute: '2-digit', hour12: false });
    lines.push(`#${ticket} · ${++unit}/${units} · ${order.pager_number != null ? `CONTROL: ${order.pager_number} · ` : ''}${text(order.order_type)} · ${time}`); styles.push('footer');
    referenceLabels.push({ folio:order.pager_number != null ? `CONTROL ${order.pager_number} · #${ticket}` : `#${ticket}`,cup:`${unit}/${units}`,service:text(order.order_type),
      date:new Date(order.created_at).toLocaleDateString('es-MX',{timeZone:'America/Matamoros',day:'2-digit',month:'2-digit',year:'2-digit'}),
      time:new Date(order.created_at).toLocaleTimeString('en-US',{timeZone:'America/Matamoros',hour:'2-digit',minute:'2-digit',hour12:true}) });
    baristaStyles.push(styles);
    return lines;
  }));
  return { customer: { title: `CM #${ticket} CLIENTE`, sections: [receipt], styles: [receiptStyles], receiptBranding, issuerComplete, testOnly: options.testOnly === true },
    barista: { title: `CM #${ticket} BARRA`, sections, styles: baristaStyles, labelLayout:'reference-v2',referenceLabels } };
}

export interface PrintStorage { length: number; key(index: number): string | null; getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const prefix = (checkoutKey: string) => `${checkoutKey}:print:v1:`;
// One key per sale avoids two tabs overwriting each other's outbox.
export function rememberSalePrint(storage: PrintStorage, checkoutKey: string, order: Pick<SavedOrder, 'id' | 'ticket_number'>) {
  storage.setItem(prefix(checkoutKey) + order.id, JSON.stringify({ id: order.id, ticket: String(order.ticket_number) }));
}
export function pendingSalePrints(storage: PrintStorage, checkoutKey: string): string[] {
  const ids: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix(checkoutKey))) ids.push(key.slice(prefix(checkoutKey).length));
  }
  return ids;
}
export function forgetSalePrint(storage: PrintStorage, checkoutKey: string, orderId: string) { storage.removeItem(prefix(checkoutKey) + orderId); }
