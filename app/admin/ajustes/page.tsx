export default function AjustesPage() {
  return <main className="max-w-[900px] mx-auto space-y-6 py-10">
    <header><h1 className="text-3xl font-semibold">Ajustes</h1></header>
    <section className="rounded-2xl border bg-white p-6 space-y-3">
      <h2 className="text-xl font-semibold">Tickets e impresión</h2>
      <p>La identidad del emisor y las impresoras se configuran en la caja con el responsable.</p>
      <p>Los tickets usan esa configuración. Las reimpresiones conservan el comprobante original cuando está disponible.</p>
      <p>Esta pantalla es informativa y no cambia los datos del ticket.</p>
    </section>
  </main>;
}
