import type { SupabaseClient } from '@supabase/supabase-js';
import { withDeadline } from './request-deadline';
import { AccessError } from './user-management';
import { clipSettings } from './clip-config';

type Client = Pick<SupabaseClient, 'rpc'>;
type Payment = {
  request_id: string; actor_id: string; state: string; terminal_serial: string; provider_id: string | null;
  webhook_key: string; quote: {total:number; payment_method?:string; card_amount_mxn?:number}; hints: string[]; result: unknown;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class ClipNotSent extends AccessError {
  constructor() { super('El pedido cambió o contiene datos inválidos. Revisa el pedido antes de enviar a CLIP.',409); }
}
export const clipProviderId = (value: unknown): value is string => typeof value === 'string' && /^pinpad-[A-Za-z0-9-]{8,100}$/.test(value);
export function clipCents(value: unknown): number {
  if (!['string','number'].includes(typeof value) || !/^\d{1,8}(?:\.\d{1,2})?$/.test(String(value))) throw Error('Importe CLIP inválido');
  const amount = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(amount)) throw Error('Importe CLIP inválido');
  return amount;
}
export async function clipRpc(client: Client, name: string, args: Record<string, unknown>) {
  const { data, error } = await withDeadline(() => client.rpc(name, args));
  if (error?.code === 'PCL01' && name === 'pos_clip_prepare') throw new ClipNotSent();
  if (error) throw new AccessError('No se confirmó el pago. Compruébalo antes de volver a cobrar.', 503);
  return data;
}
export async function clipStaff(client: SupabaseClient) {
  const { data: { user }, error } = await withDeadline(() => client.auth.getUser());
  if (error || !user) throw new AccessError('Inicia sesión para consultar el pago.', error ? 503 : 401);
  const profile = await withDeadline(() => client.from('profiles').select('role,is_active').eq('id', user.id).single());
  if (profile.error) throw new AccessError('No se pudo comprobar el acceso.', 503);
  if (!profile.data?.is_active || !['admin','cashier','barista'].includes(profile.data.role)) throw new AccessError('Sin acceso a pagos.', 403);
  return { id: user.id, admin: profile.data.role === 'admin' };
}

