import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { localDemoAccess } from '@/lib/operations-demo.mjs';
export const dynamic = 'force-dynamic';
export default async function OperationsDemo() {
  let product: string;
  try {
    const incoming = await headers();
    const access = await localDemoAccess(new Request(`http://${incoming.get('host')}/ops-demo`, { headers: incoming }));
    product = access.identity.product;
  } catch { notFound(); }
  return <main style={{ maxWidth: 540, margin: '10vh auto', padding: 24 }}>
    <h1>{product === 'cafe' ? 'Demostración de Café' : 'Demostración de Smoothies'}</h1>
    <p>Todos los datos son ficticios. Los pagos externos y la impresión en papel están desactivados.</p>
    <form method="post" action="/api/ops-demo/login">
      <button type="submit" name="role" value="cashier">Abrir caja demo</button>{' '}
      <button type="submit" name="role" value="admin">Abrir administración demo</button>
    </form>
    <p>Al volver a abrir, se conservan los datos de esta demostración.</p>
  </main>;
}
