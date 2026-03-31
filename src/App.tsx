import { useState } from 'react';
import { Dashboard } from './components/Dashboard/Dashboard';
import { Settings } from './components/Settings/Settings';
import { ConnectionStatus } from './components/shared/ConnectionStatus';

type Screen = 'dashboard' | 'map' | 'settings';

export function App() {
  const [screen, setScreen] = useState<Screen>('dashboard');

  return (
    <div className="h-full flex flex-col bg-gray-950 text-white">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {screen === 'dashboard' && <Dashboard />}
        {screen === 'settings' && <Settings />}
      </div>

      {/* Bottom navigation - big touch targets for gloves */}
      <nav className="flex-none grid grid-cols-3 border-t border-gray-800 bg-gray-900">
        <NavButton
          label="Dashboard"
          icon="speed"
          active={screen === 'dashboard'}
          onClick={() => setScreen('dashboard')}
        />
        <NavButton
          label="Mapa"
          icon="map"
          active={screen === 'map'}
          onClick={() => setScreen('map')}
        />
        <NavButton
          label="Config"
          icon="settings"
          active={screen === 'settings'}
          onClick={() => setScreen('settings')}
        />
      </nav>

      {/* Floating connection status */}
      <ConnectionStatus />
    </div>
  );
}

function NavButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center py-3 transition-colors ${
        active ? 'text-blue-400' : 'text-gray-500'
      }`}
    >
      <span className="material-symbols-outlined text-2xl">{icon}</span>
      <span className="text-xs mt-0.5">{label}</span>
    </button>
  );
}
