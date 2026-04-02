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
    if (!email.includes('@')) {
      setError('Email invalido');
      return;
    }
    setError(null);
    setStep('loading');

    const result = await sendOTP(email);
    if (result.success) {
      setStep('otp');
    } else {
      setError(result.error ?? 'Erro ao enviar codigo');
      setStep('email');
    }
  };

  const handleVerifyOTP = async () => {
    if (otp.length !== 6) {
      setError('Codigo deve ter 6 digitos');
      return;
    }
    setError(null);
    setStep('loading');

    const result = await verifyOTP(email, otp);
    if (result.success && result.user && result.session_token && result.expires_at) {
      setSession(result.user, result.session_token, result.expires_at);
      // Register this device for auto-login next time
      registerDevice(result.user);
    } else {
      setError(result.error ?? 'Codigo invalido');
      setStep('otp');
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center bg-gray-950 px-6">
      {/* Logo area */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-white">BikeControl</h1>
        <p className="text-gray-500 text-sm mt-2">Giant eBike Command Center</p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        {/* Email step */}
        {step === 'email' && (
          <>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendOTP()}
              placeholder="O teu email"
              autoFocus
              className="w-full h-14 bg-gray-800 text-white rounded-xl px-4 text-lg placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <button
              onClick={handleSendOTP}
              className="w-full h-14 bg-blue-600 text-white rounded-xl font-bold text-lg active:scale-95 transition-transform"
            >
              Enviar codigo
            </button>
          </>
        )}

        {/* OTP step */}
        {step === 'otp' && (
          <>
            <p className="text-gray-400 text-sm text-center">
              Codigo enviado para <span className="text-white">{email}</span>
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
              className="w-full h-16 bg-gray-800 text-white rounded-xl px-4 text-3xl text-center tracking-[0.5em] font-bold placeholder-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none tabular-nums"
            />
            <button
              onClick={handleVerifyOTP}
              className="w-full h-14 bg-green-600 text-white rounded-xl font-bold text-lg active:scale-95 transition-transform"
            >
              Entrar
            </button>
            <button
              onClick={() => { setStep('email'); setOtp(''); setError(null); }}
              className="w-full text-gray-500 text-sm py-2"
            >
              Mudar email
            </button>
          </>
        )}

        {/* Loading */}
        {step === 'loading' && (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-gray-400 text-sm mt-4">A processar...</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-xl px-4 py-3 text-sm text-center">
            {error}
          </div>
        )}
      </div>

      <p className="text-gray-700 text-xs mt-10">
        Sem password. Recebes um codigo por email.
      </p>
    </div>
  );
}
