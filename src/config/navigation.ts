// ═══════════════════════════════════════════════════════════
// navigation — single source of truth for menus + RBAC keys
// ═══════════════════════════════════════════════════════════
//
// Both the mobile Settings menu and the desktop sidebar consume this
// config so adding a new feature page is a one-line change instead of
// editing two parallel arrays. Each leaf (or category) can carry an
// optional `permission` key that the RBAC layer uses to filter the
// rendered tree (see usePermissions + filterNavByPermissions below).

export type SettingsPage =
  | 'menu'
  | 'rider'
  | 'personal'
  | 'physical'
  | 'zones'
  | 'medical'
  | 'emergency'
  | 'bikefit'
  | 'club'
  | 'bike'
  | 'kromi'
  | 'bluetooth'
  | 'accessories'
  | 'routes'
  | 'account'
  | 'privacy'
  | 'service-book'
  | 'shop'
  | 'super-admin';

export type Screen = 'dashboard' | 'map' | 'climb' | 'connections' | 'settings' | 'history';

export interface NavLeaf {
  id: SettingsPage;
  icon: string;
  label: string;
  /** One-line description shown in the mobile menu cards. */
  desc: string;
  /** RBAC permission key required to see this entry. Omit = always visible. */
  permission?: string;
}

export interface NavCategory {
  label: string;
  icon: string;
  color: string;
  items: NavLeaf[];
  /** When set, the whole category is a one-tap shortcut to a top-level Screen. */
  navigateTo?: Screen;
  /** RBAC permission key gating the entire category. */
  permission?: string;
}

// ─── The single canonical menu tree ──────────────────────────
export const NAV_CATEGORIES: NavCategory[] = [
  { label: 'Perfil', icon: 'person', color: '#ff716c', items: [
    { id: 'personal',  icon: 'badge',              label: 'Dados Pessoais',     desc: 'Nome, nascimento, género, clube, foto' },
    { id: 'physical',  icon: 'monitor_heart',      label: 'Perfil Físico',      desc: 'Peso, altura, VO2max, FTP, SpO2' },
    { id: 'medical',   icon: 'health_and_safety', label: 'Médico + Objectivos', desc: 'Condições, objectivos, perfil atleta' },
    { id: 'emergency', icon: 'emergency',          label: 'Emergência + QR',    desc: 'Sangue, alergias, contactos, QR público',
      permission: 'features.emergency_qr' },
  ]},
  { label: 'Treino', icon: 'show_chart', color: '#fbbf24', items: [
    { id: 'zones', icon: 'show_chart', label: 'Zonas HR + Potência', desc: 'Zonas cardíacas e de potência editáveis' },
    { id: 'kromi', icon: 'psychology',  label: 'KROMI Intelligence',  desc: 'Auto-assist, aprendizagem',
      permission: 'features.intelligence_v2' },
  ]},
  { label: 'Bicicletas', icon: 'pedal_bike', color: '#3fff8b', items: [
    { id: 'bike',    icon: 'pedal_bike', label: 'As minhas bikes', desc: 'Bateria, motor, consumo, hardware' },
    { id: 'bikefit', icon: 'straighten', label: 'Bike Fit',        desc: '25 medidas, por bike, com histórico',
      permission: 'features.bike_fit' },
  ]},
  { label: 'Manutenção', icon: 'build', color: '#ff9f43', items: [
    { id: 'service-book', icon: 'menu_book', label: 'Caderneta de Serviço', desc: 'Histórico, custos, manutenção programada',
      permission: 'features.service_book' },
  ]},
  { label: 'Clube', icon: 'groups', color: '#fbbf24', items: [
    { id: 'club', icon: 'groups', label: 'O meu clube', desc: 'Gerir clube, membros, rides em grupo',
      permission: 'features.clubs' },
  ]},
  { label: 'Dispositivos', icon: 'bluetooth', color: '#6e9bff', items: [
    { id: 'bluetooth',   icon: 'bluetooth',       label: 'BLE + Sensores', desc: 'Ligação, sensores, estado' },
    { id: 'accessories', icon: 'flashlight_on',   label: 'Acessorios',     desc: 'Luz traseira, radar, auto-controlo' },
  ]},
  { label: 'Atividades', icon: 'timeline', color: '#e966ff', items: [], navigateTo: 'history' },
  { label: 'Mapa',       icon: 'map',      color: '#6e9bff', items: [], navigateTo: 'map' },
  { label: 'Oficina', icon: 'store', color: '#ff9f43', permission: 'features.shop_management', items: [
    { id: 'shop', icon: 'store', label: 'Gestão de Oficina', desc: 'Serviços, preços, calendário, equipa',
      permission: 'features.shop_management' },
  ]},
  { label: 'Sistema', icon: 'settings', color: '#adaaaa', items: [
    { id: 'routes',  icon: 'route',           label: 'Rotas',    desc: 'Import Komoot, histórico' },
    { id: 'account', icon: 'account_circle', label: 'Conta',    desc: 'Email, sessão, versão' },
    { id: 'privacy', icon: 'shield_person',  label: 'Privacidade', desc: 'Exportar dados, apagar conta (GDPR)' },
  ]},
];

/** Super-admin-only category appended dynamically by consumers. */
export const SUPER_ADMIN_CATEGORY: NavCategory = {
  label: 'Super Admin',
  icon: 'admin_panel_settings',
  color: '#ff9f43',
  items: [
    { id: 'super-admin', icon: 'admin_panel_settings', label: 'Painel Admin', desc: 'Utilizadores, roles, Drive, sistema' },
  ],
};

/** All distinct permission keys referenced by NAV_CATEGORIES (for batched lookups). */
export const NAV_PERMISSION_KEYS: string[] = Array.from(
  new Set(
    NAV_CATEGORIES.flatMap((c) => [
      ...(c.permission ? [c.permission] : []),
      ...c.items.map((i) => i.permission).filter((p): p is string => !!p),
    ])
  )
);

/** Flattened lookup table for back-header titles, etc. */
export const ALL_NAV_LEAVES: NavLeaf[] = NAV_CATEGORIES.flatMap((c) => c.items);

/**
 * Drop categories/leaves the user can't see.
 *
 * - A category that gates itself (has its own `permission`) is removed
 *   if the user doesn't have it.
 * - A category whose subitems all get filtered out is also removed,
 *   unless it's a `navigateTo` shortcut (which has no items).
 */
export function filterNavByPermissions(
  cats: NavCategory[],
  perms: Record<string, boolean>,
): NavCategory[] {
  return cats
    .filter((cat) => !cat.permission || perms[cat.permission])
    .map((cat) => ({
      ...cat,
      items: cat.items.filter((item) => !item.permission || perms[item.permission]),
    }))
    .filter((cat) => cat.navigateTo || cat.items.length > 0);
}