// CLIP has no documented creation idempotency guarantee. Claim in PostgreSQL BEFORE
// the single POST. A timeout/crash must never automatically resend that POST.
export class ClipGateway {
  constructor(private db: Client, private config = clipSettings(), private providerFetch: typeof fetch = fetch) {}
  private async provider(path: string, method = 'GET', body?: unknown) {
    if (!this.config.tokenReady) throw new AccessError('Falta conectar la terminal CLIP. Pide ayuda al responsable.', 503);
    const signal = AbortSignal.timeout(10_000);
    const response = await withDeadline(() => this.providerFetch(`https://api.payclip.io/f2f/pinpad/v1/${path}`, {
      method, signal, redirect: 'error', cache: 'no-store',
      headers: { Authorization: `Basic ${this.config.token}`, 'Content-Type':'application/json', 'Pinpad-Include-Detail':'true', 'Pinpad-Wait-Response':'false' },
      ...(body ? { body:JSON.stringify(body) } : {}),
    }), { signal });
    // Never surface raw provider errors/headers (they may include credentials or card data).
    const text = await withDeadline(() => response.text(), { signal });
    if (text.length > 100_000) throw new AccessError('Respuesta de CLIP no confirmada.', 502);
    let data: Record<string, unknown>;
    try { data = JSON.parse(text); } catch { throw new AccessError('Respuesta de CLIP no confirmada.', 502); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AccessError('Respuesta de CLIP no confirmada.', 502);
    return { response, data };
  }
  private async read(request: string, actor: string | null): Promise<Payment> {
    if (!uuid.test(request)) throw new AccessError('No se pudo identificar el pago.', 400);
    const payment = await clipRpc(this.db, 'pos_clip_get', { p_request:request, p_actor:actor });
    if (!payment) throw new AccessError('Pago no encontrado.', 404);
    return payment as Payment;
  }
  private charge(p: Payment) { return p.quote.payment_method === 'efectivo_tarjeta' ? p.quote.card_amount_mxn : p.quote.total; }
  private args(p: Payment) { return { p_request:p.request_id, p_actor:p.actor_id }; }
  private publicState(p: Payment, review = false) {
    const state = review ? 'review' : p.state;
    return { requestId:p.request_id, state,
      ...(state === 'completed' ? {order:p.result} : {}),
      message: state === 'completed' ? 'Pago aprobado. Venta guardada.' : state === 'failed' ? 'CLIP no cobró. Puedes volver al pedido.' :
        review || (state === 'dispatching' && !p.provider_id) ? 'El pago sigue sin confirmar. No vuelvas a cobrar; avisa al responsable.' : 'Esperando el pago en CLIP. No vuelvas a cobrar.' };
  }
  async start(request: string, actor: string) {
    let p = await this.read(request, actor);
    if (p.state === 'prepared') {
      if (!this.config.enabled) throw new AccessError('El cobro automático de CLIP está desactivado.', 503);
      const claim = await clipRpc(this.db, 'pos_clip_claim', { ...this.args(p), p_terminal:this.config.serial });
      if (claim?.claimed === true) {
        p = await this.read(request, actor);
        const callback = new URL(this.config.webhook);
        callback.searchParams.set('request', request); callback.searchParams.set('key', p.webhook_key);
        try {
          const { response, data } = await this.provider('payment', 'POST', {
            amount:(clipCents(this.charge(p)) / 100).toFixed(2), tip_amount:'0.00', reference:`pos-${request}`,
            serial_number_pos:p.terminal_serial, webhook_url:callback.href,
            preferences:{ is_tip_enabled:false,is_msi_enabled:false,is_mci_enabled:false,is_dcc_enabled:false,
              is_retry_enabled:false,is_split_payment_enabled:false,is_auto_print_receipt_enabled:false,is_share_enabled:false },
          });
          if (response.status === 400 && data.code === 'ERR10_04') {
            await clipRpc(this.db, 'pos_clip_settle', { ...this.args(p),p_provider:null,p_outcome:'unavailable',p_evidence:{code:'ERR10_04'} });
          } else if (response.ok && clipProviderId(data.pinpad_request_id)) {
            await clipRpc(this.db, 'pos_clip_attach', { ...this.args(p), p_provider:data.pinpad_request_id });
          }
        } catch { /* Persisted dispatch fence remains; recover only by GET or verified webhook hint. */ }
      }
    }
    return this.status(request, actor);
  }
  async status(request: string, actor: string | null, candidate?: string) {
    let p = await this.read(request, actor);
    if (['completed','failed','prepared'].includes(p.state)) return this.publicState(p);
    const ids = p.provider_id ? [p.provider_id] : [...new Set([...(candidate ? [candidate] : []),...p.hints])].slice(0,1);
    for (const id of ids) {
      if (!clipProviderId(id)) continue;
      try {
        const { response, data } = await this.provider(`payment?pinpadRequestId=${encodeURIComponent(id)}`);
        if (!response.ok || data.pinpad_request_id !== id || data.reference !== `pos-${request}` || clipCents(data.amount) !== clipCents(this.charge(p))) continue;
        const detail = data.detail as {pages?:{total_results?:number;total?:number};results?:Record<string,unknown>[]} | undefined;
        const results = detail?.results;
        const canceled = data.status === 'CANCELED' || data.status === 'REJECTED';
        // CLIP omits these totals on some canceled requests. Only that final
        // non-paid status may omit them; the complete zero-paid detail below
        // still has to agree before releasing the original request's fence.
        const paid = clipCents(canceled ? data.amount_paid ?? 0 : data.amount_paid);
        const tip = clipCents(canceled ? data.tip_amount ?? 0 : data.tip_amount);
        if (tip !== 0) continue;
        // Only a provider-authenticated lookup can bind a notification to this order.
        if (!p.provider_id) {
          await clipRpc(this.db, 'pos_clip_attach', { ...this.args(p),p_provider:id });
          p = await this.read(request, actor);
        }
        const evidence = { reference:data.reference,amount_cents:clipCents(data.amount),paid_cents:paid,tip_cents:tip,
          currency:'MXN',device:p.terminal_serial,status:data.status,transaction:'' };
        if (canceled && paid === 0 && Array.isArray(results)
          && detail?.pages?.total_results === results.length && results.every(r =>
            typeof r.status === 'string' && ['canceled','rejected','declined'].includes(r.status.toLowerCase())
            && clipCents(r.paid_amount) === 0 && clipCents(r.tip_amount ?? 0) === 0 && clipCents(r.amount_refunded ?? 0) === 0)) {
          await clipRpc(this.db, 'pos_clip_settle', { ...this.args(p),p_provider:id,p_outcome:'failed',p_evidence:evidence });
        } else if (['COMPLETED','APPROVED'].includes(String(data.status)) && paid === clipCents(this.charge(p))
          && Array.isArray(results) && results.length === 1 && detail?.pages?.total_results === 1 && detail?.pages?.total === 1) {
          const transaction = results[0], device = transaction.device as {id?:string} | undefined;
          if (transaction.status !== 'approved' || transaction.currency !== 'MXN' || device?.id !== p.terminal_serial
            || clipCents(transaction.amount) !== paid || clipCents(transaction.paid_amount) !== paid
            || clipCents(transaction.tip_amount) !== 0 || clipCents(transaction.amount_refunded) !== 0 || !uuid.test(String(transaction.transaction_id))) continue;
          await clipRpc(this.db, 'pos_clip_settle', { ...this.args(p),p_provider:id,p_outcome:'completed',p_evidence:{...evidence,transaction:transaction.transaction_id} });
        } else if (paid > 0 || ['COMPLETED','APPROVED'].includes(String(data.status))) return this.publicState(p, true);
        return this.publicState(await this.read(request, actor));
      } catch { /* Unknown/malformed/provider outage retains original payment and request. */ }
    }
    return this.publicState(p, ids.length > 0);
  }
}
