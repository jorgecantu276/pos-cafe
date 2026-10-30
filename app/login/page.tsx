'use client';

import { WorkspaceKeyboard } from '../register/WorkspaceRegister';
import '../register/workspace.css';
import './login.css';

import { type LoginProfile } from '@/lib/pos-types';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { loginReturnTarget } from '@/lib/login-return';
import { RequestTimeout, withDeadline } from '@/lib/request-deadline';
import { Keyboard, Eye, EyeOff, Coffee, Check, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const [users, setUsers] = useState<LoginProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [selectedUsername, setSelectedUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showPass, setShowPass] = useState(false);
  const [keyboard, setKeyboard] = useState(false);

  const router = useRouter();


  // 🟢 1. OBTENER USUARIOS DE LA BASE DE DATOS
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const { data, error } = await withDeadline(() => supabase.rpc('pos_login_profiles'));

        if (error) throw error;
        setUsers(data || []);
      } catch (err) {
        console.error("Error cargando perfiles:", err);
        setError('No se pudieron cargar los perfiles. Revisa la conexión; si continúa, avisa al responsable.');
      } finally {
        setLoadingUsers(false);
      }
    };

    fetchProfiles();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUsername) {
      setError('Selecciona un perfil para continuar.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // 🟢 2. RECONSTRUIR EL CORREO FANTASMA PARA EL LOGIN
      const fakeEmail = `${selectedUsername.replace(/\s+/g, '').toLowerCase()}@carinitomio.local`;

      const { error: signInError } = await withDeadline(() => supabase.auth.signInWithPassword({
        email: fakeEmail,
        password
      }));

      if (signInError) throw signInError;

      const target = loginReturnTarget(new URLSearchParams(window.location.search).get('returnTo'));
      router.replace(target);
      router.refresh();
    } catch (failure) {
      const unavailable=failure&&typeof failure==='object'&&('name' in failure&&failure.name==='AuthRetryableFetchError'||'status' in failure&&(Number(failure.status)===0||Number(failure.status)>=500));
      setError(unavailable || failure instanceof RequestTimeout ? 'No se pudo conectar para iniciar sesión. Revisa la conexión y reintenta.' : 'Contraseña incorrecta. Verifica tu acceso.');
    } finally {
      setLoading(false);
    }
  };

  // 🟢 AL SELECCIONAR UN USUARIO
  const handleUserSelect = (username: string) => {
    setSelectedUsername(username);
    setPassword(''); // Limpiamos la contraseña por si había otra
    setError(null);
  };

  const selectedUser = users.find(u => u.username === selectedUsername);

  return <main className="workspace-login"><header><span className="workspace-login-brand"><Coffee size={22} /><strong>Cariñito Mío</strong></span><span>Caja</span></header><section className="workspace-login-panel"><div className="workspace-login-heading"><span aria-hidden="true"><Coffee size={30} /></span><h1>Iniciar sesión</h1><p>Selecciona tu perfil para abrir la caja.</p></div>
    <form onSubmit={handleLogin}><fieldset disabled={loading} className="workspace-login-profiles"><legend>Perfil</legend>
      {loadingUsers ? <p role="status">Cargando perfiles…</p> : users.map(user => <button type="button" key={user.id} aria-label={user.full_name} aria-pressed={selectedUsername === user.username} onClick={() => handleUserSelect(user.username || '')}>
        <span className="workspace-login-avatar" aria-hidden="true">{user.full_name.trim().split(/\s+/).map(word => word[0]).slice(0, 2).join('')}</span><span className="workspace-login-profile-copy"><strong><span>{user.full_name.split(' ')[0]}</span> {user.full_name.split(' ').slice(1).join(' ')}</strong><small>{user.username}</small></span>{selectedUsername === user.username && <Check size={21} aria-hidden="true" />}
      </button>)}
      {!loadingUsers && !users.length && <p>No hay perfiles disponibles.</p>}
    </fieldset>
    <label className="workspace-login-password">Contraseña<div><input type={showPass ? 'text' : 'password'} autoComplete="current-password" disabled={!selectedUsername || loading} aria-label="Contraseña" placeholder={selectedUsername ? `Contraseña de ${selectedUser?.full_name.split(' ')[0]}` : 'Selecciona un perfil'} value={password} onChange={event => setPassword(event.target.value)} />
      <button type="button" aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'} disabled={!selectedUsername || loading} onClick={() => setShowPass(!showPass)}>{showPass ? <EyeOff size={21} /> : <Eye size={21} />}</button>
      <button type="button" aria-label="Teclado para contraseña" aria-pressed={keyboard} disabled={!selectedUsername || loading} onClick={() => setKeyboard(!keyboard)}><Keyboard size={23} /></button>
    </div></label>
    {keyboard && <div className="workspace-login-keys"><WorkspaceKeyboard value={password} onChange={setPassword} disabled={loading} /></div>}
    {error && <p role="alert" className="workspace-login-error">{error}</p>}
    <button className="workspace-login-submit" type="submit" disabled={loading || !selectedUsername || !password}>{loading ? 'Entrando…' : 'Acceder'}<ArrowRight size={20} aria-hidden="true" /></button>
    </form></section></main>;
}
