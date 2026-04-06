// ═══════════════════════════════════════════════════════════
// ImpersonationBanner — persistent top bar during impersonation
// ═══════════════════════════════════════════════════════════
//
// Renders fixed at the top of the app whenever the auth store is
// in impersonation mode. Provides a clear "Stop" button so admins
// can never accidentally forget they're acting as another user.

import { useAuthStore } from '../../store/authStore';

export function ImpersonationBanner() {
  const realUser = useAuthStore((s) => s.realUser);
  const impersonated = useAuthStore((s) => s.impersonatedUser);
  const endImpersonation = useAuthStore((s) => s.endImpersonation);

  if (!impersonated || !realUser) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      backgroundColor: '#ff9f43',
      color: '#0e0e0e',
      padding: '6px 12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: '11px',
      fontWeight: 700,
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>visibility</span>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontWeight: 800 }}>A ver como:</span>{' '}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {impersonated.name ?? impersonated.email}
          </span>
        </div>
      </div>
      <button
        onClick={() => void endImpersonation()}
        style={{
          padding: '4px 10px',
          backgroundColor: '#0e0e0e',
          color: '#ff9f43',
          border: '1px solid #0e0e0e',
          borderRadius: '3px',
          fontSize: '10px',
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          flexShrink: 0,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>logout</span>
        Sair
      </button>
    </div>
  );
}
