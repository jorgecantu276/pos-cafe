import Link from 'next/link';
import { Banknote, ChevronRight, Coffee, ContactRound, ReceiptText, Settings2 } from 'lucide-react';

const mainTools = [
  { name: 'Ventas', detail: 'Consultar, reimprimir o cancelar tickets', path: 'ventas', icon: ReceiptText },
  { name: 'Caja', detail: 'Turnos, cortes y entregas entre cajeros', path: 'cortes', icon: Banknote },
  { name: 'Catálogo', detail: 'Productos, extras y favoritos de caja', path: 'productos', icon: Coffee },
  { name: 'Clientes', detail: 'Buscar clientes y ver sus puntos', path: 'clientes', icon: ContactRound },
];

export default function Administration() {
  return <div className="workspace-admin-menu workspace-admin-simple"><div className="workspace-admin-page-title"><h1>Administración</h1></div>
    <nav className="workspace-admin-main-tools" aria-label="Herramientas principales">{mainTools.map(({name, detail, path, icon: Icon}) => <Link href={`/admin/${path}`} key={path}>
      <span className="workspace-admin-menu-icon"><Icon size={24} strokeWidth={1.7}/></span><span className="workspace-admin-menu-label"><strong>{name}</strong><small>{detail}</small></span><ChevronRight size={18} aria-hidden="true"/>
    </Link>)}</nav>
    <Link className="workspace-admin-settings-link" href="/admin/configuracion"><Settings2 size={18} aria-hidden="true"/>Configuración</Link>
  </div>;
}
