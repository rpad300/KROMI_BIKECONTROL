import { useState, useEffect } from 'react';
import { Dashboard } from './components/Dashboard/Dashboard';
import { MapView } from './components/Map/MapView';
import { Settings } from './components/Settings/Settings';
import { LoginPage } from './components/Auth/LoginPage';
import { ConnectionStatus } from './components/shared/ConnectionStatus';
import { useGeolocation } from './hooks/useGeolocation';
import { useAutoAssist } from './hooks/useAutoAssist';
import { useAuthStore } from './store/authStore';

type Screen = 'dashboard' | 'map' | 'settings';

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
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
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
      <div className="flex-1 overflow-y-auto">
        {screen === 'dashboard' && <Dashboard />}
        {screen === 'map' && <MapView />}
        {screen === 'settings' && <Settings />}
      </div>

      {/* Bottom navigation - big touch targets for gloves */}
      <nav className="flex-none grid grid-cols-3 border-t border-gray-800 bg-gray-900">
        <NavButton label="Dashboard" icon="speed" active={screen === 'dashboard'} onClick={() => setScreen('dashboard')} />
        <NavButton label="Mapa" icon="map" active={screen === 'map'} onClick={() => setScreen('map')} />
        <NavButton label="Config" icon="settings" active={screen === 'settings'} onClick={() => setScreen('settings')} />
      </nav>

      {/* Floating connection status */}
      <ConnectionStatus />
    </div>
  );
}

function NavButton({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center py-3 transition-colors ${active ? 'text-blue-400' : 'text-gray-500'}`}
    >
      <span className="material-symbols-outlined text-2xl">{icon}</span>
      <span className="text-xs mt-0.5">{label}</span>
    </button>
  );
}
