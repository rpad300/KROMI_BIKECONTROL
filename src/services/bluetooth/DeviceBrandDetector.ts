/**
 * DeviceBrandDetector — identifies device brand and type from BLE name + UUIDs.
 *
 * Uses name patterns and advertised service UUIDs to determine:
 *   - Brand (Giant, Shimano, SRAM, iGPSPORT, Garmin, Wahoo, Polar, Magene, etc.)
 *   - Category (bike, drivetrain, heart_rate, power, cadence, light, radar, tpms, watch)
 *   - Icon (Material Symbols icon name)
 *   - Color (hex color for UI theming)
 */

// ── Types ───────────────────────────────────────────────────────

export type DeviceBrand =
  | 'giant' | 'bosch' | 'specialized' | 'shimano' | 'sram' | 'igpsport' | 'garmin'
  | 'fazua' | 'brose' | 'yamaha' | 'panasonic'
  | 'wahoo' | 'polar' | 'magene' | 'stages' | 'quarq'
  | 'favero' | 'elite' | 'tacx' | 'bryton' | 'sigma'
  | 'lezyne' | 'bontrager' | 'cateye' | 'huawei' | 'xiaomi'
  | 'samsung' | 'apple' | 'suunto' | 'coros' | 'unknown';

export type DeviceCategory =
  | 'bike' | 'drivetrain' | 'heart_rate' | 'power' | 'cadence'
  | 'speed' | 'light' | 'radar' | 'tpms' | 'watch' | 'computer'
  | 'trainer' | 'unknown';

export interface DeviceIdentity {
  brand: DeviceBrand;
  brandLabel: string;
  category: DeviceCategory;
  categoryLabel: string;
  icon: string;
  color: string;
  /** Short badge text for scanner/connections, e.g. "iGPSPORT" */
  badge: string;
}

// ── Brand detection rules ───────────────────────────────────────

interface BrandRule {
  brand: DeviceBrand;
  label: string;
  color: string;
  /** Name patterns (case-insensitive regex) */
  namePatterns: RegExp[];
  /** Service UUID patterns (partial match) */
  uuidPatterns?: string[];
}

