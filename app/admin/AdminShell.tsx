'use client';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, Settings2 } from 'lucide-react';
import { usePathname } from 'next/navigation';
import './workspace-admin.css';

const areas = {
  catalog: { name: 'Catálogo', href: '/admin/productos', links: [
    { name: 'Productos y extras', href: '/admin/productos' }, { name: 'Favoritos de caja', href: '/admin/favoritos' }, { name: 'Inventario', href: '/admin/inventario' },
  ] },
  drawer: { name: 'Caja', href: '/admin/cortes', links: [
    { name: 'Turno y cortes', href: '/admin/cortes' }, { name: 'Entregas y tipo de cambio', href: '/admin/caja' },
  ] },
  settings: { name: 'Configuración', href: '/admin/configuracion', links: [] },
};
const pages: Record<string, { name: string; area?: keyof typeof areas }> = {
  ventas: { name: 'Ventas' }, clientes: { name: 'Clientes' },
  productos: { name: 'Productos y extras', area: 'catalog' }, favoritos: { name: 'Favoritos de caja', area: 'catalog' },
  inventario: { name: 'Inventario', area: 'catalog' },
  cortes: { name: 'Turno y cortes', area: 'drawer' }, caja: { name: 'Entregas y tipo de cambio', area: 'drawer' },
  configuracion: { name: 'Configuración', area: 'settings' }, usuarios: { name: 'Equipo', area: 'settings' },
  respaldos: { name: 'Respaldos', area: 'settings' }, impresion: { name: 'Recuperar impresión', area: 'settings' },
};

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const page = pages[pathname.split('/')[2]];
  const area = page?.area ? areas[page.area] : null;
  return <div className="workspace-admin"><header><div className="workspace-admin-location"><Link href="/admin"><span className="workspace-admin-mark"><Settings2 size={20} strokeWidth={1.8}/></span>Administración</Link>{area && area.name !== page.name && <><ChevronRight size={15} aria-hidden="true"/><Link className="workspace-admin-parent" href={area.href}>{area.name}</Link></>}{page && <><ChevronRight size={15} aria-hidden="true"/><span className="workspace-admin-current">{page.name}</span></>}</div><Link className="workspace-admin-back" href="/"><ArrowLeft size={17} aria-hidden="true"/>Volver a caja</Link></header>
    <main>{!!area?.links.length && <nav className="workspace-admin-section-nav" aria-label={`Secciones de ${area.name}`}>{area.links.map(link => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined}>{link.name}</Link>)}</nav>}{children}</main>
  </div>;
}
