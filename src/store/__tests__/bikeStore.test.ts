import { describe, it, expect, beforeEach } from 'vitest';
import { useBikeStore } from '../bikeStore';
import { AssistMode } from '../../types/bike.types';

describe('bikeStore', () => {
  beforeEach(() => {
    // Reset store to initial state between tests
    useBikeStore.setState({
      battery_percent: 0,
      speed_kmh: 0,
      cadence_rpm: 0,
      power_watts: 0,
      assist_mode: AssistMode.ECO,
      distance_km: 0,
      ride_time_s: 0,
      power_avg: 0,
      power_max: 0,
      speed_max: 0,
      hr_bpm: 0,
      hr_zone: 0,
      gear: 0,
      is_shifting: false,
      torque_nm: 0,
      lights: [],
      ble_status: 'disconnected',
    });
  });

  describe('initial state', () => {
    it('has zero values by default', () => {
      const state = useBikeStore.getState();
      expect(state.battery_percent).toBe(0);
      expect(state.speed_kmh).toBe(0);
      expect(state.power_watts).toBe(0);
      expect(state.distance_km).toBe(0);
      expect(state.assist_mode).toBe(AssistMode.ECO);
      expect(state.ble_status).toBe('disconnected');
    });
  });

  describe('setBatteryPercent', () => {
    it('updates battery level', () => {
      useBikeStore.getState().setBatteryPercent(75);
      expect(useBikeStore.getState().battery_percent).toBe(75);
    });
  });

  describe('setSpeed', () => {
    it('updates speed and rounds to 1 decimal', () => {
      useBikeStore.getState().setSpeed(25.678);
      expect(useBikeStore.getState().speed_kmh).toBe(25.7);
    });

    it('tracks speed_max', () => {
      useBikeStore.getState().setSpeed(30);
      useBikeStore.getState().setSpeed(20);
      expect(useBikeStore.getState().speed_max).toBe(30);
    });
  });

  describe('setPower', () => {
    it('updates power and tracks max', () => {
      useBikeStore.getState().setPower(250);
      useBikeStore.getState().setPower(150);
      expect(useBikeStore.getState().power_watts).toBe(150);
      expect(useBikeStore.getState().power_max).toBe(250);
    });
  });

  describe('setAssistMode', () => {
    it('changes assist mode', () => {
      useBikeStore.getState().setAssistMode(AssistMode.SPORT);
      expect(useBikeStore.getState().assist_mode).toBe(AssistMode.SPORT);
    });
  });

  describe('setHR', () => {
    it('sets heart rate and zone', () => {
      useBikeStore.getState().setHR(155, 4);
      const state = useBikeStore.getState();
      expect(state.hr_bpm).toBe(155);
      expect(state.hr_zone).toBe(4);
    });
  });

  describe('setGear', () => {
    it('sets gear and clears shifting flag', () => {
      useBikeStore.setState({ is_shifting: true });
      useBikeStore.getState().setGear(7);
      const state = useBikeStore.getState();
      expect(state.gear).toBe(7);
      expect(state.is_shifting).toBe(false);
    });
  });

  describe('resetSession', () => {
    it('resets session stats to zero', () => {
      useBikeStore.getState().setSpeed(45);
      useBikeStore.getState().setPower(300);
      useBikeStore.getState().setDistance(12.5);
      useBikeStore.getState().resetSession();

      const state = useBikeStore.getState();
      expect(state.distance_km).toBe(0);
      expect(state.ride_time_s).toBe(0);
      expect(state.power_avg).toBe(0);
      expect(state.power_max).toBe(0);
      expect(state.speed_max).toBe(0);
    });
  });

  describe('BLE service status', () => {
    it('sets individual service connection status', () => {
      useBikeStore.getState().setServiceConnected('battery', true);
      useBikeStore.getState().setServiceConnected('power', true);
      const services = useBikeStore.getState().ble_services;
      expect(services.battery).toBe(true);
      expect(services.power).toBe(true);
      expect(services.csc).toBe(false);
    });
  });

  describe('lights management', () => {
    it('adds a light and syncs legacy fields', () => {
      useBikeStore.getState().addLight({
        id: 'front-1',
        name: 'VS1800S',
        position: 'front',
        brand: 'igpsport',
        battery_pct: 80,
        mode: 3,
        connected: true,
      });

      const state = useBikeStore.getState();
      expect(state.lights).toHaveLength(1);
      expect(state.light_device_name).toBe('VS1800S');
      expect(state.light_battery_pct).toBe(80);
    });

    it('removes a light by id', () => {
      useBikeStore.getState().addLight({
        id: 'front-1',
        name: 'VS1800S',
        position: 'front',
        brand: 'igpsport',
        battery_pct: 80,
        mode: 3,
        connected: true,
      });
      useBikeStore.getState().removeLight('front-1');
      expect(useBikeStore.getState().lights).toHaveLength(0);
    });
  });
});
