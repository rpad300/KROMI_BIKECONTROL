import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ServiceRequest, MaintenanceSchedule, Shop, ShopMember } from '../types/service.types';

interface ServiceState {
  // Services
  services: ServiceRequest[];
  loading: boolean;

  // Shop mode
  shopMode: boolean;
  shopId: string | null;
  shopMembership: ShopMember | null;
  shop: Shop | null;

  // Maintenance alerts
  alerts: MaintenanceSchedule[];

  // Actions
  setServices: (services: ServiceRequest[]) => void;
  addService: (service: ServiceRequest) => void;
  updateServiceInList: (id: string, partial: Partial<ServiceRequest>) => void;
  removeService: (id: string) => void;
  setLoading: (v: boolean) => void;
  setAlerts: (alerts: MaintenanceSchedule[]) => void;

  // Shop mode
  toggleShopMode: () => void;
  setShopMode: (v: boolean) => void;
  setShop: (shop: Shop | null, membership: ShopMember | null) => void;
}

export const useServiceStore = create<ServiceState>()(
  persist(
    (set) => ({
      services: [],
      loading: false,
      shopMode: false,
      shopId: null,
      shopMembership: null,
      shop: null,
      alerts: [],

      setServices: (services) => set({ services }),
      addService: (service) => set((s) => ({ services: [service, ...s.services] })),
      updateServiceInList: (id, partial) => set((s) => ({
        services: s.services.map((svc) => svc.id === id ? { ...svc, ...partial } : svc),
      })),
      removeService: (id) => set((s) => ({
        services: s.services.filter((svc) => svc.id !== id),
      })),
      setLoading: (loading) => set({ loading }),
      setAlerts: (alerts) => set({ alerts }),

      toggleShopMode: () => set((s) => ({ shopMode: !s.shopMode })),
      setShopMode: (shopMode) => set({ shopMode }),
      setShop: (shop, membership) => set({
        shop, shopMembership: membership, shopId: shop?.id ?? null,
      }),
    }),
    {
      name: 'bikecontrol-service',
      partialize: (state) => ({
        shopMode: state.shopMode,
        shopId: state.shopId,
      }),
    },
  ),
);
