'use client';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, Settings2 } from 'lucide-react';
import { usePathname } from 'next/navigation';
import './workspace-admin.css';

const pageNames: Record<string, string> = { ventas: 'Ventas', productos: 'Productos', caja: 'Caja y tipo de cambio', cortes: 'Cortes de caja', impresion: 'Recuperar impresión', clientes: 'Clientes', cancelaciones: 'Cancelaciones', usuarios: 'Equipo', cupones: 'Cupones', ajustes: 'Ajustes' };

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const page = pageNames[usePathname().split('/')[2]];
  return <div className="workspace-admin"><header><div className="workspace-admin-location"><Link href="/admin"><span className="workspace-admin-mark"><Settings2 size={20} strokeWidth={1.8}/></span>Administración</Link>{page && <><ChevronRight size={15} aria-hidden="true"/><span className="workspace-admin-current">{page}</span></>}</div><Link className="workspace-admin-back" href="/"><ArrowLeft size={17} aria-hidden="true"/>Volver a caja</Link></header>
    <main>{children}</main>
  </div>;
}
