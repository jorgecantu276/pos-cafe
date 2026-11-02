// Server configuration only. Never use NEXT_PUBLIC variables for the CLIP token.
export function clipSettings(env: Record<string,string|undefined> = process.env) {
  const token = (env.POS_CLIP_TOKEN ?? '').trim().replace(/^Basic\s+/i, '');
  const tokenReady = /^[A-Za-z0-9+/]+={0,2}$/.test(token) && token.length >= 20 && !/PLACEHOLDER|REPLACE|YOUR_TOKEN/i.test(token);
  const serial = (env.POS_CLIP_SERIAL ?? '').trim();
  let webhook = env.POS_CLIP_WEBHOOK_URL ?? '';
  if (!webhook && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.NEXT_PUBLIC_SUPABASE_URL ?? ''))
    webhook = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/clip-webhook`;
  let webhookReady = false;
  try { const url = new URL(webhook); webhookReady = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !/YOUR_PROJECT|example\./i.test(webhook); } catch { /* Not configured. */ }
  const ready = tokenReady && /^[A-Za-z0-9-]{5,80}$/.test(serial) && webhookReady && Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
  return { enabled: env.POS_CLIP_ENABLED === '1' && ready, tokenReady, token, serial, webhook };
}
