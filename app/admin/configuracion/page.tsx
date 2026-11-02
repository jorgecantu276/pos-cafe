import Link from 'next/link';
import { Archive, ChevronRight, Printer, UsersRound, CreditCard, CircleDollarSign } from 'lucide-react';
import { SettingsGroup } from '../Settings';

export default function ConfigurationPage() {
  return <div className="settings-page"><h1>Configuración</h1>
    <SettingsGroup title="Negocio"><nav aria-label="Configuración del negocio">
      <Link className="settings-link-row" href="/admin/usuarios"><UsersRound size={22} aria-hidden="true"/><span><strong>Equipo</strong><small>Usuarios y acceso</small></span><ChevronRight size={18} aria-hidden="true"/></Link>
      <Link className="settings-link-row" href="/admin/caja"><CircleDollarSign size={22} aria-hidden="true"/><span><strong>Tipo de cambio</strong><small>Dólares y pesos</small></span><ChevronRight size={18} aria-hidden="true"/></Link>
    </nav></SettingsGroup>
    <SettingsGroup title="Dispositivos"><nav aria-label="Dispositivos">
      <Link className="settings-link-row" href="/admin/impresion"><Printer size={22} aria-hidden="true"/><span><strong>Impresoras</strong><small>Tickets y etiquetas</small></span><ChevronRight size={18} aria-hidden="true"/></Link>
      <Link className="settings-link-row" href="/admin/clip"><CreditCard size={22} aria-hidden="true"/><span><strong>Terminal CLIP</strong><small>Cobros con tarjeta</small></span><ChevronRight size={18} aria-hidden="true"/></Link>
    </nav></SettingsGroup>
    <SettingsGroup title="Datos"><nav aria-label="Datos">
      <Link className="settings-link-row" href="/admin/respaldos"><Archive size={22} aria-hidden="true"/><span><strong>Respaldos</strong><small>Copias del negocio</small></span><ChevronRight size={18} aria-hidden="true"/></Link>
    </nav></SettingsGroup>
  </div>;
}
