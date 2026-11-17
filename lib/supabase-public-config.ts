import { posProfile } from './pos-profile';
export function supabasePublicKey() {
  if (posProfile.id !== 'smoothies') return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (typeof window !== 'undefined') {
    const browser = window as Window & { smoothiesPublicKey?: string };
    if (process.env.NEXT_PUBLIC_SMOOTHIES_PORTABLE === '1') {
      if (!browser.smoothiesPublicKey) throw Error('La configuracion de la caja aun no esta lista. Vuelve a abrir POS Smoothies.');
      return browser.smoothiesPublicKey;
    }
    return browser.smoothiesPublicKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  }
  if (process.env.NEXT_PUBLIC_SMOOTHIES_PORTABLE === '1') {
    if (!process.env.SMOOTHIES_RUNTIME_ANON_KEY) throw Error('Falta la configuracion local de POS Smoothies.');
    return process.env.SMOOTHIES_RUNTIME_ANON_KEY;
  }
  return process.env.SMOOTHIES_RUNTIME_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}
