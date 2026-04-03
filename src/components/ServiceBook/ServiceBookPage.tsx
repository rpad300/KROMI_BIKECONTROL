import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import { useServiceStore } from '../../store/serviceStore';
import {
  getServicesForBike, getBikeServiceStats, type BikeServiceStats,
} from '../../services/maintenance/MaintenanceService';
import { NewServicePage } from './NewServicePage';
import { ServiceDetailPage } from './ServiceDetailPage';
import { MaintenancePage } from './MaintenancePage';
import { ShopSearchPage } from './ShopSearchPage';
import { BikeQRDisplay } from '../shared/BikeQRCode';
import {
  SERVICE_STATUS_LABELS, SERVICE_STATUS_COLORS,
  SERVICE_TYPE_LABELS, URGENCY_COLORS,
  type ServiceRequest,
} from '../../types/service.types';

type SubPage = 'list' | 'new' | 'detail' | 'maintenance' | 'shops' | 'qr';

export function ServiceBookPage() {
  const userId = useAuthStore((s) => s.user?.id);
  const bikes = useSettingsStore((s) => s.bikes);
  const activeBikeId = useSettingsStore((s) => s.activeBikeId);
  const { services, setServices, setLoading, loading } = useServiceStore();

  const [selectedBikeId, setSelectedBikeId] = useState(activeBikeId);
  const [page, setPage] = useState<SubPage>('list');
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [stats, setStats] = useState<BikeServiceStats | null>(null);

  const bike = safeBikeConfig(bikes.find((b) => b.id === selectedBikeId));

  const loadServices = useCallback(async () => {
    if (!selectedBikeId) return;
    setLoading(true);
    const data = await getServicesForBike(selectedBikeId);
    setServices(data);
    if (userId) {
      const s = await getBikeServiceStats(selectedBikeId, userId);
      setStats(s);
    }
    setLoading(false);
  }, [selectedBikeId, userId, setServices, setLoading]);

  useEffect(() => { loadServices(); }, [loadServices]);

  if (page === 'new') {
    return <NewServicePage bikeId={selectedBikeId} onBack={() => { setPage('list'); loadServices(); }} />;
  }
  if (page === 'detail' && selectedServiceId) {
    return <ServiceDetailPage serviceId={selectedServiceId} onBack={() => { setPage('list'); loadServices(); }} />;
  }
  if (page === 'maintenance') {
    return <MaintenancePage bikeId={selectedBikeId} onBack={() => setPage('list')} />;
  }
  if (page === 'shops') {
    return <ShopSearchPage onSelectShop={() => setPage('new')} onBack={() => setPage('list')} />;
  }
  if (page === 'qr') {
    return (
      <div className="space-y-3">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => setPage('list')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '22px', color: '#adaaaa' }}>arrow_back</span>
          </button>
          <div className="font-headline font-bold" style={{ fontSize: '16px', color: '#ff9f43' }}>QR Code</div>
        </div>
        <BikeQRDisplay bikeId={selectedBikeId} />
      </div>
    );
  }

  const bikeServices = services.filter((s) => s.bike_id === selectedBikeId);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 className="font-headline font-bold text-lg" style={{ color: '#ff9f43' }}>Caderneta de Serviço</h2>
          <div style={{ fontSize: '10px', color: '#777575' }}>{bike.name}</div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={() => setPage('maintenance')} style={{
            display: 'flex', alignItems: 'center', gap: '3px', padding: '5px 8px',
            backgroundColor: 'rgba(255,159,67,0.1)', border: '1px solid rgba(255,159,67,0.2)',
            borderRadius: '4px', color: '#ff9f43', fontSize: '9px', fontWeight: 700, cursor: 'pointer',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>schedule</span>
            Agenda
          </button>
          <button onClick={() => setPage('shops')} style={{
            display: 'flex', alignItems: 'center', gap: '3px', padding: '5px 8px',
            backgroundColor: 'rgba(110,155,255,0.1)', border: '1px solid rgba(110,155,255,0.2)',
            borderRadius: '4px', color: '#6e9bff', fontSize: '9px', fontWeight: 700, cursor: 'pointer',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>store</span>
            Oficinas
          </button>
          <button onClick={() => setPage('qr')} style={{
            display: 'flex', alignItems: 'center', gap: '3px', padding: '5px 8px',
            backgroundColor: 'rgba(233,102,255,0.1)', border: '1px solid rgba(233,102,255,0.2)',
            borderRadius: '4px', color: '#e966ff', fontSize: '9px', fontWeight: 700, cursor: 'pointer',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>qr_code</span>
            QR
          </button>
        </div>
      </div>

      {/* Bike selector */}
      {bikes.length > 1 && (
        <select value={selectedBikeId} onChange={(e) => setSelectedBikeId(e.target.value)} style={{
          width: '100%', padding: '8px', backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.3)',
          borderRadius: '4px', color: 'white', fontSize: '12px', outline: 'none',
        }}>
          {bikes.map((b) => (
            <option key={b.id} value={b.id}>{safeBikeConfig(b).name}</option>
          ))}
        </select>
      )}

      {/* Stats bar */}
      {stats && stats.total_services > 0 && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <StatBox label="Serviços" value={String(stats.total_services)} color="#ff9f43" />
          <StatBox label="Total gasto" value={`${stats.total_cost.toFixed(0)}€`} color="#ff716c" />
          <StatBox label="Peças" value={`${stats.total_parts.toFixed(0)}€`} color="#6e9bff" />
          <StatBox label="Mão-de-obra" value={`${stats.total_labor.toFixed(0)}€`} color="#e966ff" />
        </div>
      )}

      {/* New service button */}
      <button onClick={() => setPage('new')} style={{
        width: '100%', padding: '12px', backgroundColor: 'rgba(255,159,67,0.1)',
        border: '1px dashed rgba(255,159,67,0.3)', borderRadius: '6px',
        color: '#ff9f43', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add_circle</span>
        Novo Serviço
      </button>

      {/* Service list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-[#ff9f43] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : bikeServices.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', backgroundColor: '#131313', borderRadius: '6px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '36px', color: '#494847' }}>build</span>
          <p style={{ fontSize: '12px', color: '#777575', marginTop: '8px' }}>Sem serviços registados para esta bike.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {bikeServices.map((svc) => (
            <ServiceCard
              key={svc.id}
              service={svc}
              onClick={() => { setSelectedServiceId(svc.id); setPage('detail'); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceCard({ service, onClick }: { service: ServiceRequest; onClick: () => void }) {
  const statusColor = SERVICE_STATUS_COLORS[service.status] ?? '#494847';
  const statusLabel = SERVICE_STATUS_LABELS[service.status] ?? service.status;
  const typeLabel = SERVICE_TYPE_LABELS[service.request_type] ?? service.request_type;
  const urgencyColor = URGENCY_COLORS[service.urgency] ?? '#adaaaa';
  const date = new Date(service.created_at).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <button onClick={onClick} style={{
      width: '100%', textAlign: 'left', padding: '12px', backgroundColor: '#131313',
      border: 'none', borderLeft: `3px solid ${statusColor}`, borderRadius: '4px', cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="font-headline font-bold" style={{ fontSize: '13px', color: 'white' }}>{service.title}</span>
            <span style={{ fontSize: '8px', padding: '2px 6px', backgroundColor: `${statusColor}20`, color: statusColor, fontWeight: 700, borderRadius: '2px' }}>
              {statusLabel}
            </span>
          </div>
          <div style={{ fontSize: '10px', color: '#777575', marginTop: '2px' }}>
            <span style={{ color: urgencyColor }}>{typeLabel}</span>
            {' · '}{date}
            {service.total_cost > 0 && <span style={{ color: '#ff9f43' }}> · {service.total_cost.toFixed(2)}€</span>}
          </div>
          {service.description && (
            <div style={{ fontSize: '10px', color: '#494847', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px' }}>
              {service.description}
            </div>
          )}
        </div>
        <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#494847' }}>chevron_right</span>
      </div>
    </button>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, padding: '8px', backgroundColor: '#131313', borderRadius: '4px', textAlign: 'center' }}>
      <div className="font-headline font-bold tabular-nums" style={{ fontSize: '14px', color }}>{value}</div>
      <div style={{ fontSize: '8px', color: '#777575' }}>{label}</div>
    </div>
  );
}
