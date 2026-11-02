// Public callback: stores only a bounded, per-payment nonce-protected hint.
// It never approves a sale. The POS verifies it through CLIP's authenticated GET.
export async function handleClipWebhook(request: Request, env: (name: string) => string | undefined, send: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed',{status:405});
  const url = new URL(request.url), id = url.searchParams.get('request'), key = url.searchParams.get('key');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !key || !uuid.test(id) || !uuid.test(key)) return new Response('Invalid request',{status:400});
  try {
    const text = await request.text();
    if (text.length > 4096) return new Response('Invalid request',{status:400});
    const body = JSON.parse(text);
    if (body.origin !== 'pinpad-payments-api' || body.event_type !== 'PINPAD_INTENT_STATUS_CHANGED'
      || typeof body.id !== 'string' || !/^pinpad-[A-Za-z0-9-]{8,100}$/.test(body.id)) return new Response('Invalid event',{status:400});
    const endpoint = env('SUPABASE_URL'), secret = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!endpoint || !secret) return new Response('Unavailable',{status:503});
    const result = await send(`${endpoint}/rest/v1/rpc/pos_clip_notify`,{method:'POST',signal:AbortSignal.timeout(8000),redirect:'error',
      headers:{'Content-Type':'application/json',apikey:secret,Authorization:`Bearer ${secret}`},
      body:JSON.stringify({p_request:id,p_key:key,p_provider:body.id})});
    return new Response(result.ok ? 'OK' : 'Unavailable',{status:result.ok ? 200 : 503});
  } catch { return new Response('Unavailable',{status:503}); }
}
// Deno's runtime is supplied by Supabase Edge Functions, not the Next.js server.
declare const Deno: {env:{get:(name:string)=>string|undefined};serve:(handler:(request:Request)=>Promise<Response>)=>void};
if (typeof Deno !== 'undefined') Deno.serve(request => handleClipWebhook(request,name => Deno.env.get(name)));
