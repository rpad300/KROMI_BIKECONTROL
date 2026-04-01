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
      <div className="h-full flex items-center justify-center bg-gray-950">
        <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
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
    <div className="h-full flex flex-col bg-gray-950 text-white">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {screen === 'dashboard' && <Dashboard />}
        {screen === 'map' && <MapView />}
        {screen === 'climb' && <ClimbApproach />}
        {screen === 'connections' && <Connections />}
        {screen === 'settings' && <Settings onNavigate={setScreen} />}
        {screen === 'history' && <RideHistory />}
      </div>

      <nav className="flex-none grid grid-cols-5 border-t border-gray-800 bg-gray-900">
        <NavButton label="Dash" icon="speed" active={screen === 'dashboard'} onClick={() => setScreen('dashboard')} />
        <NavButton label="Mapa" icon="map" active={screen === 'map'} onClick={() => setScreen('map')} />
        <NavButton label="Climb" icon="terrain" active={screen === 'climb'} onClick={() => setScreen('climb')} />
        <NavButton label="BLE" icon="bluetooth" active={screen === 'connections'} onClick={() => setScreen('connections')} />
        <NavButton label="Config" icon="settings" active={screen === 'settings'} onClick={() => setScreen('settings')} />
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
    <div className="h-full flex bg-gray-950 text-white">
      {/* Sidebar */}
      <aside className="w-64 flex-none flex flex-col border-r border-gray-800 bg-gray-900">
        {/* Logo */}
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-xl font-bold text-emerald-400">KROMI</h1>
          <p className="text-xs text-gray-500 mt-1">BikeControl</p>
        </div>

        {/* Nav items */}
        <nav className="flex-1 p-3 space-y-1">
          {DESKTOP_NAV.map((item) => (
            <button
              key={item.screen}
              onClick={() => setScreen(item.screen)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                screen === item.screen
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-xl">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* Desktop info banner */}
        <div className="p-4 m-3 bg-gray-800 rounded-xl">
          <p className="text-xs text-gray-400">
            Modo desktop — configuração e histórico.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Para controlo do motor e dashboard live, abre no telemóvel Android.
          </p>
        </div>

        {/* User + logout */}
        <div className="p-4 border-t border-gray-800">
          <div className="text-xs text-gray-500 truncate">{user?.email}</div>
          <button
            onClick={logout}
            className="mt-2 text-xs text-red-400 hover:text-red-300"
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
      className={`flex flex-col items-center justify-center py-3 transition-colors min-h-[56px] ${
        active ? 'text-emerald-400' : 'text-gray-500'
      }`}
    >
      <span className="material-symbols-outlined text-2xl">{icon}</span>
      <span className="text-[10px] mt-0.5 font-medium">{label}</span>
    </button>
  );
}
