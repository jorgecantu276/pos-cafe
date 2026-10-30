import Link from 'next/link';
import { ArrowUpRight, Banknote, ChevronRight, ClipboardList, Coffee, ContactRound, Monitor, Printer, ReceiptText, Settings2, TicketPercent, UsersRound, XCircle } from 'lucide-react';

const dailyTools = [
  { name: 'Ventas', detail: 'Historial y comprobantes', path: 'ventas', icon: ReceiptText },
  { name: 'Productos', detail: 'Catálogo y opciones', path: 'productos', icon: Coffee },
  { name: 'Caja y tipo de cambio', detail: 'Turnos, entregas y recuperación', path: 'caja', icon: Banknote },
  { name: 'Cortes de caja', detail: 'Conteos y reportes de turno', path: 'cortes', icon: ClipboardList },
  { name: 'Recuperar impresión', detail: 'Revisar copias pendientes', path: 'impresion', icon: Printer },
];
const managementTools = [
  { name: 'Clientes', detail: 'Datos y puntos', path: 'clientes', icon: ContactRound },
  { name: 'Cancelaciones', detail: 'Consultar y registrar', path: 'cancelaciones', icon: XCircle },
  { name: 'Usuarios', detail: 'Contraseñas y permisos', path: 'usuarios', icon: UsersRound },
  { name: 'Cupones', detail: 'Estado de promociones', path: 'cupones', icon: TicketPercent },
  { name: 'Ajustes', detail: 'Datos de los tickets', path: 'ajustes', icon: Settings2 },
];

export default function Administration() {
  return <div className="workspace-admin-menu"><div className="workspace-admin-page-title"><h1>Administración</h1></div>
    <div className="workspace-admin-groups"><section><h2>Operación</h2><nav aria-label="Herramientas principales">{dailyTools.map(({name, detail, path, icon: Icon}) => <Link href={`/admin/${path}`} key={path}><span className="workspace-admin-menu-icon"><Icon size={21} strokeWidth={1.7}/></span><span className="workspace-admin-menu-label"><strong>{name}</strong><small>{detail}</small></span><ChevronRight size={17} aria-hidden="true"/></Link>)}</nav></section>
    <section><h2>Gestión</h2><nav aria-label="Más herramientas">{managementTools.map(({name, detail, path, icon: Icon}) => <Link href={`/admin/${path}`} key={path}><span className="workspace-admin-menu-icon"><Icon size={21} strokeWidth={1.7}/></span><span className="workspace-admin-menu-label"><strong>{name}</strong><small>{detail}</small></span><ChevronRight size={17} aria-hidden="true"/></Link>)}</nav></section></div>
    <Link className="workspace-admin-tv" href="/tv" target="_blank" rel="noopener noreferrer"><Monitor size={18}/><span>Ventas en TV</span><ArrowUpRight size={16}/></Link>
  </div>;
}
