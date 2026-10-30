import Link from 'next/link';

export default function Administration() {
  return <div className="workspace-admin-menu"><h1>Administración</h1>
    <nav aria-label="Herramientas principales">{[['Ventas', 'ventas'], ['Productos', 'productos'], ['Cortes de caja', 'cortes']].map(([name, path]) => <Link href={`/admin/${path}`} key={path}>{name}<span aria-hidden="true">›</span></Link>)}</nav>
    <details><summary>Más opciones</summary><nav aria-label="Más herramientas">{[['Clientes', 'clientes'], ['Cancelaciones', 'cancelaciones'], ['Usuarios', 'usuarios'], ['Cupones', 'cupones'], ['Ajustes', 'ajustes']].map(([name, path]) => <Link href={`/admin/${path}`} key={path}>{name}<span aria-hidden="true">›</span></Link>)}<Link href="/tv" target="_blank" rel="noopener noreferrer">Ventas en TV<span aria-hidden="true">↗</span></Link></nav></details>
  </div>;
}
