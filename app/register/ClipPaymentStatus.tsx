'use client';

import { useEffect, useRef, useState } from 'react';
import { withDeadline } from '@/lib/request-deadline';

export default function ClipPaymentStatus({requestId,onReady}:{requestId:string;onReady:()=>void}) {
  const ready = useRef(onReady);
  const [message,setMessage] = useState('Consultando el mismo pago en CLIP…');
  const [finished,setFinished] = useState(false);
  useEffect(() => { ready.current = onReady; },[onReady]);
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const check = async () => {
      try {
        const response = await withDeadline(() => fetch(`/api/payments/clip?request=${encodeURIComponent(requestId)}`,{cache:'no-store',signal:controller.signal}),{signal:controller.signal});
        const reply = await withDeadline(() => response.json(),{signal:controller.signal});
        if (stopped) return;
        if (!response.ok || reply.requestId !== requestId) throw Error('No se pudo consultar CLIP. Conserva el pedido; se volverá a consultar.');
        setMessage(reply.message);
        if (reply.state === 'completed') { stopped = true; ready.current(); return; }
        if (reply.state === 'failed') { setFinished(true); stopped = true; return; }
      } catch { if (!stopped) setMessage('No se pudo consultar CLIP. Conserva el pedido; se volverá a consultar.'); }
      if (!stopped) timer = setTimeout(() => void check(),3000);
    };
    void check();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  },[requestId]);
  return <p role="status" className="pos-clip-status">{message}{!finished && ' No captures otro cobro en la terminal.'}</p>;
}
