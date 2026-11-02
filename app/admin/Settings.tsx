import type { ReactNode } from 'react';

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="settings-group"><h2>{title}</h2><div className="settings-surface">{children}</div></section>;
}

export function SettingsRow({ label, detail, children }: { label: string; detail?: ReactNode; children?: ReactNode }) {
  return <div className="settings-row"><div className="settings-row-copy"><strong>{label}</strong>{detail && <span>{detail}</span>}</div>{children && <div className="settings-row-control">{children}</div>}</div>;
}

export function SettingsNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={`settings-notice${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</p>;
}
