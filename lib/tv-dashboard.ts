export const CAFE_TIME_ZONE = 'America/Matamoros';
export const TV_REFRESH_MS = 5000, TV_STALE_MS = 20000, TV_ORDER_MS = 900000;
export interface TvOrder {
    id: string;
    ticket_number: number | null;
    created_at: string;
    status: string | null;
    receipt_snapshot: unknown;
}
export interface TvFoodOrder {
    id: string;
    ticket: number | null;
    control: number | null;
    createdAt: string;
    expiresAt: string;
    service: string;
    note: string;
    items: {
        name: string;
        quantity: number;
        note: string;
        extras: string[];
    }[];
}
export interface TvSnapshot {
    capturedAt: string;
    orders: TvFoodOrder[];
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
export function summarizeTvOrders(rows: TvOrder[], now: Date): TvSnapshot {
    const orders: TvFoodOrder[] = [];
    for (const row of rows) {
        const age = +now - Date.parse(row.created_at);
        if (row.status !== 'completed' || !Number.isFinite(age) || age < 0 || age >= TV_ORDER_MS)
            continue;
        const receipt = record(row.receipt_snapshot);
        if (!Array.isArray(receipt.items))
            throw new Error('Orden sin detalle de preparación.');
        const items: TvFoodOrder['items'] = [];
        for (const raw of receipt.items) {
            const item = record(raw), product = record(item.product);
            const category = text(product.category).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            if (!category)
                throw new Error('Producto sin categoría.');
            if (category === 'bebidas')
                continue;
            if (!text(product.name) || !Number.isInteger(item.quantity) || Number(item.quantity) <= 0)
                throw new Error('Detalle inválido.');
            items.push({ name: text(product.name), quantity: Number(item.quantity), note: text(product.note), extras: Array.isArray(product.displayExtras) ? product.displayExtras.map(e => text(record(e).name)).filter(Boolean) : [] });
        }
        if (!items.length)
            continue;
        orders.push({ id: row.id, ticket: row.ticket_number, control: Number.isInteger(receipt.pager_number) && Number(receipt.pager_number) >= 1 && Number(receipt.pager_number) <= 30 ? Number(receipt.pager_number) : null, createdAt: row.created_at, expiresAt: new Date(Date.parse(row.created_at) + TV_ORDER_MS).toISOString(), service: text(receipt.order_type), note: text(receipt.order_note), items });
    }
    return { capturedAt: now.toISOString(), orders: orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) };
}
export const visibleTvOrders = (s: TvSnapshot, n: Date) => s.orders.filter(o => Date.parse(o.createdAt) <= +n && Date.parse(o.expiresAt) > +n);
export const tvIsStale = (s: TvSnapshot, n: Date) => +n - Date.parse(s.capturedAt) > TV_STALE_MS;
export function tvCountdown(expiry: string, now: Date) { const s = Math.max(0, Math.ceil((Date.parse(expiry) - +now) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
export const tvTime = (v: string) => new Intl.DateTimeFormat('es-MX', { timeZone: CAFE_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(v));
