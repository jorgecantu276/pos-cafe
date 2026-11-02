'use client';

import StaffAvatar from '@/components/StaffAvatar';
import { staffAvatars, staffAvatarSource } from '@/lib/staff-avatars';

import { type StaffProfile, errorMessage } from '@/lib/pos-types';

import { useCallback, useRef, useState } from 'react';
import { acknowledgeStaffPending, readStaffPending, saveStaffChange, type StaffPending } from '@/lib/staff-requests';
import {readStaffActivation,saveStaffActivation} from '@/lib/staff-active';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import LoadFailure from '@/app/LoadFailure';
import AdminDialog from '../AdminDialog';
import {
  ShieldCheck, Loader2, Trash2, UserPlus,
  Check, Edit2
} from 'lucide-react';

export default function UsuariosPage() {

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [activePending,setActivePending]=useState(false),[status,setStatus]=useState<'active'|'inactive'>('active');
  const [pendingChange, setPendingChange] = useState<StaffPending | null>(() => {
    if (typeof window === 'undefined') return null;
    try { return readStaffPending(localStorage); } catch { return null; }
  });
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');

  const initialFormState = {
    id: '',
    username: '',
    password: '',
    role: 'cashier',
    management_revision:0,
    avatar_url: staffAvatars[0].src as string
  };

  const [formData, setFormData] = useState(initialFormState);

  const loadUsers = useCallback(async (signal: AbortSignal) => {
    const auth=await supabase.auth.getUser();if(auth.error||!auth.data.user)throw new Error('Inicia sesión.');
    const { data, error } = await supabase.from('profiles').select('id, full_name, username, role, avatar_url, is_active, management_revision')
      .order('username', { ascending: true }).abortSignal(signal);
    if (error) throw error;
    return {actor:auth.data.user.id,users:(data||[]) as StaffProfile[],activationPending:Boolean(readStaffActivation(localStorage,auth.data.user.id))};
  }, []);
  const applyUsers=useCallback((data:{activationPending:boolean})=>setActivePending(data.activationPending),[]);
  const { data:{actor,users:allUsers}, loading, error: loadError, reload: fetchUsers } = useResource(loadUsers,{actor:'',users:[] as StaffProfile[],activationPending:false},applyUsers);
  const users=allUsers.filter(user=>status==='active'?user.is_active:!user.is_active);


  const handleOpenModal = (mode: 'create' | 'edit', user?: StaffProfile) => {
    if (saving.current||activePending||pendingChange) return;
    setSaveError(''); setSaveMessage('');
    setModalMode(mode);
    if (mode === 'edit' && user) {
      setFormData({
        id: user.id,
        username: user.username || '',
        password: '', // Se deja en blanco por seguridad
        role: user.role === 'admin' ? 'admin' : 'cashier',
        management_revision:user.management_revision??0,
        avatar_url: staffAvatarSource(user.avatar_url, user.username || '')
      });
    } else {
      setFormData(initialFormState);
    }
    setIsModalOpen(true);
  };

  const refreshPending = () => {
    try { setPendingChange(readStaffPending(localStorage)); } catch { setSaveError('No se pudo comprobar el cambio. Pide ayuda al responsable.'); }
    try{setActivePending(Boolean(readStaffActivation(localStorage,actor)));}catch(error){setActivePending(true);setSaveError(errorMessage(error));}
  };
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving.current||activePending) return;
    saving.current = true; setIsSaving(true); setSaveError(''); setSaveMessage('');
    try {
      const result = await saveStaffChange(localStorage, { operation: modalMode, username: formData.username, id: formData.id || undefined },
        modalMode === 'create' ? formData : { ...formData, is_active: true },{actor});
      setFormData({ ...formData, password: '' });
      await fetchUsers(); setIsModalOpen(false);
      setSaveMessage(result.password_changed ? 'Usuario y contraseña guardados.' : modalMode === 'create' ? 'Usuario agregado.' : 'Cambios guardados.');
    } catch (error) { setSaveError(errorMessage(error)); }
    finally { refreshPending(); saving.current = false; setIsSaving(false); }
  };
  const handleAcknowledge = () => {
    if (!confirm('¿Ya comprobaste el usuario y su acceso? Podrás volver a editarlo.')) return;
    try { acknowledgeStaffPending(localStorage); setPendingChange(null); setSaveError(''); }
    catch { setSaveError('No se pudo guardar la revisión. Vuelve a intentar.'); }
  };
  const handleActive = async (user?:StaffProfile) => {
    if (saving.current || pendingChange || (user&&activePending)) return;
    if(user?.is_active&&!confirm('¿Desactivar este usuario? Se conservará su historial.'))return;
    saving.current = true; setIsSaving(true); setSaveError(''); setSaveMessage('');
    try {
      await saveStaffActivation(supabase,localStorage,actor,user?{id:user.id,revision:user.management_revision??0,active:!user.is_active}:undefined);
      await fetchUsers();setSaveMessage('Acceso guardado.');
    } catch (error) { setSaveError(errorMessage(error)); }
    finally { refreshPending(); saving.current = false; setIsSaving(false); }
  };

  if (loadError) return <LoadFailure message={loadError} retry={fetchUsers} />;

  if (loading) return (
    <div className="flex h-[60vh] items-center justify-center">
      <Loader2 className="animate-spin text-[#0071e3] w-8 h-8" strokeWidth={1.5} />
    </div>
  );

  return (
    <div className="max-w-[900px] mx-auto space-y-12 py-10 animate-in slide-in-from-bottom-2 duration-1000">

      {/* HEADER */}
      <header className="flex justify-between items-center">
        <div className="space-y-1">
          <h2 className="text-4xl font-semibold text-[#1d1d1f] tracking-tight">Equipo</h2>
          <p className="text-[#86868b] text-lg font-medium">Usuarios, contraseñas y permisos.</p>
        </div>
        <button
          disabled={isSaving || !!pendingChange||activePending} onClick={() => handleOpenModal('create')}
          className="bg-[#0071e3] text-white px-5 py-2.5 rounded-full text-[13px] font-semibold hover:bg-[#0077ed] transition-all active:scale-95 flex items-center gap-2 shadow-sm"
        >
          <UserPlus size={16} /> Agregar usuario
        </button>
      </header>
      <div className="admin-segmented" role="group" aria-label="Estado del equipo"><button type="button" aria-pressed={status==='active'} onClick={()=>setStatus('active')}>Activos</button><button type="button" aria-pressed={status==='inactive'} onClick={()=>setStatus('inactive')}>Inactivos</button></div>

      {saveMessage && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">{saveMessage}</p>}
      {saveError && !isModalOpen && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">{saveError}</p>}
      {pendingChange && <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3" aria-label="Cambio de usuario sin confirmar">
        <p>Hay un cambio sin confirmar para <strong>{pendingChange.username}</strong>. Revisa la lista y prueba su acceso antes de crearlo de nuevo.</p>
        <div className="flex gap-3"><button disabled={isSaving} className="rounded-xl border bg-white p-3" onClick={() => void fetchUsers()}>Actualizar lista</button><button disabled={isSaving} className="rounded-xl border bg-white p-3" onClick={handleAcknowledge}>Ya revisé el resultado</button></div>
      </section>}
      {activePending&&<section className="admin-recovery" aria-label="Cambio de acceso sin confirmar"><p>Hay un acceso sin confirmar. Compruébalo antes de hacer otro cambio.</p><button type="button" disabled={isSaving||!!pendingChange} onClick={()=>void handleActive()}>Comprobar acceso</button></section>}
      {/* LISTA DE USUARIOS */}
      <div className="bg-white rounded-[28px] shadow-[0_8px_40px_rgba(0,0,0,0.04)] border border-slate-100/50 overflow-hidden">
        <div className="divide-y divide-slate-100">
          {users.map((user) => (
            <div key={user.id} className="p-6 md:p-8 flex items-center justify-between group transition-all hover:bg-[#f5f5f7]/40">

              <div className="flex items-center gap-6">
                <div className="relative">
                  <StaffAvatar value={user.avatar_url} username={user.username || ''} className="w-16 h-16 rounded-full"/>
                  {user.role === 'admin' && (
                    <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full shadow-sm">
                      <ShieldCheck size={14} className="text-[#0071e3]" />
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <h4 className="font-semibold text-lg text-[#1d1d1f]">{user.username || 'Usuario'}</h4>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-tight uppercase ${
                      user.role === 'admin' ? 'bg-[#0071e3]/10 text-[#005ab8]' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {user.role === 'admin' ? 'ADMINISTRADOR' : 'CAJERO'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!user.is_active?<button type="button" className="admin-secondary-button" disabled={isSaving||!!pendingChange||activePending} aria-label={`Reactivar a ${user.username}`} onClick={()=>void handleActive(user)}>Reactivar</button>:<>
                <button
                  disabled={isSaving||!!pendingChange||activePending} onClick={() => handleOpenModal('edit', user)}
                  className="px-4 py-2 rounded-full text-[13px] font-semibold transition-all border bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-[#0071e3] flex items-center gap-2"
                >
                  <Edit2 size={14} /> Editar
                </button>

                <button disabled={isSaving || !!pendingChange||activePending} aria-label={'Desactivar a ' + user.username} onClick={() => void handleActive(user)} className="p-2.5 text-slate-300 hover:bg-red-50 hover:text-[#ff3b30] rounded-full transition-all">
                   <Trash2 size={18} strokeWidth={1.5} />
                </button>
                </>}
              </div>
            </div>
          ))}
          {!users.length&&<p className="p-6">No hay usuarios {status==='active'?'activos':'inactivos'}.</p>}
        </div>
      </div>

      <details className="rounded-2xl border bg-white px-5 py-2">
        <summary>Permisos de cada usuario</summary>
        <dl className="space-y-3 py-3 text-sm"><div><dt className="font-semibold">Administrador</dt><dd>Acceso a caja, ventas y ajustes.</dd></div><div><dt className="font-semibold">Cajero</dt><dd>Cobros, entrega de caja y cierre de turno.</dd></div></dl>
      </details>

      {isModalOpen && <AdminDialog title={modalMode === 'create' ? 'Nuevo usuario' : 'Editar usuario'} onClose={() => { if (!saving.current) setIsModalOpen(false); }} busy={isSaving} footer={<>
        {(pendingChange||activePending) && <button type="button" className="admin-secondary-button" disabled={isSaving} onClick={() => { setIsModalOpen(false); void fetchUsers(); }}>Comprobar cambios</button>}
        <button type="button" className="admin-secondary-button" disabled={isSaving} onClick={() => setIsModalOpen(false)}>{pendingChange ? 'Cerrar' : 'Cancelar'}</button>
        <button type="submit" form="staff-editor-form" className="admin-primary-button" disabled={isSaving || !!pendingChange||activePending}>{isSaving ? <><Loader2 className="animate-spin" size={18}/>Guardando…</> : 'Guardar usuario'}</button>
      </>}>
        {saveError && <p role="alert" className="admin-form-message">{saveError}</p>}
        <form id="staff-editor-form" onSubmit={handleSaveUser}>
          <fieldset disabled={isSaving || !!pendingChange||activePending} className="space-y-5">
            <label className="admin-field">Usuario<input id="staff-username" data-dialog-autofocus={modalMode === 'create' ? true : undefined} autoComplete="username" required placeholder="Ej. juan" value={formData.username} disabled={modalMode === 'edit'} onChange={event => setFormData({...formData, username:event.target.value})}/></label>
            <fieldset className="admin-segmented"><legend>Acceso</legend><div className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={formData.role === 'admin'} onClick={() => setFormData({...formData,role:'admin'})}>Administrador</button>
              <button type="button" aria-pressed={formData.role === 'cashier'} onClick={() => setFormData({...formData,role:'cashier'})}>Cajero</button>
            </div></fieldset>
            <label className="admin-field">{modalMode === 'create' ? 'Contraseña' : 'Nueva contraseña'}<input type="password" data-dialog-autofocus={modalMode === 'edit' ? true : undefined} required={modalMode === 'create'} minLength={8} maxLength={128} aria-label={modalMode === 'create' ? 'Contraseña inicial' : 'Nueva contraseña opcional'} autoComplete="new-password" value={formData.password} onChange={event => setFormData({...formData,password:event.target.value})}/></label>
            <p className="admin-description">{modalMode === 'edit' ? 'Déjala vacía para conservar la actual. ' : ''}De 8 a 128 caracteres.</p>
            <details><summary>Imagen del usuario</summary><fieldset className="staff-avatar-picker" aria-label="Avatar"><legend className="sr-only">Avatar</legend><div>{staffAvatars.map(avatar => <button key={avatar.src} type="button" aria-label={'Elegir ' + avatar.label.toLowerCase()} aria-pressed={formData.avatar_url === avatar.src} onClick={() => setFormData({...formData,avatar_url:avatar.src})}>
              <StaffAvatar value={avatar.src} username="" size={48}/><span>{avatar.label}</span>{formData.avatar_url === avatar.src && <Check size={15} aria-hidden="true"/>}
            </button>)}</div></fieldset></details>
          </fieldset>
        </form>
      </AdminDialog>}

    </div>
  );
}
