'use client';

export default function LoadFailure({ message, retry }: { message: string; retry: () => Promise<void> }) {
  return <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
    <p>No se pudo cargar la información. {message}</p>
    <button className="mt-2 font-semibold underline" onClick={() => { void retry(); }}>Reintentar conexión</button>
  </div>;
}
