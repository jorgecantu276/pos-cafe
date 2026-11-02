import { redirect } from 'next/navigation';
import { serverSupabase } from '@/lib/supabase-server';
import AdminShell from './AdminShell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect('/login');
  const { data, error } = await client.from('profiles').select('role,is_active').eq('id', user.id).single();
  if (error || data?.role !== 'admin' || data?.is_active !== true) redirect('/');
  const { data: inventory } = await client.rpc('pos_inventory_state').abortSignal(AbortSignal.timeout(3000));
  return <AdminShell inventoryEnabled={inventory?.enabled === true}>{children}</AdminShell>;
}
