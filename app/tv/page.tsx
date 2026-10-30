import { redirect } from 'next/navigation';
import { serverSupabase } from '@/lib/supabase-server';
import { requireAdministrator, AccessError } from '@/lib/user-management';
import TvDashboard from './TvDashboard';
import { TV_LOGIN_URL } from '@/lib/login-return';

export const dynamic = 'force-dynamic';

export default async function TvPage() {
  try { await requireAdministrator(await serverSupabase()); }
  catch (error) {
    if (error instanceof AccessError) redirect(error.status === 401 ? TV_LOGIN_URL : '/');
    throw error;
  }
  return <TvDashboard />;
}
