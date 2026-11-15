import { posProfile } from './pos-profile';
export function supabasePublicKey() {
  if (posProfile.id !== 'smoothies') return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (typeof window !== 'undefined') {
    const browser = window as Window & { smoothiesPublicKey?: string };
    return browser.smoothiesPublicKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  }
  return process.env.SMOOTHIES_RUNTIME_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}
