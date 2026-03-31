export interface ElevationPoint {
  lat: number;
  lng: number;
  elevation: number;
  distance_from_current: number;
  gradient_pct: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TransitionEvent {
  type: 'flat_to_climb' | 'descent_to_climb' | 'climb_to_flat' | 'climb_to_descent';
  distance_m: number;
  gradient_after_pct: number;
  target_mode: number; // AssistMode
  is_preemptive: boolean;
}

export interface TerrainAnalysis {
  current_gradient_pct: number;
  avg_upcoming_gradient_pct: number;
  max_upcoming_gradient_pct: number;
  next_transition: TransitionEvent | null;
  profile: ElevationPoint[];
}

export interface AssistDecision {
  action: 'none' | 'change_mode';
  new_mode?: number;
  reason: string;
  terrain: TerrainAnalysis | null;
  is_preemptive?: boolean;
}
