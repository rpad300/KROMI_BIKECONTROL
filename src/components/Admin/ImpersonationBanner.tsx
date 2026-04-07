// ═══════════════════════════════════════════════════════════
// ImpersonationBanner — persistent top bar during impersonation
// ═══════════════════════════════════════════════════════════
//
// Renders fixed at the top of the app whenever the auth store is
// in impersonation mode. Provides a clear "Stop" button so admins
// can never accidentally forget they're acting as another user.

import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { subscribeReadOnlyToasts } from '../../hooks/useReadOnlyGuard';

export function ImpersonationBanner() {
  const realUser = useAuthStore((s) => s.realUser);
  const impersonated = useAuthStore((s) => s.impersonatedUser);
  const readOnly = useAuthStore((s) => s.impersonationReadOnly);
  const endImpersonation = useAuthStore((s) => s.endImpersonation);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    return subscribeReadOnlyToasts((msg) => {
      setToast(msg);
      window.setTimeout(() => setToast(null), 3500);
    });
  }, []);

  if (!impersonated || !realUser) return null;

  return (
    <>
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
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span>
              <span style={{ fontWeight: 800 }}>A ver como:</span>{' '}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {impersonated.name ?? impersonated.email}
              </span>
            </span>
            {readOnly && (
              <span style={{ fontSize: '9px', fontWeight: 600, opacity: 0.75 }}>
                (somente leitura)
              </span>
            )}
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

      {/* Read-only blocked-action toast (auto-dismiss) */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: '44px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10000,
          backgroundColor: '#0e0e0e',
          color: '#ff9f43',
          border: '1px solid #ff9f43',
          padding: '8px 14px',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 600,
          maxWidth: '90vw',
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>lock</span>
          {toast}
        </div>
      )}
    </>
  );
}
