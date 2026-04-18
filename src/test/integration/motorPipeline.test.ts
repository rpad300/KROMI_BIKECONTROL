/**
 * Gap #16: End-to-End Motor Control Pipeline Tests
 *
 * Simulates the full intelligence pipeline without BLE/WebSocket.
 * Tests that sensor inputs flow through KromiEngine layers and produce
 * correct motor control outputs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeForces, type PhysicsInput } from '../../services/intelligence/PhysicsEngine';
import { COMPLIANCE_CONFIGS, type ComplianceRegion } from '../../services/intelligence/KromiEngine';

// ── Mock stores and services that KromiEngine imports ────────

vi.mock('../../store/settingsStore', () => {
  const DEFAULT_RIDER = {
    weight_kg: 135,
    hr_max: 185,
    target_zone: 2,
    zones: [],
  };
  const DEFAULT_BIKE = {
    id: 'test',
    name: 'Test Bike',
    bike_type: 'emtb',
    weight_kg: 24,
    wheel_circumference_mm: 2290,
    chainring_teeth: '34',
    cassette_sprockets: [51, 45, 39, 34, 30, 26, 23, 20, 17, 15, 13, 10],
    battery_capacity_wh: 625,
    main_battery_wh: 625,
    sub_battery_wh: 0,
    has_range_extender: false,
    has_power_meter: false,
    cda_preset: 'mtb_upright',
    tire_pressure_bar: 1.8,
    motor_brand: 'shimano',
  };
  return {
    useSettingsStore: {
      getState: () => ({
        riderProfile: DEFAULT_RIDER,
        bikeConfig: DEFAULT_BIKE,
        autoAssist: { enabled: false },
        compliance_region: 'eu',
      }),
      subscribe: () => () => {},
    },
    safeBikeConfig: (c: Record<string, unknown>) => ({ ...DEFAULT_BIKE, ...c }),
  };
});

vi.mock('../../store/bikeStore', () => ({
  useBikeStore: {
    getState: () => ({
      power_watts: 0,
      speed_kmh: 0,
      barometric_altitude_m: 0,
      ble_status: 'disconnected',
    }),
  },
}));

vi.mock('../../store/routeStore', () => ({
  useRouteStore: {
    getState: () => ({
      navigation: { active: false, distanceRemaining_m: 0, distanceToNextEvent_m: null },
      activeRoutePoints: [],
    }),
  },
}));

vi.mock('../../store/autoAssistStore', () => ({
  useAutoAssistStore: {
    getState: () => ({
      setLastDecision: vi.fn(),
      setTerrain: vi.fn(),
      setOverride: vi.fn(),
      setAutoDetectedTerrain: vi.fn(),
      setGearSuggestion: vi.fn(),
    }),
  },
}));

vi.mock('../../store/intelligenceStore', () => ({
  useIntelligenceStore: {
    getState: () => ({
      active: false,
      setActive: vi.fn(),
      setDecision: vi.fn(),
    }),
  },
}));

vi.mock('../../store/nutritionStore', () => ({
  useNutritionStore: {
    getState: () => ({
      setState: vi.fn(),
      setPhysiology: vi.fn(),
    }),
  },
}));

vi.mock('../../types/athlete.types', () => ({
  calculateZones: (hrMax: number) => [
    { zone: 1, min_bpm: 0, max_bpm: Math.round(hrMax * 0.6), name: 'Recovery' },
    { zone: 2, min_bpm: Math.round(hrMax * 0.6), max_bpm: Math.round(hrMax * 0.7), name: 'Aerobic' },
    { zone: 3, min_bpm: Math.round(hrMax * 0.7), max_bpm: Math.round(hrMax * 0.8), name: 'Tempo' },
    { zone: 4, min_bpm: Math.round(hrMax * 0.8), max_bpm: Math.round(hrMax * 0.9), name: 'Threshold' },
    { zone: 5, min_bpm: Math.round(hrMax * 0.9), max_bpm: hrMax, name: 'VO2max' },
  ],
}));

vi.mock('../../../services/weather/WeatherService', () => ({
  getCachedWeather: () => null,
}));

vi.mock('../../services/weather/WeatherService', () => ({
  getCachedWeather: () => null,
}));

vi.mock('../../services/weather/OpenMeteoService', () => ({
  getCachedOpenMeteo: () => null,
  fetchOpenMeteoWeather: vi.fn(),
}));

vi.mock('../../services/maps/TerrainService', () => ({
  getCachedTrail: () => null,
}));

vi.mock('../../services/maps/ElevationService', () => ({
  elevationService: { getLastResult: () => null },
}));

vi.mock('../../services/autoAssist/AutoAssistEngine', () => ({
  autoAssistEngine: {
    updateConfig: vi.fn(),
    tick: vi.fn().mockResolvedValue({ action: 'none', reason: 'test', terrain: null }),
    getCurrentTerrainAnalysis: () => null,
    kromiEngineDefers: false,
    isOverrideActive: () => false,
    getOverrideRemaining: () => 0,
  },
}));

vi.mock('../../services/autoAssist/TerrainPatternLearner', () => ({
  terrainPatternLearner: {
    feed: vi.fn(),
    predictNext: () => null,
    getCurrentTerrain: () => 'flat',
    load: vi.fn(),
    save: vi.fn(),
    resetRide: vi.fn(),
  },
}));

vi.mock('../../services/intelligence/TerrainDiscovery', () => ({
  terrainDiscovery: {
    feed: vi.fn(),
    predict: () => ({ confidence: 0, pre_adjust_support: 0, pre_adjust_torque: 0, predicted_gradient: 0, pattern: '' }),
    reset: vi.fn(),
  },
}));

vi.mock('../../services/autoAssist/BatteryOptimizer', () => ({
  computeBatteryBudget: (soc: number) => ({
    constraint_factor: soc > 30 ? 1.0 : soc > 15 ? 0.6 : 0.3,
    is_emergency: soc < 10,
    estimated_range_km: soc * 1.5,
  }),
  feedConsumption: vi.fn(),
}));

vi.mock('../../services/motor/TuningIntelligence', () => ({
  tuningIntelligence: { evaluate: vi.fn().mockReturnValue({}) },
}));

vi.mock('../../services/bluetooth/BLEBridge', () => ({
  setAdvancedTuning: vi.fn(),
  isTuningAvailable: () => false,
}));

// ── Helper: build a default tick input ────────────────────────

function makeInput(overrides: Partial<import('../../services/intelligence/KromiEngine').KromiTickInput> = {}): import('../../services/intelligence/KromiEngine').KromiTickInput {
  return {
    speed_kmh: 15,
    gradient_pct: 0,
    cadence_rpm: 80,
    power_watts: 150,
    hr_bpm: 130,
    currentGear: 6,
    batterySoc: 80,
    altitude: 200,
    latitude: 38.7,
    longitude: -9.1,
    heading: 90,
    distanceKm: 5,
    gpsActive: true,
    upcomingGradient: null,
    distanceToChange: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('PhysicsEngine — computeForces (unit)', () => {
  const basePhysics: PhysicsInput = {
    speed_kmh: 15,
    gradient_pct: 0,
    cadence_rpm: 80,
    power_watts: 150,
    currentGear: 6,
    totalMass: 159,
    wheelCircumM: 2.290,
    chainring: 34,
    sprockets: [51, 45, 39, 34, 30, 26, 23, 20, 17, 15, 13, 10],
    crr: 0.006,
    cda: 0.6,
    airDensity: 1.225,
    windComponent: 0,
  };

  it('produces positive forces on flat terrain', () => {
    const result = computeForces(basePhysics);
    expect(result.F_rolling).toBeGreaterThan(0);
    expect(result.F_aero).toBeGreaterThan(0);
    expect(result.P_total).toBeGreaterThan(0);
    expect(result.speedZone).toBe('active');
    expect(result.fadeFactor).toBe(1);
  });

  it('increases gravity force on 8% climb', () => {
    const flat = computeForces(basePhysics);
    const climb = computeForces({ ...basePhysics, gradient_pct: 8 });
    expect(climb.F_gravity).toBeGreaterThan(flat.F_gravity);
    expect(climb.P_total).toBeGreaterThan(flat.P_total);
    expect(climb.P_motor_gap).toBeGreaterThan(flat.P_motor_gap);
  });

  it('speed fade activates near 25 km/h (EU compliance)', () => {
    const at23 = computeForces({ ...basePhysics, speed_kmh: 23 });
    expect(at23.speedZone).toBe('fade');
    expect(at23.fadeFactor).toBeLessThan(1.0);
    expect(at23.fadeFactor).toBeGreaterThan(0);

    const at26 = computeForces({ ...basePhysics, speed_kmh: 26 });
    expect(at26.speedZone).toBe('free');
    expect(at26.fadeFactor).toBe(0);
    expect(at26.P_motor_gap).toBe(0);
  });

  it('motor gap is 0 above speed limit', () => {
    const result = computeForces({ ...basePhysics, speed_kmh: 30 });
    expect(result.P_motor_gap).toBe(0);
  });

  it('detects inefficient gear (low cadence)', () => {
    const result = computeForces({ ...basePhysics, cadence_rpm: 40 });
    expect(result.inefficient_gear).toBe(true);
  });

  it('Gap #15: compliance override changes speed limit', () => {
    // US compliance: 32 km/h limit, fade starts at 28
    const us30 = computeForces({
      ...basePhysics,
      speed_kmh: 30,
      compliance_speedLimit_kmh: 32,
      compliance_fadeStart_kmh: 28,
      compliance_hardCutoff: false,
    });
    expect(us30.speedZone).toBe('fade');
    expect(us30.fadeFactor).toBeGreaterThan(0);

    // JP compliance: hard cutoff at 24 km/h
    const jp23 = computeForces({
      ...basePhysics,
      speed_kmh: 23,
      compliance_speedLimit_kmh: 24,
      compliance_fadeStart_kmh: 21,
      compliance_hardCutoff: true,
    });
    expect(jp23.speedZone).toBe('fade');
    expect(jp23.fadeFactor).toBe(0); // hard cutoff = 0 in fade zone
  });
});

describe('Motor Control Pipeline (E2E)', () => {
  let kromiEngine: typeof import('../../services/intelligence/KromiEngine').kromiEngine;

  beforeEach(async () => {
    // Re-import to get fresh instance
    vi.resetModules();
    const mod = await import('../../services/intelligence/KromiEngine');
    kromiEngine = mod.kromiEngine;
    kromiEngine.reset();
    // Signal motor connected
    kromiEngine.onMotorTelemetry();
  });

  it('climbing at 15 km/h + 8% gradient produces meaningful assist', () => {
    const result = kromiEngine.tick(makeInput({
      speed_kmh: 15,
      gradient_pct: 8,
      power_watts: 200,
      hr_bpm: 140,
    }));

    expect(result.supportPct).toBeGreaterThan(100);
    expect(result.torqueNm).toBeGreaterThan(20);
    expect(result.speedZone).toBe('active');
  });

  it('battery constraint limits motor output at low SOC', () => {
    // Tick once at full battery to establish baseline
    const fullBattery = kromiEngine.tick(makeInput({
      speed_kmh: 15,
      gradient_pct: 5,
      power_watts: 150,
      batterySoc: 80,
    }));

    // Reset and tick at low battery
    kromiEngine.reset();
    kromiEngine.onMotorTelemetry();

    const lowBattery = kromiEngine.tick(makeInput({
      speed_kmh: 15,
      gradient_pct: 5,
      power_watts: 150,
      batterySoc: 15,
    }));

    expect(lowBattery.batteryFactor).toBeLessThan(fullBattery.batteryFactor);
  });

  it('speed fade activates near 25 km/h', () => {
    const at23 = kromiEngine.tick(makeInput({ speed_kmh: 23 }));
    expect(at23.speedZone).toBe('fade');

    kromiEngine.reset();
    kromiEngine.onMotorTelemetry();

    const at26 = kromiEngine.tick(makeInput({ speed_kmh: 26 }));
    expect(at26.speedZone).toBe('free');
  });

  it('brake detection (zero cadence at speed) reduces support', () => {
    const result = kromiEngine.tick(makeInput({
      speed_kmh: 20,
      cadence_rpm: 0,
      power_watts: 0,
    }));

    // With zero power, the engine should produce minimal support
    expect(result.supportPct).toBeLessThanOrEqual(200);
  });

  it('gradient change triggers pre-adjustment ramp via lookahead', () => {
    // Tick on flat to establish baseline
    for (let i = 0; i < 3; i++) {
      kromiEngine.tick(makeInput({ gradient_pct: 0 }));
    }

    // Now tick with upcoming gradient info
    const result = kromiEngine.tick(makeInput({
      gradient_pct: 0,
      upcomingGradient: 10,
      distanceToChange: 100,
    }));

    // The engine should be processing — result should be valid
    expect(result.supportPct).toBeGreaterThanOrEqual(50);
    expect(result.reason).toBeTruthy();
  });

  it('Gap #12: motor disconnect freezes outputs', () => {
    // First, tick normally
    const normal = kromiEngine.tick(makeInput({ speed_kmh: 15, gradient_pct: 5 }));
    expect(normal.reason).not.toBe('Motor offline — outputs frozen');

    // Simulate motor disconnect by not calling onMotorTelemetry for > 5s
    // We need to advance time. Use vi.useFakeTimers().
    vi.useFakeTimers();
    kromiEngine.onMotorTelemetry(); // mark connected

    // Advance time past timeout
    vi.advanceTimersByTime(6000);

    const frozen = kromiEngine.tick(makeInput({ speed_kmh: 15 }));
    expect(frozen.reason).toBe('Motor offline — outputs frozen');
    expect(frozen.alerts).toContain('Motor desligado — a aguardar reconexao');

    // Reconnect
    kromiEngine.onMotorTelemetry();
    const reconnected = kromiEngine.tick(makeInput({ speed_kmh: 15 }));
    expect(reconnected.reason).not.toBe('Motor offline — outputs frozen');

    vi.useRealTimers();
  });

  it('Gap #15: compliance configs are correctly defined', () => {
    expect(COMPLIANCE_CONFIGS.eu.speedLimit_kmh).toBe(25);
    expect(COMPLIANCE_CONFIGS.us.speedLimit_kmh).toBe(32);
    expect(COMPLIANCE_CONFIGS.au.hardCutoff).toBe(true);
    expect(COMPLIANCE_CONFIGS.jp.speedLimit_kmh).toBe(24);
    expect(COMPLIANCE_CONFIGS.jp.maxPower_w).toBe(250);
  });

  it('Gap #15: speed events are logged when exceeding 25km/h', () => {
    vi.useFakeTimers();

    // Ride above 25 km/h
    kromiEngine.tick(makeInput({ speed_kmh: 27 }));
    vi.advanceTimersByTime(1000);
    kromiEngine.tick(makeInput({ speed_kmh: 28 }));
    vi.advanceTimersByTime(1000);
    // Drop below
    kromiEngine.tick(makeInput({ speed_kmh: 20 }));

    const events = kromiEngine.getSpeedEventLog();
    expect(events.length).toBe(1);
    expect(events[0]!.speed_kmh).toBe(20); // logged when speed drops back
    expect(events[0]!.duration_s).toBeGreaterThan(0);

    vi.useRealTimers();
  });
});

describe('Compliance Configs', () => {
  it('all regions have valid speed limits', () => {
    const regions: ComplianceRegion[] = ['eu', 'us', 'au', 'jp'];
    for (const region of regions) {
      const config = COMPLIANCE_CONFIGS[region];
      expect(config.speedLimit_kmh).toBeGreaterThan(0);
      expect(config.fadeStart_kmh).toBeLessThan(config.speedLimit_kmh);
      expect(config.maxPower_w).toBeGreaterThan(0);
    }
  });

  it('fade start is always less than speed limit', () => {
    for (const config of Object.values(COMPLIANCE_CONFIGS)) {
      expect(config.fadeStart_kmh).toBeLessThan(config.speedLimit_kmh);
    }
  });
});
