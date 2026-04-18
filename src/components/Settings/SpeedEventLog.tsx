import { useState, useMemo } from 'react';
import { kromiEngine } from '../../services/intelligence/KromiEngine';

/**
 * SpeedEventLog — shows speed compliance events for the current ride.
 *
 * Visible only inside Settings -> Super Admin panel. Lists each speed
 * exceed event with timestamp, duration, speed, and optional location.
 * Includes CSV export for compliance reporting.
 */
export function SpeedEventLog() {
  const [events, setEvents] = useState(() => kromiEngine.getSpeedEventLog());

  const refresh = () => setEvents(kromiEngine.getSpeedEventLog());

  const csvContent = useMemo(() => {
    if (events.length === 0) return '';
    const header = 'timestamp,speed_kmh,duration_s,lat,lng,assist_active';
    const rows = events.map((e) =>
      [
        new Date(e.timestamp).toISOString(),
        e.speed_kmh.toFixed(1),
        e.duration_s.toFixed(1),
        e.location?.lat.toFixed(6) ?? '',
        e.location?.lng.toFixed(6) ?? '',
        e.assistActive ? 'true' : 'false',
      ].join(',')
    );
    return [header, ...rows].join('\n');
  }, [events]);

  const downloadCsv = () => {
    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `speed-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="font-label" style={{
          fontSize: '9px', color: '#777575', textTransform: 'uppercase',
          letterSpacing: '0.12em', paddingLeft: '4px',
        }}>
          SPEED COMPLIANCE LOG
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={refresh}
            style={{
              padding: '4px 10px', fontSize: '10px', color: '#3fff8b',
              backgroundColor: '#262626', border: '1px solid rgba(63,255,139,0.3)',
              cursor: 'pointer',
            }}
          >
            Atualizar
          </button>
          {events.length > 0 && (
            <button
              onClick={downloadCsv}
              style={{
                padding: '4px 10px', fontSize: '10px', color: '#6e9bff',
                backgroundColor: '#262626', border: '1px solid rgba(110,155,255,0.3)',
                cursor: 'pointer',
              }}
            >
              Exportar CSV
            </button>
          )}
        </div>
      </div>

      {events.length === 0 ? (
        <div style={{
          padding: '24px', textAlign: 'center', color: '#777575',
          backgroundColor: '#1a1919', fontSize: '12px',
        }}>
          Sem eventos de velocidade registados nesta sessao.
        </div>
      ) : (
        <div style={{ backgroundColor: '#1a1919', padding: '8px' }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 60px 60px 60px',
            gap: '4px', fontSize: '9px', color: '#777575',
            fontWeight: 600, marginBottom: '4px', padding: '4px',
          }}>
            <div>Hora</div>
            <div style={{ textAlign: 'right' }}>Vel.</div>
            <div style={{ textAlign: 'right' }}>Dur.</div>
            <div style={{ textAlign: 'center' }}>Assist</div>
          </div>
          {/* Rows */}
          <div style={{ maxHeight: '300px', overflow: 'auto' }}>
            {events.map((e, i) => (
              <div
                key={i}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 60px 60px 60px',
                  gap: '4px', fontSize: '11px', padding: '6px 4px',
                  borderTop: '1px solid rgba(73,72,71,0.15)',
                }}
              >
                <div style={{ color: '#adaaaa' }}>
                  {new Date(e.timestamp).toLocaleTimeString('pt-PT')}
                </div>
                <div className="tabular-nums" style={{
                  textAlign: 'right', fontWeight: 700,
                  color: e.speed_kmh > 30 ? '#ff716c' : '#fbbf24',
                }}>
                  {e.speed_kmh.toFixed(1)}
                </div>
                <div className="tabular-nums" style={{ textAlign: 'right', color: '#adaaaa' }}>
                  {e.duration_s.toFixed(0)}s
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{
                    fontSize: '9px', padding: '2px 6px',
                    backgroundColor: e.assistActive ? 'rgba(255,113,108,0.15)' : 'rgba(63,255,139,0.1)',
                    color: e.assistActive ? '#ff716c' : '#3fff8b',
                  }}>
                    {e.assistActive ? 'SIM' : 'NAO'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: '9px', color: '#494847', paddingLeft: '4px' }}>
        Eventos: velocidade superior ao limite regional durante a sessao atual.
      </div>
    </div>
  );
}
