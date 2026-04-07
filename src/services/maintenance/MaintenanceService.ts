/**
 * MaintenanceService — Supabase REST CRUD for the Service Book system.
 */

import type {
  ServiceRequest, ServiceItem, ServiceComment, ServicePhoto,
  MaintenanceSchedule, Shop, ShopMember, BikeQRCode,
  ServiceStatus, MaintenanceDefault,
} from '../../types/service.types';
import { supaFetch, supaGet } from '../../lib/supaFetch';

async function query<T>(path: string): Promise<T[]> {
  try {
    const data = await supaGet<T[]>(`/rest/v1${path}`);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function insert<T>(table: string, record: Partial<T>): Promise<T | null> {
  try {
    const res = await supaFetch(`/rest/v1/${table}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(record),
    });
    const data = await res.json();
    return Array.isArray(data) ? data[0] ?? null : data;
  } catch {
    return null;
  }
}

async function update<T>(table: string, id: string, partial: Partial<T>): Promise<void> {
  try {
    await supaFetch(`/rest/v1/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...partial, updated_at: new Date().toISOString() }),
    });
  } catch {
    // best-effort
  }
}

async function remove(table: string, id: string): Promise<void> {
  try {
    await supaFetch(`/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE' });
  } catch {
    // best-effort
  }
}

// ── Service Requests ────────────────────────────────────────

export async function getServicesForRider(riderId: string): Promise<ServiceRequest[]> {
  return query(`/service_requests?rider_id=eq.${riderId}&order=created_at.desc&limit=100`);
}

export async function getServicesForBike(bikeId: string): Promise<ServiceRequest[]> {
  return query(`/service_requests?bike_id=eq.${bikeId}&order=created_at.desc&limit=100`);
}

export async function getServicesForShop(shopId: string): Promise<ServiceRequest[]> {
  return query(`/service_requests?shop_id=eq.${shopId}&order=created_at.desc&limit=100`);
}

export async function getServiceById(id: string): Promise<ServiceRequest | null> {
  const data = await query<ServiceRequest>(`/service_requests?id=eq.${id}`);
  return data[0] ?? null;
}

export async function createService(req: Partial<ServiceRequest>): Promise<ServiceRequest | null> {
  return insert('service_requests', req);
}

export async function updateService(id: string, partial: Partial<ServiceRequest>): Promise<void> {
  return update('service_requests', id, partial);
}

export async function updateServiceStatus(id: string, status: ServiceStatus): Promise<void> {
  const updates: Partial<ServiceRequest> = { status };
  if (status === 'completed') updates.completed_at = new Date().toISOString();
  await update('service_requests', id, updates);
}

export async function deleteService(id: string): Promise<void> {
  return remove('service_requests', id);
}

// ── Service Items ───────────────────────────────────────────

export async function getServiceItems(serviceId: string): Promise<ServiceItem[]> {
  return query(`/service_items?service_id=eq.${serviceId}&order=created_at.asc`);
}

export async function addServiceItem(item: Partial<ServiceItem>): Promise<ServiceItem | null> {
  // Auto-calculate total_cost
  if (item.quantity && item.unit_cost) {
    item.total_cost = item.quantity * item.unit_cost;
  }
  return insert('service_items', item);
}

export async function updateServiceItem(id: string, partial: Partial<ServiceItem>): Promise<void> {
  if (partial.quantity !== undefined && partial.unit_cost !== undefined) {
    partial.total_cost = partial.quantity * partial.unit_cost;
  }
  return update('service_items', id, partial);
}

export async function approveItem(id: string, userId: string): Promise<void> {
  return update('service_items', id, {
    status: 'approved' as ServiceItem['status'],
    approved_at: new Date().toISOString(),
    approved_by: userId,
  } as Partial<ServiceItem>);
}

export async function rejectItem(id: string, userId: string): Promise<void> {
  return update('service_items', id, {
    status: 'rejected' as ServiceItem['status'],
    approved_at: new Date().toISOString(),
    approved_by: userId,
  } as Partial<ServiceItem>);
}

export async function deleteServiceItem(id: string): Promise<void> {
  return remove('service_items', id);
}

// ── Comments ────────────────────────────────────────────────

export async function getComments(serviceId: string): Promise<ServiceComment[]> {
  return query(`/service_comments?service_id=eq.${serviceId}&order=created_at.asc`);
}

export async function addComment(comment: Partial<ServiceComment>): Promise<ServiceComment | null> {
  return insert('service_comments', comment);
}

// ── Photos ──────────────────────────────────────────────────

export async function getPhotos(serviceId: string): Promise<ServicePhoto[]> {
  // Embed the joined kromi_files row so PhotoGrid can render Drive thumbnails
  // without an extra round-trip. Falls back to storage_path for legacy rows.
  return query(
    `/service_photos?service_id=eq.${serviceId}&order=created_at.asc&select=*,kromi_file:kromi_files(drive_view_link,drive_thumbnail_link,drive_download_link)`,
  );
}

export async function addPhoto(photo: Partial<ServicePhoto>): Promise<ServicePhoto | null> {
  return insert('service_photos', photo);
}

// ── Shops ───────────────────────────────────────────────────

export async function getShops(): Promise<Shop[]> {
  return query('/shops?active=eq.true&order=rating_avg.desc&limit=50');
}

export async function getShopById(id: string): Promise<Shop | null> {
  const data = await query<Shop>(`/shops?id=eq.${id}`);
  return data[0] ?? null;
}

export async function createShop(shop: Partial<Shop>): Promise<Shop | null> {
  return insert('shops', shop);
}

export async function updateShop(id: string, partial: Partial<Shop>): Promise<void> {
  return update('shops', id, partial);
}

export async function getShopMembers(shopId: string): Promise<ShopMember[]> {
  return query(`/shop_members?shop_id=eq.${shopId}&active=eq.true`);
}

export async function getUserShopMembership(userId: string): Promise<ShopMember | null> {
  const data = await query<ShopMember>(`/shop_members?user_id=eq.${userId}&active=eq.true`);
  return data[0] ?? null;
}

export async function addShopMember(member: Partial<ShopMember>): Promise<ShopMember | null> {
  return insert('shop_members', member);
}

// ── Maintenance Schedules ───────────────────────────────────

export async function getSchedulesForBike(bikeId: string, userId: string): Promise<MaintenanceSchedule[]> {
  return query(`/maintenance_schedules?bike_id=eq.${bikeId}&user_id=eq.${userId}&active=eq.true&order=wear_pct.desc`);
}

export async function seedSchedulesForBike(
  bikeId: string, userId: string, defaults: MaintenanceDefault[],
): Promise<void> {
  for (const d of defaults) {
    try {
      await supaFetch('/rest/v1/maintenance_schedules?on_conflict=bike_id,user_id,component_type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          bike_id: bikeId, user_id: userId,
          component_type: d.component_type, component_name: d.label,
          interval_km: d.interval_km, interval_hours: d.interval_hours, interval_months: d.interval_months,
        }),
      });
    } catch {
      // best-effort
    }
  }
}

export async function updateSchedule(id: string, partial: Partial<MaintenanceSchedule>): Promise<void> {
  return update('maintenance_schedules', id, partial);
}

export async function resetScheduleAfterService(
  id: string, serviceId: string, currentKm: number, currentHours: number,
): Promise<void> {
  return update('maintenance_schedules', id, {
    last_service_km: currentKm,
    last_service_hours: currentHours,
    last_service_date: new Date().toISOString().split('T')[0],
    last_service_id: serviceId,
    current_km: 0,
    current_hours: 0,
    wear_pct: 0,
    alert_triggered: false,
  } as Partial<MaintenanceSchedule>);
}

// ── QR Codes ────────────────────────────────────────────────

export async function getQRCode(bikeId: string, userId: string): Promise<BikeQRCode | null> {
  const data = await query<BikeQRCode>(`/bike_qr_codes?bike_id=eq.${bikeId}&user_id=eq.${userId}&active=eq.true`);
  return data[0] ?? null;
}

export async function createQRCode(bikeId: string, userId: string): Promise<BikeQRCode | null> {
  const token = `BK-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  return insert<BikeQRCode>('bike_qr_codes', { bike_id: bikeId, user_id: userId, token } as Partial<BikeQRCode>);
}

// ── Stats ───────────────────────────────────────────────────

export interface BikeServiceStats {
  total_services: number;
  total_cost: number;
  total_parts: number;
  total_labor: number;
  last_service_date: string | null;
}

export async function getBikeServiceStats(bikeId: string, riderId: string): Promise<BikeServiceStats> {
  const services = await query<ServiceRequest>(
    `/service_requests?bike_id=eq.${bikeId}&rider_id=eq.${riderId}&status=in.(completed,closed)&select=total_cost,total_parts_cost,total_labor_cost,completed_at`
  );
  return {
    total_services: services.length,
    total_cost: services.reduce((s, r) => s + (r.total_cost ?? 0), 0),
    total_parts: services.reduce((s, r) => s + (r.total_parts_cost ?? 0), 0),
    total_labor: services.reduce((s, r) => s + (r.total_labor_cost ?? 0), 0),
    last_service_date: services[0]?.completed_at ?? null,
  };
}
