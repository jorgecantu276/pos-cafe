'use client';

import { useEffect } from 'react';
import { posProfile } from '@/lib/pos-profile';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(error => console.error('No se pudo actualizar la instalación del POS:', error));
  }, []);
  useEffect(() => {
    if (posProfile.id !== 'smoothies') return;
    let packageId: string | undefined;
    let stopped = false;
    let busy = false;
    async function checkVersion() {
      if (busy || stopped) return;
      busy = true;
      try {
        const response = await fetch('/api/app-version', { cache: 'no-store', signal: AbortSignal.timeout(2500) });
        if (!response.ok || stopped) return;
        const identity = await response.json();
        if (identity.protocol !== 1 || !/^[a-f0-9]{16}$/.test(identity.packageId)) return;
        if (!packageId) { packageId = identity.packageId; return; }
        if (identity.packageId === packageId) return;
        // The updater changes the server only after closing the drawer. Keep
        // admin forms and visible dialogs intact until the user returns to Caja.
        const active = document.activeElement;
        if (document.visibilityState !== 'visible' || !['/', '/login'].includes(window.location.pathname)
          || document.querySelector('[role="dialog"], dialog[open]')
          || active?.matches('input, textarea, select, [contenteditable="true"]')) return;
        window.location.reload();
      } catch { /* Local restarts and unavailable internet leave the current screen usable. */ }
      finally { busy = false; }
    }
    void checkVersion();
    const timer = window.setInterval(() => { void checkVersion(); }, 10_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
  return null;
}
