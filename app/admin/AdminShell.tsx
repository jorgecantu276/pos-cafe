'use client';
import Link from 'next/link';
import './workspace-admin.css';


export default function AdminShell({ children }: { children: React.ReactNode }) {
  return <div className="workspace-admin"><header><Link href="/admin">Administración</Link><Link href="/">Volver a caja</Link></header>
    <main>{children}</main>
  </div>;
}