const BRAND_RULES: BrandRule[] = [
  {
    brand: 'giant',
    label: 'Giant',
    color: '#3fff8b',
    namePatterns: [/^GBH/i, /^giant/i, /trance/i, /reign/i, /anthem/i, /defy/i, /tcr/i, /propel/i],
    uuidPatterns: ['f0ba3012', '0000fc23'],
  },
  {
    brand: 'bosch',
    label: 'Bosch',
    color: '#e11d48',
    namePatterns: [/bosch/i, /^nyon/i, /^kiox/i, /^intuvia/i, /^smartphonehub/i],
    uuidPatterns: ['424f5343', 'dc435fbe'], // "BOSC" prefix + fake DIS
  },
  {
    brand: 'specialized',
    label: 'Specialized',
    color: '#ef4444',
    namePatterns: [/specialized/i, /^turbo/i, /^levo/i, /^creo/i, /^vado/i, /^como/i, /^kenevo/i, /^tero/i, /^pluto/i],
    uuidPatterns: ['eaa2-11e9', '0000fe02', 'c0b11800', '3731-3032-494d', '4b49-4e4f-5254'],
  },
  {
    brand: 'fazua',
    label: 'Fazua',
    color: '#8b5cf6',
    namePatterns: [/fazua/i, /avinox/i, /^evation/i, /^ride\s?[56]0/i, /porsche.*ebike/i],
  },
  {
    brand: 'brose',
    label: 'Brose',
    color: '#f97316',
    namePatterns: [/brose/i, /^drive\s?[sctp]/i],
  },
  {
    brand: 'yamaha',
    label: 'Yamaha',
    color: '#0066cc',
    namePatterns: [/yamaha/i, /^pw-[scx]/i, /^pwseries/i],
  },
  {
    brand: 'shimano',
    label: 'Shimano',
    color: '#6e9bff',
    namePatterns: [/^shimano/i, /^di2/i, /^ep[0-9]/i, /^ew-/i, /^sc-/i, /^steps/i, /^sm-/i, /^e[5-8]\d{3}/i],
    uuidPatterns: ['6e40fec1', '18ef', '5348-494d-414e'],
  },
  {
    brand: 'sram',
    label: 'SRAM',
    color: '#fbbf24',
    namePatterns: [/^sram/i, /^axs/i, /^etap/i, /^quarq/i, /^rockshox/i, /^flight/i],
    uuidPatterns: ['4d500001'],
  },
  {
    brand: 'igpsport',
    label: 'iGPSPORT',
    color: '#ff9f43',
    namePatterns: [/^igps/i, /^vs1[0-9]/i, /^lr[0-9]/i, /^cad[0-9]/i, /^hr[0-9]/i, /^spd[0-9]/i, /^bsc[0-9]/i, /^igs[0-9]/i],
    uuidPatterns: ['e50e24dcca8e', 'e50e24dcca9e'],
  },
  {
    brand: 'garmin',
    label: 'Garmin',
    color: '#00b4d8',
    namePatterns: [/^garmin/i, /^varia/i, /^edge/i, /^vector/i, /^rally/i, /^hrm/i, /^fenix/i, /^forerunner/i, /^vivosmart/i, /^instinct/i, /^enduro/i, /^epix/i, /^rtl\d/i, /^ut\s?\d/i, /^hl\s?\d/i, /^tl\d/i],
    uuidPatterns: ['6a4e8022', '6a4e', '16aa8022'],
  },
  {
    brand: 'wahoo',
    label: 'Wahoo',
    color: '#2563eb',
    namePatterns: [/^wahoo/i, /^kickr/i, /^elemnt/i, /^tickr/i, /^rpm/i, /^headwind/i, /^speedplay/i],
  },
  {
    brand: 'polar',
    label: 'Polar',
    color: '#e11d48',
    namePatterns: [/^polar/i, /^oh1/i, /^verity/i, /^h[0-9]/i, /^vantage/i, /^grit/i, /^ignite/i, /^pacer/i],
  },
  {
    brand: 'magene',
    label: 'Magene',
    color: '#8b5cf6',
    namePatterns: [/^magene/i, /^s3\+/i, /^h303/i, /^h64/i, /^t[0-9]{3}/i, /^l508/i],
  },
  {
    brand: 'stages',
    label: 'Stages',
    color: '#14b8a6',
    namePatterns: [/^stages/i, /^stg-/i, /^dash/i],
  },
  {
    brand: 'favero',
    label: 'Favero',
    color: '#f59e0b',
    namePatterns: [/^favero/i, /^assioma/i],
  },
  {
    brand: 'elite',
    label: 'Elite',
    color: '#dc2626',
    namePatterns: [/^elite/i, /^direto/i, /^suito/i, /^zumo/i],
  },
  {
    brand: 'bryton',
    label: 'Bryton',
    color: '#059669',
    namePatterns: [/^bryton/i, /^rider/i, /^smart.*cad/i],
  },
  {
    brand: 'lezyne',
    label: 'Lezyne',
    color: '#64748b',
    namePatterns: [/^lezyne/i, /^mega/i, /^super.*gps/i],
  },
  {
    brand: 'huawei',
    label: 'Huawei',
    color: '#ef4444',
    namePatterns: [/^huawei/i, /^honor/i, /^band/i],
  },
  {
    brand: 'coros',
    label: 'COROS',
    color: '#7c3aed',
    namePatterns: [/^coros/i, /^pace/i, /^apex/i, /^vertix/i],
  },
  {
    brand: 'suunto',
    label: 'Suunto',
    color: '#0891b2',
    namePatterns: [/^suunto/i, /^race/i, /^vertical/i],
  },
];

// ── Category detection ──────────────────────────────────────────

