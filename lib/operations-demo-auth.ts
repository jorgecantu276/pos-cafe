/** Only the two reserved synthetic databases receive a separate browser namespace. */
export function operationsDemoAuth(api: string) {
  if (process.env.NEXT_PUBLIC_POS_OPS_DEMO !== '1') return {};
  const url = new URL(api);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !['55901','55921'].includes(url.port)) throw Error('Configuración de demostración inválida.');
  const name = `sb-pos-demo-${url.port}-auth-token`;
  return { auth: { storageKey: name }, cookieOptions: { name, path: '/', sameSite: 'lax' as const, secure: false } };
}
