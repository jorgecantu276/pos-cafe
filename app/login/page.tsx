'use client';
import { posProfile } from '@/lib/pos-profile';

import { WorkspaceKeyboard } from '../register/WorkspaceRegister';
import '../register/workspace.css';
import './login.css';

import { type LoginProfile } from '@/lib/pos-types';
import StaffAvatar from '@/components/StaffAvatar';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { loginReturnTarget } from '@/lib/login-return';
import { RequestTimeout, withDeadline } from '@/lib/request-deadline';
import { Keyboard, Eye, EyeOff, Coffee, Check, ArrowRight, Sparkles } from 'lucide-react';

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
  const passwordInput = useRef<HTMLInputElement>(null);
  const smoothies = posProfile.id === 'smoothies';

  useEffect(() => {
    if (smoothies && selectedUsername) passwordInput.current?.focus();
  }, [selectedUsername, smoothies]);


  // 🟢 1. OBTENER USUARIOS DE LA BASE DE DATOS
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const { data, error } = await withDeadline(() => supabase.rpc('pos_login_profiles'));

        if (error) throw error;
        setUsers(data || []);
      } catch (err) {
        console.error("Error cargando perfiles:", err);
        setError('No se pudieron cargar los usuarios. Revisa la conexión.');
      } finally {
        setLoadingUsers(false);
      }
    };

    fetchProfiles();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUsername) {
      setError('Elige tu usuario.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // 🟢 2. RECONSTRUIR EL CORREO FANTASMA PARA EL LOGIN
      const fakeEmail = `${selectedUsername.replace(/\s+/g, '').toLowerCase()}@${posProfile.staffDomain}`;

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
      setError(unavailable || failure instanceof RequestTimeout ? 'No hay conexión. Vuelve a intentar.' : 'Contraseña incorrecta. Vuelve a intentar.');
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

  return <main className="workspace-login"><header><span className="workspace-login-brand">{smoothies ? <Sparkles size={22} /> : <Coffee size={22} />}<strong>{posProfile.brand}</strong></span><span>Caja</span></header><section className="workspace-login-panel"><div className="workspace-login-heading"><span aria-hidden="true">{smoothies ? <Sparkles size={30} /> : <Coffee size={30} />}</span><h1>{smoothies && selectedUser ? `Hola, ${selectedUser.full_name.split(' ')[0]}` : 'Iniciar sesión'}</h1><p>{smoothies && selectedUser ? 'Escribe tu contraseña.' : 'Elige tu usuario.'}</p></div>
    <form onSubmit={handleLogin}><fieldset disabled={loading} className="workspace-login-profiles"><legend>Usuario</legend>
      {loadingUsers ? <p role="status">Cargando usuarios…</p> : users.map(user => <button type="button" key={user.id} aria-label={user.full_name} aria-pressed={selectedUsername === user.username} onClick={() => handleUserSelect(user.username || '')}>
        <StaffAvatar value={user.avatar_url} username={user.username || user.full_name} size={40} className="workspace-login-avatar"/><span className="workspace-login-profile-copy"><strong><span>{user.full_name.split(' ')[0]}</span> {user.full_name.split(' ').slice(1).join(' ')}</strong><small>{user.username}</small></span>{selectedUsername === user.username && <Check size={21} aria-hidden="true" />}
      </button>)}
      {!loadingUsers && !users.length && <p>No hay usuarios disponibles.</p>}
    </fieldset>
    <label className="workspace-login-password">Contraseña<div><input ref={passwordInput} type={showPass ? 'text' : 'password'} autoComplete="current-password" disabled={!selectedUsername || loading} aria-label="Contraseña" placeholder={selectedUsername ? `Contraseña de ${selectedUser?.full_name.split(' ')[0]}` : 'Elige tu usuario'} value={password} onChange={event => setPassword(event.target.value)} />
      <button type="button" aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'} disabled={!selectedUsername || loading} onClick={() => setShowPass(!showPass)}>{showPass ? <EyeOff size={21} /> : <Eye size={21} />}</button>
      <button type="button" aria-label="Teclado para contraseña" aria-pressed={keyboard} disabled={!selectedUsername || loading} onClick={() => setKeyboard(!keyboard)}><Keyboard size={23} /></button>
    </div></label>
    {keyboard && <div className="workspace-login-keys"><WorkspaceKeyboard value={password} onChange={setPassword} disabled={loading} /></div>}
    {error && <p role="alert" className="workspace-login-error">{error}</p>}
    <button className="workspace-login-submit" type="submit" disabled={loading || !selectedUsername || !password}>{loading ? 'Entrando…' : 'Acceder'}<ArrowRight size={20} aria-hidden="true" /></button>
    </form></section></main>;
}
