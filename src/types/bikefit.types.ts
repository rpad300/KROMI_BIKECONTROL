/** Complete bike fit measurement set — DIY + professional fields */
export interface BikeFit {
  id: string;
  bike_config_id?: string;
  bike_name?: string;
  updated_at?: string;

  // Rider measurements
  inseam_cm?: number;
  arm_length_cm?: number;
  torso_length_cm?: number;
  shoulder_width_cm?: number;
  shoe_size?: string;

  // Saddle
  saddle_height_mm?: number;
  saddle_setback_mm?: number;
  saddle_tilt_deg?: number;
  saddle_model?: string;

  // Handlebar
  handlebar_width_mm?: number;
  handlebar_drop_mm?: number;
  handlebar_reach_mm?: number;
  stem_length_mm?: number;
  stem_angle_deg?: number;
  spacers_mm?: number;

  // Frame
  frame_size?: string;
  frame_stack_mm?: number;
  frame_reach_mm?: number;

  // Cranks + pedals
  crank_length_mm?: number;
  cleat_fore_aft_mm?: number;
  cleat_rotation_deg?: number;
  pedal_type?: string;

  // Position
  riding_position?: 'aggressive' | 'moderate' | 'upright';

  // Fit session
  fitter_name?: string;
  fit_date?: string;
  notes?: string;
}

export interface BikeFitChange {
  id: string;
  changed_at: string;
  field_name: string;
  old_value: string;
  new_value: string;
  reason: string;
  notes?: string;
}

/** Field groups for progressive UI */
export const FIT_FIELD_GROUPS = [
  {
    id: 'rider', label: 'Medidas do Ciclista', icon: 'straighten', color: '#ff716c',
    fields: [
      { key: 'inseam_cm', label: 'Entrepernas (cm)', unit: 'cm', type: 'number' as string },
      { key: 'arm_length_cm', label: 'Comprimento braço (cm)', unit: 'cm', type: 'number' as string },
      { key: 'torso_length_cm', label: 'Comprimento tronco (cm)', unit: 'cm', type: 'number' as string },
      { key: 'shoulder_width_cm', label: 'Largura ombros (cm)', unit: 'cm', type: 'number' as string },
      { key: 'shoe_size', label: 'Tamanho sapato', unit: '', type: 'text' as string },
    ],
  },
  {
    id: 'saddle', label: 'Selim', icon: 'event_seat', color: '#fbbf24',
    fields: [
      { key: 'saddle_height_mm', label: 'Altura selim (mm)', unit: 'mm', type: 'number' as string },
      { key: 'saddle_setback_mm', label: 'Recuo selim (mm)', unit: 'mm', type: 'number' as string },
      { key: 'saddle_tilt_deg', label: 'Inclinação selim (°)', unit: '°', type: 'number' as string },
      { key: 'saddle_model', label: 'Modelo selim', unit: '', type: 'text' as string },
    ],
  },
  {
    id: 'handlebar', label: 'Guiador', icon: 'swap_horiz', color: '#6e9bff',
    fields: [
      { key: 'handlebar_width_mm', label: 'Largura guiador (mm)', unit: 'mm', type: 'number' as string },
      { key: 'handlebar_drop_mm', label: 'Drop (mm)', unit: 'mm', type: 'number' as string },
      { key: 'handlebar_reach_mm', label: 'Reach guiador (mm)', unit: 'mm', type: 'number' as string },
      { key: 'stem_length_mm', label: 'Comprimento avanço (mm)', unit: 'mm', type: 'number' as string },
      { key: 'stem_angle_deg', label: 'Ângulo avanço (°)', unit: '°', type: 'number' as string },
      { key: 'spacers_mm', label: 'Spacers (mm)', unit: 'mm', type: 'number' as string },
    ],
  },
  {
    id: 'frame', label: 'Quadro', icon: 'pedal_bike', color: '#3fff8b',
    fields: [
      { key: 'frame_size', label: 'Tamanho', unit: '', type: 'text' as string },
      { key: 'frame_stack_mm', label: 'Stack (mm)', unit: 'mm', type: 'number' as string },
      { key: 'frame_reach_mm', label: 'Reach (mm)', unit: 'mm', type: 'number' as string },
    ],
  },
  {
    id: 'cranks', label: 'Pedaleiro + Calços', icon: 'settings', color: '#e966ff',
    fields: [
      { key: 'crank_length_mm', label: 'Comprimento pedaleiro (mm)', unit: 'mm', type: 'number' as string },
      { key: 'cleat_fore_aft_mm', label: 'Calço frente-trás (mm)', unit: 'mm', type: 'number' as string },
      { key: 'cleat_rotation_deg', label: 'Rotação calço (°)', unit: '°', type: 'number' as string },
      { key: 'pedal_type', label: 'Tipo pedal', unit: '', type: 'text' as string },
    ],
  },
  {
    id: 'session', label: 'Sessão de Fitting', icon: 'assignment', color: '#adaaaa',
    fields: [
      { key: 'riding_position', label: 'Posição', unit: '', type: 'text' as string },
      { key: 'fitter_name', label: 'Fitter / Loja', unit: '', type: 'text' as string },
      { key: 'fit_date', label: 'Data do fitting', unit: '', type: 'date' as string },
      { key: 'notes', label: 'Notas', unit: '', type: 'textarea' as string },
    ],
  },
];
