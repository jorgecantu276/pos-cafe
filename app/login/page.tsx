'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { Coffee, Lock, ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  
  const [selectedUsername, setSelectedUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [showPass, setShowPass] = useState(false);
  
  const router = useRouter();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // 🟢 1. OBTENER USUARIOS DE LA BASE DE DATOS
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .order('full_name', { ascending: true });
          
        if (error) throw error;
        setUsers(data || []);
      } catch (err) {
        console.error("Error cargando perfiles:", err);
      } finally {
        setLoadingUsers(false);
      }
    };

    fetchProfiles();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUsername) {
      setError('Por favor selecciona un perfil primero.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // 🟢 2. RECONSTRUIR EL CORREO FANTASMA PARA EL LOGIN
      const fakeEmail = `${selectedUsername.replace(/\s+/g, '').toLowerCase()}@carinitomio.local`;

      const { error: signInError } = await supabase.auth.signInWithPassword({ 
        email: fakeEmail, 
        password 
      });
      
      if (signInError) throw signInError;
      
      router.refresh();
      router.push('/');
    } catch (err: any) {
      setError('Contraseña incorrecta. Verifica tu acceso.');
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

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex flex-col items-center justify-center p-4 font-sans antialiased selection:bg-[#0071e3]/20 relative overflow-hidden">
      
      <div className="w-full max-w-[480px] animate-in fade-in zoom-in-95 duration-700 ease-out z-10 pb-32">
        
        {/* LOGO SUPERIOR */}
        <div className="flex justify-center mb-8">
          <div className="w-16 h-16 bg-white rounded-[20px] shadow-sm flex items-center justify-center text-[#1d1d1f] border border-slate-100/50">
            <Coffee size={32} strokeWidth={1.5} />
          </div>
        </div>

        {/* TARJETA PRINCIPAL */}
        <div className="bg-white rounded-[40px] shadow-[0_20px_50px_rgba(0,0,0,0.06)] p-8 md:p-10 border border-slate-100">
          
          <div className="text-center space-y-1.5 mb-8">
            <h1 className="text-2xl font-bold text-[#1d1d1f] tracking-tight">Iniciar Turno</h1>
            <p className="text-[13px] font-medium text-[#86868b]">Selecciona tu perfil para comenzar.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            
            {/* 🟢 SELECTOR DE USUARIOS DINÁMICO */}
            <div className="flex justify-center flex-wrap gap-4 mb-6 min-h-[90px] items-center">
              {loadingUsers ? (
                <Loader2 className="animate-spin text-[#0071e3] w-6 h-6" />
              ) : users.length === 0 ? (
                <p className="text-sm text-slate-400">No hay usuarios registrados.</p>
              ) : (
                users.map((user) => (
                  <div 
                    key={user.id} 
                    onClick={() => handleUserSelect(user.username)}
                    className={`flex flex-col items-center gap-2 cursor-pointer transition-all duration-300 ${selectedUsername === user.username ? 'scale-110 opacity-100' : 'scale-100 opacity-50 hover:opacity-80'}`}
                  >
                    <div className={`w-16 h-16 rounded-full overflow-hidden border-4 shadow-sm transition-colors flex items-center justify-center bg-slate-50 ${selectedUsername === user.username ? 'border-[#0071e3]' : 'border-transparent'}`}>
                      {user.avatar_url ? (
                        <img src={user.avatar_url} alt={user.full_name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xl font-bold text-slate-400 uppercase">
                          {user.full_name?.charAt(0) || 'U'}
                        </span>
                      )}
                    </div>
                    <span className={`text-xs font-bold ${selectedUsername === user.username ? 'text-[#0071e3]' : 'text-slate-500'}`}>
                      {user.full_name.split(' ')[0]}
                    </span>
                  </div>
                ))
              )}
            </div>

            {error && (
              <div className="p-4 bg-[#ff3b30]/10 text-[#ff3b30] rounded-2xl text-[13px] font-semibold text-center animate-in shake">
                {error}
              </div>
            )}

            {/* 🟢 INPUT DE CONTRASEÑA */}
            <div className={`space-y-4 transition-all duration-500 ${selectedUsername ? 'opacity-100 h-auto' : 'opacity-50 pointer-events-none'}`}>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#86868b] group-focus-within:text-[#0071e3] transition-colors" />
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder={selectedUsername ? `Contraseña de ${selectedUser?.full_name.split(' ')[0]}` : 'Selecciona un usuario...'}
                  className="w-full border-2 rounded-[22px] py-4 pl-12 pr-12 text-sm font-medium outline-none transition-all text-[#1d1d1f] text-center tracking-widest bg-[#f5f5f7] border-transparent focus:border-[#0071e3] focus:bg-white focus:shadow-sm"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button 
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#86868b] hover:text-[#0071e3]"
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              <button
                type="submit"
                disabled={loading || !password}
                className="w-full bg-[#1d1d1f] text-white h-[60px] rounded-[22px] font-bold text-base shadow-xl hover:bg-black active:scale-[0.98] transition-all flex items-center justify-center gap-3 mt-4 disabled:opacity-50 disabled:shadow-none"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : (
                  <>Acceder <ArrowRight size={18} strokeWidth={2.5} /></>
                )}
              </button>
            </div>
          </form>
        </div>
        
        <p className="text-center text-[10px] font-bold text-[#86868b] mt-8 uppercase tracking-[0.3em] opacity-40">
          Mi Café OS • v2.0
        </p>
      </div>
    </div>
  );
}