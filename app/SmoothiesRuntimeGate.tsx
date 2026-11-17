'use client';

import Script from 'next/script';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

function ready() {
  return typeof window !== 'undefined' && Boolean((window as Window & { smoothiesPublicKey?: string }).smoothiesPublicKey);
}
function subscribe(notify: () => void) {
  window.addEventListener('smoothies-runtime-ready', notify);
  return () => window.removeEventListener('smoothies-runtime-ready', notify);
}

export default function SmoothiesRuntimeGate({ children }: { children: ReactNode }) {
  const initialized = useSyncExternalStore(subscribe, ready, () => false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (initialized) return;
    const timer = window.setTimeout(() => { if (!ready()) setFailed(true); }, 10_000);
    return () => window.clearTimeout(timer);
  }, [initialized, attempt]);
  return <>
    <Script key={attempt} src={`/smoothies-config.js${attempt ? `?attempt=${attempt}` : ''}`} strategy="afterInteractive"
      onReady={() => { if (!ready()) setFailed(true); }} onError={() => setFailed(true)} />
    {initialized ? children : <main className="flex min-h-screen items-center justify-center p-8">
      <div role={failed ? 'alert' : 'status'}>
        <p>{failed ? 'No se pudo preparar la caja. Vuelve a intentar.' : 'Preparando la caja…'}</p>
        {failed && <button type="button" className="mt-4 min-h-12 rounded-xl border px-5 font-semibold"
          onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Volver a intentar</button>}
      </div>
    </main>}
  </>;
}
