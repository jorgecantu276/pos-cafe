'use client';

import Image from 'next/image';

import { type StaffProfile, errorMessage } from '@/lib/pos-types';

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import LoadFailure from '@/app/LoadFailure';
import { 
  ShieldCheck, Shield, Loader2, Trash2, UserPlus, 
  X, Image as ImageIcon, KeyRound, Save, Edit2, Coffee
} from 'lucide-react';

export default function UsuariosPage() {

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');

  const initialFormState = {
    id: '',
    full_name: '',
    username: '',
    password: '',
    role: 'barista',
    avatar_url: ''
  };

  const [formData, setFormData] = useState(initialFormState);

  const loadUsers = useCallback(async (signal: AbortSignal) => {
    const { data, error } = await supabase.from('profiles').select('id, full_name, username, role, avatar_url, is_active')
      .eq('is_active', true).order('full_name', { ascending: true }).abortSignal(signal);
    if (error) throw error;
    return (data || []) as StaffProfile[];
  }, []);
  const { data: users, setData: setUsers, loading, error: loadError, reload: fetchUsers } = useResource(loadUsers, []);


  const handleOpenModal = (mode: 'create' | 'edit', user?: StaffProfile) => {
    setModalMode(mode);
    if (mode === 'edit' && user) {
      setFormData({
        id: user.id,
        full_name: user.full_name || '',
        username: user.username || '',
        password: '', // Se deja en blanco por seguridad
        role: user.role || 'barista',
        avatar_url: user.avatar_url || ''
      });
    } else {
      setFormData(initialFormState);
    }
    setIsModalOpen(true);
  };

const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      if (modalMode === 'create') {
        // LÓGICA DE CREACIÓN: Enviamos los datos a nuestra nueva API
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        
      } else {
        const res = await fetch('/api/users', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...formData, is_active: true }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
      }

      await fetchUsers();
      setIsModalOpen(false);
    } catch (error: unknown) {
      alert("Error al guardar el usuario: " + errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetPassword = async () => {
    alert('La recuperación se realiza en Supabase Auth con el responsable. Esta pantalla todavía no cambia contraseñas.');
  };

  const handleDelete = async (id: string) => {
    if(!confirm('¿Desactivar este usuario? Se conservará su historial.')) return;
    try {
      const user = users.find(u => u.id === id);
      const res = await fetch('/api/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...user, is_active: false }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setUsers(users.filter(u => u.id !== id));
    } catch (error) {
      alert(error instanceof Error ? errorMessage(error) : 'No se pudo desactivar.');
    }
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
          <p className="text-[#86868b] text-lg font-medium">Gestiona permisos y accesos locales.</p>
        </div>
        <button 
          onClick={() => handleOpenModal('create')}
          className="bg-[#0071e3] text-white px-5 py-2.5 rounded-full text-[13px] font-semibold hover:bg-[#0077ed] transition-all active:scale-95 flex items-center gap-2 shadow-sm"
        >
          <UserPlus size={16} /> Crear Usuario
        </button>
      </header>

      {/* LISTA DE USUARIOS */}
      <div className="bg-white rounded-[28px] shadow-[0_8px_40px_rgba(0,0,0,0.04)] border border-slate-100/50 overflow-hidden">
        <div className="divide-y divide-slate-100">
          {users.map((user) => (
            <div key={user.id} className="p-6 md:p-8 flex items-center justify-between group transition-all hover:bg-[#f5f5f7]/40">
              
              <div className="flex items-center gap-6">
                <div className="relative">
                  {user.avatar_url ? (
                    <Image unoptimized width={64} height={64} src={user.avatar_url} alt={user.full_name} className="w-16 h-16 rounded-full object-cover shadow-sm border border-slate-200" />
                  ) : (
                    <div className="w-16 h-16 bg-gradient-to-b from-slate-50 to-slate-100 rounded-full flex items-center justify-center text-[#1d1d1f] font-semibold text-xl shadow-inner border border-slate-200/50 uppercase">
                      {user.full_name?.charAt(0) || 'U'}
                    </div>
                  )}
                  {user.role === 'admin' && (
                    <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full shadow-sm">
                      <ShieldCheck size={14} className="text-[#0071e3]" />
                    </div>
                  )}
                </div>
                
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <h4 className="font-semibold text-lg text-[#1d1d1f]">{user.full_name}</h4>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-tight uppercase ${
                      user.role === 'admin' ? 'bg-[#0071e3]/10 text-[#0071e3]' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {user.role === 'admin' ? 'ADMIN' : 'BARISTA'}
                    </span>
                  </div>
                  <p className="text-sm text-[#86868b] font-medium tracking-tight">@{user.username || 'usuario'}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button 
                  onClick={() => handleOpenModal('edit', user)}
                  className="px-4 py-2 rounded-full text-[13px] font-semibold transition-all border bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-[#0071e3] flex items-center gap-2"
                >
                  <Edit2 size={14} /> Editar
                </button>
                
                <button onClick={() => handleDelete(user.id)} className="p-2.5 text-slate-300 hover:bg-red-50 hover:text-[#ff3b30] rounded-full transition-all">
                   <Trash2 size={18} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* TARJETAS INFORMATIVAS DE ROLES */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-10">
        <div className="bg-[#f5f5f7] p-8 rounded-[24px] space-y-3 border border-slate-100/50">
           <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm text-[#0071e3]">
              <ShieldCheck size={20} />
           </div>
           <h5 className="font-semibold text-[#1d1d1f]">Administradores</h5>
           <p className="text-sm text-[#86868b] leading-relaxed font-medium">Control total. Pueden acceder a ventas, productos, cortes de caja, configuraciones y usuarios.</p>
        </div>
        <div className="bg-[#f5f5f7] p-8 rounded-[24px] space-y-3 border border-slate-100/50">
           <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm text-[#86868b]">
              <Shield size={20} />
           </div>
           <h5 className="font-semibold text-[#1d1d1f]">Barista</h5>
           <p className="text-sm text-[#86868b] leading-relaxed font-medium">Acceso exclusivo al Punto de Venta (POS). Pueden abrir turno, cobrar y emitir su Corte Z.</p>
        </div>
      </div>

      {/* MODAL DE CREACIÓN / EDICIÓN */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
            
            <div className="flex justify-between items-center p-6 md:p-8 border-b border-slate-50">
              <h3 className="text-2xl font-black italic tracking-tight text-slate-900">
                {modalMode === 'create' ? 'Nuevo Usuario' : 'Editar Usuario'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 bg-slate-100 rounded-full text-slate-400 hover:bg-slate-200 transition-colors">
                <X size={20}/>
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-6 md:p-8 space-y-6">
              
              {/* FILA 1: IMAGEN Y ROL */}
              <div className="flex gap-6 items-start">
                <div className="flex-shrink-0 flex flex-col items-center gap-3">
                  <div className="w-24 h-24 rounded-full bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden relative group">
                    {formData.avatar_url ? (
                      <Image unoptimized width={64} height={64} src={formData.avatar_url} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="text-slate-300" size={32} />
                    )}
                  </div>
                </div>
                
                <div className="flex-1 space-y-4">
                  <div>
                    <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest block mb-2">URL de Imagen (Opcional)</label>
                    <input 
                      type="url" 
                      placeholder="https://ejemplo.com/foto.jpg" 
                      className="w-full bg-[#f5f5f7] border border-transparent focus:border-[#0071e3]/30 rounded-xl px-4 py-3 text-sm font-medium outline-none transition-all"
                      value={formData.avatar_url}
                      onChange={e => setFormData({...formData, avatar_url: e.target.value})}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest block mb-2">Nivel de Acceso</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        type="button"
                        onClick={() => setFormData({...formData, role: 'admin'})}
                        className={`p-3 rounded-xl border-2 font-bold text-sm transition-all flex items-center justify-center gap-2 ${formData.role === 'admin' ? 'border-[#0071e3] text-[#0071e3] bg-blue-50/50' : 'border-slate-100 text-slate-500 bg-white hover:border-slate-200'}`}
                      >
                        <ShieldCheck size={16} /> Admin
                      </button>
                      <button 
                        type="button"
                        onClick={() => setFormData({...formData, role: 'barista'})}
                        className={`p-3 rounded-xl border-2 font-bold text-sm transition-all flex items-center justify-center gap-2 ${formData.role === 'barista' ? 'border-[#1d1d1f] text-[#1d1d1f] bg-slate-50' : 'border-slate-100 text-slate-500 bg-white hover:border-slate-200'}`}
                      >
                        <Coffee size={16} /> Barista
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* FILA 2: DATOS PERSONALES */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-50 pt-6">
                <div>
                  <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest block mb-2">Nombre Completo</label>
                  <input 
                    type="text" 
                    required
                    placeholder="Ej. Juan Pérez" 
                    className="w-full bg-white border border-slate-200 focus:border-[#0071e3]/40 rounded-xl px-4 py-3 text-sm font-semibold outline-none transition-all shadow-sm"
                    value={formData.full_name}
                    onChange={e => setFormData({...formData, full_name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest block mb-2">Usuario / Alias</label>
                  <input 
                    type="text" 
                    required
                    placeholder="Ej. juan.barista" 
                    className="w-full bg-white border border-slate-200 focus:border-[#0071e3]/40 rounded-xl px-4 py-3 text-sm font-semibold outline-none transition-all shadow-sm"
                    value={formData.username}
                    disabled={modalMode === 'edit'}
                    onChange={e => setFormData({...formData, username: e.target.value})}
                  />
                </div>
              </div>

              {/* FILA 3: CONTRASEÑA */}
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-[#1d1d1f]">
                    <KeyRound size={18} />
                    <span className="font-bold text-sm">Seguridad</span>
                  </div>
                  {modalMode === 'edit' && (
                    <button 
                      type="button"
                      onClick={handleResetPassword}
                      className="text-[11px] font-black uppercase tracking-widest text-[#0071e3] hover:text-[#0077ed] bg-[#0071e3]/10 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Restablecer
                    </button>
                  )}
                </div>
                
                <input 
                  type="password" 
                  required={modalMode === 'create'}
                  placeholder={modalMode === 'create' ? "Asignar contraseña inicial" : "Ingresa nueva para cambiarla (opcional)"}
                  className="w-full bg-white border border-slate-200 focus:border-[#0071e3]/40 rounded-xl px-4 py-3 text-sm font-semibold outline-none transition-all shadow-sm"
                  value={formData.password}
                  onChange={e => setFormData({...formData, password: e.target.value})}
                />
                {modalMode === 'edit' && (
                  <p className="text-[11px] text-slate-400 font-medium mt-2">Deja en blanco si no deseas cambiar la contraseña actual.</p>
                )}
              </div>

              {/* BOTONES */}
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)} 
                  className="flex-1 bg-slate-100 text-slate-600 h-14 rounded-[20px] font-bold hover:bg-slate-200 transition-all"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 bg-[#1d1d1f] text-white h-14 rounded-[20px] font-bold shadow-xl shadow-slate-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex justify-center items-center gap-2"
                >
                  {isSaving ? <Loader2 className="animate-spin" /> : <><Save size={20} /> Guardar Usuario</>}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}
