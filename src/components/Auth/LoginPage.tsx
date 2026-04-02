import { useState } from 'react';
import { sendOTP, verifyOTP, registerDevice } from '../../services/auth/AuthService';
import { useAuthStore } from '../../store/authStore';

type Step = 'email' | 'otp' | 'loading';

export function LoginPage() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const setSession = useAuthStore((s) => s.setSession);

  const handleSendOTP = async () => {
    if (!email.includes('@')) { setError('Email invalido'); return; }
    setError(null);
    setStep('loading');
    const result = await sendOTP(email);
    if (result.success) { setStep('otp'); }
    else { setError(result.error ?? 'Erro ao enviar codigo'); setStep('email'); }
  };

  const handleVerifyOTP = async () => {
    if (otp.length !== 6) { setError('Codigo deve ter 6 digitos'); return; }
    setError(null);
    setStep('loading');
    const result = await verifyOTP(email, otp);
    if (result.success && result.user && result.session_token && result.expires_at) {
      setSession(result.user, result.session_token, result.expires_at);
      registerDevice(result.user);
    } else { setError(result.error ?? 'Codigo invalido'); setStep('otp'); }
  };

  return (
    <div className="h-full flex items-center justify-center bg-[#0e0e0e] p-6 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] bg-[#0058ca]/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#3fff8b]/5 blur-[100px] rounded-full" />
      </div>

      <main className="relative z-10 w-full max-w-sm flex flex-col items-center gap-12">
        {/* Branding */}
        <header className="flex flex-col items-center text-center">
          <div className="mb-6 inline-flex items-center justify-center w-20 h-20 bg-[#201f1f] shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-tr from-[#3fff8b]/20 to-[#6e9bff]/10" />
            <span className="material-symbols-outlined text-[#3fff8b] text-4xl">pedal_bike</span>
            <div className="absolute bottom-0 left-0 w-full h-1 bg-[#3fff8b]" />
          </div>
          <h1 className="font-headline font-bold text-4xl tracking-tighter text-white uppercase">
            BIKECONTROL
          </h1>
          <p className="font-body text-sm text-[#777575] mt-2 tracking-wide uppercase">
            Giant eBike Command Center
          </p>
        </header>

        {/* Form */}
        <section className="w-full space-y-4">
          {step === 'email' && (
            <>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                  <span className="material-symbols-outlined text-[#777575] group-focus-within:text-[#3fff8b] transition-colors">alternate_email</span>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendOTP()}
                  placeholder="O teu email"
                  autoFocus
                  className="w-full h-14 pl-12 pr-4 bg-[#201f1f] border-none text-white font-body placeholder:text-[#777575]/60 focus:ring-2 focus:ring-[#3fff8b]/50 transition-all outline-none"
                />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-[2px] bg-[#3fff8b] group-focus-within:w-full transition-all duration-300" />
              </div>
              <button
                onClick={handleSendOTP}
                className="w-full h-14 bg-[#0058ca] hover:bg-[#6e9bff] text-white font-headline font-bold text-lg shadow-[0_8px_16px_rgba(14,109,243,0.2)] active:scale-95 transition-all flex items-center justify-center gap-2 group"
              >
                <span>Enviar codigo</span>
                <span className="material-symbols-outlined text-xl group-hover:translate-x-1 transition-transform">arrow_forward</span>
              </button>
            </>
          )}

          {step === 'otp' && (
            <>
              <p className="text-[#adaaaa] text-sm text-center">
                Codigo enviado para <span className="text-white font-bold">{email}</span>
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyOTP()}
                placeholder="000000"
                autoFocus
                className="w-full h-16 bg-[#201f1f] text-white px-4 text-3xl text-center tracking-[0.5em] font-headline font-bold placeholder:text-[#777575]/40 focus:ring-2 focus:ring-[#3fff8b]/50 outline-none tabular-nums"
              />
              <button
                onClick={handleVerifyOTP}
                className="w-full h-14 bg-[#3fff8b] text-black font-headline font-bold text-lg active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <span>Entrar</span>
                <span className="material-symbols-outlined text-xl">login</span>
              </button>
              <button
                onClick={() => { setStep('email'); setOtp(''); setError(null); }}
                className="w-full text-[#adaaaa] text-sm py-2 hover:text-white transition-colors"
              >
                Mudar email
              </button>
            </>
          )}

          {step === 'loading' && (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-[#3fff8b] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-[#adaaaa] text-sm mt-4 font-label uppercase tracking-widest">A processar...</p>
            </div>
          )}

          {error && (
            <div className="bg-[#ff716c]/10 border border-[#ff716c]/30 text-[#ff716c] px-4 py-3 text-sm text-center font-body">
              {error}
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="text-center space-y-6">
          <p className="font-body text-xs text-[#777575] leading-relaxed max-w-[200px] mx-auto">
            Sem password. Recebes um codigo por email.
          </p>
          <div className="flex items-center justify-center gap-8">
            <div className="flex flex-col items-center">
              <span className="font-headline text-[10px] text-[#494847] uppercase tracking-[0.2em]">Sync</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#3fff8b] mt-1 shadow-[0_0_8px_rgba(63,255,139,0.6)]" />
            </div>
            <div className="h-8 w-px bg-[#494847]/20" />
            <div className="flex flex-col items-center">
              <span className="font-headline text-[10px] text-[#494847] uppercase tracking-[0.2em]">Secure</span>
              <span className="material-symbols-outlined text-[#494847] text-xs mt-1" style={{ fontVariationSettings: "'FILL' 1" }}>lock</span>
            </div>
            <div className="h-8 w-px bg-[#494847]/20" />
            <div className="flex flex-col items-center">
              <span className="font-headline text-[10px] text-[#494847] uppercase tracking-[0.2em]">v0.9.4</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#6e9bff] mt-1" />
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
