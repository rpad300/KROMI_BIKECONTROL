import { useState, useEffect } from 'react';
import { getShops } from '../../services/maintenance/MaintenanceService';
import { getShopServices, type ShopServiceTemplate } from '../../services/maintenance/ShopService';
import { useMapStore } from '../../store/mapStore';
import type { Shop } from '../../types/service.types';

export function ShopSearchPage({ onSelectShop, onBack }: { onSelectShop: (shopId: string) => void; onBack: () => void }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedServices, setExpandedServices] = useState<ShopServiceTemplate[]>([]);
  const lat = useMapStore((s) => s.latitude);
  const lng = useMapStore((s) => s.longitude);

  useEffect(() => { getShops().then((data) => { setShops(data); setLoading(false); }); }, []);

  // Sort by distance if GPS available
  const sorted = [...shops].sort((a, b) => {
    if (lat && lng && a.lat && a.lng && b.lat && b.lng) {
      const distA = Math.hypot((a.lat - lat), (a.lng - lng));
      const distB = Math.hypot((b.lat - lat), (b.lng - lng));
      return distA - distB;
    }
    return (b.rating_avg ?? 0) - (a.rating_avg ?? 0);
  });

  const filtered = search
    ? sorted.filter((s) => `${s.name} ${s.city}`.toLowerCase().includes(search.toLowerCase()))
    : sorted;

  const handleExpand = async (shopId: string) => {
    if (expandedId === shopId) { setExpandedId(null); return; }
    setExpandedId(shopId);
    const svcs = await getShopServices(shopId);
    setExpandedServices(svcs);
  };

  return (
    <div className="space-y-3">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '22px', color: '#adaaaa' }}>arrow_back</span>
        </button>
        <div className="font-headline font-bold" style={{ fontSize: '16px', color: '#ff9f43' }}>Encontrar Oficina</div>
      </div>

      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar por nome ou cidade..."
        style={{ width: '100%', padding: '10px', backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: 'white', fontSize: '12px', outline: 'none' }} />

      {loading ? (
        <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-[#ff9f43] border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', backgroundColor: '#131313', borderRadius: '6px', fontSize: '11px', color: '#494847' }}>
          Nenhuma oficina encontrada.
        </div>
      ) : (
        filtered.map((shop) => (
          <div key={shop.id} style={{ backgroundColor: '#131313', borderRadius: '6px', overflow: 'hidden' }}>
            <button onClick={() => handleExpand(shop.id)} style={{
              width: '100%', textAlign: 'left', padding: '12px', border: 'none', cursor: 'pointer', backgroundColor: 'transparent',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '24px', color: '#ff9f43' }}>store</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: 'white', fontWeight: 600 }}>{shop.name}</div>
                  <div style={{ fontSize: '10px', color: '#777575' }}>
                    {shop.city ?? ''}{shop.address ? ` · ${shop.address}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {shop.rating_avg > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '12px', color: '#fbbf24' }}>star</span>
                      <span style={{ fontSize: '11px', color: '#fbbf24', fontWeight: 700 }}>{shop.rating_avg.toFixed(1)}</span>
                      <span style={{ fontSize: '8px', color: '#494847' }}>({shop.review_count})</span>
                    </div>
                  )}
                  {(shop as unknown as Record<string, unknown>).hourly_rate ? (
                    <div style={{ fontSize: '9px', color: '#777575' }}>
                      {String((shop as unknown as Record<string, unknown>).hourly_rate)}€/h
                    </div>
                  ) : null}
                </div>
              </div>
            </button>

            {expandedId === shop.id && (
              <div style={{ padding: '0 12px 12px', borderTop: '1px solid rgba(73,72,71,0.1)' }}>
                {shop.phone && <div style={{ fontSize: '10px', color: '#777575', marginTop: '6px' }}>Tel: {shop.phone}</div>}
                {shop.description && <div style={{ fontSize: '10px', color: '#494847', marginTop: '4px' }}>{shop.description}</div>}

                {expandedServices.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '9px', color: '#ff9f43', fontWeight: 700, marginBottom: '4px' }}>Serviços ({expandedServices.length})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                      {expandedServices.slice(0, 12).map((svc) => (
                        <span key={svc.id} style={{ fontSize: '8px', padding: '2px 5px', backgroundColor: 'rgba(255,159,67,0.08)', color: '#ff9f43', borderRadius: '2px' }}>
                          {svc.name} {svc.price_default ? `${svc.price_default}€` : ''}
                        </span>
                      ))}
                      {expandedServices.length > 12 && <span style={{ fontSize: '8px', color: '#494847' }}>+{expandedServices.length - 12}</span>}
                    </div>
                  </div>
                )}

                <button onClick={() => onSelectShop(shop.id)} style={{
                  marginTop: '8px', width: '100%', padding: '10px', backgroundColor: '#ff9f43', color: 'black',
                  border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                }}>
                  Seleccionar esta oficina
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
