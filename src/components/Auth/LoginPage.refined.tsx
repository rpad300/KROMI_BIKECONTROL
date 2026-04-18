import { useState } from 'react';
import { sendOTP, verifyOTP, registerDevice } from '../../services/auth/AuthService';
import { useAuthStore } from '../../store/authStore';

declare const __APP_VERSION__: string;

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
      setSession(
        result.user,
        result.session_token,
        result.expires_at,
        result.jwt ?? null,
        result.jwt_expires_at ?? null,
      );
      if (result.jwt) {
        void registerDevice(result.user, result.jwt);
      }
    } else { setError(result.error ?? 'Codigo invalido'); setStep('otp'); }
  };

  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

  return (
    <div className="h-full flex items-center justify-center p-6 relative overflow-hidden"
         style={{ backgroundColor: 'var(--ev-bg)' }}>

      {/* Background glow — subtle radial blurs in corners */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] blur-[120px] rounded-full"
             style={{ backgroundColor: 'rgba(0, 88, 202, 0.08)' }} />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] blur-[100px] rounded-full"
             style={{ backgroundColor: 'rgba(63, 255, 139, 0.04)' }} />
      </div>

      <main className="relative z-10 w-full max-w-sm flex flex-col items-center gap-10">

        {/* ── Brand ── */}
        <header className="flex flex-col items-center text-center">
          {/* Icon box */}
          <div className="mb-5 inline-flex items-center justify-center w-16 h-16 relative overflow-hidden"
               style={{ backgroundColor: 'var(--ev-surface-high)' }}>
            <div className="absolute inset-0"
                 style={{ background: 'linear-gradient(135deg, var(--ev-primary-glow), rgba(110,155,255,0.08))' }} />
            <span className="material-symbols-outlined text-3xl" style={{ color: 'var(--ev-primary)' }}>
              electric_bike
            </span>
            <div className="absolute bottom-0 left-0 w-full h-0.5" style={{ backgroundColor: 'var(--ev-primary)' }} />
          </div>

          {/* Brand name — JetBrains Mono for the refined look */}
          <h1 className="font-mono font-bold text-3xl tracking-[-0.04em] uppercase"
              style={{ color: 'var(--ev-on-surface)' }}>
            STEALTH-EV
          </h1>
          <p className="text-eyebrow mt-2" style={{ color: 'var(--ev-on-surface-muted)' }}>
            BIKECONTROL
          </p>
        </header>

        {/* ── Form ── */}
        <section className="w-full space-y-3">

          {step === 'email' && (
            <>
              {/* Email input */}
              <div className="relative group">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  <span className="material-symbols-outlined text-lg transition-colors"
                        style={{ color: 'var(--ev-on-surface-muted)' }}>
                    alternate_email
                  </span>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendOTP()}
                  placeholder="O teu email"
                  autoFocus
                  className="w-full h-12 pl-10 pr-4 border-none font-body text-sm outline-none
                             placeholder:opacity-40 transition-all
                             focus:ring-2 focus:ring-[color:var(--ev-primary)]/30"
                  style={{
                    backgroundColor: 'var(--ev-surface-high)',
                    color: 'var(--ev-on-surface)',
                  }}
                />
                {/* Animated underline on focus */}
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-[2px] transition-all duration-300
                                group-focus-within:w-full"
                     style={{ backgroundColor: 'var(--ev-primary)' }} />
              </div>

              {/* Submit CTA */}
              <button
                onClick={handleSendOTP}
                className="w-full h-12 font-display font-bold text-sm uppercase tracking-wider
                           active:scale-95 transition-all flex items-center justify-center gap-2 group shadow-cta"
                style={{
                  backgroundColor: 'var(--ev-secondary-container)',
                  color: 'var(--ev-on-surface)',
                }}
              >
                <span>Enviar codigo</span>
                <span className="material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform">
                  arrow_forward
                </span>
              </button>
            </>
          )}

          {step === 'otp' && (
            <>
              <p className="text-xs text-center font-body" style={{ color: 'var(--ev-on-surface-variant)' }}>
                Codigo enviado para{' '}
                <span className="font-bold" style={{ color: 'var(--ev-on-surface)' }}>{email}</span>
              </p>

              {/* OTP input — large mono digits */}
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyOTP()}
                placeholder="000000"
                autoFocus
                className="w-full h-14 px-4 text-2xl text-center tracking-[0.5em] font-mono font-bold
                           placeholder:opacity-30 tabular-nums outline-none
                           focus:ring-2 focus:ring-[color:var(--ev-primary)]/30"
                style={{
                  backgroundColor: 'var(--ev-surface-high)',
                  color: 'var(--ev-on-surface)',
                }}
              />

              {/* Verify CTA — primary mint */}
              <button
                onClick={handleVerifyOTP}
                className="w-full h-12 font-display font-bold text-sm uppercase tracking-wider
                           active:scale-95 transition-all flex items-center justify-center gap-2"
                style={{
                  backgroundColor: 'var(--ev-primary)',
                  color: '#000000',
                }}
              >
                <span>Entrar</span>
                <span className="material-symbols-outlined text-lg">login</span>
              </button>

              {/* Back to email */}
              <button
                onClick={() => { setStep('email'); setOtp(''); setError(null); }}
                className="w-full text-xs py-2 transition-colors font-body"
                style={{ color: 'var(--ev-on-surface-variant)' }}
              >
                Mudar email
              </button>
            </>
          )}

          {step === 'loading' && (
            <div className="text-center py-8">
              <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin mx-auto"
                   style={{ borderColor: 'var(--ev-primary)', borderTopColor: 'transparent' }} />
              <p className="text-label mt-4" style={{ color: 'var(--ev-on-surface-variant)' }}>
                A processar...
              </p>
            </div>
          )}

          {error && (
            <div className="px-4 py-2.5 text-xs text-center font-body"
                 style={{
                   backgroundColor: 'rgba(255, 113, 108, 0.08)',
                   borderLeft: '2px solid var(--ev-error)',
                   color: 'var(--ev-error)',
                 }}>
              {error}
            </div>
          )}
        </section>

        {/* ── Footer ── */}
        <footer className="text-center space-y-5">
          <p className="font-body text-[10px] leading-relaxed max-w-[200px] mx-auto"
             style={{ color: 'var(--ev-on-surface-muted)' }}>
            Sem password. Recebes um codigo por email.
          </p>

          {/* Status indicators */}
          <div className="flex items-center justify-center gap-6">
            <StatusDot label="Sync" color="var(--ev-primary)" glow />
            <div className="h-6 w-px" style={{ backgroundColor: 'var(--ev-outline-subtle)' }} />
            <StatusIcon label="Secure" icon="lock" />
            <div className="h-6 w-px" style={{ backgroundColor: 'var(--ev-outline-subtle)' }} />
            <StatusDot label={version} color="var(--ev-secondary)" />
          </div>
        </footer>
      </main>
    </div>
  );
}

function StatusDot({ label, color, glow }: { label: string; color: string; glow?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-eyebrow" style={{ color: 'var(--ev-outline-variant)' }}>{label}</span>
      <span className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: color,
              boxShadow: glow ? `0 0 8px ${color}` : 'none',
            }} />
    </div>
  );
}

function StatusIcon({ label, icon }: { label: string; icon: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-eyebrow" style={{ color: 'var(--ev-outline-variant)' }}>{label}</span>
      <span className="material-symbols-outlined text-xs"
            style={{ color: 'var(--ev-outline-variant)', fontVariationSettings: "'FILL' 1" }}>
        {icon}
      </span>
    </div>
  );
}
