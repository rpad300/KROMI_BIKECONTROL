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
import { useAutoAssist } from './hooks/useAutoAssist';
import { useAuthStore } from './store/authStore';

type Screen = 'dashboard' | 'map' | 'climb' | 'connections' | 'settings' | 'history';

export function App() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const checkSession = useAuthStore((s) => s.checkSession);

  // Verify session on mount
  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Show loading spinner while checking session
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-950">
        <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not logged in → show login
  if (!user) {
    return <LoginPage />;
  }

  // Logged in → show main app
  return <MainApp />;
}

function MainApp() {
  const [screen, setScreen] = useState<Screen>('dashboard');

  // Global hooks — GPS + auto-assist run regardless of active screen
  useGeolocation();
  useAutoAssist();

  return (
    <div className="h-full flex flex-col bg-gray-950 text-white">
      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {screen === 'dashboard' && <Dashboard />}
        {screen === 'map' && <MapView />}
        {screen === 'climb' && <ClimbApproach />}
        {screen === 'connections' && <Connections />}
        {screen === 'settings' && <Settings onNavigate={setScreen} />}
        {screen === 'history' && <RideHistory />}
      </div>

      {/* Bottom navigation — 5 tabs, green accent */}
      <nav className="flex-none grid grid-cols-5 border-t border-gray-800 bg-gray-900">
        <NavButton label="Dash" icon="speed" active={screen === 'dashboard'} onClick={() => setScreen('dashboard')} />
        <NavButton label="Mapa" icon="map" active={screen === 'map'} onClick={() => setScreen('map')} />
        <NavButton label="Climb" icon="terrain" active={screen === 'climb'} onClick={() => setScreen('climb')} />
        <NavButton label="BLE" icon="bluetooth" active={screen === 'connections'} onClick={() => setScreen('connections')} />
        <NavButton label="Config" icon="settings" active={screen === 'settings'} onClick={() => setScreen('settings')} />
      </nav>

      {/* Floating connection status */}
      <ConnectionStatus />

      {/* BLE Bridge auto-setup (Android only) */}
      <BridgeSetup />
    </div>
  );
}

function NavButton({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) {
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
