'use client';

import { useEffect, useRef, useState } from 'react';

export default function PagerPicker({ value, onChange, disabled = false }: {
  value: number | null; onChange: (value: number | null) => void; disabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open,setOpen] = useState(false);
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog=ref.current, opener=trigger.current;
    if (typeof dialog.showModal==='function') dialog.showModal(); else dialog.setAttribute('open','');
    return () => { if(typeof dialog.close==='function')dialog.close();opener?.focus(); };
  },[open]);
  const choose = (number: number | null) => {
    if (disabled) return;
    onChange(number);
    setOpen(false);
  };
  return <><button ref={trigger} type="button" className="pos-pager-trigger" aria-haspopup="dialog" aria-expanded={open} aria-label={`Control de entrega: ${value===null?'Sin control':value}`} disabled={disabled} onClick={()=>setOpen(true)}>Control de entrega <strong>{value === null ? 'Sin control' : `#${value}`}</strong></button>
    {open&&<dialog ref={ref} className="pos-pager-dialog" aria-label="Control de entrega" onCancel={event=>{event.preventDefault();event.stopPropagation();setOpen(false);}}>
    <header><h2>Control de entrega</h2><button type="button" aria-label="Cerrar selección de control" onClick={()=>setOpen(false)}>×</button></header>
    <fieldset disabled={disabled}><legend>Elige el control que entregarás al cliente</legend><div>
      {Array.from({ length: 30 }, (_, index) => index + 1).map(number => <button type="button" key={number} aria-label={`Control ${number}`} aria-pressed={value === number} onClick={() => choose(number)}>{number}</button>)}
    </div></fieldset><footer><button type="button" disabled={disabled} aria-pressed={value === null} onClick={() => choose(null)}>Sin control</button></footer>
  </dialog>}</>;
}