interface CategoryRule {
  category: DeviceCategory;
  label: string;
  icon: string;
  /** Tags from APK bridge scan */
  tags?: string[];
  /** Name patterns */
  namePatterns?: RegExp[];
  /** Service UUIDs */
  uuids?: string[];
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    // Drivetrain MUST be checked before bike — devices can have both SHIMANO_STEPS and DI2 tags
    category: 'drivetrain',
    label: 'Drivetrain',
    icon: 'settings_suggest',
    tags: ['DI2', 'SRAM'],
    namePatterns: [/^di2/i, /^axs/i, /^etap/i, /^ew-/i, /^sram/i, /^shimano.*di2/i],
    uuids: ['6e40fec1', '4d500001'],
  },
  {
    category: 'bike',
    label: 'E-Bike',
    icon: 'electric_bike',
    tags: ['GIANT', 'GEV', 'BIKE', 'BOSCH', 'SPECIALIZED', 'SHIMANO_STEPS', 'FAZUA', 'YAMAHA'],
    uuids: ['f0ba3012', '424f5343', 'eaa2-11e9', '0000fe02', 'c0b11800', '18ef', '3731-3032-494d'],
    namePatterns: [/^GBH/i, /bosch/i, /^nyon/i, /^kiox/i, /turbo/i, /^levo/i, /^creo/i, /^vado/i, /^como/i, /^ep[0-9]/i, /avinox/i, /fazua/i, /yamaha/i, /^pw-/i, /^pluto/i],
  },
  {
    category: 'heart_rate',
    label: 'Heart Rate',
    icon: 'monitor_heart',
    tags: ['HR'],
    uuids: ['180d', '0x180d'],
    namePatterns: [/^hrm/i, /^tickr/i, /^oh1/i, /^verity/i, /^h[0-9]{1,2}$/i, /heart/i, /^polar h/i],
  },
  {
    category: 'power',
    label: 'Power Meter',
    icon: 'bolt',
    tags: ['POWER'],
    uuids: ['1818', '0x1818'],
    namePatterns: [/power/i, /^assioma/i, /^vector/i, /^rally/i, /^stages/i, /^quarq/i, /^p[12]m/i],
  },
  {
    category: 'cadence',
    label: 'Cadence',
    icon: 'speed',
    namePatterns: [/^cad/i, /cadence/i, /^rpm.*cad/i, /^bsc/i],
    uuids: ['1816'],
  },
  {
    category: 'speed',
    label: 'Speed',
    icon: 'speed',
    namePatterns: [/^spd/i, /speed/i, /^rpm.*spd/i],
  },
  {
    category: 'light',
    label: 'Light',
    icon: 'flashlight_on',
    namePatterns: [/^vs\d/i, /^lr\d/i, /light/i, /^ion/i, /^flare/i, /^bontrager.*light/i, /^volt/i, /^ampp/i, /^viz/i],
    uuids: ['e50e24dcca8e'],
  },
  {
    category: 'radar',
    label: 'Radar',
    icon: 'radar',
    namePatterns: [/^varia.*r/i, /radar/i, /^bryton.*radar/i, /^rtl\d/i],
    uuids: ['6a4e8022'], // Garmin Varia RTL service
  },
  {
    category: 'tpms',
    label: 'TPMS',
    icon: 'tire_repair',
    namePatterns: [/tpms/i, /tire.*press/i, /^tp[0-9]/i],
  },
  {
    category: 'watch',
    label: 'Watch',
    icon: 'watch',
    namePatterns: [/watch/i, /^fenix/i, /^forerunner/i, /^vantage/i, /^grit/i, /^pace/i, /^apex/i, /^band/i, /^vivosmart/i, /^instinct/i, /^epix/i, /^enduro/i],
  },
  {
    category: 'computer',
    label: 'GPS Computer',
    icon: 'computer',
    namePatterns: [/^edge/i, /^elemnt/i, /^rider/i, /^dash/i, /^igs[0-9]/i, /^mega.*gps/i],
  },
  {
    category: 'trainer',
    label: 'Trainer',
    icon: 'fitness_center',
    namePatterns: [/^kickr/i, /^direto/i, /^suito/i, /^zumo/i, /trainer/i, /^neo/i, /^flux/i],
  },
];

