// ═══════════════════════════════════════════════════════════
// Service Book / Maintenance System Types
// ═══════════════════════════════════════════════════════════

export type ServiceStatus =
  | 'draft' | 'requested' | 'accepted' | 'in_progress'
  | 'pending_approval' | 'completed' | 'closed'
  | 'cancelled' | 'rejected';

export type ServiceUrgency = 'low' | 'normal' | 'high' | 'urgent';
export type ServiceType = 'repair' | 'maintenance' | 'inspection' | 'upgrade' | 'warranty' | 'wash';
export type ItemType = 'part' | 'labor' | 'consumable';
export type ItemStatus = 'pending' | 'approved' | 'rejected' | 'done' | 'warranty';
export type CommentType = 'message' | 'status_change' | 'approval_request' | 'approval_response' | 'photo_note' | 'estimate';
export type PhotoType = 'before' | 'after' | 'damage' | 'receipt' | 'general';
export type ShopRole = 'owner' | 'manager' | 'mechanic';

export interface Shop {
  id: string;
  name: string;
  slug: string | null;
  address: string | null;
  city: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_url: string | null;
  description: string | null;
  lat: number | null;
  lng: number | null;
  rating_avg: number;
  review_count: number;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface ShopMember {
  id: string;
  shop_id: string;
  user_id: string;
  role: ShopRole;
  display_name: string | null;
  specialties: string[];
  active: boolean;
  joined_at: string;
}

export interface ServiceRequest {
  id: string;
  bike_id: string;
  rider_id: string;
  shop_id: string | null;
  mechanic_id: string | null;
  bike_name: string | null;
  bike_brand: string | null;
  bike_model: string | null;
  bike_odo_km: number | null;
  title: string;
  description: string | null;
  urgency: ServiceUrgency;
  request_type: ServiceType;
  preferred_date: string | null;
  scheduled_date: string | null;
  estimated_hours: number | null;
  status: ServiceStatus;
  total_parts_cost: number;
  total_labor_cost: number;
  total_cost: number;
  currency: string;
  qr_code_token: string | null;
  service_note: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ServiceItem {
  id: string;
  service_id: string;
  item_type: ItemType;
  component_id: string | null;
  category: string | null;
  brand: string | null;
  model: string | null;
  description: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  currency: string;
  status: ItemStatus;
  needs_approval: boolean;
  approved_at: string | null;
  approved_by: string | null;
  replaced_component: string | null;
  is_upgrade: boolean;
  labor_hours: number | null;
  mechanic_id: string | null;
  created_at: string;
}

export interface ServiceComment {
  id: string;
  service_id: string;
  author_id: string;
  author_role: 'rider' | 'mechanic' | 'system';
  body: string;
  item_id: string | null;
  comment_type: CommentType;
  email_sent: boolean;
  read_at: string | null;
  created_at: string;
}

export interface ServicePhoto {
  id: string;
  service_id: string;
  item_id: string | null;
  comment_id: string | null;
  uploaded_by: string;
  storage_path: string;
  file_name: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  thumbnail_path: string | null;
  caption: string | null;
  photo_type: PhotoType;
  created_at: string;
}

export interface MaintenanceSchedule {
  id: string;
  bike_id: string;
  user_id: string;
  component_type: string;
  component_name: string | null;
  interval_km: number | null;
  interval_hours: number | null;
  interval_months: number | null;
  last_service_km: number;
  last_service_hours: number;
  last_service_date: string | null;
  last_service_id: string | null;
  current_km: number;
  current_hours: number;
  wear_pct: number;
  alert_triggered: boolean;
  active: boolean;
  created_at: string;
}

export interface BikeQRCode {
  id: string;
  bike_id: string;
  user_id: string;
  token: string;
  active: boolean;
  scanned_count: number;
  created_at: string;
}

// ── Helpers ─────────────────────────────────────────────────

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  draft: 'Rascunho',
  requested: 'Pedido enviado',
  accepted: 'Aceite',
  in_progress: 'Em curso',
  pending_approval: 'Aguarda aprovação',
  completed: 'Concluído',
  closed: 'Fechado',
  cancelled: 'Cancelado',
  rejected: 'Rejeitado',
};

export const SERVICE_STATUS_COLORS: Record<ServiceStatus, string> = {
  draft: '#494847',
  requested: '#6e9bff',
  accepted: '#3fff8b',
  in_progress: '#fbbf24',
  pending_approval: '#e966ff',
  completed: '#3fff8b',
  closed: '#adaaaa',
  cancelled: '#ff716c',
  rejected: '#ff716c',
};

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  repair: 'Reparação',
  maintenance: 'Manutenção',
  inspection: 'Inspeção',
  upgrade: 'Upgrade',
  warranty: 'Garantia',
  wash: 'Lavagem',
};

