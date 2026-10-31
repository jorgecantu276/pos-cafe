import Link from 'next/link';
import { Banknote, ChevronRight, Coffee, ContactRound, Printer, ReceiptText, Settings2, UsersRound, Archive, Star, Monitor, XCircle } from 'lucide-react';

const mainTools = [
  { name: 'Ventas', detail: 'Consultar y reimprimir tickets', path: 'ventas', icon: ReceiptText },
  { name: 'Caja', detail: 'Revisar cortes de caja', path: 'cortes', icon: Banknote },
  { name: 'Productos', detail: 'Cambiar precios y productos', path: 'productos', icon: Coffee },
  { name: 'Clientes', detail: 'Buscar clientes y ver sus puntos', path: 'clientes', icon: ContactRound },
];
const otherTools = [
  { name: 'Equipo', path: 'usuarios', icon: UsersRound },
  { name: 'Favoritos en caja', path: 'favoritos', icon: Star },
  { name: 'Tipo de cambio y entregas', path: 'caja', icon: Banknote },
  { name: 'Cancelaciones', path: 'cancelaciones', icon: XCircle },
  { name: 'Resolver impresión pendiente', path: 'impresion', icon: Printer },
  { name: 'Datos del ticket', path: 'ajustes', icon: ReceiptText },
  { name: 'Respaldos', path: 'respaldos', icon: Archive },
];

export default function Administration() {
  return <div className="workspace-admin-menu workspace-admin-simple"><div className="workspace-admin-page-title"><h1>Administración</h1></div>
    <nav className="workspace-admin-main-tools" aria-label="Herramientas principales">{mainTools.map(({name, detail, path, icon: Icon}) => <Link href={`/admin/${path}`} key={path}>
      <span className="workspace-admin-menu-icon"><Icon size={24} strokeWidth={1.7}/></span><span className="workspace-admin-menu-label"><strong>{name}</strong><small>{detail}</small></span><ChevronRight size={18} aria-hidden="true"/>
    </Link>)}</nav>
    <details className="workspace-admin-more"><summary><Settings2 size={19} aria-hidden="true"/><span>Más opciones</span><ChevronRight size={18} aria-hidden="true"/></summary>
      <nav aria-label="Más opciones">{otherTools.map(({name, path, icon: Icon}) => <Link href={`/admin/${path}`} key={path}><Icon size={19} aria-hidden="true"/><span>{name}</span><ChevronRight size={16} aria-hidden="true"/></Link>)}
        <Link href="/tv" target="_blank" rel="noopener noreferrer"><Monitor size={19} aria-hidden="true"/><span>Pantalla de ventas</span><ChevronRight size={16} aria-hidden="true"/></Link>
      </nav>
    </details>
  </div>;
}