// ── Detection functions ─────────────────────────────────────────

/**
 * Detect device brand from name and UUIDs.
 */
function detectBrand(name: string, uuids: string): { brand: DeviceBrand; label: string; color: string } {
  const uuidsLower = uuids.toLowerCase();

  for (const rule of BRAND_RULES) {
    // Check name patterns
    if (rule.namePatterns.some(p => p.test(name))) {
      return { brand: rule.brand, label: rule.label, color: rule.color };
    }
    // Check UUID patterns
    if (rule.uuidPatterns?.some(u => uuidsLower.includes(u))) {
      return { brand: rule.brand, label: rule.label, color: rule.color };
    }
  }

  return { brand: 'unknown', label: '', color: '#777575' };
}

/**
 * Detect device category from name, tags, and UUIDs.
 */
function detectCategory(name: string, tags: string[], uuids: string): { category: DeviceCategory; label: string; icon: string } {
  const uuidsLower = uuids.toLowerCase();

  for (const rule of CATEGORY_RULES) {
    // Check tags from bridge
    if (rule.tags?.some(t => tags.includes(t))) {
      return { category: rule.category, label: rule.label, icon: rule.icon };
    }
    // Check name patterns
    if (rule.namePatterns?.some(p => p.test(name))) {
      return { category: rule.category, label: rule.label, icon: rule.icon };
    }
    // Check UUIDs
    if (rule.uuids?.some(u => uuidsLower.includes(u))) {
      return { category: rule.category, label: rule.label, icon: rule.icon };
    }
  }

  return { category: 'unknown', label: 'Device', icon: 'bluetooth' };
}

/**
 * Full device identification — brand + category + UI metadata.
 */
export function identifyDevice(name: string, tags: string[] = [], uuids = ''): DeviceIdentity {
  const { brand, label: brandLabel, color } = detectBrand(name, uuids);
  const { category, label: categoryLabel, icon } = detectCategory(name, tags, uuids);

  return {
    brand,
    brandLabel,
    category,
    categoryLabel,
    icon,
    color,
    badge: brandLabel || categoryLabel,
  };
}

/**
 * Get a display-friendly category group label for the Connections page.
 */
export function getCategoryGroup(category: DeviceCategory): {
  group: string;
  label: string;
  icon: string;
  color: string;
  order: number;
} {
  switch (category) {
    case 'bike':       return { group: 'bike', label: 'E-Bike', icon: 'electric_bike', color: '#3fff8b', order: 0 };
    case 'drivetrain': return { group: 'drivetrain', label: 'Drivetrain', icon: 'settings_suggest', color: '#6e9bff', order: 1 };
    case 'heart_rate':
    case 'watch':      return { group: 'body', label: 'Body Sensors', icon: 'monitor_heart', color: '#ff716c', order: 2 };
    case 'power':
    case 'cadence':
    case 'speed':      return { group: 'performance', label: 'Performance', icon: 'bolt', color: '#fbbf24', order: 3 };
    case 'light':
    case 'radar':      return { group: 'accessories', label: 'Accessories', icon: 'flashlight_on', color: '#ff9f43', order: 4 };
    case 'tpms':       return { group: 'tpms', label: 'TPMS', icon: 'tire_repair', color: '#14b8a6', order: 5 };
    case 'computer':
    case 'trainer':    return { group: 'other', label: 'Other Devices', icon: 'devices', color: '#94a3b8', order: 6 };
    default:           return { group: 'other', label: 'Other', icon: 'bluetooth', color: '#777575', order: 7 };
  }
}

/**
 * Identify saved device from name only (no tags/UUIDs available).
 */
export function identifyByName(name: string): DeviceIdentity {
  return identifyDevice(name, [], '');
}