export const URGENCY_LABELS: Record<ServiceUrgency, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

export const URGENCY_COLORS: Record<ServiceUrgency, string> = {
  low: '#adaaaa',
  normal: '#6e9bff',
  high: '#fbbf24',
  urgent: '#ff716c',
};

// ── Default maintenance intervals per bike type ─────────────

export interface MaintenanceDefault {
  component_type: string;
  label: string;
  icon: string;
  interval_km: number | null;
  interval_hours: number | null;
  interval_months: number | null;
}

const BASE_SCHEDULE: MaintenanceDefault[] = [
  { component_type: 'chain', label: 'Corrente', icon: 'link', interval_km: 3000, interval_hours: null, interval_months: null },
  { component_type: 'brake_pads', label: 'Pastilhas de travão', icon: 'do_not_disturb_on', interval_km: 4000, interval_hours: null, interval_months: null },
  { component_type: 'brake_fluid', label: 'Óleo de travão', icon: 'water_drop', interval_km: null, interval_hours: null, interval_months: 12 },
  { component_type: 'tyres', label: 'Pneus', icon: 'trip_origin', interval_km: 4000, interval_hours: null, interval_months: null },
  { component_type: 'cassette', label: 'Cassete', icon: 'settings', interval_km: 7000, interval_hours: null, interval_months: null },
  { component_type: 'cables', label: 'Cabos e bainhas', icon: 'cable', interval_km: null, interval_hours: null, interval_months: 12 },
  { component_type: 'wheel_true', label: 'Centrar rodas', icon: 'trip_origin', interval_km: null, interval_hours: null, interval_months: 6 },
  { component_type: 'general_wash', label: 'Lavagem geral', icon: 'water', interval_km: 500, interval_hours: null, interval_months: null },
];

const MTB_SUSPENSION: MaintenanceDefault[] = [
  { component_type: 'fork_lower', label: 'Fork — serviço lower', icon: 'swap_vert', interval_km: null, interval_hours: 50, interval_months: null },
  { component_type: 'fork_full', label: 'Fork — serviço completo', icon: 'swap_vert', interval_km: null, interval_hours: 200, interval_months: null },
  { component_type: 'shock_service', label: 'Amortecedor — serviço', icon: 'swap_vert', interval_km: null, interval_hours: 200, interval_months: null },
];

const EBIKE_EXTRAS: MaintenanceDefault[] = [
  { component_type: 'ebike_annual', label: 'Revisão anual e-bike', icon: 'electric_bike', interval_km: null, interval_hours: null, interval_months: 12 },
  { component_type: 'motor_service', label: 'Serviço motor', icon: 'bolt', interval_km: 10000, interval_hours: null, interval_months: null },
  { component_type: 'battery_check', label: 'Verificação bateria', icon: 'battery_full', interval_km: null, interval_hours: null, interval_months: 6 },
];

export function getDefaultSchedule(bikeType: 'ebike' | 'mechanical', suspension: 'rigid' | 'hardtail' | 'full'): MaintenanceDefault[] {
  const schedule = [...BASE_SCHEDULE];
  if (suspension === 'hardtail' || suspension === 'full') {
    schedule.push(MTB_SUSPENSION[0]!, MTB_SUSPENSION[1]!); // fork services
  }
  if (suspension === 'full') {
    schedule.push(MTB_SUSPENSION[2]!); // shock service
  }
  if (bikeType === 'ebike') {
    schedule.push(...EBIKE_EXTRAS);
  }
  return schedule;
}
