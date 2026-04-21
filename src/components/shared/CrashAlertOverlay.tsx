/**
 * CrashAlertOverlay — fullscreen overlay shown when a crash is detected.
 *
 * Reads from useCrashStore (set by CrashDetectionService).
 * Shows a 30s countdown, trigger type, GPS coords, and a big "ESTOU BEM" button.
 * When countdown reaches 0, shows SOS confirmation.
 */

import { useCrashStore, type CrashTrigger } from '../../services/emergency/CrashDetectionService';
import { cancelCrashAlert } from '../../services/emergency/CrashDetectionService';

const TRIGGER_LABELS: Record<CrashTrigger, string> = {
  impact: 'Impacto forte detectado',
  sudden_stop: 'Paragem subita sem sinais vitais',
  hr_anomaly: 'Anomalia cardiaca detectada',
};

export function CrashAlertOverlay() {
  const alert = useCrashStore((s) => s.alert);

  if (!alert || !alert.active) return null;

  const sosSent = alert.countdownSeconds <= 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        backgroundColor: sosSent ? '#1a0000' : '#cc0000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        transition: 'background-color 0.5s ease',
      }}
    >
      {/* Header */}
      <div style={{ fontSize: '18px', fontWeight: 900, color: 'white', letterSpacing: '0.15em', marginBottom: '8px' }}>
        ACIDENTE DETECTADO
      </div>

      {/* Trigger description */}
      <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)', marginBottom: '24px', textAlign: 'center' }}>
        {TRIGGER_LABELS[alert.trigger]}
      </div>

      {/* Countdown or SOS sent */}
      {!sosSent ? (
        <>
          <div
            style={{
              fontSize: '120px',
              fontWeight: 900,
              color: 'white',
              lineHeight: 1,
              textShadow: '0 0 40px rgba(255,255,255,0.5)',
              marginBottom: '8px',
            }}
          >
            {alert.countdownSeconds}
          </div>
          <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.9)', marginBottom: '32px' }}>
            SOS sera enviado em {alert.countdownSeconds}s
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              fontSize: '48px',
              fontWeight: 900,
              color: '#fbbf24',
              marginBottom: '8px',
              textShadow: '0 0 20px rgba(251,191,36,0.5)',
            }}
          >
            SOS ENVIADO
          </div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)', marginBottom: '32px', textAlign: 'center' }}>
            Contactos de emergencia foram notificados com a tua localizacao.
          </div>
        </>
      )}

      {/* ESTOU BEM button */}
      <button
        onClick={cancelCrashAlert}
        style={{
          width: '100%',
          maxWidth: '320px',
          height: '80px',
          backgroundColor: '#3fff8b',
          color: '#000',
          border: 'none',
          borderRadius: '12px',
          fontSize: '24px',
          fontWeight: 900,
          cursor: 'pointer',
          letterSpacing: '0.05em',
          boxShadow: '0 4px 24px rgba(63,255,139,0.4)',
        }}
      >
        ESTOU BEM
      </button>

      {/* GPS coordinates */}
      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '24px', fontFamily: 'monospace' }}>
        GPS: {alert.position.lat.toFixed(6)}, {alert.position.lng.toFixed(6)}
      </div>
    </div>
  );
}
