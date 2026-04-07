/**
 * ShopService — shop management: services catalog, calendar, availability, sharing
 */

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

async function update(table: string, id: string, partial: Record<string, unknown>): Promise<void> {
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

// ── Shop Services Catalog ───────────────────────────────────

export interface ShopServiceTemplate {
  id: string;
  shop_id: string;
  category: string;
  name: string;
  description: string | null;
  pricing_type: 'fixed' | 'hourly' | 'quote';
  price_road: number | null;
  price_gravel: number | null;
  price_mtb: number | null;
  price_ebike: number | null;
  price_default: number | null;
  estimated_minutes: number | null;
  sort_order: number;
  active: boolean;
}

export async function getShopServices(shopId: string): Promise<ShopServiceTemplate[]> {
  return query(`/shop_services?shop_id=eq.${shopId}&active=eq.true&order=sort_order.asc`);
}

export async function createShopService(svc: Partial<ShopServiceTemplate>): Promise<ShopServiceTemplate | null> {
  return insert('shop_services', svc);
}

export async function updateShopService(id: string, partial: Partial<ShopServiceTemplate>): Promise<void> {
  return update('shop_services', id, partial as Record<string, unknown>);
}

/** Seed default services from template table when shop is created */
export async function seedShopDefaults(shopId: string): Promise<void> {
  const templates = await query<{
    category: string; name: string; description: string; pricing_type: string;
    price_road: number; price_gravel: number; price_mtb: number; price_ebike: number;
    price_default: number; estimated_minutes: number; sort_order: number;
  }>('/shop_services_templates?order=sort_order.asc');

  for (const t of templates) {
    await insert('shop_services', { shop_id: shopId, ...t });
  }

  // Seed default working hours (Mon-Fri 9:00-18:00, Sat 9:00-13:00)
  const hours = [
    { day_of_week: 1, open_time: '09:00', close_time: '18:00', break_start: '13:00', break_end: '14:00' },
    { day_of_week: 2, open_time: '09:00', close_time: '18:00', break_start: '13:00', break_end: '14:00' },
    { day_of_week: 3, open_time: '09:00', close_time: '18:00', break_start: '13:00', break_end: '14:00' },
    { day_of_week: 4, open_time: '09:00', close_time: '18:00', break_start: '13:00', break_end: '14:00' },
    { day_of_week: 5, open_time: '09:00', close_time: '18:00', break_start: '13:00', break_end: '14:00' },
    { day_of_week: 6, open_time: '09:00', close_time: '13:00', break_start: undefined, break_end: undefined },
  ];
  for (const h of hours) {
    await insert('shop_hours', { shop_id: shopId, ...h });
  }
}

// ── Shop Hours ──────────────────────────────────────────────

export interface ShopHours {
  id: string;
  shop_id: string;
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  break_start: string | null;
  break_end: string | null;
}

export async function getShopHours(shopId: string): Promise<ShopHours[]> {
  return query(`/shop_hours?shop_id=eq.${shopId}&order=day_of_week.asc`);
}

// ── Calendar Slots ──────────────────────────────────────────

export async function getCalendarSlots(shopId: string, date: string): Promise<Array<{
  id: string; start_time: string; end_time: string; title: string;
  status: string; bike_name: string | null; rider_name: string | null; duration_min: number;
}>> {
  return query(`/shop_calendar?shop_id=eq.${shopId}&slot_date=eq.${date}&order=start_time.asc`);
}

export async function createCalendarSlot(slot: Record<string, unknown>): Promise<unknown> {
  return insert('shop_calendar', slot);
}

// ── Availability Calculation ────────────────────────────────

export async function getShopAvailability(shopId: string, date: string): Promise<{
  total_min: number; booked_min: number; free_min: number;
}> {
  // Get hours for this day of week
  const dayOfWeek = new Date(date).getDay();
  const hours = await query<ShopHours>(`/shop_hours?shop_id=eq.${shopId}&day_of_week=eq.${dayOfWeek}`);

  if (hours.length === 0 || !hours[0]?.open_time || !hours[0]?.close_time) {
    return { total_min: 0, booked_min: 0, free_min: 0 }; // Closed
  }

  const h = hours[0]!;
  const openMin = timeToMinutes(h.open_time!);
  const closeMin = timeToMinutes(h.close_time!);
  let totalMin = closeMin - openMin;

  // Subtract break
  if (h.break_start && h.break_end) {
    totalMin -= (timeToMinutes(h.break_end!) - timeToMinutes(h.break_start!));
  }

  // Get booked slots for this day
  const slots = await query<{ duration_min: number; status: string }>(
    `/shop_calendar?shop_id=eq.${shopId}&slot_date=eq.${date}&status=neq.cancelled&select=duration_min,status`
  );
  const bookedMin = slots.reduce((sum, s) => sum + (s.duration_min ?? 0), 0);

  return { total_min: totalMin, booked_min: bookedMin, free_min: Math.max(0, totalMin - bookedMin) };
}

/** AI-powered scheduling: suggest available dates for a service */
export async function suggestAvailableDates(
  shopId: string, estimatedMinutes: number, fromDate: string, maxDays = 14,
): Promise<{ date: string; free_min: number; suggestion: string }[]> {
  const suggestions: { date: string; free_min: number; suggestion: string }[] = [];
  const start = new Date(fromDate);

  for (let i = 0; i < maxDays && suggestions.length < 5; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0]!;

    const avail = await getShopAvailability(shopId, dateStr);
    if (avail.free_min >= estimatedMinutes) {
      const dayLabel = d.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'short' });
      suggestions.push({
        date: dateStr,
        free_min: avail.free_min,
        suggestion: `${dayLabel} — ${Math.floor(avail.free_min / 60)}h${avail.free_min % 60 > 0 ? `${avail.free_min % 60}m` : ''} disponíveis`,
      });
    }
  }

  return suggestions;
}

// ── Calendar Shares ─────────────────────────────────────────

export async function getCalendarShares(shopId: string): Promise<Array<{
  id: string; token: string; label: string | null; permissions: string; active: boolean;
}>> {
  return query(`/shop_calendar_shares?shop_id=eq.${shopId}&active=eq.true`);
}

export async function createCalendarShare(shopId: string, userId: string, label: string): Promise<unknown> {
  const token = `CAL-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
  return insert('shop_calendar_shares', { shop_id: shopId, created_by: userId, token, label });
}

// ── Helpers ──────────────────────────────────────────────────

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
