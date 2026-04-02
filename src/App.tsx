import { useState, useEffect } from 'react';
import { Dashboard } from './components/Dashboard/Dashboard';
import { MapView } from './components/Map/MapView';
import { ClimbApproach } from './components/Climb/ClimbApproach';
import { Connections } from './components/Connections/Connections';
import { Settings } from './components/Settings/Settings';
import { RideHistory } from './components/History/RideHistory';
import { LoginPage } from './components/Auth/LoginPage';
import { ConnectionStatus } from './components/shared/ConnectionStatus';
import { BridgeSetup } from './components/shared/BridgeSetup';
import { useGeolocation } from './hooks/useGeolocation';
import { useMotorControl } from './hooks/useMotorControl';
import { useAuthStore } from './store/authStore';
import { usePlatform } from './hooks/usePlatform';
import { LiveRideView } from './components/LiveRide/LiveRideView';
import { startSettingsSync } from './services/sync/SettingsSyncService';
import { trackLogin } from './services/sync/LoginTracker';

type MobileScreen = 'dashboard' | 'map' | 'climb' | 'connections' | 'settings' | 'history';
type DesktopScreen = 'live' | 'settings' | 'history' | 'map';

export function App() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const checkSession = useAuthStore((s) => s.checkSession);

  useEffect(() => { checkSession(); }, [checkSession]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-ev-bg">
        <div className="w-10 h-10 border-2 border-ev-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return <MainApp />;
}

function MainApp() {
  const platform = usePlatform();

  // Sync settings from/to DB + track login (once on mount)
  useEffect(() => {
    trackLogin();
    const unsub = startSettingsSync();
    return unsub;
  }, []);

  return platform === 'mobile' ? <MobileApp /> : <DesktopApp />;
}

// ═══════════════════════════════════════════════════
// MOBILE — full PWA with BLE, dashboard, motor control
// ═══════════════════════════════════════════════════

function MobileApp() {
  const [screen, setScreen] = useState<MobileScreen>('dashboard');

  useGeolocation();
  useMotorControl();

  return (
    <div className="h-full flex flex-col bg-ev-bg text-ev-on-surface">
      {/* Content — no scroll on dashboard, scroll on settings/history */}
      <div className={`flex-1 min-h-0 ${screen === 'settings' || screen === 'history' ? 'overflow-y-auto' : 'overflow-hidden'}`}>
        {screen === 'dashboard' && <Dashboard />}
        {screen === 'map' && <MapView />}
        {screen === 'climb' && <ClimbApproach />}
        {screen === 'connections' && <Connections />}
        {screen === 'settings' && <Settings onNavigate={setScreen} />}
        {screen === 'history' && <RideHistory />}
      </div>

      {/* Bottom Nav — Stitch style */}
      <nav className="flex-none flex justify-around items-center h-20 bg-ev-bg/90 backdrop-blur-xl border-t border-ev-primary/10 shadow-[0_-4px_24px_rgba(0,0,0,0.8)]">
        <NavButton label="Dash" icon="speed" active={screen === 'dashboard'} onClick={() => setScreen('dashboard')} />
        <NavButton label="Map" icon="map" active={screen === 'map'} onClick={() => setScreen('map')} />
        <NavButton label="Climb" icon="terrain" active={screen === 'climb'} onClick={() => setScreen('climb')} />
        <NavButton label="BLE" icon="settings_bluetooth" active={screen === 'connections'} onClick={() => setScreen('connections')} />
        <NavButton label="Setup" icon="settings" active={screen === 'settings'} onClick={() => setScreen('settings')} />
      </nav>

      <ConnectionStatus />
      <BridgeSetup />
    </div>
  );
}

// ═══════════════════════════════════════════════════
// DESKTOP — config, history, map review (no BLE needed)
// ═══════════════════════════════════════════════════

const DESKTOP_NAV: { screen: DesktopScreen; label: string; icon: string }[] = [
  { screen: 'live', label: 'Volta Live', icon: 'directions_bike' },
  { screen: 'settings', label: 'Configuração', icon: 'settings' },
  { screen: 'history', label: 'Histórico', icon: 'history' },
  { screen: 'map', label: 'Mapa', icon: 'map' },
];

function DesktopApp() {
  const [screen, setScreen] = useState<DesktopScreen>('live');
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="h-full flex bg-ev-bg text-ev-on-surface">
      {/* Sidebar */}
      <aside className="w-64 flex-none flex flex-col border-r border-ev-outline-variant/20 bg-ev-surface-low">
        {/* Logo */}
        <div className="p-6 border-b border-ev-outline-variant/20">
          <h1 className="text-xl font-headline font-bold text-ev-primary tracking-tight">STEALTH-EV</h1>
          <p className="text-xs text-ev-on-surface-variant mt-1 font-label uppercase tracking-widest">BikeControl</p>
        </div>

        {/* Nav items */}
        <nav className="flex-1 p-3 space-y-1">
          {DESKTOP_NAV.map((item) => (
            <button
              key={item.screen}
              onClick={() => setScreen(item.screen)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                screen === item.screen
                  ? 'bg-ev-primary/10 text-ev-primary border-l-2 border-ev-primary'
                  : 'text-ev-on-surface-variant hover:bg-ev-surface-high hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-xl">{item.icon}</span>
              <span className="font-label">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Desktop info banner */}
        <div className="p-4 m-3 bg-ev-surface-container">
          <p className="text-xs text-ev-on-surface-variant">
            Modo desktop — configuração e histórico.
          </p>
          <p className="text-xs text-ev-outline mt-1">
            Para dashboard live, abre no Android.
          </p>
        </div>

        {/* User + logout */}
        <div className="p-4 border-t border-ev-outline-variant/20">
          <div className="text-xs text-ev-outline truncate">{user?.email}</div>
          <button
            onClick={logout}
            className="mt-2 text-xs text-ev-error hover:text-ev-error-dim"
          >
            Terminar sessão
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto py-6">
          {screen === 'live' && <LiveRideView />}
          {screen === 'settings' && <Settings />}
          {screen === 'history' && <RideHistory />}
          {screen === 'map' && <MapView />}
        </div>
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Shared components
// ═══════════════════════════════════════════════════

function NavButton({ label, icon, active, onClick }: {
  label: string; icon: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-16 h-16 active:scale-90 transition-all duration-150 ${
        active
          ? 'bg-ev-primary text-black rounded-sm'
          : 'text-zinc-400 hover:text-ev-primary'
      }`}
    >
      <span
        className="material-symbols-outlined text-2xl"
        style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
      >{icon}</span>
      <span className="font-body font-bold text-[10px] uppercase mt-1">{label}</span>
    </button>
  );
}
