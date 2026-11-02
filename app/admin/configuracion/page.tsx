import Link from 'next/link';
import { Archive, ChevronRight, Printer, UsersRound, CreditCard } from 'lucide-react';

export default function ConfigurationPage() {
  return <div className="workspace-admin-menu workspace-admin-simple">
    <div className="workspace-admin-page-title"><h1>Configuración</h1></div>
    <nav aria-label="Configuración del negocio">
      <Link href="/admin/usuarios"><span className="workspace-admin-menu-icon"><UsersRound size={23}/></span><span className="workspace-admin-menu-label"><strong>Equipo</strong><small>Cuentas y acceso de los empleados</small></span><ChevronRight size={18} aria-hidden="true"/></Link>
      <Link href="/admin/respaldos"><span className="workspace-admin-menu-icon"><Archive size={23}/></span><span className="workspace-admin-menu-label"><strong>Respaldos</strong><small>Estado y copias de recuperación</small></span><ChevronRight size={18} aria-hidden="true"/></Link>
    </nav>
    <Link className="workspace-admin-settings-link" href="/admin/impresion"><Printer size={18} aria-hidden="true"/>Revisar impresión pendiente</Link>
    <Link className="workspace-admin-settings-link" href="/admin/clip"><CreditCard size={18} aria-hidden="true"/>Terminal CLIP</Link>
  </div>;
}
