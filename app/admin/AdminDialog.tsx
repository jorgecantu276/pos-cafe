'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function AdminDialog({ title, children, footer, onClose, busy = false, wide = false }: {
  title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const trigger = document.activeElement instanceof window.HTMLElement ? document.activeElement : null;
    if (typeof node.showModal === 'function') node.showModal();
    else node.setAttribute('open', ''); // DOM test environment.
    (node.querySelector<HTMLElement>('[data-dialog-autofocus]') ?? node.querySelector<HTMLElement>('button'))?.focus();
    return () => {
      if (typeof node.close === 'function') node.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} aria-modal="true" tabIndex={-1} className={`admin-dialog${wide ? ' admin-dialog-wide' : ''}`}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const node = event.currentTarget;
      const controls = [...node.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); node.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last!.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="admin-dialog-header"><h2 id={titleId}>{title}</h2><button type="button" aria-label={`Cerrar ${title}`} disabled={busy} className="admin-icon-button" onClick={onClose}><X size={22}/></button></header>
    <div className="admin-dialog-body">{children}</div>
    {footer && <footer className="admin-dialog-footer">{footer}</footer>}
  </dialog>;
}
